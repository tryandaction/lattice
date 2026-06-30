//! Lattice Desktop Application
//!
//! Main entry point for the Tauri desktop shell, including
//! persistent settings and local code execution commands.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pdf_native;

use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    ipc::Response as TauriResponse, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager,
    State, WebviewUrl,
};
use tauri_plugin_store::StoreExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;

use crate::pdf_native::{
    desktop_extract_pdf_page_text_layout,
    desktop_ocr_pdf_page_text_layout,
};

const SETTINGS_STORE: &str = "settings.json";
const RUNNER_EVENT_NAME: &str = "runner://event";
const PYTHON_EVENT_PREFIX: &str = "__LATTICE_EVENT__";
const FRONTEND_SETTINGS_KEY: &str = "lattice-settings";
const DEFAULT_FOLDER_KEY: &str = "default_folder";
const LAST_OPENED_FOLDER_KEY: &str = "last_opened_folder";
const LAST_WORKSPACE_PATH_KEY: &str = "last_workspace_path";
const RECENT_WORKSPACE_PATHS_KEY: &str = "recent_workspace_paths";
const WINDOW_STATE_KEY: &str = "window_state";
const MAX_RECENT_WORKSPACES: usize = 12;
const DESKTOP_NATIVE_WEBVIEW_NEW_WINDOW_EVENT: &str = "desktop-native-webview://new-window";
const DESKTOP_NATIVE_WEBVIEW_DOWNLOAD_EVENT: &str = "desktop-native-webview://download";

