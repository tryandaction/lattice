//! Lattice Desktop Application
//!
//! Main entry point for the Tauri desktop shell, including
//! persistent settings and local code execution commands.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
};
use uuid::Uuid;

const SETTINGS_STORE: &str = "settings.json";
const RUNNER_EVENT_NAME: &str = "runner://event";
const PYTHON_EVENT_PREFIX: &str = "__LATTICE_EVENT__";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub default_folder: Option<String>,
    pub last_opened_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDirEntry {
    name: String,
    is_directory: bool,
    is_file: bool,
    is_symlink: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
enum RunnerType {
    PythonLocal,
    PythonPyodide,
    ExternalCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ExecutionMode {
    File,
    Selection,
    Cell,
    Inline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PythonEnvironmentType {
    System,
    Venv,
    Conda,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PythonEnvironmentInfo {
    path: String,
    version: String,
    env_type: PythonEnvironmentType,
    name: Option<String>,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CommandAvailability {
    command: String,
    available: bool,
    resolved_path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocalExecutionRequest {
    session_id: Option<String>,
    runner_type: RunnerType,
    command: Option<String>,
    file_path: Option<String>,
    cwd: Option<String>,
    code: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
    mode: ExecutionMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExecutionStartResponse {
    session_id: String,
    runner_type: RunnerType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunnerEvent {
    session_id: String,
    event: String,
    timestamp_ms: u64,
    payload: Value,
}

#[derive(Debug, Clone)]
struct ManagedExecution {
    child: Arc<Mutex<Child>>,
    terminated: Arc<AtomicBool>,
}

#[derive(Default)]
struct ExecutionSessions {
    sessions: Mutex<HashMap<String, ManagedExecution>>,
}

#[derive(Debug, Clone)]
struct ManagedPythonSession {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    terminated: Arc<AtomicBool>,
    cleanup: CleanupArtifacts,
}

#[derive(Default)]
struct PythonSessions {
    sessions: Mutex<HashMap<String, ManagedPythonSession>>,
}

#[derive(Debug, Clone)]
struct CleanupArtifacts {
    bootstrap_path: PathBuf,
    payload_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PythonPayload {
    mode: ExecutionMode,
    cwd: Option<String>,
    file_path: Option<String>,
    code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PythonSessionStartRequest {
    session_id: Option<String>,
    command: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PythonSessionExecuteRequest {
    session_id: String,
    code: String,
}

#[derive(Debug, Deserialize)]
struct PythonProbe {
    executable: String,
    version: String,
    prefix: Option<String>,
    base_prefix: Option<String>,
}

#[tauri::command]
fn get_default_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;

    if let Some(value) = store.get("default_folder") {
        if let Some(folder) = value.as_str() {
            return Ok(Some(folder.to_string()));
        }
    }

    Ok(None)
}

#[tauri::command]
fn set_default_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    store.set("default_folder", json!(folder));
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_last_opened_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;

    if let Some(value) = store.get("last_opened_folder") {
        if let Some(folder) = value.as_str() {
            return Ok(Some(folder.to_string()));
        }
    }

    Ok(None)
}

#[tauri::command]
fn set_last_opened_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    store.set("last_opened_folder", json!(folder));
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_default_folder(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    store.delete("default_folder");
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn desktop_read_dir(path: String) -> Result<Vec<DesktopDirEntry>, String> {
    let normalized = PathBuf::from(path);
    let entries = fs::read_dir(&normalized).map_err(|error| error.to_string())?;
    let mut results = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        results.push(DesktopDirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_directory: file_type.is_dir(),
            is_file: file_type.is_file(),
            is_symlink: file_type.is_symlink(),
        });
    }

    Ok(results)
}

#[tauri::command]
fn desktop_read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(PathBuf::from(path)).map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(PathBuf::from(path), data).map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_exists_path(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).exists())
}

#[tauri::command]
fn desktop_create_dir(path: String, recursive: bool) -> Result<(), String> {
    let target = PathBuf::from(path);
    if recursive {
        fs::create_dir_all(target).map_err(|error| error.to_string())?;
    } else {
        fs::create_dir(target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_remove_path(path: String, recursive: bool) -> Result<(), String> {
    let target = PathBuf::from(path);
    let metadata = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        if recursive {
            fs::remove_dir_all(target).map_err(|error| error.to_string())?;
        } else {
            fs::remove_dir(target).map_err(|error| error.to_string())?;
        }
    } else {
        fs::remove_file(target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn detect_python_environments(cwd: Option<String>) -> Result<Vec<PythonEnvironmentInfo>, String> {
    discover_python_environments(cwd.as_deref())
}

#[tauri::command]
fn probe_command_availability(command: String) -> Result<CommandAvailability, String> {
    Ok(probe_command(&command))
}

#[tauri::command]
async fn start_local_execution(
    app: AppHandle,
    state: State<'_, ExecutionSessions>,
    request: LocalExecutionRequest,
) -> Result<ExecutionStartResponse, String> {
    if matches!(request.runner_type, RunnerType::PythonPyodide) {
        return Err("python-pyodide is not handled by the desktop backend".to_string());
    }

    let session_id = request
        .session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let runner_type = request.runner_type.clone();
    let mode = request.mode.clone();
    let request_cwd = request.cwd.clone();
    let request_file_path = request.file_path.clone();

    let cwd_path = request
        .cwd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);

    let (mut command, cleanup_artifacts) = build_execution_command(&request, cwd_path.as_deref())?;

    if let Some(cwd) = &cwd_path {
        command.current_dir(cwd);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    if let Some(environment) = &request.env {
        command.envs(environment);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    let terminated = Arc::new(AtomicBool::new(false));

    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(
            session_id.clone(),
            ManagedExecution {
                child: Arc::clone(&child),
                terminated: Arc::clone(&terminated),
            },
        );
    }

    emit_runner_event(
        &app,
        &session_id,
        "started",
        json!({
            "cwd": request_cwd,
            "filePath": request_file_path,
            "mode": mode,
            "runnerType": runner_type,
        }),
    );

    if let Some(stdout_pipe) = stdout {
        let app_handle = app.clone();
        let stdout_session_id = session_id.clone();
        let stdout_runner_type = runner_type.clone();
        tokio::spawn(async move {
            stream_output(
                app_handle,
                stdout_session_id,
                stdout_pipe,
                "stdout",
                matches!(stdout_runner_type, RunnerType::PythonLocal),
            )
            .await;
        });
    }

    if let Some(stderr_pipe) = stderr {
        let app_handle = app.clone();
        let stderr_session_id = session_id.clone();
        tokio::spawn(async move {
            stream_output(app_handle, stderr_session_id, stderr_pipe, "stderr", false).await;
        });
    }

    let wait_app = app.clone();
    let wait_session_id = session_id.clone();
    let cleanup = cleanup_artifacts.clone();
    tokio::spawn(async move {
        let exit_result = {
            let mut guard = child.lock().await;
            guard.wait().await
        };

        match exit_result {
            Ok(status) => {
                let success = status.success();
                let exit_code = status.code();
                let was_terminated = terminated.load(Ordering::SeqCst);
                emit_runner_event(
                    &wait_app,
                    &wait_session_id,
                    if was_terminated { "terminated" } else { "completed" },
                    json!({
                        "success": success && !was_terminated,
                        "exitCode": exit_code,
                        "terminated": was_terminated,
                    }),
                );
            }
            Err(error) => {
                emit_runner_event(
                    &wait_app,
                    &wait_session_id,
                    "error",
                    json!({
                        "message": error.to_string(),
                    }),
                );
            }
        }

        {
            let sessions = wait_app.state::<ExecutionSessions>();
            let mut guard = sessions.sessions.lock().await;
            guard.remove(&wait_session_id);
        }

        cleanup_execution_files(cleanup);
    });

    Ok(ExecutionStartResponse {
        session_id,
        runner_type,
    })
}

#[tauri::command]
async fn terminate_local_execution(
    state: State<'_, ExecutionSessions>,
    session_id: String,
) -> Result<(), String> {
    let managed = {
        let sessions = state.sessions.lock().await;
        sessions.get(&session_id).cloned()
    };

    let Some(managed) = managed else {
        return Err(format!("Execution session not found: {session_id}"));
    };

    managed.terminated.store(true, Ordering::SeqCst);
    let mut child = managed.child.lock().await;
    child.kill().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_python_session(
    app: AppHandle,
    execution_state: State<'_, ExecutionSessions>,
    session_state: State<'_, PythonSessions>,
    request: PythonSessionStartRequest,
) -> Result<ExecutionStartResponse, String> {
    let session_id = request
        .session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let cwd_path = request
        .cwd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);

    let python = if let Some(command) = request.command.clone().filter(|value| !value.trim().is_empty()) {
        command
    } else {
        let environments = discover_python_environments(cwd_path.as_deref().and_then(Path::to_str))?;
        environments
            .first()
            .map(|env| env.path.clone())
            .ok_or_else(|| "No local Python interpreter detected".to_string())?
    };

    let cleanup = create_python_session_artifacts()?;
    let mut command = Command::new(&python);
    command.arg("-u").arg(&cleanup.bootstrap_path);

    if let Some(cwd) = &cwd_path {
        command.current_dir(cwd);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::piped());

    if let Some(environment) = &request.env {
        command.envs(environment);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture Python session stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Failed to capture Python session stderr".to_string())?;
    let stdin = child.stdin.take().ok_or_else(|| "Failed to capture Python session stdin".to_string())?;
    let child = Arc::new(Mutex::new(child));
    let stdin = Arc::new(Mutex::new(stdin));
    let terminated = Arc::new(AtomicBool::new(false));

    {
        let mut sessions = session_state.sessions.lock().await;
        sessions.insert(
            session_id.clone(),
            ManagedPythonSession {
                child: Arc::clone(&child),
                stdin: Arc::clone(&stdin),
                terminated: Arc::clone(&terminated),
                cleanup: cleanup.clone(),
            },
        );
    }

    {
        let mut executions = execution_state.sessions.lock().await;
        executions.insert(
            session_id.clone(),
            ManagedExecution {
                child: Arc::clone(&child),
                terminated: Arc::clone(&terminated),
            },
        );
    }

    emit_runner_event(
        &app,
        &session_id,
        "started",
        json!({
            "cwd": request.cwd,
            "mode": ExecutionMode::Cell,
            "runnerType": RunnerType::PythonLocal,
            "persistent": true,
        }),
    );

    let stdout_app = app.clone();
    let stdout_session_id = session_id.clone();
    tokio::spawn(async move {
        stream_output(stdout_app, stdout_session_id, stdout, "stdout", true).await;
    });

    let stderr_app = app.clone();
    let stderr_session_id = session_id.clone();
    tokio::spawn(async move {
        stream_output(stderr_app, stderr_session_id, stderr, "stderr", false).await;
    });

    let wait_app = app.clone();
    let wait_session_id = session_id.clone();
    tokio::spawn(async move {
        let exit_result = {
            let mut guard = child.lock().await;
            guard.wait().await
        };

        match exit_result {
            Ok(status) => {
                let was_terminated = terminated.load(Ordering::SeqCst);
                emit_runner_event(
                    &wait_app,
                    &wait_session_id,
                    if was_terminated { "terminated" } else { "completed" },
                    json!({
                        "success": status.success() && !was_terminated,
                        "exitCode": status.code(),
                        "terminated": was_terminated,
                        "persistent": true,
                    }),
                );
            }
            Err(error) => {
                emit_runner_event(
                    &wait_app,
                    &wait_session_id,
                    "error",
                    json!({ "message": error.to_string() }),
                );
            }
        }

        {
            let python_sessions = wait_app.state::<PythonSessions>();
            let mut guard = python_sessions.sessions.lock().await;
            if let Some(session) = guard.remove(&wait_session_id) {
                cleanup_execution_files(Some(session.cleanup));
            }
        }
        {
            let executions = wait_app.state::<ExecutionSessions>();
            let mut guard = executions.sessions.lock().await;
            guard.remove(&wait_session_id);
        }
    });

    Ok(ExecutionStartResponse {
        session_id,
        runner_type: RunnerType::PythonLocal,
    })
}

#[tauri::command]
async fn execute_python_session(
    app: AppHandle,
    session_state: State<'_, PythonSessions>,
    request: PythonSessionExecuteRequest,
) -> Result<(), String> {
    let managed = {
        let sessions = session_state.sessions.lock().await;
        sessions.get(&request.session_id).cloned()
    };

    let Some(managed) = managed else {
        return Err(format!("Python session not found: {}", request.session_id));
    };

    emit_runner_event(
        &app,
        &request.session_id,
        "started",
        json!({
            "mode": ExecutionMode::Cell,
            "runnerType": RunnerType::PythonLocal,
            "persistent": true,
        }),
    );

    let payload = serde_json::to_string(&json!({ "code": request.code })).map_err(|error| error.to_string())?;
    let mut stdin = managed.stdin.lock().await;
    stdin.write_all(payload.as_bytes()).await.map_err(|error| error.to_string())?;
    stdin.write_all(b"\n").await.map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn stop_python_session(
    session_state: State<'_, PythonSessions>,
    session_id: String,
) -> Result<(), String> {
    let managed = {
        let sessions = session_state.sessions.lock().await;
        sessions.get(&session_id).cloned()
    };

    let Some(managed) = managed else {
        return Err(format!("Python session not found: {session_id}"));
    };

    managed.terminated.store(true, Ordering::SeqCst);
    let mut child = managed.child.lock().await;
    child.kill().await.map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(ExecutionSessions::default())
        .manage(PythonSessions::default())
        .invoke_handler(tauri::generate_handler![
            get_default_folder,
            set_default_folder,
            get_last_opened_folder,
            set_last_opened_folder,
            clear_default_folder,
            desktop_read_dir,
            desktop_read_file_bytes,
            desktop_write_file_bytes,
            desktop_exists_path,
            desktop_create_dir,
            desktop_remove_path,
            detect_python_environments,
            probe_command_availability,
            start_local_execution,
            terminate_local_execution,
            start_python_session,
            execute_python_session,
            stop_python_session,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
                let _ = window.clear_all_browsing_data();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to run Lattice application");
}

async fn stream_output<R>(
    app: AppHandle,
    session_id: String,
    stream: R,
    channel: &'static str,
    parse_python_events: bool,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(stream).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if parse_python_events && line.starts_with(PYTHON_EVENT_PREFIX) {
            let payload = &line[PYTHON_EVENT_PREFIX.len()..];
            if let Ok(value) = serde_json::from_str::<Value>(payload) {
                let event = value
                    .get("event")
                    .and_then(Value::as_str)
                    .unwrap_or("display_data");
                emit_runner_event(
                    &app,
                    &session_id,
                    event,
                    value.get("payload").cloned().unwrap_or(Value::Null),
                );
                continue;
            }
        }

        emit_runner_event(
            &app,
            &session_id,
            channel,
            json!({
                "text": line,
                "channel": channel,
            }),
        );
    }
}

fn emit_runner_event(app: &AppHandle, session_id: &str, event: &str, payload: Value) {
    let emitted = app.emit(
        RUNNER_EVENT_NAME,
        RunnerEvent {
            session_id: session_id.to_string(),
            event: event.to_string(),
            timestamp_ms: now_timestamp_ms(),
            payload,
        },
    );

    if emitted.is_err() {
        // Ignore event delivery errors when the webview is gone.
    }
}

fn now_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn build_execution_command(
    request: &LocalExecutionRequest,
    cwd: Option<&Path>,
) -> Result<(Command, Option<CleanupArtifacts>), String> {
    match request.runner_type {
        RunnerType::PythonLocal => build_python_command(request, cwd),
        RunnerType::ExternalCommand => build_external_command(request),
        RunnerType::PythonPyodide => Err("python-pyodide is not executable via Tauri backend".to_string()),
    }
}

fn build_external_command(
    request: &LocalExecutionRequest,
) -> Result<(Command, Option<CleanupArtifacts>), String> {
    let command_name = request
        .command
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Missing external command".to_string())?;

    let availability = probe_command(&command_name);
    if !availability.available {
        return Err(
            availability
                .error
                .unwrap_or_else(|| format!("Command not available: {command_name}")),
        );
    }

    let mut command = Command::new(&command_name);
    if let Some(arguments) = &request.args {
        command.args(arguments);
    }

    Ok((command, None))
}

fn build_python_command(
    request: &LocalExecutionRequest,
    cwd: Option<&Path>,
) -> Result<(Command, Option<CleanupArtifacts>), String> {
    let python = if let Some(command) = request.command.clone().filter(|value| !value.trim().is_empty()) {
        command
    } else {
        let environments = discover_python_environments(cwd.and_then(Path::to_str))?;
        environments
            .first()
            .map(|env| env.path.clone())
            .ok_or_else(|| "No local Python interpreter detected".to_string())?
    };

    let payload = PythonPayload {
        mode: request.mode.clone(),
        cwd: request.cwd.clone(),
        file_path: request.file_path.clone(),
        code: request.code.clone(),
    };

    let artifacts = create_python_runner_artifacts(&payload)?;
    let payload_path = artifacts
        .payload_path
        .clone()
        .ok_or_else(|| "Missing Python runner payload".to_string())?;
    let mut command = Command::new(&python);
    command
        .arg("-u")
        .arg(&artifacts.bootstrap_path)
        .arg(&payload_path);

    if let Some(arguments) = &request.args {
        command.args(arguments);
    }

    Ok((command, Some(artifacts)))
}

fn create_python_runner_artifacts(payload: &PythonPayload) -> Result<CleanupArtifacts, String> {
    let temp_dir = env::temp_dir().join("lattice-runner");
    fs::create_dir_all(&temp_dir).map_err(|error| error.to_string())?;

    let suffix = Uuid::new_v4().to_string();
    let bootstrap_path = temp_dir.join(format!("runner-{suffix}.py"));
    let payload_path = temp_dir.join(format!("runner-{suffix}.json"));

    fs::write(&bootstrap_path, python_runner_bootstrap()).map_err(|error| error.to_string())?;
    fs::write(
        &payload_path,
        serde_json::to_vec(payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    Ok(CleanupArtifacts {
        bootstrap_path,
        payload_path: Some(payload_path),
    })
}

fn create_python_session_artifacts() -> Result<CleanupArtifacts, String> {
    let temp_dir = env::temp_dir().join("lattice-runner");
    fs::create_dir_all(&temp_dir).map_err(|error| error.to_string())?;

    let suffix = Uuid::new_v4().to_string();
    let bootstrap_path = temp_dir.join(format!("session-{suffix}.py"));

    fs::write(&bootstrap_path, python_session_bootstrap()).map_err(|error| error.to_string())?;

    Ok(CleanupArtifacts {
        bootstrap_path,
        payload_path: None,
    })
}

fn cleanup_execution_files(cleanup: Option<CleanupArtifacts>) {
    let Some(cleanup) = cleanup else {
        return;
    };

    let _ = fs::remove_file(cleanup.bootstrap_path);
    if let Some(payload_path) = cleanup.payload_path {
        let _ = fs::remove_file(payload_path);
    }
}

fn discover_python_environments(cwd: Option<&str>) -> Result<Vec<PythonEnvironmentInfo>, String> {
    let mut results = Vec::new();
    let mut seen_paths = HashSet::new();

    if let Some(path) = cwd.map(PathBuf::from) {
        for candidate in project_python_candidates(&path) {
            try_register_python(&mut results, &mut seen_paths, &candidate, "workspace");
        }
    }

    if let Ok(virtual_env) = env::var("VIRTUAL_ENV") {
        let candidate = python_from_env_root(&PathBuf::from(&virtual_env));
        try_register_python(&mut results, &mut seen_paths, &candidate, "VIRTUAL_ENV");
    }

    if let Ok(conda_prefix) = env::var("CONDA_PREFIX") {
        let candidate = python_from_env_root(&PathBuf::from(&conda_prefix));
        try_register_python(&mut results, &mut seen_paths, &candidate, "CONDA_PREFIX");
    }

    if let Some(conda_envs) = discover_conda_environments() {
        for candidate in conda_envs {
            try_register_python(&mut results, &mut seen_paths, &candidate, "conda");
        }
    }

    for (program, prefix_args, source) in [
        ("python", Vec::<String>::new(), "path"),
        ("python3", Vec::<String>::new(), "path"),
        ("py", vec!["-3".to_string()], "py-launcher"),
    ] {
        try_register_python_program(
            &mut results,
            &mut seen_paths,
            program,
            prefix_args,
            source,
        );
    }

    results.sort_by(|left, right| match (&left.env_type, &right.env_type) {
        (PythonEnvironmentType::Venv, PythonEnvironmentType::System) => std::cmp::Ordering::Less,
        (PythonEnvironmentType::Conda, PythonEnvironmentType::System) => std::cmp::Ordering::Less,
        (PythonEnvironmentType::System, PythonEnvironmentType::Venv) => std::cmp::Ordering::Greater,
        (PythonEnvironmentType::System, PythonEnvironmentType::Conda) => std::cmp::Ordering::Greater,
        _ => left.path.cmp(&right.path),
    });

    Ok(results)
}

fn project_python_candidates(cwd: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for env_name in [".venv", "venv", "env"] {
        candidates.push(cwd.join(env_name).join(windows_python_relative_path()));
        candidates.push(cwd.join(env_name).join(unix_python_relative_path()));
    }
    candidates
}

fn windows_python_relative_path() -> &'static str {
    "Scripts/python.exe"
}

fn unix_python_relative_path() -> &'static str {
    "bin/python"
}

fn python_from_env_root(root: &Path) -> PathBuf {
    let windows = root.join(windows_python_relative_path());
    if windows.exists() {
        return windows;
    }
    root.join(unix_python_relative_path())
}

fn discover_conda_environments() -> Option<Vec<PathBuf>> {
    let output = StdCommand::new("conda")
        .args(["info", "--envs", "--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value: Value = serde_json::from_slice(&output.stdout).ok()?;
    let envs = value.get("envs")?.as_array()?;
    let mut results = Vec::new();
    for entry in envs {
        if let Some(path) = entry.as_str() {
            results.push(python_from_env_root(Path::new(path)));
        }
    }
    Some(results)
}

fn try_register_python(
    results: &mut Vec<PythonEnvironmentInfo>,
    seen_paths: &mut HashSet<String>,
    python_path: &Path,
    source: &str,
) {
    let path = python_path.to_string_lossy().to_string();
    if seen_paths.contains(&path) {
        return;
    }

    let Some(info) = probe_python_path(python_path, source) else {
        return;
    };

    seen_paths.insert(info.path.clone());
    results.push(info);
}

fn try_register_python_program(
    results: &mut Vec<PythonEnvironmentInfo>,
    seen_paths: &mut HashSet<String>,
    program: &str,
    prefix_args: Vec<String>,
    source: &str,
) {
    let Some(info) = probe_python_program(program, &prefix_args, source) else {
        return;
    };

    if seen_paths.insert(info.path.clone()) {
        results.push(info);
    }
}

fn probe_python_path(python_path: &Path, source: &str) -> Option<PythonEnvironmentInfo> {
    if !python_path.exists() {
        return None;
    }
    probe_python_command(python_path.as_os_str().to_string_lossy().as_ref(), &[], source)
}

fn probe_python_program(
    program: &str,
    prefix_args: &[String],
    source: &str,
) -> Option<PythonEnvironmentInfo> {
    probe_python_command(program, prefix_args, source)
}

fn probe_python_command(
    executable: &str,
    prefix_args: &[String],
    source: &str,
) -> Option<PythonEnvironmentInfo> {
    let probe_script = r#"import json, sys
print(json.dumps({
  "executable": sys.executable,
  "version": sys.version.split()[0],
  "prefix": getattr(sys, "prefix", None),
  "base_prefix": getattr(sys, "base_prefix", None),
}))"#;

    let mut command = StdCommand::new(executable);
    command.args(prefix_args);
    command.arg("-c").arg(probe_script);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let probe: PythonProbe = serde_json::from_slice(&output.stdout).ok()?;
    let path = probe.executable;
    let env_type = classify_python_environment(&path, probe.prefix.as_deref(), probe.base_prefix.as_deref());
    let name = environment_name_from_path(&path, &env_type);

    Some(PythonEnvironmentInfo {
        path,
        version: probe.version,
        env_type,
        name,
        source: source.to_string(),
    })
}

fn classify_python_environment(
    executable: &str,
    prefix: Option<&str>,
    base_prefix: Option<&str>,
) -> PythonEnvironmentType {
    let lowercase = executable.to_ascii_lowercase();

    if lowercase.contains(".venv") || prefix.zip(base_prefix).map(|(left, right)| left != right).unwrap_or(false) {
        return PythonEnvironmentType::Venv;
    }

    if lowercase.contains("conda") || lowercase.contains("miniconda") || lowercase.contains("anaconda") {
        return PythonEnvironmentType::Conda;
    }

    PythonEnvironmentType::System
}

fn environment_name_from_path(path: &str, env_type: &PythonEnvironmentType) -> Option<String> {
    let parent = Path::new(path).parent()?.parent()?;
    let name = parent.file_name()?.to_string_lossy().to_string();

    match env_type {
        PythonEnvironmentType::System => None,
        PythonEnvironmentType::Venv | PythonEnvironmentType::Conda => Some(name),
    }
}

fn probe_command(command: &str) -> CommandAvailability {
    let resolved_path = resolve_command_path(command);

    let Some(path) = resolved_path.clone() else {
        return CommandAvailability {
            command: command.to_string(),
            available: false,
            resolved_path: None,
            version: None,
            error: Some(format!("Command not found: {command}")),
        };
    };

    let version = StdCommand::new(&path)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !stdout.is_empty() {
                stdout
            } else {
                stderr
            }
        })
        .filter(|value| !value.is_empty());

    CommandAvailability {
        command: command.to_string(),
        available: true,
        resolved_path: Some(path),
        version,
        error: None,
    }
}

fn resolve_command_path(command: &str) -> Option<String> {
    let tool = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = StdCommand::new(tool)
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout)
        .ok()?
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn python_runner_bootstrap() -> &'static str {
    r#"import base64
import io
import json
import os
import runpy
import sys
import traceback
from pathlib import Path

PREFIX = "__LATTICE_EVENT__"

def emit(event, payload):
    sys.__stdout__.write(PREFIX + json.dumps({"event": event, "payload": payload}, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()

def normalize_text(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "".join(str(item) for item in value)
    return str(value)

def make_display_payload(value):
    if value is None:
        return {"data": {"text/plain": ""}}

    if hasattr(value, "_repr_html_"):
        try:
            html = value._repr_html_()
            if html:
                return {"data": {"text/html": normalize_text(html)}}
        except Exception:
            pass

    if hasattr(value, "_repr_svg_"):
        try:
            svg = value._repr_svg_()
            if svg:
                return {"data": {"image/svg+xml": normalize_text(svg)}}
        except Exception:
            pass

    if hasattr(value, "_repr_png_"):
        try:
            png = value._repr_png_()
            if png:
                if isinstance(png, str):
                    encoded = png
                else:
                    encoded = base64.b64encode(png).decode("ascii")
                return {"data": {"image/png": encoded}}
        except Exception:
            pass

    return {"data": {"text/plain": normalize_text(value)}}

def display(value):
    emit("display_data", make_display_payload(value))

def capture_matplotlib_figures():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return

    figure_numbers = list(plt.get_fignums())
    for number in figure_numbers:
        try:
            figure = plt.figure(number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
            emit("display_data", {"data": {"image/png": encoded}})
        finally:
            plt.close(number)

def main():
    payload_path = Path(sys.argv[1])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    cwd = payload.get("cwd")
    if cwd:
        os.chdir(cwd)

    globals_dict = {
        "__name__": "__main__",
        "__file__": payload.get("file_path") or "<lattice-inline>",
        "display": display,
    }

    try:
        file_path = payload.get("file_path")
        code = payload.get("code")
        if file_path:
            runpy.run_path(file_path, init_globals=globals_dict, run_name="__main__")
        elif code:
            exec(compile(code, "<lattice-inline>", "exec"), globals_dict, globals_dict)
        else:
            raise RuntimeError("Nothing to execute")

        capture_matplotlib_figures()
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 0
        raise
    except Exception as exc:
        emit("error", {
            "message": str(exc),
            "ename": exc.__class__.__name__,
            "evalue": str(exc),
            "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__),
        })
        sys.exit(1)

if __name__ == "__main__":
    main()
"#
}

fn python_session_bootstrap() -> &'static str {
    r#"import base64
import io
import json
import os
import sys
import traceback

PREFIX = "__LATTICE_EVENT__"
execution_count = 0

def emit(event, payload):
    sys.__stdout__.write(PREFIX + json.dumps({"event": event, "payload": payload}, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()

def normalize_text(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "".join(str(item) for item in value)
    return str(value)

def make_display_payload(value):
    if value is None:
        return {"data": {"text/plain": ""}}

    if hasattr(value, "_repr_html_"):
        try:
            html = value._repr_html_()
            if html:
                return {"data": {"text/html": normalize_text(html)}}
        except Exception:
            pass

    if hasattr(value, "_repr_svg_"):
        try:
            svg = value._repr_svg_()
            if svg:
                return {"data": {"image/svg+xml": normalize_text(svg)}}
        except Exception:
            pass

    if hasattr(value, "_repr_png_"):
        try:
            png = value._repr_png_()
            if png:
                if isinstance(png, str):
                    encoded = png
                else:
                    encoded = base64.b64encode(png).decode("ascii")
                return {"data": {"image/png": encoded}}
        except Exception:
            pass

    return {"data": {"text/plain": normalize_text(value)}}

def display(value):
    emit("display_data", make_display_payload(value))

def capture_matplotlib_figures():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return

    figure_numbers = list(plt.get_fignums())
    for number in figure_numbers:
        try:
            figure = plt.figure(number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", bbox_inches="tight")
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
            emit("display_data", {"data": {"image/png": encoded}})
        finally:
            plt.close(number)

globals_dict = {
    "__name__": "__main__",
    "__file__": "<lattice-notebook-session>",
    "display": display,
}

emit("ready", {"persistent": True})

for raw_line in sys.stdin:
    raw_line = raw_line.strip()
    if not raw_line:
        continue

    try:
        payload = json.loads(raw_line)
        code = payload.get("code")
        if not code:
            raise RuntimeError("Missing code payload")

        execution_count += 1
        try:
            compiled = compile(code, "<lattice-notebook-cell>", "eval")
            result = eval(compiled, globals_dict, globals_dict)
            if result is not None:
                display(result)
        except SyntaxError:
            exec(compile(code, "<lattice-notebook-cell>", "exec"), globals_dict, globals_dict)

        capture_matplotlib_figures()
        emit("completed", {"success": True, "exitCode": 0, "terminated": False, "executionCount": execution_count})
    except Exception as exc:
        emit("error", {
            "message": str(exc),
            "ename": exc.__class__.__name__,
            "evalue": str(exc),
            "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__),
        })
    except BaseException as exc:
        emit("error", {
            "message": str(exc),
            "ename": exc.__class__.__name__,
            "evalue": str(exc),
            "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__),
        })
"#
}
