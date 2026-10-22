use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex}, time::Duration};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChanges {
    watch_id: String,
    paths: Vec<String>,
    renames: Vec<Rename>,
    rescan: bool,
}

#[derive(Clone, Debug, Serialize)]
struct Rename { from: String, to: String }

struct LiveWatch { _watcher: RecommendedWatcher, stopped: Arc<AtomicBool> }
impl Drop for LiveWatch { fn drop(&mut self) { self.stopped.store(true, Ordering::Release); } }

#[derive(Default)]
pub struct WorkspaceWatchState { watches: Mutex<HashMap<String, (String, LiveWatch)>> }
impl WorkspaceWatchState {
    pub fn stop_window(&self, window: &str) {
        if let Ok(mut watches) = self.watches.lock() { watches.remove(window); }
    }
}

fn visible_relative(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.components().any(|part| matches!(part.as_os_str().to_str(),
        Some(".git" | ".lattice" | "node_modules" | "target" | ".next" | ".lattice-build"))) { return None; }
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn start_watch(root: PathBuf, watch_id: String, emit: impl Fn(WorkspaceChanges) + Send + 'static) -> Result<LiveWatch, String> {
    let (sender, receiver) = mpsc::sync_channel::<notify::Result<Event>>(128);
    let overflow = Arc::new(AtomicBool::new(false));
    let callback_overflow = overflow.clone();
    let mut watcher = RecommendedWatcher::new(move |event| {
        if sender.try_send(event).is_err() { callback_overflow.store(true, Ordering::Release); }
    }, Config::default().with_follow_symlinks(false)).map_err(|error| error.to_string())?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|error| error.to_string())?;
    let stopped = Arc::new(AtomicBool::new(false));
    let worker_stopped = stopped.clone();
    std::thread::spawn(move || {
        let mut paths = HashSet::new();
        let mut renames = Vec::new();
        let mut rescan = false;
        let mut rename_from: Option<String> = None;
        let mut last_emit = std::time::Instant::now();
        loop {
            if worker_stopped.load(Ordering::Acquire) { break; }
            match receiver.recv_timeout(Duration::from_millis(200)) {
                Ok(Ok(event)) => {
                    if event.need_rescan() { rescan = true; }
                    if !matches!(event.kind, EventKind::Access(_)) {
                        let relative: Vec<String> = event.paths.iter().filter_map(|path| visible_relative(&root, path)).collect();
                        if matches!(event.kind, EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::Both))) && relative.len() == 2 && renames.len() < 128 {
                            renames.push(Rename { from: relative[0].clone(), to: relative[1].clone() });
                            rename_from = None;
                        } else if matches!(event.kind, EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::From))) && relative.len() == 1 {
                            // ReadDirectoryChangesW emits adjacent OLD_NAME / NEW_NAME.
                            // Pair only consecutive records, never infer by file name.
                            rename_from = Some(relative[0].clone());
                        } else if matches!(event.kind, EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::To))) && relative.len() == 1 {
                            if let Some(from) = rename_from.take() {
                                if renames.len() < 128 { renames.push(Rename { from, to: relative[0].clone() }); }
                            }
                        } else {
                            rename_from = None;
                        }
                        for path in relative { if paths.len() < 512 { paths.insert(path); } else { rescan = true; } }
                    }
                }
                Ok(Err(_)) => rescan = true,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => { rename_from = None; }
            }
            if overflow.swap(false, Ordering::AcqRel) { rescan = true; }
            if last_emit.elapsed() >= Duration::from_millis(200) && (!paths.is_empty() || rescan) {
                if worker_stopped.load(Ordering::Acquire) { break; }
                let mut batch: Vec<String> = paths.drain().collect(); batch.sort();
                emit(WorkspaceChanges { watch_id: watch_id.clone(), paths: batch, renames: std::mem::take(&mut renames), rescan });
                rescan = false; last_emit = std::time::Instant::now();
            }
        }
    });
    Ok(LiveWatch { _watcher: watcher, stopped })
}

#[tauri::command]
pub fn desktop_watch_workspace(app: AppHandle, window: WebviewWindow, state: State<'_, WorkspaceWatchState>, path: String, watch_id: String) -> Result<(), String> {
    if watch_id.len() > 128 || watch_id.is_empty() { return Err("Invalid workspace watch identifier".into()); }
    let root = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !root.is_dir() { return Err("Workspace is not a directory".into()); }
    let label = window.label().to_string();
    let target = label.clone();
    let watch = start_watch(root, watch_id.clone(), move |changes| { let _ = app.emit_to(&target, "workspace://changed", changes); })?;
    state.watches.lock().map_err(|_| "Workspace watcher unavailable")?.insert(label, (watch_id, watch));
    Ok(())
}

#[tauri::command]
pub fn desktop_unwatch_workspace(window: WebviewWindow, state: State<'_, WorkspaceWatchState>, watch_id: String) -> Result<(), String> {
    let mut watches = state.watches.lock().map_err(|_| "Workspace watcher unavailable")?;
    if watches.get(window.label()).is_some_and(|(id, _)| id == &watch_id) { watches.remove(window.label()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn await_path(receiver: &mpsc::Receiver<WorkspaceChanges>, path: &str) -> WorkspaceChanges {
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while std::time::Instant::now() < deadline {
            if let Ok(batch) = receiver.recv_timeout(Duration::from_millis(500)) {
                if batch.paths.iter().any(|candidate| candidate == path) { return batch; }
            }
        }
        panic!("Native watcher did not report {path}");
    }
    #[test]
    fn native_events_follow_create_rename_delete_and_stop() {
        let folder = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(folder.path()).unwrap();
        let (sender, receiver) = mpsc::channel();
        let watch = start_watch(root.clone(), "synthetic-watch".into(), move |event| { let _ = sender.send(event); }).unwrap();
        std::fs::write(root.join("created.txt"), "synthetic").unwrap();
        await_path(&receiver, "created.txt");
        std::fs::rename(root.join("created.txt"), root.join("renamed.txt")).unwrap();
        let renamed = await_path(&receiver, "renamed.txt");
        assert!(renamed.renames.iter().any(|entry| entry.from == "created.txt" && entry.to == "renamed.txt"));
        std::fs::remove_file(root.join("renamed.txt")).unwrap();
        await_path(&receiver, "renamed.txt");
        drop(watch);
        std::thread::sleep(Duration::from_millis(300));
        while receiver.try_recv().is_ok() {}
        std::fs::write(root.join("after-stop.txt"), "synthetic").unwrap();
        assert!(receiver.recv_timeout(Duration::from_millis(400)).is_err());
    }
    #[test]
    fn hidden_metadata_and_outside_paths_are_not_published() {
        let root = Path::new("workspace");
        assert_eq!(visible_relative(root, Path::new("workspace/docs/a.txt")), Some("docs/a.txt".into()));
        assert_eq!(visible_relative(root, Path::new("workspace/.lattice/cache.json")), None);
        assert_eq!(visible_relative(root, Path::new("outside/a.txt")), None);
    }
}
