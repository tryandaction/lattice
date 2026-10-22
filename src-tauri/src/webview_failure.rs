//! Minimal native process diagnostics; never include URLs, prompts, or headers.
//! Recovery mitigates a crashed renderer; it does not diagnose its root cause.

#[cfg(any(windows, test))]
use std::time::Duration;

#[cfg(any(windows, test))]
const RECOVERY_WINDOW: Duration = Duration::from_secs(600);

#[cfg(any(windows, test))]
#[derive(Default)]
struct RecoveryBudget {
    last_reload: Option<Duration>,
}

#[cfg(any(windows, test))]
impl RecoveryBudget {
    fn allow_renderer_reload(&mut self, now: Duration) -> bool {
        if self
            .last_reload
            .is_some_and(|last| now.saturating_sub(last) < RECOVERY_WINDOW)
        {
            return false;
        }
        self.last_reload = Some(now);
        true
    }
}

#[cfg(windows)]
mod platform {
    use super::RecoveryBudget;
    use std::{
        fs,
        io::Write,
        path::Path,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        time::{Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri::Manager;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    use webview2_com::{
        CoTaskMemPWSTR, Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler,
    };
    use webview2_windows_core::{Interface, PWSTR};

    fn log(path: &Path, event: serde_json::Value) {
        // Small, bounded metadata log; rotation never touches WebView user data.
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::metadata(path).is_ok_and(|meta| meta.len() > 256 * 1024) {
            // Windows rename cannot replace an existing rotation. Copy/truncate
            // these diagnostic files so repeated rotations remain bounded.
            if fs::copy(path, path.with_extension("previous.jsonl")).is_ok() {
                let _ = fs::write(path, []);
            }
        }
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{event}");
        }
    }

    pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        let app = window.app_handle().clone();
        let label = window.label().to_string();
        let path = app.path().app_log_dir()?.join("webview-process.jsonl");
        let app_for_callback = app.clone();
        window.with_webview(move |platform| unsafe {
            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(error) => { log(&path, serde_json::json!({"event":"registration_failed", "error":error.code().0})); return; }
            };
            let mut raw_version = PWSTR::null();
            let runtime = if platform.environment().BrowserVersionString(&mut raw_version).is_ok() {
                CoTaskMemPWSTR::from(raw_version).to_string()
            } else { "unknown".into() };
            let budget = Arc::new(Mutex::new(RecoveryBudget::default()));
            let dialog_open = Arc::new(AtomicBool::new(false));
            let started = Instant::now();
            let callback_path = path.clone();
            let runtime_for_callback = runtime.clone();
            let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()); };
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                args.ProcessFailedKind(&mut kind)?;
                let mut exit_code = None;
                let mut reason = None;
                if let Ok(details) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                    let mut code = 0;
                    if details.ExitCode(&mut code).is_ok() { exit_code = Some(code); }
                    let mut value = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
                    if details.Reason(&mut value).is_ok() { reason = Some(value.0); }
                }
                let renderer = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED;
                let browser = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
                let reload = renderer && budget.lock().map(|mut budget| budget.allow_renderer_reload(started.elapsed())).unwrap_or(false);
                let action = if reload { "reload_once" } else if renderer { "manual_reload_required" } else if browser { "restart_required" } else { "observe" };
                log(&callback_path, serde_json::json!({"event":"process_failed", "unixMs":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(), "window":label, "runtime":runtime_for_callback, "kind":kind.0, "reason":reason, "exitCode":exit_code, "action":action}));
                if !renderer && !browser { return Ok(()); }
                app_for_callback.state::<crate::ai_http::AiHttpStreamState>().cancel_window(&label);
                let recovery_app = app_for_callback.clone();
                let recovery_label = label.clone();
                let recovery_path = callback_path.clone();
                let recovery_dialog = Arc::clone(&dialog_open);
                // Tauri runs main-thread submissions inline when called on the
                // UI thread. Dispatch from a worker so Reload cannot re-enter
                // WebView2 while its ProcessFailed COM callback is still active.
                let dispatch_app = app_for_callback.clone();
                std::thread::spawn(move || {
                let _ = dispatch_app.run_on_main_thread(move || {
                    if reload {
                        if let Some(window) = recovery_app.get_webview_window(&recovery_label) {
                            match window.reload() {
                                Ok(()) => return,
                                Err(_) => log(&recovery_path, serde_json::json!({"event":"reload_failed"})),
                            }
                        }
                    }
                    if recovery_dialog.swap(true, Ordering::AcqRel) { return; }
                    let text = if browser {
                        "WebView2 浏览器进程已退出。请关闭并重新启动 Lattice。已保存的文件、对话和设置未被清除；当前任务已停止。诊断已记录。"
                    } else {
                        "WebView2 页面进程重复异常退出，已暂停自动恢复以避免循环崩溃。已保存的数据未被清除；当前任务已停止。可重新载入界面，若再次出现请重启 Lattice。诊断已记录。"
                    };
                    let buttons = if browser { MessageDialogButtons::Ok } else { MessageDialogButtons::OkCancelCustom("重新载入".into(), "暂不操作".into()) };
                    let callback_app = recovery_app.clone();
                    recovery_app.dialog().message(text).title("Lattice 页面恢复").kind(MessageDialogKind::Error).buttons(buttons).show(move |reload_requested| {
                        recovery_dialog.store(false, Ordering::Release);
                        if reload_requested && !browser {
                            if let Some(window) = callback_app.get_webview_window(&recovery_label) { let _ = window.reload(); }
                        }
                    });
                });
                });
                Ok(())
            }));
            let mut token = 0;
            // WebView2 retains the COM event handler until the control is destroyed.
            match core.add_ProcessFailed(&handler, &mut token) {
                Ok(()) => log(&path, serde_json::json!({"event":"registered", "runtime":runtime})),
                Err(error) => log(&path, serde_json::json!({"event":"registration_failed", "error":error.code().0})),
            }
        })
    }
}

#[cfg(windows)]
pub use platform::install;

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reload_budget_prevents_crash_loop_and_allows_later_recovery() {
        let mut budget = RecoveryBudget::default();
        assert!(budget.allow_renderer_reload(Duration::ZERO));
        assert!(!budget.allow_renderer_reload(Duration::from_secs(1)));
        assert!(!budget.allow_renderer_reload(Duration::from_secs(599)));
        assert!(budget.allow_renderer_reload(Duration::from_secs(600)));
        assert!(!budget.allow_renderer_reload(Duration::from_secs(601)));
    }
}