#[cfg(windows)]
const CREATE_NO_WINDOW_FLAG: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateSnapshot {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
    pub is_maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_folder: Option<String>,
    pub last_opened_folder: Option<String>,
    pub last_workspace_path: Option<String>,
    #[serde(default)]
    pub recent_workspace_paths: Vec<String>,
    pub window_state: Option<WindowStateSnapshot>,
    #[serde(default, flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum StartupWorkspaceSource {
    LastWorkspacePath,
    RecentWorkspacePaths,
    DefaultFolder,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupWorkspaceResolution {
    path: Option<String>,
    source: Option<StartupWorkspaceSource>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDirEntry {
    name: String,
    is_directory: bool,
    is_file: bool,
    is_symlink: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopTextChunk {
    text: String,
    bytes_read: usize,
    total_bytes: u64,
    has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFileMetadata {
    size: u64,
    modified_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebDocumentSnapshot {
    final_url: String,
    content_type: Option<String>,
    body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNativeWebviewSnapshot {
    label: String,
    current_url: String,
    title: Option<String>,
    status: String,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNativeWebviewRequestEvent {
    label: String,
    url: String,
    disposition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNativeWebviewDownloadEventPayload {
    label: String,
    phase: String,
    url: String,
    path: Option<String>,
    success: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
enum RunnerType {
    PythonLocal,
    PythonPyodide,
    ExternalCommand,
    CompiledNative,
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
#[serde(rename_all = "camelCase")]
struct FormulaOcrPix2texRequest {
    image_data_url: String,
    command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormulaOcrPix2texResponse {
    latex: String,
    backend: String,
    command: String,
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

#[derive(Default)]
struct DesktopPreviewState {
    workspace_root: StdMutex<Option<PathBuf>>,
}

#[derive(Default)]
struct DesktopNativeWebviewState {
    snapshots: StdMutex<HashMap<String, DesktopNativeWebviewSnapshot>>,
}

struct DesktopFsState {
    read_dir_permits: Arc<Semaphore>,
    read_file_permits: Arc<Semaphore>,
    mutate_path_permits: Arc<Semaphore>,
}

impl Default for DesktopFsState {
    fn default() -> Self {
        Self {
            read_dir_permits: Arc::new(Semaphore::new(8)),
            read_file_permits: Arc::new(Semaphore::new(4)),
            mutate_path_permits: Arc::new(Semaphore::new(1)),
        }
    }
}

#[derive(Debug, Clone)]
struct CleanupArtifacts {
    bootstrap_path: PathBuf,
    payload_path: Option<PathBuf>,
    extra_paths: Vec<PathBuf>,
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

fn normalize_optional_path(path: Option<String>) -> Option<String> {
    path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn set_desktop_native_webview_snapshot(
    app: &AppHandle,
    label: &str,
    current_url: Option<String>,
    title: Option<String>,
    status: Option<&str>,
    last_error: Option<Option<String>>,
) -> Result<DesktopNativeWebviewSnapshot, String> {
    let state = app.state::<DesktopNativeWebviewState>();
    let mut snapshots = state.snapshots.lock().map_err(|error| error.to_string())?;
    let snapshot = snapshots
        .entry(label.to_string())
        .or_insert_with(|| DesktopNativeWebviewSnapshot {
            label: label.to_string(),
            current_url: current_url.clone().unwrap_or_default(),
            title: None,
            status: "idle".to_string(),
            last_error: None,
        });
    if let Some(url) = current_url {
        snapshot.current_url = url;
    }
    if let Some(next_title) = title {
        snapshot.title = Some(next_title);
    }
    if let Some(next_status) = status {
        snapshot.status = next_status.to_string();
    }
    if let Some(next_error) = last_error {
        snapshot.last_error = next_error;
    }
    Ok(snapshot.clone())
}

fn remove_desktop_native_webview_snapshot(app: &AppHandle, label: &str) -> Result<(), String> {
    let state = app.state::<DesktopNativeWebviewState>();
    let mut snapshots = state.snapshots.lock().map_err(|error| error.to_string())?;
    snapshots.remove(label);
    Ok(())
}

fn get_desktop_native_webview_snapshot(
    app: &AppHandle,
    label: &str,
) -> Result<Option<DesktopNativeWebviewSnapshot>, String> {
    let state = app.state::<DesktopNativeWebviewState>();
    let snapshots = state.snapshots.lock().map_err(|error| error.to_string())?;
    Ok(snapshots.get(label).cloned())
}

fn build_desktop_native_webview_data_directory(url: &reqwest::Url) -> PathBuf {
    let origin_key = format!(
        "{}_{}_{}",
        url.scheme(),
        url.host_str().unwrap_or("unknown"),
        url.port_or_known_default()
            .map(|port| port.to_string())
            .unwrap_or_else(|| "default".to_string())
    )
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' { ch } else { '_' })
    .collect::<String>();

    PathBuf::from(format!("embedded-web/{}", origin_key))
}

fn emit_desktop_native_webview_new_window(
    app: &AppHandle,
    label: &str,
    url: &reqwest::Url,
) -> Result<(), String> {
    app.emit(
        DESKTOP_NATIVE_WEBVIEW_NEW_WINDOW_EVENT,
        DesktopNativeWebviewRequestEvent {
            label: label.to_string(),
            url: url.to_string(),
            disposition: "new-window".to_string(),
        },
    )
    .map_err(|error| error.to_string())
}

fn emit_desktop_native_webview_download_event(
    app: &AppHandle,
    payload: DesktopNativeWebviewDownloadEventPayload,
) -> Result<(), String> {
    app.emit(DESKTOP_NATIVE_WEBVIEW_DOWNLOAD_EVENT, payload)
        .map_err(|error| error.to_string())
}

fn decode_preview_request_path(path: &str) -> Result<String, String> {
    let trimmed = path.strip_prefix('/').unwrap_or(path);
    let decoded = percent_decode_str(trimmed)
        .decode_utf8()
        .map_err(|error| error.to_string())?
        .to_string();

    #[cfg(windows)]
    {
        if decoded.len() >= 3 && decoded.as_bytes()[1] == b':' {
            return Ok(decoded);
        }

        if decoded.len() >= 4 && decoded.starts_with('/') && decoded.as_bytes()[2] == b':' {
            return Ok(decoded[1..].to_string());
        }
    }

    Ok(decoded)
}

fn canonicalize_directory_path(path: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err(format!("Preview root is not a directory: {path}"));
    }
    Ok(canonical)
}

fn canonicalize_file_path(path: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !canonical.is_file() {
        return Err(format!("Preview path is not a file: {path}"));
    }
    Ok(canonical)
}

fn is_path_within_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn get_preview_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("pdf") => "application/pdf",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        Some("tif") | Some("tiff") => "image/tiff",
        _ => "application/octet-stream",
    }
}

fn parse_range_header(range_header: &str, file_len: u64) -> Option<(u64, u64)> {
    if file_len == 0 || !range_header.starts_with("bytes=") {
        return None;
    }

    let first_range = range_header[6..].split(',').next()?.trim();
    let (start_raw, end_raw) = first_range.split_once('-')?;

    if start_raw.is_empty() {
        let suffix_len = end_raw.parse::<u64>().ok()?.min(file_len);
        if suffix_len == 0 {
            return None;
        }
        return Some((file_len - suffix_len, file_len - 1));
    }

    let start = start_raw.parse::<u64>().ok()?;
    if start >= file_len {
        return None;
    }

    let end = if end_raw.is_empty() {
        file_len - 1
    } else {
        end_raw.parse::<u64>().ok()?.min(file_len - 1)
    };

    if start > end {
        return None;
    }

    Some((start, end))
}

fn preview_error_response(
    status: http::StatusCode,
    message: impl Into<String>,
) -> http::Response<Vec<u8>> {
    let mut response = http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.into().into_bytes())
        .unwrap();
    append_preview_cors_headers(&mut response);
    response
}

fn append_preview_cors_headers(response: &mut http::Response<Vec<u8>>) {
    let headers = response.headers_mut();
    headers.insert(
        http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        http::HeaderValue::from_static("*"),
    );
    headers.insert(
        http::header::ACCESS_CONTROL_ALLOW_METHODS,
        http::HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    headers.insert(
        http::header::ACCESS_CONTROL_ALLOW_HEADERS,
        http::HeaderValue::from_static("Content-Type, Range"),
    );
    headers.insert(
        http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        http::HeaderValue::from_static("Accept-Ranges, Content-Length, Content-Range, Content-Type"),
    );
}

fn build_preview_file_response(
    path: &Path,
    request: &http::Request<Vec<u8>>,
) -> Result<http::Response<Vec<u8>>, String> {
    if request.method() == http::Method::OPTIONS {
        let mut response = http::Response::builder()
            .status(http::StatusCode::NO_CONTENT)
            .body(Vec::new())
            .unwrap();
        append_preview_cors_headers(&mut response);
        return Ok(response);
    }

    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    let file_len = metadata.len();
    let content_type = get_preview_content_type(path);

    if let Some(range_header) = request
        .headers()
        .get(http::header::RANGE)
        .and_then(|value| value.to_str().ok())
    {
        if let Some((start, end)) = parse_range_header(range_header, file_len) {
            let chunk_len = end - start + 1;
            let mut buffer = vec![0; chunk_len as usize];
            file.seek(SeekFrom::Start(start)).map_err(|error| error.to_string())?;
            file.read_exact(&mut buffer).map_err(|error| error.to_string())?;

            let mut response = http::Response::builder()
                .status(http::StatusCode::PARTIAL_CONTENT)
                .header(http::header::CONTENT_TYPE, content_type)
                .header(http::header::ACCEPT_RANGES, "bytes")
                .header(http::header::CONTENT_LENGTH, chunk_len.to_string())
                .header(http::header::CONTENT_RANGE, format!("bytes {start}-{end}/{file_len}"))
                .body(buffer)
                .unwrap();
            append_preview_cors_headers(&mut response);
            return Ok(response);
        }

        let mut response = http::Response::builder()
            .status(http::StatusCode::RANGE_NOT_SATISFIABLE)
            .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(http::header::CONTENT_RANGE, format!("bytes */{file_len}"))
            .body(b"invalid range".to_vec())
            .unwrap();
        append_preview_cors_headers(&mut response);
        return Ok(response);
    }

    let mut buffer = Vec::new();
    if request.method() != http::Method::HEAD {
        file.read_to_end(&mut buffer).map_err(|error| error.to_string())?;
    }

    let mut response = http::Response::builder()
        .status(http::StatusCode::OK)
        .header(http::header::CONTENT_TYPE, content_type)
        .header(http::header::ACCEPT_RANGES, "bytes")
        .header(http::header::CONTENT_LENGTH, file_len.to_string())
        .body(buffer)
        .unwrap();
    append_preview_cors_headers(&mut response);
    Ok(response)
}

fn resolve_preview_path(
    preview_state: &DesktopPreviewState,
    request: &http::Request<Vec<u8>>,
) -> Result<PathBuf, String> {
    let raw_path = decode_preview_request_path(request.uri().path())?;
    let canonical_file = canonicalize_file_path(&raw_path)?;
    let workspace_root = preview_state
        .workspace_root
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "Preview root has not been configured.".to_string())?;

    if !is_path_within_root(&canonical_file, &workspace_root) {
        return Err(format!(
            "Preview path is outside the current workspace: {}",
            canonical_file.to_string_lossy()
        ));
    }

    Ok(canonical_file)
}

fn normalize_recent_workspace_paths(paths: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }

        let normalized = trimmed.to_string();
        if deduped.iter().any(|existing| existing == &normalized) {
            continue;
        }

        deduped.push(normalized);
        if deduped.len() >= MAX_RECENT_WORKSPACES {
            break;
        }
    }

    deduped
}

fn has_persisted_app_settings(settings: &AppSettings) -> bool {
    settings.default_folder.is_some()
        || settings.last_opened_folder.is_some()
        || settings.last_workspace_path.is_some()
        || !settings.recent_workspace_paths.is_empty()
        || settings.window_state.is_some()
        || !settings.extra.is_empty()
}

fn build_app_settings_from_store(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;

    let mut settings = store
        .get(FRONTEND_SETTINGS_KEY)
        .and_then(|value| serde_json::from_value::<AppSettings>(value).ok())
        .unwrap_or_default();

    if settings.default_folder.is_none() {
        settings.default_folder = store
            .get(DEFAULT_FOLDER_KEY)
            .and_then(|value| value.as_str().map(str::to_string));
    }

    if settings.last_opened_folder.is_none() {
        settings.last_opened_folder = store
            .get(LAST_OPENED_FOLDER_KEY)
            .and_then(|value| value.as_str().map(str::to_string));
    }

    if settings.last_workspace_path.is_none() {
        settings.last_workspace_path = store
            .get(LAST_WORKSPACE_PATH_KEY)
            .and_then(|value| value.as_str().map(str::to_string));
    }

    if settings.recent_workspace_paths.is_empty() {
        settings.recent_workspace_paths = store
            .get(RECENT_WORKSPACE_PATHS_KEY)
            .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
            .unwrap_or_default();
    }

    if settings.window_state.is_none() {
        settings.window_state = store
            .get(WINDOW_STATE_KEY)
            .and_then(|value| serde_json::from_value::<WindowStateSnapshot>(value).ok());
    }

    settings.default_folder = normalize_optional_path(settings.default_folder);
    settings.last_opened_folder = normalize_optional_path(settings.last_opened_folder);
    settings.last_workspace_path = normalize_optional_path(settings.last_workspace_path);
    settings.recent_workspace_paths = normalize_recent_workspace_paths(settings.recent_workspace_paths);

    Ok(settings)
}

fn save_app_settings(app: &tauri::AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;

    let normalized = AppSettings {
        default_folder: normalize_optional_path(settings.default_folder),
        last_opened_folder: normalize_optional_path(settings.last_opened_folder),
        last_workspace_path: normalize_optional_path(settings.last_workspace_path),
        recent_workspace_paths: normalize_recent_workspace_paths(settings.recent_workspace_paths),
        window_state: settings.window_state,
        extra: settings.extra,
    };

    match normalized.default_folder.as_deref() {
        Some(value) => store.set(DEFAULT_FOLDER_KEY, json!(value)),
        None => {
            store.delete(DEFAULT_FOLDER_KEY);
        }
    }

    match normalized.last_opened_folder.as_deref() {
        Some(value) => store.set(LAST_OPENED_FOLDER_KEY, json!(value)),
        None => {
            store.delete(LAST_OPENED_FOLDER_KEY);
        }
    }

    match normalized.last_workspace_path.as_deref() {
        Some(value) => store.set(LAST_WORKSPACE_PATH_KEY, json!(value)),
        None => {
            store.delete(LAST_WORKSPACE_PATH_KEY);
        }
    }

    if normalized.recent_workspace_paths.is_empty() {
        store.delete(RECENT_WORKSPACE_PATHS_KEY);
    } else {
        store.set(
            RECENT_WORKSPACE_PATHS_KEY,
            serde_json::to_value(&normalized.recent_workspace_paths).map_err(|error| error.to_string())?,
        );
    }

    if let Some(window_state) = &normalized.window_state {
        store.set(
            WINDOW_STATE_KEY,
            serde_json::to_value(window_state).map_err(|error| error.to_string())?,
        );
    } else {
        store.delete(WINDOW_STATE_KEY);
    }

    if has_persisted_app_settings(&normalized) {
        store.set(
            FRONTEND_SETTINGS_KEY,
            serde_json::to_value(&normalized).map_err(|error| error.to_string())?,
        );
    } else {
        store.delete(FRONTEND_SETTINGS_KEY);
    }

    store.save().map_err(|error| error.to_string())?;
    Ok(normalized)
}

#[tauri::command]
fn get_default_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(build_app_settings_from_store(&app)?.default_folder)
}

#[tauri::command]
fn set_default_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let mut settings = build_app_settings_from_store(&app)?;
    settings.default_folder = Some(folder);
    save_app_settings(&app, settings)?;
    Ok(())
}

#[tauri::command]
fn get_last_opened_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(build_app_settings_from_store(&app)?.last_opened_folder)
}

#[tauri::command]
fn set_last_opened_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let mut settings = build_app_settings_from_store(&app)?;
    settings.last_opened_folder = Some(folder);
    save_app_settings(&app, settings)?;
    Ok(())
}

#[tauri::command]
fn clear_default_folder(app: tauri::AppHandle) -> Result<(), String> {
    let mut settings = build_app_settings_from_store(&app)?;
    settings.default_folder = None;
    save_app_settings(&app, settings)?;
    Ok(())
}

#[tauri::command]
fn set_last_workspace_path(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let mut settings = build_app_settings_from_store(&app)?;
    settings.last_workspace_path = path.clone();
    settings.last_opened_folder = path;
    save_app_settings(&app, settings)?;
    Ok(())
}

#[tauri::command]
fn resolve_startup_workspace(app: tauri::AppHandle) -> Result<StartupWorkspaceResolution, String> {
    let settings = build_app_settings_from_store(&app)?;
    let valid_recent_workspace_paths = normalize_recent_workspace_paths(
        settings
            .recent_workspace_paths
            .iter()
            .filter_map(|path| resolve_existing_directory_path(path))
            .collect(),
    );

    let mut next_settings = settings.clone();
    next_settings.recent_workspace_paths = valid_recent_workspace_paths.clone();

    let resolved = if let Some(valid_path) = settings
        .last_workspace_path
        .as_deref()
        .and_then(resolve_existing_directory_path)
    {
        next_settings.last_workspace_path = Some(valid_path.clone());
        next_settings.last_opened_folder = Some(valid_path.clone());
        if !next_settings.recent_workspace_paths.iter().any(|path| path == &valid_path) {
            next_settings.recent_workspace_paths.insert(0, valid_path.clone());
            next_settings.recent_workspace_paths =
                normalize_recent_workspace_paths(next_settings.recent_workspace_paths.clone());
        }

        StartupWorkspaceResolution {
            path: Some(valid_path),
            source: Some(StartupWorkspaceSource::LastWorkspacePath),
        }
    } else if let Some(valid_path) = settings
        .last_opened_folder
        .as_deref()
        .and_then(resolve_existing_directory_path)
    {
        next_settings.last_workspace_path = Some(valid_path.clone());
        next_settings.last_opened_folder = Some(valid_path.clone());
        if !next_settings.recent_workspace_paths.iter().any(|path| path == &valid_path) {
            next_settings.recent_workspace_paths.insert(0, valid_path.clone());
            next_settings.recent_workspace_paths =
                normalize_recent_workspace_paths(next_settings.recent_workspace_paths.clone());
        }

        StartupWorkspaceResolution {
            path: Some(valid_path),
            source: Some(StartupWorkspaceSource::LastWorkspacePath),
        }
    } else if let Some(valid_path) = valid_recent_workspace_paths.first().cloned() {
        next_settings.last_workspace_path = Some(valid_path.clone());
        next_settings.last_opened_folder = Some(valid_path.clone());

        StartupWorkspaceResolution {
            path: Some(valid_path),
            source: Some(StartupWorkspaceSource::RecentWorkspacePaths),
        }
    } else if let Some(valid_path) = settings
        .default_folder
        .as_deref()
        .and_then(resolve_existing_directory_path)
    {
        next_settings.default_folder = Some(valid_path.clone());

        StartupWorkspaceResolution {
            path: Some(valid_path),
            source: Some(StartupWorkspaceSource::DefaultFolder),
        }
    } else {
        next_settings.last_workspace_path = None;
        next_settings.last_opened_folder = None;

        StartupWorkspaceResolution {
            path: None,
            source: None,
        }
    };

    if next_settings.default_folder != settings.default_folder
        || next_settings.last_opened_folder != settings.last_opened_folder
        || next_settings.last_workspace_path != settings.last_workspace_path
        || next_settings.recent_workspace_paths != settings.recent_workspace_paths
    {
        save_app_settings(&app, next_settings)?;
    }

    Ok(resolved)
}

#[tauri::command]
fn get_setting(app: tauri::AppHandle, key: String) -> Result<Option<Value>, String> {
    if key == FRONTEND_SETTINGS_KEY {
        let settings = build_app_settings_from_store(&app)?;
        if has_persisted_app_settings(&settings) {
            return Ok(Some(
                serde_json::to_value(settings).map_err(|error| error.to_string())?,
            ));
        }
        return Ok(None);
    }

    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    Ok(store.get(&key))
}

#[tauri::command]
fn set_setting(app: tauri::AppHandle, key: String, value: Value) -> Result<(), String> {
    if key == FRONTEND_SETTINGS_KEY {
        let settings =
            serde_json::from_value::<AppSettings>(value).map_err(|error| error.to_string())?;
        save_app_settings(&app, settings)?;
        return Ok(());
    }

    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    store.set(&key, value);
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_setting(app: tauri::AppHandle, key: String) -> Result<(), String> {
    if key == FRONTEND_SETTINGS_KEY {
        save_app_settings(&app, AppSettings::default())?;
        return Ok(());
    }

    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    store.delete(&key);
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_settings(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|error| error.to_string())?;
    store.clear();
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn desktop_read_dir(
    fs_state: State<'_, DesktopFsState>,
    path: String,
) -> Result<Vec<DesktopDirEntry>, String> {
    let normalized = PathBuf::from(path);
    let permit = fs_state
        .read_dir_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
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
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_read_file_bytes_raw(
    fs_state: State<'_, DesktopFsState>,
    path: String,
) -> Result<TauriResponse, String> {
    let permit = fs_state
        .read_file_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    let bytes = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        fs::read(PathBuf::from(path)).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    Ok(TauriResponse::new(bytes))
}

#[tauri::command]
async fn desktop_read_text_file(
    fs_state: State<'_, DesktopFsState>,
    path: String,
) -> Result<String, String> {
    let permit = fs_state
        .read_file_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        fs::read_to_string(PathBuf::from(path)).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_read_text_file_chunk(
    fs_state: State<'_, DesktopFsState>,
    path: String,
    max_bytes: usize,
) -> Result<DesktopTextChunk, String> {
    let permit = fs_state
        .read_file_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let target = PathBuf::from(path);
        let mut file = fs::File::open(&target).map_err(|error| error.to_string())?;
        let total_bytes = file.metadata().map_err(|error| error.to_string())?.len();
        let read_limit = max_bytes.max(1).min(1024 * 1024);
        let mut buffer = vec![0; read_limit];
        let bytes_read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        buffer.truncate(bytes_read);

        Ok(DesktopTextChunk {
            text: String::from_utf8_lossy(&buffer).to_string(),
            bytes_read,
            total_bytes,
            has_more: (bytes_read as u64) < total_bytes,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn desktop_write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(PathBuf::from(path), data).map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_copy_path(
    fs_state: State<'_, DesktopFsState>,
    source: String,
    target: String,
) -> Result<(), String> {
    let permit = fs_state
        .mutate_path_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        copy_desktop_path(&PathBuf::from(source), &PathBuf::from(target))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_move_path(
    fs_state: State<'_, DesktopFsState>,
    source: String,
    target: String,
) -> Result<(), String> {
    let permit = fs_state
        .mutate_path_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let source_path = PathBuf::from(source);
        let target_path = PathBuf::from(target);
        match fs::rename(&source_path, &target_path) {
            Ok(()) => Ok(()),
            Err(_) => {
                copy_desktop_path(&source_path, &target_path)?;
                remove_desktop_path_sync(&source_path, true)
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_rename_path(
    fs_state: State<'_, DesktopFsState>,
    source: String,
    target: String,
) -> Result<(), String> {
    desktop_move_path(fs_state, source, target).await
}

#[tauri::command]
async fn desktop_exists_path(path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        PathBuf::from(path)
            .try_exists()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_file_metadata(path: String) -> Result<DesktopFileMetadata, String> {
    tokio::task::spawn_blocking(move || {
        let metadata = fs::metadata(PathBuf::from(path)).map_err(|error| error.to_string())?;
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis());

        Ok(DesktopFileMetadata {
            size: metadata.len(),
            modified_ms,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_is_directory(
    fs_state: State<'_, DesktopFsState>,
    path: String,
) -> Result<bool, String> {
    let permit = fs_state
        .read_dir_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        Ok(PathBuf::from(path).is_dir())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn fetch_web_document(url: String) -> Result<WebDocumentSnapshot, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is required.".to_string());
    }

    let parsed = reqwest::Url::parse(trimmed).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only HTTP and HTTPS URLs can be opened internally.".to_string()),
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(15))
        .user_agent("Lattice/2.2.0 (+https://github.com/tryandaction/lattice)")
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Failed to load webpage: HTTP {}", status.as_u16()));
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(WebDocumentSnapshot {
        final_url,
        content_type,
        body,
    })
}

#[tauri::command]
async fn desktop_native_webview_mount(
    app: AppHandle,
    label: String,
    window_label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    focus: bool,
) -> Result<DesktopNativeWebviewSnapshot, String> {
    let target_url = reqwest::Url::parse(url.trim()).map_err(|error| error.to_string())?;
    if let Some(existing) = app.get_webview(&label) {
        let current_url = existing.url().map_err(|error| error.to_string())?;
        if current_url != target_url {
            existing
                .navigate(target_url.clone())
                .map_err(|error| error.to_string())?;
        }
        existing
            .set_position(LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
        existing
            .set_size(LogicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        if visible {
            existing.show().map_err(|error| error.to_string())?;
            if focus {
                existing.set_focus().map_err(|error| error.to_string())?;
            }
        } else {
            existing.hide().map_err(|error| error.to_string())?;
        }
        return set_desktop_native_webview_snapshot(
            &app,
            &label,
            Some(target_url.to_string()),
            None,
            Some("ready"),
            Some(None),
        );
    }

    let app_for_navigation = app.clone();
    let label_for_navigation = label.clone();
    let app_for_page_load = app.clone();
    let label_for_page_load = label.clone();
    let app_for_title = app.clone();
    let label_for_title = label.clone();
    let app_for_new_window = app.clone();
    let label_for_new_window = label.clone();
    let app_for_download = app.clone();
    let label_for_download = label.clone();

    let webview_builder = tauri::webview::WebviewBuilder::new(
        label.clone(),
        WebviewUrl::External(target_url.clone()),
    )
    .user_agent("LatticeEmbeddedWebview/2.2.0")
    .data_directory(build_desktop_native_webview_data_directory(&target_url))
    .initialization_script(
        r#"
          (() => {
            const patchHistory = (method) => {
              const original = history[method];
              if (typeof original !== 'function') return;
              history[method] = function (...args) {
                const result = original.apply(this, args);
                window.dispatchEvent(new Event('lattice-history-change'));
                return result;
              };
            };
            patchHistory('pushState');
            patchHistory('replaceState');
            window.addEventListener('popstate', () => {
              window.dispatchEvent(new Event('lattice-history-change'));
            });
            window.addEventListener('hashchange', () => {
              window.dispatchEvent(new Event('lattice-history-change'));
            });
          })();
        "#,
    )
    .on_navigation(move |next_url| {
        let _ = set_desktop_native_webview_snapshot(
            &app_for_navigation,
            &label_for_navigation,
            Some(next_url.to_string()),
            None,
            Some("ready"),
            None,
        );
        true
    })
    .on_page_load(move |_webview, payload| {
        let _ = set_desktop_native_webview_snapshot(
            &app_for_page_load,
            &label_for_page_load,
            Some(payload.url().to_string()),
            None,
            Some("ready"),
            Some(None),
        );
    })
    .on_document_title_changed(move |_webview, title| {
        let _ = set_desktop_native_webview_snapshot(
            &app_for_title,
            &label_for_title,
            None,
            Some(title),
            None,
            None,
        );
    })
    .on_new_window(move |next_url, _features| {
        let _ = emit_desktop_native_webview_new_window(
            &app_for_new_window,
            &label_for_new_window,
            &next_url,
        );
        tauri::webview::NewWindowResponse::Deny
    })
    .on_download(move |_webview, event| {
        match event {
            tauri::webview::DownloadEvent::Requested { url, destination } => {
                let _ = emit_desktop_native_webview_download_event(
                    &app_for_download,
                    DesktopNativeWebviewDownloadEventPayload {
                        label: label_for_download.clone(),
                        phase: "requested".to_string(),
                        url: url.to_string(),
                        path: Some(destination.display().to_string()),
                        success: None,
                    },
                );
            }
            tauri::webview::DownloadEvent::Finished { url, path, success } => {
                let _ = emit_desktop_native_webview_download_event(
                    &app_for_download,
                    DesktopNativeWebviewDownloadEventPayload {
                        label: label_for_download.clone(),
                        phase: "finished".to_string(),
                        url: url.to_string(),
                        path: path.map(|value| value.display().to_string()),
                        success: Some(success),
                    },
                );
            }
            _ => {}
        }
        true
    });

    let initial_snapshot = set_desktop_native_webview_snapshot(
        &app,
        &label,
        Some(target_url.to_string()),
        None,
        Some("mounting"),
        Some(None),
    )?;

    let app_for_mount = app.clone();
    let label_for_mount = label.clone();
    let target_url_for_mount = target_url.clone();
    let window_label_for_mount = window_label.clone();
    std::thread::spawn(move || {
        let app_for_thread = app_for_mount.clone();
        let label_for_thread = label_for_mount.clone();
        let target_url_for_thread = target_url_for_mount.clone();
        let window_label_for_thread = window_label_for_mount.clone();
        let mount_result = app_for_mount.run_on_main_thread(move || {
            let Some(window) = app_for_thread.get_window(&window_label_for_thread) else {
                let _ = set_desktop_native_webview_snapshot(
                    &app_for_thread,
                    &label_for_thread,
                    Some(target_url_for_thread.to_string()),
                    None,
                    Some("error"),
                    Some(Some(format!("Window not found: {}", window_label_for_thread))),
                );
                return;
            };

            let child_result = window.add_child(
                webview_builder,
                LogicalPosition::new(x, y),
                LogicalSize::new(width, height),
            );

            match child_result {
                Ok(webview) => {
                    let visibility_result = if !visible {
                        webview.hide().map_err(|error| error.to_string())
                    } else if focus {
                        webview.set_focus().map_err(|error| error.to_string())
                    } else {
                        Ok(())
                    };

                    match visibility_result {
                        Ok(()) => {
                            let _ = set_desktop_native_webview_snapshot(
                                &app_for_thread,
                                &label_for_thread,
                                Some(target_url_for_thread.to_string()),
                                None,
                                Some("ready"),
                                Some(None),
                            );
                        }
                        Err(error) => {
                            let _ = set_desktop_native_webview_snapshot(
                                &app_for_thread,
                                &label_for_thread,
                                Some(target_url_for_thread.to_string()),
                                None,
                                Some("error"),
                                Some(Some(error)),
                            );
                        }
                    }
                }
                Err(error) => {
                    let _ = set_desktop_native_webview_snapshot(
                        &app_for_thread,
                        &label_for_thread,
                        Some(target_url_for_thread.to_string()),
                        None,
                        Some("error"),
                        Some(Some(error.to_string())),
                    );
                }
            }
        });

        if let Err(error) = mount_result {
            let _ = set_desktop_native_webview_snapshot(
                &app_for_mount,
                &label_for_mount,
                Some(target_url_for_mount.to_string()),
                None,
                Some("error"),
                Some(Some(error.to_string())),
            );
        }
    });

    Ok(initial_snapshot)
}

#[tauri::command]
fn desktop_native_webview_update_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_native_webview_set_visibility(
    app: AppHandle,
    label: String,
    visible: bool,
    focus: bool,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    if visible {
        webview.show().map_err(|error| error.to_string())?;
        if focus {
            webview.set_focus().map_err(|error| error.to_string())?;
        }
    } else {
        webview.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_native_webview_close(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    remove_desktop_native_webview_snapshot(&app, &label)
}

#[tauri::command]
fn desktop_native_webview_get_state(
    app: AppHandle,
    label: String,
) -> Result<Option<DesktopNativeWebviewSnapshot>, String> {
    if let Some(webview) = app.get_webview(&label) {
        let current_url = webview.url().map_err(|error| error.to_string())?.to_string();
        let snapshot = set_desktop_native_webview_snapshot(
            &app,
            &label,
            Some(current_url),
            None,
            Some("ready"),
            None,
        )?;
        return Ok(Some(snapshot));
    }

    get_desktop_native_webview_snapshot(&app, &label)
}

#[tauri::command]
fn desktop_native_webview_navigate(
    app: AppHandle,
    label: String,
    url: String,
) -> Result<DesktopNativeWebviewSnapshot, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    let target_url = reqwest::Url::parse(url.trim()).map_err(|error| error.to_string())?;
    webview
        .navigate(target_url.clone())
        .map_err(|error| error.to_string())?;
    set_desktop_native_webview_snapshot(
        &app,
        &label,
        Some(target_url.to_string()),
        None,
        Some("ready"),
        Some(None),
    )
}

#[tauri::command]
fn desktop_native_webview_reload(app: AppHandle, label: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    webview.reload().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_native_webview_go_back(app: AppHandle, label: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    webview
        .eval("window.history.back();")
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_native_webview_go_forward(app: AppHandle, label: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview not found: {}", label))?;
    webview
        .eval("window.history.forward();")
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_create_dir(
    fs_state: State<'_, DesktopFsState>,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let permit = fs_state
        .mutate_path_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let target = PathBuf::from(path);
        if recursive {
            fs::create_dir_all(target).map_err(|error| error.to_string())?;
        } else {
            fs::create_dir(target).map_err(|error| error.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_remove_path(
    fs_state: State<'_, DesktopFsState>,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let permit = fs_state
        .mutate_path_permits
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        remove_desktop_path_sync(&PathBuf::from(path), recursive)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn copy_desktop_path(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        fs::create_dir_all(target).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_desktop_path(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, target).map(|_| ()).map_err(|error| error.to_string())
}

fn remove_desktop_path_sync(target: &Path, recursive: bool) -> Result<(), String> {
    let metadata = fs::symlink_metadata(target).map_err(|error| error.to_string())?;
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
fn desktop_set_preview_root(
    preview_state: State<'_, DesktopPreviewState>,
    path: Option<String>,
) -> Result<(), String> {
    let normalized_root = match path {
        Some(path) if !path.trim().is_empty() => Some(canonicalize_directory_path(&path)?),
        _ => None,
    };

    let mut workspace_root = preview_state
        .workspace_root
        .lock()
        .map_err(|error| error.to_string())?;
    *workspace_root = normalized_root;
    Ok(())
}

#[tauri::command]
fn desktop_window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_window_start_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_window_toggle_maximize(window: tauri::WebviewWindow) -> Result<bool, String> {
    let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
    if is_maximized {
        window.unmaximize().map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn desktop_window_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn detect_python_environments(cwd: Option<String>) -> Result<Vec<PythonEnvironmentInfo>, String> {
    discover_python_environments(cwd.as_deref())
}

#[tauri::command]
fn probe_command_availability(command: String) -> Result<CommandAvailability, String> {
    Ok(probe_command(&command))
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn value(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes: Vec<u8> = input.bytes().filter(|byte| !byte.is_ascii_whitespace()).collect();
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if bytes.len() % 4 != 0 {
        return Err("Invalid base64 length".to_string());
    }

    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().rev().take_while(|byte| **byte == b'=').count();
        if pad > 2 {
            return Err("Invalid base64 padding".to_string());
        }
        let sextets = [
            value(chunk[0]).ok_or_else(|| "Invalid base64 character".to_string())?,
            value(chunk[1]).ok_or_else(|| "Invalid base64 character".to_string())?,
            if chunk[2] == b'=' { 0 } else { value(chunk[2]).ok_or_else(|| "Invalid base64 character".to_string())? },
            if chunk[3] == b'=' { 0 } else { value(chunk[3]).ok_or_else(|| "Invalid base64 character".to_string())? },
        ];
        output.push((sextets[0] << 2) | (sextets[1] >> 4));
        if pad < 2 {
            output.push((sextets[1] << 4) | (sextets[2] >> 2));
        }
        if pad < 1 {
            output.push((sextets[2] << 6) | sextets[3]);
        }
    }
    Ok(output)
}

#[tauri::command]
fn formula_ocr_pix2tex(request: FormulaOcrPix2texRequest) -> Result<FormulaOcrPix2texResponse, String> {
    let command_name = request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pix2tex")
        .to_string();
    let availability = probe_command(&command_name);
    if !availability.available {
        return Err(availability.error.unwrap_or_else(|| {
            format!("pix2tex is not available. Install LaTeX-OCR and ensure `{command_name}` is on PATH.")
        }));
    }

    let data_url = request.image_data_url.trim();
    let base64_payload = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "Expected a PNG data URL".to_string())?;
    let image_bytes = decode_base64(base64_payload)?;
    if image_bytes.is_empty() {
        return Err("OCR image is empty".to_string());
    }

    let image_path = env::temp_dir().join(format!("lattice-formula-ocr-{}.png", Uuid::new_v4()));
    fs::write(&image_path, image_bytes).map_err(|error| error.to_string())?;

    let output_result = (|| {
        let mut command = StdCommand::new(&command_name);
        configure_std_command(&mut command);
        command.arg(&image_path);
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.output().map_err(|error| error.to_string())
    })();

    let _ = fs::remove_file(&image_path);

    let output = output_result?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("pix2tex exited with status {}", output.status)
        } else {
            stderr
        });
    }

    let latex = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .last()
        .unwrap_or("")
        .trim_matches('`')
        .trim()
        .to_string();
    if latex.is_empty() {
        return Err("pix2tex returned an empty result".to_string());
    }

    Ok(FormulaOcrPix2texResponse {
        latex,
        backend: "pix2tex".to_string(),
        command: command_name,
    })
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

    if matches!(request.runner_type, RunnerType::CompiledNative) {
        return start_compiled_native_execution(app, state, request).await;
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
    command.env("PYTHONUTF8", "1");
    command.env("PYTHONIOENCODING", "utf-8");

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

async fn start_compiled_native_execution(
    app: AppHandle,
    state: State<'_, ExecutionSessions>,
    request: LocalExecutionRequest,
) -> Result<ExecutionStartResponse, String> {
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

    let compiler = request
        .command
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Missing C/C++ compiler command".to_string())?;
    let source_path = request
        .file_path
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Compiled native execution requires a saved file path".to_string())?;

    let compiler_availability = probe_command(&compiler);
    if !compiler_availability.available {
        return Err(
            compiler_availability
                .error
                .unwrap_or_else(|| format!("Command not available: {compiler}")),
        );
    }

    let output_path = compiled_native_output_path(&session_id)?;
    let cleanup = CleanupArtifacts {
        bootstrap_path: output_path.clone(),
        payload_path: None,
        extra_paths: Vec::new(),
    };

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

    let mut compile_command = Command::new(&compiler);
    configure_tokio_command(&mut compile_command);
    if let Some(cwd) = &cwd_path {
        compile_command.current_dir(cwd);
    }
    if let Some(environment) = &request.env {
        compile_command.envs(environment);
    }
    if let Some(arguments) = &request.args {
        compile_command.args(arguments);
    }
    compile_command
        .arg(&source_path)
        .arg("-o")
        .arg(&output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut compile_child = compile_command.spawn().map_err(|error| error.to_string())?;
    let compile_stdout = compile_child.stdout.take();
    let compile_stderr = compile_child.stderr.take();
    let compile_child = Arc::new(Mutex::new(compile_child));
    let terminated = Arc::new(AtomicBool::new(false));

    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(
            session_id.clone(),
            ManagedExecution {
                child: Arc::clone(&compile_child),
                terminated: Arc::clone(&terminated),
            },
        );
    }

    if let Some(stdout_pipe) = compile_stdout {
        let app_handle = app.clone();
        let stdout_session_id = session_id.clone();
        tokio::spawn(async move {
            stream_output(app_handle, stdout_session_id, stdout_pipe, "stdout", false).await;
        });
    }

    if let Some(stderr_pipe) = compile_stderr {
        let app_handle = app.clone();
        let stderr_session_id = session_id.clone();
        tokio::spawn(async move {
            stream_output(app_handle, stderr_session_id, stderr_pipe, "stderr", false).await;
        });
    }

    let wait_app = app.clone();
    let wait_session_id = session_id.clone();
    tokio::spawn(async move {
        let compile_status = {
            let mut guard = compile_child.lock().await;
            guard.wait().await
        };

        match compile_status {
            Ok(status) if status.success() && !terminated.load(Ordering::SeqCst) => {
                if let Err(error) = run_compiled_native_artifact(
                    wait_app.clone(),
                    wait_session_id.clone(),
                    output_path.clone(),
                    cwd_path,
                    request.env,
                    cleanup.clone(),
                    Arc::clone(&terminated),
                )
                .await
                {
                    emit_runner_event(
                        &wait_app,
                        &wait_session_id,
                        "error",
                        json!({ "message": error }),
                    );
                    remove_execution_session(&wait_app, &wait_session_id).await;
                    cleanup_execution_files(Some(cleanup));
                }
            }
            Ok(status) => {
                let was_terminated = terminated.load(Ordering::SeqCst);
                emit_runner_event(
                    &wait_app,
                    &wait_session_id,
                    if was_terminated { "terminated" } else { "completed" },
                    json!({
                        "success": false,
                        "exitCode": status.code(),
                        "terminated": was_terminated,
                    }),
                );
                remove_execution_session(&wait_app, &wait_session_id).await;
                cleanup_execution_files(Some(cleanup));
            }
            Err(error) => {
                emit_runner_event(
                    &wait_app,
                    &wait_session_id,
                    "error",
                    json!({ "message": error.to_string() }),
                );
                remove_execution_session(&wait_app, &wait_session_id).await;
                cleanup_execution_files(Some(cleanup));
            }
        }
    });

    Ok(ExecutionStartResponse {
        session_id,
        runner_type,
    })
}

async fn run_compiled_native_artifact(
    app: AppHandle,
    session_id: String,
    output_path: PathBuf,
    cwd_path: Option<PathBuf>,
    env_vars: Option<HashMap<String, String>>,
    cleanup: CleanupArtifacts,
    terminated: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut command = Command::new(&output_path);
    configure_tokio_command(&mut command);
    if let Some(cwd) = &cwd_path {
        command.current_dir(cwd);
    }
    if let Some(environment) = &env_vars {
        command.envs(environment);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    {
        let sessions = app.state::<ExecutionSessions>();
        let mut guard = sessions.sessions.lock().await;
        guard.insert(
            session_id.clone(),
            ManagedExecution {
                child: Arc::clone(&child),
                terminated: Arc::clone(&terminated),
            },
        );
    }

    if let Some(stdout_pipe) = stdout {
        let app_handle = app.clone();
        let stdout_session_id = session_id.clone();
        tokio::spawn(async move {
            stream_output(app_handle, stdout_session_id, stdout_pipe, "stdout", false).await;
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
                    json!({ "message": error.to_string() }),
                );
            }
        }

        remove_execution_session(&wait_app, &wait_session_id).await;
        cleanup_execution_files(Some(cleanup));
    });

    Ok(())
}

fn compiled_native_output_path(session_id: &str) -> Result<PathBuf, String> {
    let temp_dir = env::temp_dir().join("lattice-runner");
    fs::create_dir_all(&temp_dir).map_err(|error| error.to_string())?;
    let extension = if cfg!(target_os = "windows") { ".exe" } else { "" };
    Ok(temp_dir.join(format!("compiled-{session_id}{extension}")))
}

async fn remove_execution_session(app: &AppHandle, session_id: &str) {
    let sessions = app.state::<ExecutionSessions>();
    let mut guard = sessions.sessions.lock().await;
    guard.remove(session_id);
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
    configure_python_tokio_command(&mut command);
    command.arg("-u").arg(&cleanup.bootstrap_path);

    if let Some(cwd) = &cwd_path {
        command.current_dir(cwd);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::piped());

    if let Some(environment) = &request.env {
        command.envs(environment);
    }
    command.env("PYTHONUTF8", "1");
    command.env("PYTHONIOENCODING", "utf-8");

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

#[tauri::command]
fn desktop_open_terminal_at_path(path: String) -> Result<(), String> {
    let cwd = PathBuf::from(path);
    if !cwd.is_dir() {
        return Err("Terminal path must be an existing directory".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        StdCommand::new("cmd")
            .args(["/C", "start", "", "cmd"])
            .current_dir(&cwd)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    #[cfg(target_os = "macos")]
    {
        StdCommand::new("open")
            .args(["-a", "Terminal", "."])
            .current_dir(&cwd)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let candidates = [
            ("x-terminal-emulator", Vec::<&str>::new()),
            ("gnome-terminal", Vec::<&str>::new()),
            ("konsole", vec!["--workdir", "."]),
            ("xfce4-terminal", vec!["--working-directory", "."]),
            ("xterm", Vec::<&str>::new()),
        ];

        for (command, args) in candidates {
            if StdCommand::new(command)
                .args(args)
                .current_dir(&cwd)
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
        }

        Err("No supported terminal application was found".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("lattice-preview", |ctx, request| {
            let preview_state = ctx.app_handle().state::<DesktopPreviewState>();
            let result = resolve_preview_path(&preview_state, &request)
                .and_then(|path| build_preview_file_response(&path, &request));

            match result {
                Ok(response) => response,
                Err(message) => preview_error_response(http::StatusCode::FORBIDDEN, message),
            }
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(DesktopPreviewState::default())
        .manage(DesktopNativeWebviewState::default())
        .manage(DesktopFsState::default())
        .manage(ExecutionSessions::default())
        .manage(PythonSessions::default())
        .invoke_handler(tauri::generate_handler![
            get_setting,
            set_setting,
            remove_setting,
            clear_settings,
            get_default_folder,
            set_default_folder,
            get_last_opened_folder,
            set_last_opened_folder,
            set_last_workspace_path,
            resolve_startup_workspace,
            clear_default_folder,
            desktop_read_dir,
            desktop_read_file_bytes_raw,
            desktop_read_text_file,
            desktop_read_text_file_chunk,
            desktop_write_file_bytes,
            desktop_copy_path,
            desktop_move_path,
            desktop_rename_path,
            desktop_exists_path,
            desktop_file_metadata,
            desktop_is_directory,
            fetch_web_document,
            desktop_native_webview_mount,
            desktop_native_webview_update_bounds,
            desktop_native_webview_set_visibility,
            desktop_native_webview_close,
            desktop_native_webview_get_state,
            desktop_native_webview_navigate,
            desktop_native_webview_reload,
            desktop_native_webview_go_back,
            desktop_native_webview_go_forward,
            desktop_create_dir,
            desktop_remove_path,
            desktop_set_preview_root,
            desktop_window_minimize,
            desktop_window_start_dragging,
            desktop_window_toggle_maximize,
            desktop_window_is_maximized,
            desktop_window_close,
            detect_python_environments,
            probe_command_availability,
            formula_ocr_pix2tex,
            start_local_execution,
            terminate_local_execution,
            start_python_session,
            execute_python_session,
            stop_python_session,
            desktop_open_terminal_at_path,
            desktop_extract_pdf_page_text_layout,
            desktop_ocr_pdf_page_text_layout,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_decorations(false);
                }
                let _ = window.maximize();
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
        RunnerType::CompiledNative => Err("compiled-native is handled by the compile-run pipeline".to_string()),
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
    configure_tokio_command(&mut command);
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
    configure_python_tokio_command(&mut command);
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
        extra_paths: Vec::new(),
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
        extra_paths: Vec::new(),
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
    for path in cleanup.extra_paths {
        let _ = fs::remove_file(path);
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
    let mut command = StdCommand::new("conda");
    configure_std_command(&mut command);
    let output = command
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
    configure_std_command(&mut command);
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

    let version = {
        let mut command = StdCommand::new(&path);
        configure_std_command(&mut command);
        command
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    }
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
    let mut process = StdCommand::new(tool);
    configure_std_command(&mut process);
    let output = process
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

def reconfigure_stdio():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass

reconfigure_stdio()

def emit(event, payload):
    sys.__stdout__.write(PREFIX + json.dumps({"event": event, "payload": payload}, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()

def normalize_text(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "".join(str(item) for item in value)
    return str(value)

def normalize_lattice_code(value):
    if value is None:
        return ""

    normalized = []
    for ch in value:
        codepoint = ord(ch)
        if 0xDC80 <= codepoint <= 0xDCFF:
            normalized.append(bytes([codepoint - 0xDC00]).decode("cp1252", errors="replace"))
        elif 0xD800 <= codepoint <= 0xDFFF:
            normalized.append("\uFFFD")
        else:
            normalized.append(ch)

    return "".join(normalized)

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
            code = normalize_lattice_code(code)
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

fn resolve_existing_directory_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    let metadata = fs::metadata(&candidate).ok()?;
    if !metadata.is_dir() {
        return None;
    }

    Some(candidate.to_string_lossy().to_string())
}

fn configure_tokio_command(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }
}

fn configure_python_tokio_command(command: &mut Command) {
    configure_tokio_command(command);
    command.env("PYTHONUTF8", "1");
    command.env("PYTHONIOENCODING", "utf-8");
}

fn configure_std_command(command: &mut StdCommand) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_settings_roundtrip_preserves_frontend_extra_fields() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "defaultFolder": "C:/workspace",
            "lastOpenedFolder": "C:/workspace",
            "lastWorkspacePath": "C:/workspace",
            "recentWorkspacePaths": ["C:/workspace"],
            "windowState": {
                "width": 1440.0,
                "height": 900.0,
                "x": 100.0,
                "y": 120.0,
                "isMaximized": true
            },
            "onboardingCompleted": true,
            "activityView": "search",
            "pluginPanelDockOpen": true,
            "aiPanelOpen": true,
            "aiPanelWidth": 32
        }))
        .expect("settings should deserialize");

        assert_eq!(settings.default_folder.as_deref(), Some("C:/workspace"));
        assert_eq!(settings.last_workspace_path.as_deref(), Some("C:/workspace"));
        assert_eq!(settings.extra.get("onboardingCompleted"), Some(&json!(true)));
        assert_eq!(settings.extra.get("aiPanelOpen"), Some(&json!(true)));
        assert_eq!(settings.extra.get("aiPanelWidth"), Some(&json!(32)));

        let encoded = serde_json::to_value(&settings).expect("settings should serialize");
        assert_eq!(encoded["onboardingCompleted"], json!(true));
        assert_eq!(encoded["activityView"], json!("search"));
        assert_eq!(encoded["pluginPanelDockOpen"], json!(true));
        assert_eq!(encoded["aiPanelOpen"], json!(true));
        assert_eq!(encoded["aiPanelWidth"], json!(32));
    }

    #[test]
    fn persisted_settings_detection_counts_extra_frontend_fields() {
        let mut settings = AppSettings::default();
        settings
            .extra
            .insert("onboardingCompleted".to_string(), json!(true));

        assert!(has_persisted_app_settings(&settings));
    }

    #[test]
    fn preview_request_path_decodes_percent_escaped_paths() {
        let decoded = decode_preview_request_path("/C:/Research%20Notes/paper.pdf")
            .expect("path should decode");
        assert_eq!(decoded, "C:/Research Notes/paper.pdf");
    }

    #[test]
    fn byte_range_parser_supports_open_and_suffix_ranges() {
        assert_eq!(parse_range_header("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range_header("bytes=10-", 100), Some((10, 99)));
        assert_eq!(parse_range_header("bytes=-15", 100), Some((85, 99)));
        assert_eq!(parse_range_header("bytes=150-200", 100), None);
    }
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

def reconfigure_stdio():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass

reconfigure_stdio()

def emit(event, payload):
    sys.__stdout__.write(PREFIX + json.dumps({"event": event, "payload": payload}, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()

def normalize_text(value):
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "".join(str(item) for item in value)
    return str(value)

def normalize_lattice_code(value):
    if value is None:
        return ""

    normalized = []
    for ch in value:
        codepoint = ord(ch)
        if 0xDC80 <= codepoint <= 0xDCFF:
            normalized.append(bytes([codepoint - 0xDC00]).decode("cp1252", errors="replace"))
        elif 0xD800 <= codepoint <= 0xDFFF:
            normalized.append("\uFFFD")
        else:
            normalized.append(ch)

    return "".join(normalized)

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
        code = normalize_lattice_code(code)

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
