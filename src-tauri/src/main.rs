//! Lattice Desktop Application
//!
//! Main entry point for the Tauri desktop shell, including
//! persistent settings and local code execution commands.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_http;
mod webview_failure;
mod code_oss_runtime;
mod debug_adapter;
mod pdf_native;
mod source_control;
mod shared_library_secrets;
mod agent_harness;
mod vscode_workbench;
mod workspace_watch;
mod drop_import;
mod formula_ocr_runtime;

use std::{
    collections::{HashMap, HashSet},
    env, fs,
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
    ipc::Response as TauriResponse, path::BaseDirectory, webview::PageLoadEvent, AppHandle, Emitter, LogicalPosition,
    LogicalSize, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_store::StoreExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex, Semaphore},
};
use uuid::Uuid;

use crate::ai_http::{
    ai_native_http_request, ai_native_http_stream_cancel, ai_native_http_stream_start,
    AiHttpStreamState,
};
use crate::debug_adapter::{
    desktop_continue_debug_session, desktop_evaluate_debug_expression, desktop_get_debug_scopes,
    desktop_get_debug_session_status, desktop_get_debug_stack_trace, desktop_get_debug_threads,
    desktop_get_debug_variables, desktop_pause_debug_session, desktop_restart_debug_session,
    desktop_set_debug_breakpoints, desktop_start_node_debug_session,
    desktop_start_python_debug_session, desktop_step_into_debug_session,
    desktop_step_out_debug_session, desktop_step_over_debug_session, desktop_stop_debug_session,
};
use crate::pdf_native::{desktop_extract_pdf_page_text_layout, desktop_ocr_pdf_page_text_layout};
use crate::source_control::{
    desktop_commit_source_control_changes, desktop_get_source_control_diff,
    desktop_get_source_control_status, desktop_stage_all_source_control_changes,
    desktop_stage_source_control_paths, desktop_unstage_all_source_control_changes,
    desktop_unstage_source_control_paths,
};

const SETTINGS_STORE: &str = "settings.json";
const SHARED_LIBRARY_STORE: &str = "shared-library.json";
const SHARED_LIBRARY_SECURE_PREFIX: &str = "secure:";
const SHARED_LIBRARY_QUEUE_KEY: &str = "sync-queue";
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
const VSCODE_EXTENSION_HOST_COMMAND_TIMEOUT_MS: u64 = 15_000;

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
struct VSCodeProfileCandidate {
    product: String,
    user_dir: Option<String>,
    extensions_dir: Option<String>,
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
struct VSCodeHostCommandContribution {
    command: String,
    title: String,
    category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostViewContribution {
    id: String,
    title: String,
    container: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostExtensionInput {
    id: String,
    path: String,
    main: Option<String>,
    browser: Option<String>,
    display_name: Option<String>,
    #[serde(rename = "packageJSON")]
    package_json: Option<Value>,
    activation_events: Vec<String>,
    extension_kind: Option<Vec<String>>,
    command_items: Option<Vec<VSCodeHostCommandContribution>>,
    view_items: Option<Vec<VSCodeHostViewContribution>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostStartRequest {
    workspace_root_path: Option<String>,
    configuration: Option<Value>,
    extensions: Vec<VSCodeExtensionHostExtensionInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostCommandRequest {
    command_id: String,
    args: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostInteractionResponseRequest {
    interaction_id: String,
    cancelled: Option<bool>,
    selected_ids: Option<Vec<String>>,
    value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostActivateExtensionRequest {
    extension_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostOpenDocumentRequest {
    file_path: String,
    language_id: Option<String>,
    content: Option<String>,
    version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostDocumentSyncRequest {
    file_path: String,
    language_id: Option<String>,
    content: String,
    version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostPositionRequest {
    line: usize,
    character: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostRangeRequest {
    start: VSCodeHostPositionRequest,
    end: VSCodeHostPositionRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostFormattingOptionsRequest {
    tab_size: usize,
    insert_spaces: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostLanguageFeatureRequest {
    feature: String,
    file_path: String,
    language_id: String,
    version: u64,
    position: Option<VSCodeHostPositionRequest>,
    range: Option<VSCodeHostRangeRequest>,
    trigger_character: Option<String>,
    new_name: Option<String>,
    formatting_options: Option<VSCodeHostFormattingOptionsRequest>,
    context: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostViewRequest {
    view_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostViewMessageRequest {
    view_id: String,
    message: Option<Value>,
    drain_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeScriptDiagnosticsRequest {
    workspace_root_path: Option<String>,
    file_path: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeScriptLanguageFeatureRequest {
    workspace_root_path: Option<String>,
    file_path: String,
    content: String,
    offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TypeScriptDiagnosticSnapshot {
    file_path: String,
    line: usize,
    column: usize,
    severity: String,
    code: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeScriptQuickInfoSnapshot {
    display: String,
    documentation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeScriptDefinitionSnapshot {
    file_path: String,
    line: usize,
    column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeScriptReferenceSnapshot {
    file_path: String,
    line: usize,
    column: usize,
    text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonDiagnosticsRequest {
    workspace_root_path: Option<String>,
    python_path: Option<String>,
    file_path: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonLanguageFeatureRequest {
    workspace_root_path: Option<String>,
    python_path: Option<String>,
    file_path: String,
    content: String,
    offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PythonDiagnosticSnapshot {
    file_path: String,
    line: usize,
    column: usize,
    severity: String,
    code: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonQuickInfoSnapshot {
    display: String,
    documentation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonDefinitionSnapshot {
    file_path: String,
    line: usize,
    column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonReferenceSnapshot {
    file_path: String,
    line: usize,
    column: usize,
    text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustDiagnosticsRequest {
    workspace_root_path: Option<String>,
    file_path: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustLanguageFeatureRequest {
    workspace_root_path: Option<String>,
    file_path: String,
    content: String,
    offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RustDiagnosticSnapshot {
    file_path: String,
    line: usize,
    column: usize,
    severity: String,
    code: Option<String>,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustQuickInfoSnapshot {
    display: String,
    documentation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustDefinitionSnapshot {
    file_path: String,
    line: usize,
    column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RustReferenceSnapshot {
    file_path: String,
    line: usize,
    column: usize,
    text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeIntelligenceProviderStatus {
    id: String,
    label: String,
    status: String,
    detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostCommandSnapshot {
    id: String,
    title: String,
    extension_id: String,
    category: Option<String>,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostViewSnapshot {
    id: String,
    title: String,
    extension_id: String,
    container: Option<String>,
    kind: String,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostExtensionSnapshot {
    id: String,
    display_name: Option<String>,
    status: String,
    command_count: usize,
    view_count: usize,
    error: Option<String>,
    missing_api: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostWebviewOptions {
    enable_scripts: Option<bool>,
    enable_forms: Option<bool>,
    retain_context_when_hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostWebviewSnapshot {
    view_id: String,
    title: String,
    extension_id: String,
    html: String,
    messages: Option<Vec<Value>>,
    options: Option<VSCodeHostWebviewOptions>,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostWebviewMessageResult {
    view_id: String,
    messages: Vec<Value>,
    snapshot: VSCodeExtensionHostSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostTreeCommandSnapshot {
    command: String,
    title: Option<String>,
    arguments: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostTreeItemSnapshot {
    id: String,
    label: String,
    description: Option<String>,
    tooltip: Option<String>,
    collapsible_state: String,
    command: Option<VSCodeHostTreeCommandSnapshot>,
    children: Option<Vec<VSCodeHostTreeItemSnapshot>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeHostTreeSnapshot {
    view_id: String,
    title: String,
    extension_id: String,
    items: Vec<VSCodeHostTreeItemSnapshot>,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostSnapshot {
    status: String,
    runtime: String,
    command_count: usize,
    active_extension_count: usize,
    commands: Vec<VSCodeHostCommandSnapshot>,
    views: Vec<VSCodeHostViewSnapshot>,
    extensions: Vec<VSCodeHostExtensionSnapshot>,
    last_error: Option<String>,
}

impl Default for VSCodeExtensionHostSnapshot {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            runtime: "none".to_string(),
            command_count: 0,
            active_extension_count: 0,
            commands: Vec::new(),
            views: Vec::new(),
            extensions: Vec::new(),
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum VSCodeExtensionHostRuntime {
    Node,
    CodeElectronNode,
}

impl VSCodeExtensionHostRuntime {
    fn as_str(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::CodeElectronNode => "code-electron-node",
        }
    }
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

#[derive(Debug)]
struct ManagedVSCodeExtensionHost {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: Arc<Mutex<tokio::io::Lines<BufReader<ChildStdout>>>>,
    request_lock: Arc<Mutex<()>>,
    runtime: VSCodeExtensionHostRuntime,
    script_path: PathBuf,
    config_path: PathBuf,
}

#[derive(Default)]
struct VSCodeExtensionHostState {
    process: Mutex<Option<ManagedVSCodeExtensionHost>>,
    snapshot: Mutex<VSCodeExtensionHostSnapshot>,
}

#[derive(Debug, Clone)]
struct ManagedTypeScriptService {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: Arc<Mutex<tokio::io::Lines<BufReader<ChildStdout>>>>,
    request_lock: Arc<Mutex<()>>,
    script_path: PathBuf,
    config_path: PathBuf,
    workspace_root_path: Option<String>,
}

#[derive(Default)]
struct TypeScriptServiceState {
    process: Mutex<Option<ManagedTypeScriptService>>,
}

#[derive(Debug, Clone)]
struct ManagedPythonAnalysisService {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: Arc<Mutex<tokio::io::Lines<BufReader<ChildStdout>>>>,
    request_lock: Arc<Mutex<()>>,
    python_path: String,
    script_path: PathBuf,
}

#[derive(Default)]
struct PythonAnalysisServiceState {
    process: Mutex<Option<ManagedPythonAnalysisService>>,
}

#[derive(Default)]
struct DesktopPreviewState {
    workspace_root: StdMutex<Option<PathBuf>>,
    extension_roots: StdMutex<Vec<PathBuf>>,
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
    let snapshot =
        snapshots
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

fn desktop_native_webview_snapshot_after_poll(
    cached: Option<DesktopNativeWebviewSnapshot>,
    observed_url: String,
    label: &str,
) -> DesktopNativeWebviewSnapshot {
    cached.unwrap_or_else(|| DesktopNativeWebviewSnapshot {
        label: label.to_string(),
        current_url: observed_url,
        title: None,
        status: "ready".to_string(),
        last_error: None,
    })
}

fn desktop_native_webview_snapshot_after_page_load(
    cached: Option<DesktopNativeWebviewSnapshot>,
    page_url: String,
    label: &str,
) -> DesktopNativeWebviewSnapshot {
    let mut snapshot = cached.unwrap_or_else(|| DesktopNativeWebviewSnapshot {
        label: label.to_string(),
        current_url: String::new(),
        title: None,
        status: "mounting".to_string(),
        last_error: None,
    });
    // The completed page is the redirect destination. Navigation-start events
    // can still contain the URL that issued the redirect.
    snapshot.current_url = page_url;
    snapshot.status = "ready".to_string();
    snapshot.last_error = None;
    snapshot
}

fn desktop_native_webview_url_or_fallback(candidate: &str, fallback: &str) -> String {
    reqwest::Url::parse(candidate)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

fn desktop_native_webview_record_current_url(app: &AppHandle, label: &str, source: &str) {
    let current_url = desktop_native_webview_url_or_fallback(source, "");
    if current_url.is_empty() {
        return;
    }
    let cached = get_desktop_native_webview_snapshot(app, label)
        .ok()
        .flatten();
    let next = desktop_native_webview_snapshot_after_page_load(cached, current_url, label);
    let _ = set_desktop_native_webview_snapshot(
        app,
        label,
        Some(next.current_url),
        None,
        Some(&next.status),
        Some(next.last_error),
    );
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
    .map(|ch| {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            ch
        } else {
            '_'
        }
    })
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
        Some("css") => "text/css",
        Some("js") | Some("mjs") | Some("cjs") => "application/javascript",
        Some("json") => "application/json",
        Some("html") | Some("htm") => "text/html",
        Some("wasm") => "application/wasm",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
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
        http::HeaderValue::from_static(
            "Accept-Ranges, Content-Length, Content-Range, Content-Type",
        ),
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
            file.seek(SeekFrom::Start(start))
                .map_err(|error| error.to_string())?;
            file.read_exact(&mut buffer)
                .map_err(|error| error.to_string())?;

            let mut response = http::Response::builder()
                .status(http::StatusCode::PARTIAL_CONTENT)
                .header(http::header::CONTENT_TYPE, content_type)
                .header(http::header::ACCEPT_RANGES, "bytes")
                .header(http::header::CONTENT_LENGTH, chunk_len.to_string())
                .header(
                    http::header::CONTENT_RANGE,
                    format!("bytes {start}-{end}/{file_len}"),
                )
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
        file.read_to_end(&mut buffer)
            .map_err(|error| error.to_string())?;
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
    let extension_roots = preview_state
        .extension_roots
        .lock()
        .map_err(|error| error.to_string())?
        .clone();

    if !is_path_within_root(&canonical_file, &workspace_root)
        && !extension_roots
            .iter()
            .any(|root| is_path_within_root(&canonical_file, root))
    {
        return Err(format!(
            "Preview path is outside the current workspace and registered extension roots: {}",
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
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;

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
    settings.recent_workspace_paths =
        normalize_recent_workspace_paths(settings.recent_workspace_paths);

    Ok(settings)
}

fn save_app_settings(app: &tauri::AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;

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
            serde_json::to_value(&normalized.recent_workspace_paths)
                .map_err(|error| error.to_string())?,
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
        if !next_settings
            .recent_workspace_paths
            .iter()
            .any(|path| path == &valid_path)
        {
            next_settings
                .recent_workspace_paths
                .insert(0, valid_path.clone());
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
        if !next_settings
            .recent_workspace_paths
            .iter()
            .any(|path| path == &valid_path)
        {
            next_settings
                .recent_workspace_paths
                .insert(0, valid_path.clone());
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

    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
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

    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
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

    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
    store.delete(&key);
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_settings(app: tauri::AppHandle) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|error| error.to_string())?;
    store.clear();
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn shared_library_secure_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let store = app
        .store(SHARED_LIBRARY_STORE)
        .map_err(|error| error.to_string())?;
    let storage_key = format!("{SHARED_LIBRARY_SECURE_PREFIX}{key}");
    let Some(value) = store.get(&storage_key) else { return Ok(None); };
    if let Some(legacy) = value.as_str() {
        // Migrate only on a successful protected write; preserve the legacy
        // in-memory value when persistence fails so a retry can recover it.
        let protected = shared_library_secrets::protect(&key, legacy)?;
        let plaintext = legacy.to_owned();
        store.set(&storage_key, protected);
        if let Err(error) = store.save() {
            store.set(&storage_key, value);
            return Err(error.to_string());
        }
        return Ok(Some(plaintext));
    }
    shared_library_secrets::unprotect(&key, value).map(Some)
}

#[tauri::command]
fn shared_library_secure_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let store = app
        .store(SHARED_LIBRARY_STORE)
        .map_err(|error| error.to_string())?;
    let storage_key = format!("{SHARED_LIBRARY_SECURE_PREFIX}{key}");
    let protected = shared_library_secrets::protect(&key, &value)?;
    let previous = store.get(&storage_key);
    store.set(&storage_key, protected);
    if let Err(error) = store.save() {
        match previous { Some(value) => { store.set(&storage_key, value); }, None => { store.delete(&storage_key); } }
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn shared_library_secure_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let store = app
        .store(SHARED_LIBRARY_STORE)
        .map_err(|error| error.to_string())?;
    let storage_key = format!("{SHARED_LIBRARY_SECURE_PREFIX}{key}");
    let previous = store.get(&storage_key);
    store.delete(&storage_key);
    if let Err(error) = store.save() {
        if let Some(value) = previous { store.set(&storage_key, value); }
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn shared_library_queue_load(app: tauri::AppHandle) -> Result<Value, String> {
    let store = app
        .store(SHARED_LIBRARY_STORE)
        .map_err(|error| error.to_string())?;
    Ok(store
        .get(SHARED_LIBRARY_QUEUE_KEY)
        .unwrap_or_else(|| Value::Array(Vec::new())))
}

#[tauri::command]
fn shared_library_queue_save(app: tauri::AppHandle, entries: Vec<Value>) -> Result<(), String> {
    let store = app
        .store(SHARED_LIBRARY_STORE)
        .map_err(|error| error.to_string())?;
    store.set(SHARED_LIBRARY_QUEUE_KEY, Value::Array(entries));
    store.save().map_err(|error| error.to_string())
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

fn optional_existing_dir(path: PathBuf) -> Option<String> {
    if path.is_dir() {
        Some(path.to_string_lossy().replace('\\', "/"))
    } else {
        None
    }
}

fn push_vscode_profile_candidate(
    candidates: &mut Vec<VSCodeProfileCandidate>,
    product: &str,
    user_dir: Option<PathBuf>,
    extensions_dir: Option<PathBuf>,
) {
    let user_dir = user_dir.and_then(optional_existing_dir);
    let extensions_dir = extensions_dir.and_then(optional_existing_dir);
    if user_dir.is_none() && extensions_dir.is_none() {
        return;
    }

    candidates.push(VSCodeProfileCandidate {
        product: product.to_string(),
        user_dir,
        extensions_dir,
    });
}

#[tauri::command]
fn desktop_discover_vscode_profiles() -> Result<Vec<VSCodeProfileCandidate>, String> {
    let mut candidates = Vec::new();

    #[cfg(windows)]
    {
        let appdata = env::var_os("APPDATA").map(PathBuf::from);
        let user_profile = env::var_os("USERPROFILE").map(PathBuf::from);

        let extension_dir = |name: &str| {
            user_profile
                .as_ref()
                .map(|profile| profile.join(name).join("extensions"))
        };

        if let Some(appdata) = appdata.as_ref() {
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code",
                Some(appdata.join("Code").join("User")),
                extension_dir(".vscode"),
            );
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code Insiders",
                Some(appdata.join("Code - Insiders").join("User")),
                extension_dir(".vscode-insiders"),
            );
        }

        if appdata.is_none() {
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code",
                None,
                extension_dir(".vscode"),
            );
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code Insiders",
                None,
                extension_dir(".vscode-insiders"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
            let app_support = home.join("Library").join("Application Support");
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code",
                Some(app_support.join("Code").join("User")),
                Some(home.join(".vscode").join("extensions")),
            );
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code Insiders",
                Some(app_support.join("Code - Insiders").join("User")),
                Some(home.join(".vscode-insiders").join("extensions")),
            );
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
            let config_home = env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"));
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code",
                Some(config_home.join("Code").join("User")),
                Some(home.join(".vscode").join("extensions")),
            );
            push_vscode_profile_candidate(
                &mut candidates,
                "VS Code Insiders",
                Some(config_home.join("Code - Insiders").join("User")),
                Some(home.join(".vscode-insiders").join("extensions")),
            );
        }
    }

    Ok(candidates)
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

    #[cfg(windows)]
    let initial_url = WebviewUrl::External(
        reqwest::Url::parse("about:blank").map_err(|error| error.to_string())?,
    );
    #[cfg(not(windows))]
    let initial_url = WebviewUrl::External(target_url.clone());

    let webview_builder = tauri::webview::WebviewBuilder::new(label.clone(), initial_url)
    .user_agent("LatticeEmbeddedWebview/2.2.0")
    .data_directory(build_desktop_native_webview_data_directory(&target_url))
    .on_navigation(move |next_url| {
        let next_url = desktop_native_webview_url_or_fallback(next_url.as_str(), "");
        if !next_url.is_empty() {
            let _ = set_desktop_native_webview_snapshot(
                &app_for_navigation,
                &label_for_navigation,
                Some(next_url),
                None,
                Some("ready"),
                None,
            );
        }
        true
    })
    .on_page_load(move |_webview, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }
        #[cfg(not(windows))]
        let fallback_url = payload.url().to_string();
        #[cfg(windows)]
        {
            let _ = set_desktop_native_webview_snapshot(
                &app_for_page_load,
                &label_for_page_load,
                None,
                None,
                Some("ready"),
                Some(None),
            );
            return;
        }
        #[cfg(not(windows))]
        let page_url = fallback_url;
        #[cfg(not(windows))]
        {
        let cached = get_desktop_native_webview_snapshot(&app_for_page_load, &label_for_page_load)
            .ok()
            .flatten();
        let next = desktop_native_webview_snapshot_after_page_load(
            cached,
            page_url,
            &label_for_page_load,
        );
        let _ = set_desktop_native_webview_snapshot(
            &app_for_page_load,
            &label_for_page_load,
            Some(next.current_url),
            None,
            Some(&next.status),
            Some(next.last_error),
        );
        }
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
                    Some(Some(format!(
                        "Window not found: {}",
                        window_label_for_thread
                    ))),
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
                    #[cfg(windows)]
                    {
                        let app_for_navigation_completed = app_for_thread.clone();
                        let label_for_navigation_completed = label_for_thread.clone();
                        let app_for_history_changed = app_for_thread.clone();
                        let label_for_history_changed = label_for_thread.clone();
                        let registration_error = Arc::new(StdMutex::new(None::<String>));
                        let registration_error_for_callback = Arc::clone(&registration_error);
                        let registration_result = webview.with_webview(move |platform| {
                            let core = match unsafe { platform.controller().CoreWebView2() } {
                                Ok(core) => core,
                                Err(error) => {
                                    if let Ok(mut current) = registration_error_for_callback.lock() {
                                        *current = Some(error.to_string());
                                    }
                                    return;
                                }
                            };
                            let navigation_completed =
                                webview2_com::NavigationCompletedEventHandler::create(Box::new(
                                    move |sender, _args| {
                                        if let Some(sender) = sender {
                                            let mut source_buffer =
                                                webview2_com::CoTaskMemPWSTR::from("");
                                            let mut source_out = source_buffer.take();
                                            unsafe { sender.Source(&mut source_out)? };
                                            let source = webview2_com::take_pwstr(source_out);
                                            desktop_native_webview_record_current_url(
                                                &app_for_navigation_completed,
                                                &label_for_navigation_completed,
                                                &source,
                                            );
                                        }
                                        Ok(())
                                    },
                                ));
                            let mut navigation_token = 0;
                            if let Err(error) = unsafe {
                                core.add_NavigationCompleted(&navigation_completed, &mut navigation_token)
                            } {
                                if let Ok(mut current) = registration_error_for_callback.lock() {
                                    *current = Some(error.to_string());
                                }
                                return;
                            }

                            let history_changed = webview2_com::HistoryChangedEventHandler::create(
                                Box::new(move |sender, _args| {
                                    if let Some(sender) = sender {
                                        let mut source_buffer =
                                            webview2_com::CoTaskMemPWSTR::from("");
                                        let mut source_out = source_buffer.take();
                                        unsafe { sender.Source(&mut source_out)? };
                                        let source = webview2_com::take_pwstr(source_out);
                                        desktop_native_webview_record_current_url(
                                            &app_for_history_changed,
                                            &label_for_history_changed,
                                            &source,
                                        );
                                    }
                                    Ok(())
                                }),
                            );
                            let mut history_token = 0;
                            if let Err(error) = unsafe {
                                core.add_HistoryChanged(&history_changed, &mut history_token)
                            } {
                                if let Ok(mut current) = registration_error_for_callback.lock() {
                                    *current = Some(error.to_string());
                                }
                            }
                        });

                        if let Err(error) = registration_result {
                            let _ = set_desktop_native_webview_snapshot(
                                &app_for_thread,
                                &label_for_thread,
                                Some(target_url_for_thread.to_string()),
                                None,
                                Some("error"),
                                Some(Some(error.to_string())),
                            );
                            return;
                        }
                        if let Some(error) = registration_error.lock().ok().and_then(|current| current.clone()) {
                            let _ = set_desktop_native_webview_snapshot(
                                &app_for_thread,
                                &label_for_thread,
                                Some(target_url_for_thread.to_string()),
                                None,
                                Some("error"),
                                Some(Some(error)),
                            );
                            return;
                        }
                        if let Err(error) = webview.navigate(target_url_for_thread.clone()) {
                            let _ = set_desktop_native_webview_snapshot(
                                &app_for_thread,
                                &label_for_thread,
                                Some(target_url_for_thread.to_string()),
                                None,
                                Some("error"),
                                Some(Some(error.to_string())),
                            );
                            return;
                        }
                    }

                    let visibility_result = if !visible {
                        webview.hide().map_err(|error| error.to_string())
                    } else if focus {
                        webview.set_focus().map_err(|error| error.to_string())
                    } else {
                        Ok(())
                    };

                    match visibility_result {
                        Ok(()) => {
                            #[cfg(not(windows))]
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
        // Navigation callbacks own URL ordering. WebView2 can briefly report
        // the pre-redirect URL while its child has already loaded the target;
        // polling it here would overwrite the newer navigation snapshot.
        let cached = get_desktop_native_webview_snapshot(&app, &label)?;
        let observed_url = webview
            .url()
            .map_err(|error| error.to_string())?
            .to_string();
        let state = desktop_native_webview_snapshot_after_poll(
            cached,
            observed_url.clone(),
            &label,
        );
        return Ok(Some(state));
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
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|error| error.to_string())
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

fn set_extension_preview_roots(
    preview_state: &DesktopPreviewState,
    extensions: &[VSCodeExtensionHostExtensionInput],
) -> Result<(), String> {
    let roots = extensions
        .iter()
        .filter_map(|extension| fs::canonicalize(&extension.path).ok())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    let mut extension_roots = preview_state
        .extension_roots
        .lock()
        .map_err(|error| error.to_string())?;
    *extension_roots = roots;
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
fn probe_command_availability(command: String, include_version: Option<bool>) -> Result<CommandAvailability, String> {
    Ok(probe_command_with_options(&command, include_version.unwrap_or(true)))
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

    let bytes: Vec<u8> = input
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
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
            if chunk[2] == b'=' {
                0
            } else {
                value(chunk[2]).ok_or_else(|| "Invalid base64 character".to_string())?
            },
            if chunk[3] == b'=' {
                0
            } else {
                value(chunk[3]).ok_or_else(|| "Invalid base64 character".to_string())?
            },
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
async fn formula_ocr_pix2tex(
    request: FormulaOcrPix2texRequest,
) -> Result<FormulaOcrPix2texResponse, String> {
    let command_name = request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pix2tex")
        .to_string();
    // Do not invoke --version here: OCR CLIs can load models or wait for input.
    let command_path = resolve_command_path(&command_name).ok_or_else(|| {
        format!("pix2tex is not available. Install LaTeX-OCR and ensure `{command_name}` is on PATH.")
    })?;

    let data_url = request.image_data_url.trim();
    let base64_payload = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "Expected a PNG data URL".to_string())?;
    if base64_payload.len() > 24 * 1024 * 1024 {
        return Err("Formula image is too large; select a smaller region".to_string());
    }
    let image_bytes = decode_base64(base64_payload)?;
    if image_bytes.is_empty() {
        return Err("OCR image is empty".to_string());
    }

    let image_path = env::temp_dir().join(format!("lattice-formula-ocr-{}.png", Uuid::new_v4()));
    fs::write(&image_path, image_bytes).map_err(|error| error.to_string())?;

    let mut command = Command::new(&command_path);
    configure_tokio_command(&mut command);
    command
        .arg(&image_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output_result = tokio::time::timeout(Duration::from_secs(55), command.output())
        .await
        .map_err(|_| "Local formula recognition timed out; the OCR process was stopped".to_string())
        .and_then(|output| output.map_err(|error| error.to_string()));

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
                    if was_terminated {
                        "terminated"
                    } else {
                        "completed"
                    },
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
        return Err(compiler_availability
            .error
            .unwrap_or_else(|| format!("Command not available: {compiler}")));
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
                    if was_terminated {
                        "terminated"
                    } else {
                        "completed"
                    },
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
                    if was_terminated {
                        "terminated"
                    } else {
                        "completed"
                    },
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
    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
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

    let python = if let Some(command) = request
        .command
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
        command
    } else {
        let environments =
            discover_python_environments(cwd_path.as_deref().and_then(Path::to_str))?;
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
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());

    if let Some(environment) = &request.env {
        command.envs(environment);
    }
    command.env("PYTHONUTF8", "1");
    command.env("PYTHONIOENCODING", "utf-8");

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Python session stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Python session stderr".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture Python session stdin".to_string())?;
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
                    if was_terminated {
                        "terminated"
                    } else {
                        "completed"
                    },
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

    let payload = serde_json::to_string(&json!({ "code": request.code }))
        .map_err(|error| error.to_string())?;
    let mut stdin = managed.stdin.lock().await;
    stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
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

#[tauri::command]
fn desktop_open_in_vscode(file_path: String, workspace_path: Option<String>) -> Result<(), String> {
    let target_path = resolve_vscode_target_path(&file_path, workspace_path.as_deref())?;
    let launcher = resolve_vscode_launcher().ok_or_else(|| {
        "VS Code was not found. Install VS Code or make the `code` command available on PATH."
            .to_string()
    })?;

    #[cfg(target_os = "windows")]
    let mut command = if is_windows_shell_script(&launcher) {
        let mut command = StdCommand::new("cmd");
        command.arg("/C").arg(&launcher);
        command
    } else {
        StdCommand::new(&launcher)
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = StdCommand::new(&launcher);

    configure_std_command(&mut command);
    command.arg("--reuse-window").arg(&target_path);

    if let Some(workspace) = workspace_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        command.current_dir(workspace);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open VS Code: {error}"))
}

#[cfg(target_os = "windows")]
fn is_windows_shell_script(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false)
}

fn resolve_vscode_target_path(
    file_path: &str,
    workspace_path: Option<&str>,
) -> Result<PathBuf, String> {
    let direct = PathBuf::from(file_path);
    if direct.exists() {
        return Ok(direct);
    }

    if let Some(workspace) = workspace_path {
        let joined = PathBuf::from(workspace).join(file_path);
        if joined.exists() {
            return Ok(joined);
        }
    }

    if direct.is_absolute() {
        return Err(format!("File does not exist: {file_path}"));
    }

    Err(format!(
        "File does not exist in the current workspace: {file_path}"
    ))
}

fn resolve_vscode_launcher() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            candidates.push(local_app_data.join("Programs/Microsoft VS Code/Code.exe"));
            candidates.push(
                local_app_data.join("Programs/Microsoft VS Code Insiders/Code - Insiders.exe"),
            );
        }
        if let Ok(program_files) = env::var("ProgramFiles") {
            let program_files = PathBuf::from(program_files);
            candidates.push(program_files.join("Microsoft VS Code/Code.exe"));
            candidates.push(program_files.join("Microsoft VS Code Insiders/Code - Insiders.exe"));
        }
        if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
            let program_files_x86 = PathBuf::from(program_files_x86);
            candidates.push(program_files_x86.join("Microsoft VS Code/Code.exe"));
            candidates
                .push(program_files_x86.join("Microsoft VS Code Insiders/Code - Insiders.exe"));
        }

        if let Some(path) = candidates.into_iter().find(|path| path.exists()) {
            return Some(path);
        }
    }

    for command in ["code", "code.cmd", "Code"] {
        if let Some(path) = resolve_command_path(command) {
            return Some(PathBuf::from(path));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let candidate =
            PathBuf::from("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn unavailable_vscode_extension_host_snapshot(
    message: impl Into<String>,
) -> VSCodeExtensionHostSnapshot {
    VSCodeExtensionHostSnapshot {
        status: "unavailable".to_string(),
        runtime: "none".to_string(),
        command_count: 0,
        active_extension_count: 0,
        commands: Vec::new(),
        views: Vec::new(),
        extensions: Vec::new(),
        last_error: Some(message.into()),
    }
}

fn resolve_vscode_extension_host_runtime() -> Option<(PathBuf, VSCodeExtensionHostRuntime)> {
    for command in ["node", "node.exe"] {
        if let Some(path) = resolve_command_path(command) {
            return Some((PathBuf::from(path), VSCodeExtensionHostRuntime::Node));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let launcher = resolve_vscode_launcher()?;
        let is_exe = launcher
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);
        if is_exe {
            return Some((launcher, VSCodeExtensionHostRuntime::CodeElectronNode));
        }
    }

    None
}

fn resolve_typescript_resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            "resources/vscode-typescript/typescript",
            BaseDirectory::Resource,
        )
        .map_err(|error| error.to_string())
}

fn resolve_typescript_runtime_entry(app: &AppHandle) -> Result<PathBuf, String> {
    let root = resolve_typescript_resource_root(app)?;
    let entry = root.join("lib").join("typescript.js");
    if entry.exists() {
        return Ok(entry);
    }
    Err(format!(
        "Bundled TypeScript runtime not found: {}",
        entry.to_string_lossy()
    ))
}

fn resolve_python_analysis_runtime(
    request_path: Option<&str>,
    explicit_python_path: Option<&str>,
) -> Result<String, String> {
    if let Some(path) = explicit_python_path.filter(|value| !value.trim().is_empty()) {
        return Ok(path.to_string());
    }

    let cwd = request_path
        .and_then(|value| Path::new(value).parent())
        .and_then(|path| path.to_str());
    let environments = discover_python_environments(cwd)?;
    environments
        .first()
        .map(|environment| environment.path.clone())
        .ok_or_else(|| "No local Python interpreter detected for Python analysis.".to_string())
}

fn persistent_python_analysis_service_script() -> &'static str {
    r#"import ast
import io
import json
import tokenize
import sys
from pathlib import Path

documents = {}

def offset_to_line_col(text: str, offset: int):
    before = text[:offset]
    line = before.count("\n") + 1
    last_newline = before.rfind("\n")
    column = offset + 1 if last_newline == -1 else offset - last_newline
    return line, column

def line_col_to_offset(text: str, line: int, column: int):
    lines = text.splitlines(keepends=True)
    if line <= 0:
      return 0
    if line > len(lines):
      return len(text)
    return sum(len(lines[i]) for i in range(line - 1)) + max(0, column - 1)

def identifier_at_offset(text: str, offset: int):
    if offset < 0:
      return None
    reader = io.StringIO(text).readline
    for token in tokenize.generate_tokens(reader):
      if token.type != tokenize.NAME:
        continue
      start_offset = line_col_to_offset(text, token.start[0], token.start[1] + 1)
      end_offset = line_col_to_offset(text, token.end[0], token.end[1] + 1)
      if start_offset <= offset <= end_offset:
        return token.string
    return None

def collect_symbols(tree):
    symbols = {}
    class Visitor(ast.NodeVisitor):
      def visit_FunctionDef(self, node):
        args = [arg.arg for arg in node.args.args]
        symbols.setdefault(node.name, {"line": node.lineno, "column": node.col_offset + 1, "display": f\"def {node.name}({', '.join(args)})\", "documentation": ast.get_docstring(node)})
        self.generic_visit(node)
      def visit_AsyncFunctionDef(self, node):
        args = [arg.arg for arg in node.args.args]
        symbols.setdefault(node.name, {"line": node.lineno, "column": node.col_offset + 1, "display": f\"async def {node.name}({', '.join(args)})\", "documentation": ast.get_docstring(node)})
        self.generic_visit(node)
      def visit_ClassDef(self, node):
        bases = []
        for base in node.bases:
          if isinstance(base, ast.Name):
            bases.append(base.id)
        suffix = f\"({', '.join(bases)})\" if bases else \"\"
        symbols.setdefault(node.name, {"line": node.lineno, "column": node.col_offset + 1, "display": f\"class {node.name}{suffix}\", "documentation": ast.get_docstring(node)})
        self.generic_visit(node)
      def visit_Assign(self, node):
        for target in node.targets:
          if isinstance(target, ast.Name):
            symbols.setdefault(target.id, {"line": target.lineno, "column": target.col_offset + 1, "display": f\"{target.id} = ...\", "documentation": None})
        self.generic_visit(node)
      def visit_AnnAssign(self, node):
        if isinstance(node.target, ast.Name):
          annotation = ast.unparse(node.annotation) if hasattr(ast, "unparse") else "value"
          symbols.setdefault(node.target.id, {"line": node.target.lineno, "column": node.target.col_offset + 1, "display": f\"{node.target.id}: {annotation}\", "documentation": None})
        self.generic_visit(node)
    Visitor().visit(tree)
    return symbols

def diagnostics_for(file_path, text):
    try:
      compile(text, file_path, "exec")
      return []
    except SyntaxError as error:
      return [{
        "filePath": file_path,
        "line": error.lineno or 1,
        "column": error.offset or 1,
        "severity": "error",
        "code": "syntax",
        "message": error.msg,
      }]

def quick_info_for(file_path, text, offset):
    identifier = identifier_at_offset(text, offset)
    if not identifier:
      return None
    try:
      tree = ast.parse(text, file_path)
    except SyntaxError:
      return None
    symbols = collect_symbols(tree)
    symbol = symbols.get(identifier)
    if not symbol:
      return None
    return {
      "display": symbol["display"],
      "documentation": symbol["documentation"],
    }

def definition_for(file_path, text, offset):
    identifier = identifier_at_offset(text, offset)
    if not identifier:
      return None
    try:
      tree = ast.parse(text, file_path)
    except SyntaxError:
      return None
    symbols = collect_symbols(tree)
    symbol = symbols.get(identifier)
    if not symbol:
      return None
    return {
      "filePath": file_path,
      "line": symbol["line"],
      "column": symbol["column"],
    }

def references_for(file_path, text, offset):
    identifier = identifier_at_offset(text, offset)
    if not identifier:
      return []
    reader = io.StringIO(text).readline
    lines = text.splitlines()
    results = []
    for token in tokenize.generate_tokens(reader):
      if token.type == tokenize.NAME and token.string == identifier:
        line_text = lines[token.start[0] - 1] if 0 <= token.start[0] - 1 < len(lines) else ""
        results.append({
          "filePath": file_path,
          "line": token.start[0],
          "column": token.start[1] + 1,
          "text": line_text.strip() or None,
        })
    return results

def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()

respond({"ok": True, "status": "ready"})

for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    try:
        request = json.loads(line)
    except Exception as error:
        respond({"ok": False, "error": f"Invalid JSON request: {error}"})
        continue

    try:
        if request.get("type") == "shutdown":
            respond({"ok": True})
            break

        file_path = str(Path(request["filePath"]).resolve())
        text = request.get("content") or ""
        offset = max(0, int(request.get("offset") or 0))

        if request.get("type") == "diagnostics":
            respond({"ok": True, "diagnostics": diagnostics_for(file_path, text)})
            continue
        if request.get("type") == "quickinfo":
            respond({"ok": True, "quickInfo": quick_info_for(file_path, text, offset)})
            continue
        if request.get("type") == "definition":
            respond({"ok": True, "definition": definition_for(file_path, text, offset)})
            continue
        if request.get("type") == "references":
            respond({"ok": True, "references": references_for(file_path, text, offset)})
            continue

        respond({"ok": False, "error": f"Unknown Python service request: {request.get('type')}"})
    except Exception as error:
        respond({"ok": False, "error": str(error)})
"#
}

fn rust_language_service_script() -> &'static str {
    r#"const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const requestPath = process.argv[2];
if (!requestPath) {
  throw new Error("Missing Rust language request path");
}

const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
const filePath = path.resolve(request.filePath);
const sourceText = request.content || "";
const offset = Math.max(0, Number(request.offset) || 0);
const rustcPath = typeof request.rustcPath === "string" && request.rustcPath.trim() ? request.rustcPath.trim() : null;

function identifierAtOffset(text, value) {
  const isWord = (char) => /[A-Za-z0-9_]/.test(char || "");
  if (value < 0 || value > text.length) return null;
  let start = value;
  let end = value;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  while (end < text.length && isWord(text[end])) end += 1;
  if (start === end) return null;
  return text.slice(start, end);
}

function collectSymbols(text) {
  const lines = text.split(/\r?\n/);
  const symbols = new Map();
  const patterns = [
    /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /^\s*(?:pub\s+)?(?:struct|enum|trait|type|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)/,
    /^\s*let\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)/,
  ];
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1];
      const column = line.indexOf(name) + 1;
      if (!symbols.has(name)) {
        symbols.set(name, {
          filePath,
          line: index + 1,
          column,
          display: line.trim(),
          documentation: null,
        });
      }
      break;
    }
  });
  return symbols;
}

function referencesFor(text, identifier) {
  if (!identifier) return [];
  const lines = text.split(/\r?\n/);
  const pattern = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const results = [];
  lines.forEach((line, index) => {
    let match;
    while ((match = pattern.exec(line)) !== null) {
      results.push({
        filePath,
        line: index + 1,
        column: match.index + 1,
        text: line.trim() || null,
      });
    }
  });
  return results;
}

function diagnosticsFor() {
  if (!rustcPath) {
    return [];
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-rust-"));
  const tempFile = path.join(tempDir, path.basename(filePath) || "analysis.rs");
  fs.writeFileSync(tempFile, sourceText, "utf8");
  const result = spawnSync(rustcPath, [
    "--crate-type", "lib",
    "--emit", "metadata",
    "--edition", "2021",
    "--error-format", "json",
    tempFile,
  ], { encoding: "utf8" });
  const lines = `${result.stdout || ""}\n${result.stderr || ""}`.split(/\r?\n/);
  const diagnostics = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.message_type !== "diagnostic") continue;
      const span = Array.isArray(parsed.spans) ? parsed.spans.find((entry) => typeof entry.file_name === "string") : null;
      diagnostics.push({
        filePath,
        line: span?.line_start || 1,
        column: span?.column_start || 1,
        severity: parsed.level === "error" ? "error" : parsed.level === "warning" ? "warning" : "info",
        code: parsed.code?.code || null,
        message: parsed.message || "Rust diagnostic",
      });
    } catch (_) {}
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  return diagnostics;
}

const identifier = identifierAtOffset(sourceText, offset);
const symbols = collectSymbols(sourceText);

if (request.mode === "diagnostics") {
  process.stdout.write(JSON.stringify({ ok: true, diagnostics: diagnosticsFor() }) + "\n");
  process.exit(0);
}

if (request.mode === "quickinfo") {
  const symbol = identifier ? symbols.get(identifier) : null;
  process.stdout.write(JSON.stringify({
    ok: true,
    quickInfo: symbol ? { display: symbol.display, documentation: symbol.documentation } : null,
  }) + "\n");
  process.exit(0);
}

if (request.mode === "definition") {
  const symbol = identifier ? symbols.get(identifier) : null;
  process.stdout.write(JSON.stringify({
    ok: true,
    definition: symbol ? { filePath: symbol.filePath, line: symbol.line, column: symbol.column } : null,
  }) + "\n");
  process.exit(0);
}

if (request.mode === "references") {
  process.stdout.write(JSON.stringify({
    ok: true,
    references: referencesFor(sourceText, identifier),
  }) + "\n");
  process.exit(0);
}

throw new Error(`Unsupported Rust feature mode: ${request.mode}`);
"#
}

fn write_rust_language_feature_artifacts(
    request: &RustLanguageFeatureRequest,
    mode: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let temp_root = env::temp_dir().join("lattice-rust-analysis");
    fs::create_dir_all(&temp_root).map_err(|error| error.to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let script_path = temp_root.join(format!("rust-{session_id}.cjs"));
    let request_path = temp_root.join(format!("rust-{session_id}.json"));
    fs::write(&script_path, rust_language_service_script()).map_err(|error| error.to_string())?;
    let payload = json!({
        "mode": mode,
        "workspaceRootPath": request.workspace_root_path,
        "filePath": request.file_path,
        "content": request.content,
        "offset": request.offset,
        "rustcPath": resolve_command_path("rustc"),
    });
    let payload_text = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    fs::write(&request_path, payload_text).map_err(|error| error.to_string())?;
    Ok((script_path, request_path))
}

fn persistent_typescript_service_script() -> &'static str {
    r#"const fs = require("fs");
const path = require("path");
const readline = require("readline");

const configPath = process.argv[2];
if (!configPath) {
  throw new Error("Missing TypeScript service config path");
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const ts = require(config.typescriptEntry);
const workspaceRootPath = config.workspaceRootPath ? path.resolve(config.workspaceRootPath) : process.cwd();
const compilerOptions = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.Preserve,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
};

const documents = new Map();
const versions = new Map();

function normalizePath(filePath) {
  const resolved = path.resolve(filePath);
  return ts.sys.useCaseSensitiveFileNames ? resolved : resolved.toLowerCase();
}

function ensureDocument(filePath, content) {
  const resolved = path.resolve(filePath);
  const key = normalizePath(resolved);
  const previous = documents.get(key);
  if (previous !== content) {
    documents.set(key, content);
    versions.set(key, String((Number(versions.get(key) || "0") || 0) + 1));
  }
  if (!versions.has(key)) {
    versions.set(key, "1");
  }
  return resolved;
}

const serviceHost = {
  getCompilationSettings: () => compilerOptions,
  getScriptFileNames: () => Array.from(documents.keys()).map((filePath) => filePath),
  getScriptVersion: (filePath) => versions.get(normalizePath(filePath)) || "1",
  getCurrentDirectory: () => workspaceRootPath,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  readFile: (filePath, encoding) => {
    const key = normalizePath(filePath);
    if (documents.has(key)) {
      return documents.get(key);
    }
    return ts.sys.readFile(filePath, encoding);
  },
  fileExists: (filePath) => {
    const key = normalizePath(filePath);
    if (documents.has(key)) {
      return true;
    }
    return ts.sys.fileExists(filePath);
  },
  directoryExists: (dir) => ts.sys.directoryExists ? ts.sys.directoryExists(dir) : true,
  getDirectories: (dir) => ts.sys.getDirectories ? ts.sys.getDirectories(dir) : [],
  readDirectory: (dir, extensions, exclude, include, depth) => ts.sys.readDirectory(dir, extensions, exclude, include, depth),
  getScriptSnapshot: (filePath) => {
    const key = normalizePath(filePath);
    const text = documents.has(key) ? documents.get(key) : ts.sys.readFile(filePath);
    if (text === undefined) {
      return undefined;
    }
    return ts.ScriptSnapshot.fromString(text);
  },
};

const languageService = ts.createLanguageService(serviceHost, ts.createDocumentRegistry());

function sourceFileFor(filePath) {
  const program = languageService.getProgram();
  return program && program.getSourceFile(filePath);
}

function positionFor(filePath, offset) {
  const sourceFile = sourceFileFor(filePath);
  if (!sourceFile) {
    return { line: 1, column: 1 };
  }
  const pos = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: pos.line + 1, column: pos.character + 1 };
}

function diagnosticsFor(filePath) {
  const syntactic = languageService.getSyntacticDiagnostics(filePath);
  const semantic = languageService.getSemanticDiagnostics(filePath);
  return [...syntactic, ...semantic].map((diagnostic) => {
    const sourceFile = diagnostic.file || sourceFileFor(filePath);
    const start = diagnostic.start || 0;
    const location = sourceFile
      ? sourceFile.getLineAndCharacterOfPosition(start)
      : { line: 0, character: 0 };
    const category = diagnostic.category === ts.DiagnosticCategory.Error
      ? "error"
      : diagnostic.category === ts.DiagnosticCategory.Warning
        ? "warning"
        : "info";
    return {
      filePath,
      line: location.line + 1,
      column: location.character + 1,
      severity: category,
      code: diagnostic.code ? String(diagnostic.code) : null,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    };
  });
}

function quickInfoFor(filePath, offset) {
  const info = languageService.getQuickInfoAtPosition(filePath, offset);
  if (!info) {
    return null;
  }
  return {
    display: ts.displayPartsToString(info.displayParts || []),
    documentation: ts.displayPartsToString(info.documentation || []) || null,
  };
}

function definitionFor(filePath, offset) {
  const definitions = languageService.getDefinitionAtPosition(filePath, offset) || [];
  const definition = definitions[0];
  if (!definition) {
    return null;
  }
  const targetPath = path.resolve(definition.fileName);
  const location = positionFor(targetPath, definition.textSpan.start);
  return {
    filePath: targetPath,
    line: location.line,
    column: location.column,
  };
}

function referencesFor(filePath, offset) {
  const references = languageService.getReferencesAtPosition(filePath, offset) || [];
  return references.map((reference) => {
    const targetPath = path.resolve(reference.fileName);
    const location = positionFor(targetPath, reference.textSpan.start);
    const sourceFile = sourceFileFor(targetPath);
    const lineText = sourceFile
      ? sourceFile.getFullText().split(/\r?\n/)[location.line - 1] || ""
      : "";
    return {
      filePath: targetPath,
      line: location.line,
      column: location.column,
      text: lineText.trim() || null,
    };
  });
}

function respond(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

respond({ ok: true, status: "ready" });

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    respond({ ok: false, error: `Invalid JSON request: ${error.message}` });
    return;
  }

  try {
    if (request.type === "shutdown") {
      respond({ ok: true });
      process.exit(0);
      return;
    }

    const filePath = ensureDocument(request.filePath, request.content || "");
    const offset = Math.max(0, Number(request.offset) || 0);

    if (request.type === "diagnostics") {
      respond({ ok: true, diagnostics: diagnosticsFor(filePath) });
      return;
    }
    if (request.type === "quickinfo") {
      respond({ ok: true, quickInfo: quickInfoFor(filePath, offset) });
      return;
    }
    if (request.type === "definition") {
      respond({ ok: true, definition: definitionFor(filePath, offset) });
      return;
    }
    if (request.type === "references") {
      respond({ ok: true, references: referencesFor(filePath, offset) });
      return;
    }

    respond({ ok: false, error: `Unknown TypeScript service request: ${request.type}` });
  } catch (error) {
    respond({ ok: false, error: error && error.message ? error.message : String(error) });
  }
});
"#
}

fn write_persistent_typescript_service_artifacts(
    app: &AppHandle,
    workspace_root_path: Option<&str>,
) -> Result<(PathBuf, PathBuf), String> {
    let temp_root = env::temp_dir().join("lattice-typescript-service");
    fs::create_dir_all(&temp_root).map_err(|error| error.to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let script_path = temp_root.join(format!("service-{session_id}.cjs"));
    let config_path = temp_root.join(format!("service-{session_id}.json"));
    fs::write(&script_path, persistent_typescript_service_script())
        .map_err(|error| error.to_string())?;
    let payload = json!({
        "workspaceRootPath": workspace_root_path,
        "typescriptEntry": resolve_typescript_runtime_entry(app)?,
    });
    let payload_text = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    fs::write(&config_path, payload_text).map_err(|error| error.to_string())?;
    Ok((script_path, config_path))
}

async fn stop_managed_typescript_service(service: ManagedTypeScriptService) {
    {
        let mut stdin = service.stdin.lock().await;
        let _ = stdin.write_all(br#"{"type":"shutdown"}"#).await;
        let _ = stdin.write_all(b"\n").await;
        let _ = stdin.flush().await;
    }

    {
        let mut child = service.child.lock().await;
        let _ = tokio::time::timeout(Duration::from_millis(1500), child.wait()).await;
        let _ = child.kill().await;
    }

    let _ = fs::remove_file(&service.script_path);
    let _ = fs::remove_file(&service.config_path);
}

async fn stop_managed_python_analysis_service(service: ManagedPythonAnalysisService) {
    {
        let mut stdin = service.stdin.lock().await;
        let _ = stdin.write_all(br#"{"type":"shutdown"}"#).await;
        let _ = stdin.write_all(b"\n").await;
        let _ = stdin.flush().await;
    }

    {
        let mut child = service.child.lock().await;
        let _ = tokio::time::timeout(Duration::from_millis(1500), child.wait()).await;
        let _ = child.kill().await;
    }

    let _ = fs::remove_file(&service.script_path);
}

async fn request_typescript_service(
    service: &ManagedTypeScriptService,
    request: Value,
) -> Result<Value, String> {
    let _guard = service.request_lock.lock().await;
    let request_text = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    {
        let mut stdin = service.stdin.lock().await;
        stdin
            .write_all(request_text.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| error.to_string())?;
        stdin.flush().await.map_err(|error| error.to_string())?;
    }

    let mut stdout = service.stdout.lock().await;
    let next_line = tokio::time::timeout(
        Duration::from_millis(VSCODE_EXTENSION_HOST_COMMAND_TIMEOUT_MS),
        stdout.next_line(),
    )
    .await
    .map_err(|_| "TypeScript service request timed out".to_string())?
    .map_err(|error| error.to_string())?;

    let Some(line) = next_line else {
        return Err("TypeScript service closed unexpectedly".to_string());
    };
    serde_json::from_str::<Value>(&line).map_err(|error| error.to_string())
}

async fn request_python_analysis_service(
    service: &ManagedPythonAnalysisService,
    request: Value,
) -> Result<Value, String> {
    let _guard = service.request_lock.lock().await;
    let request_text = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    {
        let mut stdin = service.stdin.lock().await;
        stdin
            .write_all(request_text.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| error.to_string())?;
        stdin.flush().await.map_err(|error| error.to_string())?;
    }

    let mut stdout = service.stdout.lock().await;
    let next_line = tokio::time::timeout(
        Duration::from_millis(VSCODE_EXTENSION_HOST_COMMAND_TIMEOUT_MS),
        stdout.next_line(),
    )
    .await
    .map_err(|_| "Python analysis service request timed out".to_string())?
    .map_err(|error| error.to_string())?;

    let Some(line) = next_line else {
        return Err("Python analysis service closed unexpectedly".to_string());
    };
    serde_json::from_str::<Value>(&line).map_err(|error| error.to_string())
}

async fn ensure_typescript_service(
    app: &AppHandle,
    state: &TypeScriptServiceState,
    workspace_root_path: Option<&str>,
) -> Result<ManagedTypeScriptService, String> {
    let needs_restart = {
        let guard = state.process.lock().await;
        match guard.as_ref() {
            Some(service) => service.workspace_root_path.as_deref() != workspace_root_path,
            None => true,
        }
    };

    if needs_restart {
        let previous = {
            let mut guard = state.process.lock().await;
            guard.take()
        };
        if let Some(service) = previous {
            stop_managed_typescript_service(service).await;
        }

        let Some((runtime_path, runtime_mode)) = resolve_vscode_extension_host_runtime() else {
            return Err(
                "No Node-compatible runtime was found for the TypeScript service.".to_string(),
            );
        };

        let (script_path, config_path) =
            write_persistent_typescript_service_artifacts(app, workspace_root_path)?;
        let mut command = Command::new(&runtime_path);
        configure_tokio_command(&mut command);
        command
            .arg(&script_path)
            .arg(&config_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if matches!(runtime_mode, VSCodeExtensionHostRuntime::CodeElectronNode) {
            command.env("ELECTRON_RUN_AS_NODE", "1");
        }
        if let Some(root) = workspace_root_path
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
        {
            command.current_dir(root);
        }

        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let Some(stdin) = child.stdin.take() else {
            return Err("TypeScript service stdin unavailable".to_string());
        };
        let Some(stdout) = child.stdout.take() else {
            return Err("TypeScript service stdout unavailable".to_string());
        };
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("[typescript-service] {line}");
                }
            });
        }

        let mut bootstrap_lines = BufReader::new(stdout).lines();
        let bootstrap_line = tokio::time::timeout(
            Duration::from_millis(VSCODE_EXTENSION_HOST_COMMAND_TIMEOUT_MS),
            bootstrap_lines.next_line(),
        )
        .await
        .map_err(|_| "Timed out while starting the TypeScript service".to_string())?
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "TypeScript service exited before bootstrap".to_string())?;
        let bootstrap_payload: Value =
            serde_json::from_str(&bootstrap_line).map_err(|error| error.to_string())?;
        if bootstrap_payload.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(bootstrap_payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("TypeScript service failed to start")
                .to_string());
        }

        let service = ManagedTypeScriptService {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            stdout: Arc::new(Mutex::new(bootstrap_lines)),
            request_lock: Arc::new(Mutex::new(())),
            script_path,
            config_path,
            workspace_root_path: workspace_root_path.map(str::to_string),
        };

        let mut guard = state.process.lock().await;
        *guard = Some(service.clone());
    }

    let guard = state.process.lock().await;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "TypeScript service is unavailable".to_string())
}

async fn ensure_python_analysis_service(
    state: &PythonAnalysisServiceState,
    request: &PythonDiagnosticsRequest,
) -> Result<ManagedPythonAnalysisService, String> {
    let python_path =
        resolve_python_analysis_runtime(Some(&request.file_path), request.python_path.as_deref())?;

    let needs_restart = {
        let guard = state.process.lock().await;
        match guard.as_ref() {
            Some(service) => service.python_path != python_path,
            None => true,
        }
    };

    if needs_restart {
        let previous = {
            let mut guard = state.process.lock().await;
            guard.take()
        };
        if let Some(service) = previous {
            stop_managed_python_analysis_service(service).await;
        }

        let temp_root = env::temp_dir().join("lattice-python-analysis");
        fs::create_dir_all(&temp_root).map_err(|error| error.to_string())?;
        let session_id = Uuid::new_v4().to_string();
        let script_path = temp_root.join(format!("python-analysis-{session_id}.py"));
        fs::write(&script_path, persistent_python_analysis_service_script())
            .map_err(|error| error.to_string())?;

        let mut command = Command::new(&python_path);
        configure_python_tokio_command(&mut command);
        command
            .arg("-u")
            .arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(root) = request
            .workspace_root_path
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
        {
            command.current_dir(root);
        }

        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let Some(stdin) = child.stdin.take() else {
            return Err("Python analysis service stdin unavailable".to_string());
        };
        let Some(stdout) = child.stdout.take() else {
            return Err("Python analysis service stdout unavailable".to_string());
        };
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    eprintln!("[python-analysis-service] {line}");
                }
            });
        }

        let mut bootstrap_lines = BufReader::new(stdout).lines();
        let bootstrap_line = tokio::time::timeout(
            Duration::from_millis(VSCODE_EXTENSION_HOST_COMMAND_TIMEOUT_MS),
            bootstrap_lines.next_line(),
        )
        .await
        .map_err(|_| "Timed out while starting the Python analysis service".to_string())?
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Python analysis service exited before bootstrap".to_string())?;
        let bootstrap_payload: Value =
            serde_json::from_str(&bootstrap_line).map_err(|error| error.to_string())?;
        if bootstrap_payload.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(bootstrap_payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Python analysis service failed to start")
                .to_string());
        }

        let service = ManagedPythonAnalysisService {
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            stdout: Arc::new(Mutex::new(bootstrap_lines)),
            request_lock: Arc::new(Mutex::new(())),
            python_path: python_path.clone(),
            script_path,
        };

        let mut guard = state.process.lock().await;
        *guard = Some(service.clone());
    }

    let guard = state.process.lock().await;
    guard
        .as_ref()
        .cloned()
        .ok_or_else(|| "Python analysis service is unavailable".to_string())
}

fn vscode_extension_host_script() -> &'static str {
    r#"const fs = require("fs");
const path = require("path");
const Module = require("module");
const readline = require("readline");
const childProcess = require("child_process");
const { fileURLToPath } = require("url");

const configPath = process.argv[2];
if (!configPath) {
  throw new Error("Missing VS Code extension host config path");
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const parentPid = Number(config.parentPid) || 0;
const extensions = Array.isArray(config.extensions) ? config.extensions : [];
const configuration = config.configuration && typeof config.configuration === "object" ? config.configuration : {};
const fsp = fs.promises;
const commandRegistry = new Map();
const pendingInteractionRegistry = new Map();
const viewRegistry = new Map();
const webviewSessionRegistry = new Map();
const webviewPanelSerializerRegistry = new Map();
const uriHandlerRegistry = new Map();
const fileSystemProviderRegistry = new Map();
const textDocumentContentProviderRegistry = new Map();
const customEditorProviderRegistry = new Map();
const terminalRegistry = new Map();
const extensionState = new Map();
const openDocuments = new Map();
const openNotebookDocuments = new Map();
const notebookControllerRegistry = new Map();
const notebookRendererMessagingRegistry = new Map();
const diagnosticCollections = new Set();
const contextKeyRegistry = new Map();
let activeTextEditor = null;
let activeNotebookEditor = null;
let activeTerminal = null;
let currentActivationExtensionId = null;
let lastError = null;
let webviewPanelCounter = 0;
let terminalCounter = 0;
let interactionCounter = 0;
const protocolStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => process.stderr.write(...args);

if (parentPid > 0) {
  const parentMonitor = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch (_) {
      process.exit(0);
    }
  }, 2000);
  parentMonitor.unref();
}

function isNotebookLanguage(languageId) {
  return languageId === "jupyter-notebook" || languageId === "notebook" || languageId === "ipynb";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPriorityCodingAgentExtension(extension) {
  return /(claude|codex|chatgpt|cline|roo|augment)/i.test(`${extension.id || ""} ${extension.displayName || ""}`);
}

function isEagerActivationCandidate(extension) {
  if (!isPriorityCodingAgentExtension(extension)) {
    return false;
  }
  const activationEvents = asArray(extension.activationEvents);
  if (activationEvents.includes("*") || activationEvents.includes("onStartupFinished")) {
    return true;
  }
  return asArray(extension.commandItems).length > 0 || asArray(extension.viewItems).length > 0;
}

function getHostErrorMessage(error) {
  if (error && error.stack) {
    return String(error.stack).split("\n")[0] || String(error.message || error);
  }
  return error && error.message ? String(error.message) : String(error);
}

function extensionIdFromPackageJson(packageJson) {
  const publisher = typeof packageJson?.publisher === "string" ? packageJson.publisher.trim() : "";
  const name = typeof packageJson?.name === "string" ? packageJson.name.trim() : "";
  return publisher && name ? `${publisher}.${name}`.toLowerCase() : "";
}

function findCurrentExtensionPath(extension) {
  const expectedId = String(extension?.id || "").trim().toLowerCase();
  const configuredPath = typeof extension?.path === "string" ? extension.path : "";
  if (!expectedId || !configuredPath) {
    return null;
  }
  const extensionsRoot = path.dirname(configuredPath);
  let entries;
  try {
    entries = fs.readdirSync(extensionsRoot, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const candidatePath = path.join(extensionsRoot, entry.name);
    const packagePath = path.join(candidatePath, "package.json");
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      if (extensionIdFromPackageJson(packageJson) !== expectedId) {
        continue;
      }
      candidates.push({
        path: candidatePath,
        packageJson,
        version: typeof packageJson.version === "string" ? packageJson.version : "0",
      });
    } catch (_) {}
  }
  candidates.sort((left, right) =>
    String(right.version).localeCompare(String(left.version), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
  return candidates[0] || null;
}

function refreshExtensionMetadata(extension) {
  const current = findCurrentExtensionPath(extension);
  if (!current) {
    return extension;
  }
  const packageJson = current.packageJson;
  return {
    ...extension,
    path: current.path,
    main: typeof packageJson.main === "string" ? packageJson.main : extension.main,
    browser: typeof packageJson.browser === "string" ? packageJson.browser : extension.browser,
    displayName: typeof packageJson.displayName === "string" ? packageJson.displayName : extension.displayName,
    packageJSON: packageJson,
    activationEvents: Array.isArray(packageJson.activationEvents)
      ? packageJson.activationEvents
      : extension.activationEvents,
  };
}

function detectMissingApi(errorMessage) {
  const match = String(errorMessage || "").match(/VS Code API shim missing:\s*([A-Za-z0-9_.]+)/i);
  return match ? [match[1]] : [];
}

function cloneCommand(command) {
  return {
    id: command.id,
    title: command.title,
    extensionId: command.extensionId,
    category: command.category || null,
    source: "host",
  };
}

function cloneView(view) {
  return {
    id: view.id,
    title: view.title,
    extensionId: view.extensionId,
    container: view.container || null,
    kind: view.kind,
    source: "host",
  };
}

function buildSnapshot(status = "ready", overrideError = null) {
  const commands = Array.from(commandRegistry.values()).map(cloneCommand);
  commands.sort((left, right) => left.title.localeCompare(right.title));
  const views = Array.from(viewRegistry.values()).map(cloneView);
  views.sort((left, right) => left.title.localeCompare(right.title));
  const extensionSnapshots = extensions.map((extension) => {
    const state = extensionState.get(extension.id);
    const error = state && state.error ? String(state.error) : undefined;
    return {
      id: extension.id,
      displayName: extension.displayName || extension.id,
      status: state && state.active ? "active" : (error ? "failed" : "pending"),
      commandCount: commands.filter((command) => command.extensionId === extension.id).length,
      viewCount: views.filter((view) => view.extensionId === extension.id).length,
      ...(error ? { error } : {}),
      missingApi: state && Array.isArray(state.missingApi) ? state.missingApi : [],
    };
  });
  const activeExtensionCount = Array.from(extensionState.values()).filter((entry) => entry.active).length;
  return {
    status,
    runtime: config.runtime || "node",
    commandCount: commands.length,
    activeExtensionCount,
    commands,
    views,
    extensions: extensionSnapshots,
    contextKeys: Object.fromEntries(contextKeyRegistry.entries()),
    lastError: overrideError || lastError,
  };
}

function send(message) {
  protocolStdoutWrite(JSON.stringify(message) + "\n");
}

function requestInteraction(interaction) {
  const id = `interaction-${++interactionCounter}`;
  return new Promise((resolve) => {
    pendingInteractionRegistry.set(id, { resolve });
    send({
      ok: true,
      interaction: { id, ...interaction },
      snapshot: buildSnapshot(),
    });
  });
}

function rememberHostError(error) {
  lastError = error && error.stack
    ? error.stack
    : (error && error.message ? error.message : String(error));
}

process.on("unhandledRejection", (error) => {
  rememberHostError(error);
});

process.on("uncaughtException", (error) => {
  rememberHostError(error);
});

function createUri(parts) {
  const scheme = parts.scheme || "file";
  const fsPath = parts.fsPath ?? parts.path ?? "";
  const uri = {
    fsPath,
    path: parts.path ?? fsPath,
    scheme,
    authority: parts.authority || "",
    query: parts.query || "",
    fragment: parts.fragment || "",
    toString() {
      const authority = this.authority ? `//${this.authority}` : "";
      const query = this.query ? `?${this.query}` : "";
      const fragment = this.fragment ? `#${this.fragment}` : "";
      if (this.scheme === "file") {
        return `file://${this.fsPath}${query}${fragment}`;
      }
      return `${this.scheme}:${authority}${this.path}${query}${fragment}`;
    },
    with(change = {}) {
      return createUri({
        scheme: change.scheme ?? this.scheme,
        authority: change.authority ?? this.authority,
        path: change.path ?? this.path,
        query: change.query ?? this.query,
        fragment: change.fragment ?? this.fragment,
        fsPath: change.fsPath ?? (change.path && this.scheme === "file" ? change.path : this.fsPath),
      });
    },
  };
  return uri;
}

function toUri(fsPath) {
  return createUri({
    fsPath,
    path: fsPath,
    scheme: "file",
  });
}

function isKnownViewFocusCommand(commandId) {
  if (!String(commandId || "").endsWith(".focus")) {
    return false;
  }
  const viewId = String(commandId).slice(0, -".focus".length);
  if (viewRegistry.has(viewId)) {
    return true;
  }
  return extensions.some((extension) => {
    return Array.isArray(extension.viewItems) && extension.viewItems.some((view) => view && view.id === viewId);
  });
}

function createMemento() {
  const values = new Map();
  return {
    keys() {
      return Array.from(values.keys());
    },
    get(key, defaultValue) {
      return values.has(key) ? values.get(key) : defaultValue;
    },
    async update(key, value) {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    },
    setKeysForSync() {},
  };
}

function createSecretStorage(extensionId) {
  const values = new Map();
  return {
    async get(key) {
      return values.get(String(key));
    },
    async store(key, value) {
      values.set(String(key), String(value));
      secretChangeEmitter.fire({ extensionId, key: String(key) });
    },
    async delete(key) {
      values.delete(String(key));
      secretChangeEmitter.fire({ extensionId, key: String(key) });
    },
    onDidChange(listener) {
      return secretChangeEmitter.event((event) => {
        if (!event || event.extensionId === extensionId) {
          listener(event);
        }
      });
    },
  };
}

class Disposable {
  constructor(callOnDispose) {
    this.callOnDispose = typeof callOnDispose === "function" ? callOnDispose : null;
  }
  dispose() {
    if (!this.callOnDispose) {
      return;
    }
    const callback = this.callOnDispose;
    this.callOnDispose = null;
    callback();
  }
  static from(...disposables) {
    return new Disposable(() => {
      for (const disposable of disposables) {
        try {
          disposable && typeof disposable.dispose === "function" && disposable.dispose();
        } catch (_) {}
      }
    });
  }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => {
      this.listeners.add(listener);
      return new Disposable(() => {
        this.listeners.delete(listener);
      });
    };
  }
  fire(value) {
    for (const listener of Array.from(this.listeners)) {
      try {
        const result = listener(value);
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            console.error("extension event listener failed", error);
          });
        }
      } catch (error) {
        console.error("extension event listener failed", error);
      }
    }
  }
  dispose() {
    this.listeners.clear();
  }
}

function normalizeQuickPickItem(item, index) {
  if (typeof item === "string") {
    return { id: `item-${index}`, label: item };
  }
  return {
    id: `item-${index}`,
    label: String(item?.label || ""),
    ...(item?.description ? { description: String(item.description) } : {}),
    ...(item?.detail ? { detail: String(item.detail) } : {}),
    ...(item?.picked ? { picked: true } : {}),
  };
}

async function showQuickPick(itemsOrPromise, options = {}) {
  const items = asArray(await Promise.resolve(itemsOrPromise));
  const serializedItems = items.map(normalizeQuickPickItem);
  const response = await requestInteraction({
    type: "quickPick",
    ...(options.title ? { title: String(options.title) } : {}),
    ...(options.placeHolder ? { placeHolder: String(options.placeHolder) } : {}),
    canPickMany: Boolean(options.canPickMany),
    ignoreFocusOut: Boolean(options.ignoreFocusOut),
    items: serializedItems,
  });
  if (response.cancelled) {
    return undefined;
  }
  const selectedIds = new Set(asArray(response.selectedIds).map(String));
  const selectedItems = items.filter((_, index) => selectedIds.has(`item-${index}`));
  return options.canPickMany ? selectedItems : selectedItems[0];
}

async function showInputBox(options = {}) {
  const response = await requestInteraction({
    type: "inputBox",
    ...(options.title ? { title: String(options.title) } : {}),
    ...(options.prompt ? { prompt: String(options.prompt) } : {}),
    ...(options.placeHolder ? { placeHolder: String(options.placeHolder) } : {}),
    ...(options.value !== undefined ? { value: String(options.value) } : {}),
    ignoreFocusOut: Boolean(options.ignoreFocusOut),
    password: Boolean(options.password),
  });
  return response.cancelled ? undefined : String(response.value ?? "");
}

function createQuickPick() {
  const acceptEmitter = new EventEmitter();
  const hideEmitter = new EventEmitter();
  const selectionEmitter = new EventEmitter();
  const activeEmitter = new EventEmitter();
  const valueEmitter = new EventEmitter();
  let visible = false;
  const quickPick = {
    items: [],
    activeItems: [],
    selectedItems: [],
    value: "",
    placeholder: "",
    title: undefined,
    canSelectMany: false,
    ignoreFocusOut: false,
    busy: false,
    enabled: true,
    buttons: [],
    validationMessage: undefined,
    onDidAccept: acceptEmitter.event,
    onDidHide: hideEmitter.event,
    onDidChangeSelection: selectionEmitter.event,
    onDidChangeActive: activeEmitter.event,
    onDidChangeValue: valueEmitter.event,
    onDidTriggerButton: () => new Disposable(() => {}),
    onDidTriggerItemButton: () => new Disposable(() => {}),
    show() {
      if (visible) {
        return;
      }
      visible = true;
      void showQuickPick(quickPick.items, {
        title: quickPick.title,
        placeHolder: quickPick.placeholder,
        canPickMany: quickPick.canSelectMany,
        ignoreFocusOut: quickPick.ignoreFocusOut,
      }).then((selection) => {
        if (!visible) {
          return;
        }
        if (selection === undefined) {
          visible = false;
          hideEmitter.fire(undefined);
          return;
        }
        quickPick.selectedItems = quickPick.canSelectMany ? selection : [selection];
        quickPick.activeItems = quickPick.selectedItems.slice(0, 1);
        selectionEmitter.fire(quickPick.selectedItems);
        activeEmitter.fire(quickPick.activeItems);
        acceptEmitter.fire(undefined);
      }).catch(rememberHostError);
    },
    hide() {
      if (!visible) {
        return;
      }
      visible = false;
      hideEmitter.fire(undefined);
    },
    dispose() {
      visible = false;
      acceptEmitter.dispose();
      hideEmitter.dispose();
      selectionEmitter.dispose();
      activeEmitter.dispose();
      valueEmitter.dispose();
    },
  };
  return quickPick;
}

function createInputBox() {
  const acceptEmitter = new EventEmitter();
  const hideEmitter = new EventEmitter();
  const valueEmitter = new EventEmitter();
  let visible = false;
  const inputBox = {
    value: "",
    valueSelection: undefined,
    placeholder: "",
    prompt: "",
    title: undefined,
    password: false,
    ignoreFocusOut: false,
    busy: false,
    enabled: true,
    buttons: [],
    validationMessage: undefined,
    onDidAccept: acceptEmitter.event,
    onDidHide: hideEmitter.event,
    onDidChangeValue: valueEmitter.event,
    onDidTriggerButton: () => new Disposable(() => {}),
    show() {
      if (visible) {
        return;
      }
      visible = true;
      void showInputBox({
        title: inputBox.title,
        prompt: inputBox.prompt,
        placeHolder: inputBox.placeholder,
        value: inputBox.value,
        password: inputBox.password,
        ignoreFocusOut: inputBox.ignoreFocusOut,
      }).then((value) => {
        if (!visible) {
          return;
        }
        if (value === undefined) {
          visible = false;
          hideEmitter.fire(undefined);
          return;
        }
        inputBox.value = value;
        valueEmitter.fire(value);
        acceptEmitter.fire(undefined);
      }).catch(rememberHostError);
    },
    hide() {
      if (!visible) {
        return;
      }
      visible = false;
      hideEmitter.fire(undefined);
    },
    dispose() {
      visible = false;
      acceptEmitter.dispose();
      hideEmitter.dispose();
      valueEmitter.dispose();
    },
  };
  return inputBox;
}

class CancellationTokenSource {
  constructor() {
    this._emitter = new EventEmitter();
    this._isCancellationRequested = false;
    this.token = {
      get isCancellationRequested() {
        return this._source._isCancellationRequested;
      },
      onCancellationRequested: (listener) => this._emitter.event(listener),
      _source: this,
    };
  }
  cancel() {
    if (this._isCancellationRequested) {
      return;
    }
    this._isCancellationRequested = true;
    this._emitter.fire(undefined);
  }
  dispose() {
    this._emitter.dispose();
  }
}

class CancellationError extends Error {
  constructor() {
    super("Canceled");
    this.name = "Canceled";
  }
}

const configurationEmitter = new EventEmitter();
const openTextDocumentEmitter = new EventEmitter();
const changeTextDocumentEmitter = new EventEmitter();
const saveTextDocumentEmitter = new EventEmitter();
const closeTextDocumentEmitter = new EventEmitter();
const openNotebookDocumentEmitter = new EventEmitter();
const changeNotebookDocumentEmitter = new EventEmitter();
const saveNotebookDocumentEmitter = new EventEmitter();
const closeNotebookDocumentEmitter = new EventEmitter();
const diagnosticsChangeEmitter = new EventEmitter();
const debugSessionEmitter = new EventEmitter();
const taskEmitter = new EventEmitter();
const terminalOpenEmitter = new EventEmitter();
const terminalCloseEmitter = new EventEmitter();
const activeTerminalEmitter = new EventEmitter();
const secretChangeEmitter = new EventEmitter();
const extensionChangeEmitter = new EventEmitter();
const activeTextEditorEmitter = new EventEmitter();
const visibleTextEditorsEmitter = new EventEmitter();
const textEditorSelectionEmitter = new EventEmitter();
const activeNotebookEditorEmitter = new EventEmitter();
const visibleNotebookEditorsEmitter = new EventEmitter();
const workspaceFoldersEmitter = new EventEmitter();
const workspaceTrustEmitter = new EventEmitter();
const createFilesEmitter = new EventEmitter();
const deleteFilesEmitter = new EventEmitter();
const renameFilesEmitter = new EventEmitter();
const tabGroupsChangeEmitter = new EventEmitter();
const tabsChangeEmitter = new EventEmitter();
const terminalShellIntegrationEmitter = new EventEmitter();
const terminalShellExecutionStartEmitter = new EventEmitter();
const terminalShellExecutionEndEmitter = new EventEmitter();
const windowStateEmitter = new EventEmitter();
const telemetryEmitter = new EventEmitter();

const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

const DiagnosticTag = {
  Unnecessary: 1,
  Deprecated: 2,
};

class Position {
  constructor(line, character) {
    this.line = Math.max(0, Number(line) || 0);
    this.character = Math.max(0, Number(character) || 0);
  }
  isBefore(other) {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }
  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
  translate(lineDelta = 0, characterDelta = 0) {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
  with(line = this.line, character = this.character) {
    return new Position(line, character);
  }
}

class Range {
  constructor(startLineOrPosition, startCharacterOrPosition, endLine, endCharacter) {
    if (startLineOrPosition instanceof Position && startCharacterOrPosition instanceof Position) {
      this.start = startLineOrPosition;
      this.end = startCharacterOrPosition;
      return;
    }
    this.start = new Position(startLineOrPosition, startCharacterOrPosition);
    this.end = new Position(endLine, endCharacter);
  }
  get isEmpty() {
    return this.start.isEqual(this.end);
  }
  contains(positionOrRange) {
    const position = positionOrRange instanceof Range ? positionOrRange.start : positionOrRange;
    const afterStart = !position.isBefore(this.start);
    const beforeEnd = position.isBefore(this.end) || position.isEqual(this.end);
    return afterStart && beforeEnd;
  }
}

class Selection extends Range {
  constructor(anchorOrStart, activeOrEnd, endLine, endCharacter) {
    if (anchorOrStart instanceof Position && activeOrEnd instanceof Position && endLine === undefined) {
      super(anchorOrStart, activeOrEnd);
      this.anchor = anchorOrStart;
      this.active = activeOrEnd;
      return;
    }
    const anchor = new Position(anchorOrStart, activeOrEnd);
    const active = new Position(endLine, endCharacter);
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
}

class Location {
  constructor(uri, rangeOrPosition) {
    this.uri = uri;
    this.range = rangeOrPosition instanceof Range
      ? rangeOrPosition
      : new Range(rangeOrPosition, rangeOrPosition);
  }
}

const SymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
  Constant: 13,
  String: 14,
  Number: 15,
  Boolean: 16,
  Array: 17,
  Object: 18,
  Key: 19,
  Null: 20,
  EnumMember: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
};

class SymbolInformation {
  constructor(name, kind, containerNameOrRange, locationOrUri, containerName) {
    this.name = String(name || "");
    this.kind = kind;
    this.tags = undefined;
    this.containerName = typeof containerNameOrRange === "string" ? containerNameOrRange : containerName;
    this.location = locationOrUri instanceof Location
      ? locationOrUri
      : new Location(locationOrUri, containerNameOrRange instanceof Range ? containerNameOrRange : new Range(0, 0, 0, 0));
  }
}

class Diagnostic {
  constructor(range, message, severity = DiagnosticSeverity.Error) {
    this.range = range;
    this.message = String(message || "");
    this.severity = severity;
    this.source = undefined;
    this.code = undefined;
    this.relatedInformation = undefined;
    this.tags = undefined;
  }
}

class TextEdit {
  constructor(range, newText) {
    this.range = range;
    this.newText = String(newText ?? "");
    this.newEol = undefined;
  }
  static replace(range, newText) {
    return new TextEdit(range, newText);
  }
  static insert(position, newText) {
    return new TextEdit(new Range(position, position), newText);
  }
  static delete(range) {
    return new TextEdit(range, "");
  }
  static setEndOfLine(eol) {
    const edit = new TextEdit(new Range(0, 0, 0, 0), "");
    edit.newEol = eol;
    return edit;
  }
}

class WorkspaceEdit {
  constructor() {
    this._changes = new Map();
  }
  replace(uri, range, newText) {
    this._append(uri, new TextEdit(range, newText));
  }
  insert(uri, position, newText) {
    this._append(uri, TextEdit.insert(position, newText));
  }
  delete(uri, range) {
    this._append(uri, TextEdit.delete(range));
  }
  has(uri) {
    return this._changes.has(uriFsPath(uri));
  }
  get(uri) {
    return this._changes.get(uriFsPath(uri));
  }
  set(uri, edits) {
    this._changes.set(uriFsPath(uri), asArray(edits));
  }
  entries() {
    return Array.from(this._changes.entries()).map(([filePath, edits]) => [toUri(filePath), edits]);
  }
  get size() {
    return this._changes.size;
  }
  createFile() {}
  deleteFile() {}
  renameFile() {}
  _append(uri, edit) {
    const filePath = uriFsPath(uri);
    const edits = this._changes.get(filePath) || [];
    edits.push(edit);
    this._changes.set(filePath, edits);
  }
}

const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
  EnumMember: 19,
  Constant: 20,
  Struct: 21,
  Event: 22,
  Operator: 23,
  TypeParameter: 24,
  User: 25,
  Issue: 26,
};

const CompletionItemTag = {
  Deprecated: 1,
};

const InsertTextFormat = {
  PlainText: 1,
  Snippet: 2,
};

class CodeLens {
  constructor(range, command) {
    this.range = range;
    this.command = command;
    this.isResolved = Boolean(command);
  }
}

class CodeActionKind {
  constructor(value) {
    this.value = String(value || "");
  }
  append(parts) {
    return new CodeActionKind(this.value ? `${this.value}.${parts}` : String(parts || ""));
  }
  contains(other) {
    const otherValue = other instanceof CodeActionKind ? other.value : String(other || "");
    return otherValue === this.value || otherValue.startsWith(`${this.value}.`);
  }
  intersects(other) {
    const otherValue = other instanceof CodeActionKind ? other.value : String(other || "");
    return this.contains(otherValue) || otherValue.startsWith(`${this.value}.`);
  }
  toString() {
    return this.value;
  }
  static Empty = new CodeActionKind("");
  static QuickFix = new CodeActionKind("quickfix");
  static Refactor = new CodeActionKind("refactor");
  static RefactorExtract = new CodeActionKind("refactor.extract");
  static RefactorInline = new CodeActionKind("refactor.inline");
  static RefactorMove = new CodeActionKind("refactor.move");
  static RefactorRewrite = new CodeActionKind("refactor.rewrite");
  static Source = new CodeActionKind("source");
  static SourceOrganizeImports = new CodeActionKind("source.organizeImports");
  static SourceFixAll = new CodeActionKind("source.fixAll");
  static Notebook = new CodeActionKind("notebook");
}

class CodeAction {
  constructor(title, kind) {
    this.title = String(title || "");
    this.kind = kind;
    this.diagnostics = undefined;
    this.edit = undefined;
    this.command = undefined;
    this.isPreferred = undefined;
    this.disabled = undefined;
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
    this.detail = undefined;
    this.documentation = undefined;
    this.sortText = undefined;
    this.filterText = undefined;
    this.insertText = undefined;
    this.range = undefined;
    this.commitCharacters = undefined;
    this.keepWhitespace = undefined;
    this.textEdit = undefined;
    this.additionalTextEdits = undefined;
    this.command = undefined;
    this.preselect = undefined;
    this.tags = undefined;
  }
}

class CallHierarchyItem {
  constructor(kind, name, detail, uri, range, selectionRange) {
    this.kind = kind;
    this.name = name;
    this.detail = detail;
    this.uri = uri;
    this.range = range;
    this.selectionRange = selectionRange;
  }
}

class TypeHierarchyItem {
  constructor(kind, name, detail, uri, range, selectionRange) {
    this.kind = kind;
    this.name = name;
    this.detail = detail;
    this.uri = uri;
    this.range = range;
    this.selectionRange = selectionRange;
  }
}

class DocumentLink {
  constructor(range, target) {
    this.range = range;
    this.target = target;
    this.tooltip = undefined;
  }
}

const InlayHintKind = {
  Type: 1,
  Parameter: 2,
};

class InlayHint {
  constructor(position, label, kind) {
    this.position = position;
    this.label = label;
    this.kind = kind;
    this.textEdits = undefined;
    this.tooltip = undefined;
    this.paddingLeft = undefined;
    this.paddingRight = undefined;
  }
}

class FileSystemError extends Error {
  constructor(messageOrUri = "File system error") {
    const message = typeof messageOrUri === "string"
      ? messageOrUri
      : `File system error: ${messageOrUri && typeof messageOrUri.toString === "function" ? messageOrUri.toString() : String(messageOrUri)}`;
    super(message);
    this.name = "FileSystemError";
    this.code = "Unknown";
  }
  static FileExists(uri) {
    const error = new FileSystemError(uri);
    error.code = "FileExists";
    return error;
  }
  static FileNotFound(uri) {
    const error = new FileSystemError(uri);
    error.code = "FileNotFound";
    return error;
  }
  static FileNotADirectory(uri) {
    const error = new FileSystemError(uri);
    error.code = "FileNotADirectory";
    return error;
  }
  static FileIsADirectory(uri) {
    const error = new FileSystemError(uri);
    error.code = "FileIsADirectory";
    return error;
  }
  static NoPermissions(uri) {
    const error = new FileSystemError(uri);
    error.code = "NoPermissions";
    return error;
  }
  static Unavailable(uri) {
    const error = new FileSystemError(uri);
    error.code = "Unavailable";
    return error;
  }
}

class RelativePattern {
  constructor(base, pattern) {
    this.baseUri = typeof base === "string" ? toUri(base) : base;
    this.pattern = pattern;
  }
}

class TreeItem {
  constructor(label, collapsibleState = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = String(id || "");
  }
}

class ThemeIcon {
  constructor(id, color) {
    this.id = String(id || "");
    this.color = color;
  }
  static File = new ThemeIcon("file");
  static Folder = new ThemeIcon("folder");
}

class MarkdownString {
  constructor(value = "", supportThemeIcons = false) {
    this.value = String(value || "");
    this.supportThemeIcons = Boolean(supportThemeIcons);
    this.supportHtml = false;
    this.isTrusted = false;
    this.baseUri = undefined;
  }
  appendText(value) {
    this.value += String(value ?? "");
    return this;
  }
  appendMarkdown(value) {
    this.value += String(value ?? "");
    return this;
  }
  appendCodeblock(value, language) {
    this.value += `\n\`\`\`${language || ""}\n${String(value ?? "")}\n\`\`\`\n`;
    return this;
  }
}

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
};

const IndentAction = {
  None: 0,
  Indent: 1,
  IndentOutdent: 2,
  Outdent: 3,
};

const ExtensionMode = {
  Production: 1,
  Development: 2,
  Test: 3,
};

const UIKind = {
  Desktop: 1,
  Web: 2,
};

const LogLevel = {
  Off: 0,
  Trace: 1,
  Debug: 2,
  Info: 3,
  Warning: 4,
  Error: 5,
};

const NotebookCellKind = {
  Markup: 1,
  Code: 2,
};

const NotebookControllerAffinity = {
  Default: 1,
  Preferred: 2,
};

const NotebookCellExecutionState = {
  Pending: 1,
  Executing: 2,
  Idle: 3,
};

const DebugConfigurationProviderTriggerKind = {
  Initial: 1,
  Dynamic: 2,
};

const TestRunProfileKind = {
  Run: 1,
  Debug: 2,
  Coverage: 3,
};

class TestMessage {
  constructor(message) {
    this.message = message;
    this.expectedOutput = undefined;
    this.actualOutput = undefined;
    this.contextValue = undefined;
    this.location = undefined;
  }
  static diff(message, expected, actual) {
    const result = new TestMessage(message);
    result.expectedOutput = expected;
    result.actualOutput = actual;
    return result;
  }
}

class LanguageModelTextPart {
  constructor(value) {
    this.value = String(value ?? "");
  }
}

class LanguageModelToolResult {
  constructor(content = []) {
    this.content = Array.isArray(content) ? content : [content];
  }
}

function createTestItemCollection() {
  const items = new Map();
  return {
    get size() {
      return items.size;
    },
    add(item) {
      if (item && item.id) {
        items.set(item.id, item);
      }
    },
    replace(nextItems) {
      items.clear();
      for (const item of Array.isArray(nextItems) ? nextItems : []) {
        if (item && item.id) {
          items.set(item.id, item);
        }
      }
    },
    delete(itemId) {
      items.delete(String(itemId));
    },
    get(itemId) {
      return items.get(String(itemId));
    },
    forEach(callback) {
      for (const item of items.values()) {
        callback(item);
      }
    },
    [Symbol.iterator]: function* iterator() {
      yield* items.values();
    },
  };
}

class NotebookCellOutputItem {
  constructor(data, mime) {
    this.data = data instanceof Uint8Array ? data : Uint8Array.from(Buffer.from(String(data || "")));
    this.mime = mime || "text/plain";
  }
  static text(value, mime = "text/plain") {
    return new NotebookCellOutputItem(Buffer.from(String(value ?? ""), "utf8"), mime);
  }
  static json(value, mime = "application/json") {
    return new NotebookCellOutputItem(Buffer.from(JSON.stringify(value ?? null), "utf8"), mime);
  }
  static stdout(value) {
    return NotebookCellOutputItem.text(value, "application/vnd.code.notebook.stdout");
  }
  static stderr(value) {
    return NotebookCellOutputItem.text(value, "application/vnd.code.notebook.stderr");
  }
  static error(value) {
    const error = value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value;
    return NotebookCellOutputItem.json(error, "application/vnd.code.notebook.error");
  }
}

class NotebookCellOutput {
  constructor(items = [], metadata = {}) {
    this.items = Array.isArray(items) ? items : [items];
    this.metadata = metadata || {};
  }
}

function normalizeFsPath(input) {
  if (!input) {
    return "";
  }
  return String(input).replace(/\\/g, "/");
}

function ensureWorkspaceDocumentPath(input) {
  const resolved = normalizeFsPath(path.resolve(String(input || "")));
  if (!resolved) {
    throw new Error("VS Code language document path is required.");
  }
  if (config.workspaceRootPath) {
    const workspaceRoot = path.resolve(config.workspaceRootPath);
    const relative = path.relative(workspaceRoot, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`VS Code language document must stay inside the workspace: ${resolved}`);
    }
  }
  return resolved;
}

function parseUri(value) {
  if (value && typeof value === "object" && typeof value.fsPath === "string") {
    return value;
  }
  if (typeof value === "string" && value.startsWith("file://")) {
    return toUri(decodeURIComponent(value.replace(/^file:\/\//, "")));
  }
  if (typeof value === "string") {
    const match = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/);
    if (match && match[1] !== "file") {
      const scheme = match[1];
      const rest = match[2] || "";
      return createUri({
        scheme,
        path: rest,
        fsPath: rest,
      });
    }
  }
  return toUri(typeof value === "string" ? value : "");
}

function uriFsPath(value) {
  return parseUri(value).fsPath;
}

function detectLanguageId(fsPath) {
  const lower = normalizeFsPath(fsPath).toLowerCase();
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".tsx")) return "typescriptreact";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".jsx")) return "javascriptreact";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".ipynb")) return "jupyter";
  return "plaintext";
}

function normalizeLanguageId(languageId) {
  const value = String(languageId || "").trim().toLowerCase();
  if (value === "javascriptreact") return "javascriptreact";
  if (value === "typescriptreact") return "typescriptreact";
  if (value === "jupyter" || value === "ipynb") return "jupyter";
  return value || "plaintext";
}

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

function normalizeDocumentVersion(value) {
  const version = Math.floor(Number(value));
  return Number.isFinite(version) && version > 0 ? version : 1;
}

function createTextDocument(fsPath, text) {
  const normalizedPath = normalizeFsPath(fsPath);
  const uri = toUri(normalizedPath);
  const lines = splitLines(text);
  const document = {
    uri,
    fileName: normalizedPath,
    isUntitled: false,
    languageId: detectLanguageId(normalizedPath),
    version: 1,
    eol: 1,
    lineCount: lines.length,
    isDirty: false,
    getText(range) {
      if (!range) {
        return text;
      }
      const startLine = lines[range.start.line] || "";
      const endLine = lines[range.end.line] || "";
      if (range.start.line === range.end.line) {
        return startLine.slice(range.start.character, range.end.character);
      }
      return [
        startLine.slice(range.start.character),
        ...lines.slice(range.start.line + 1, range.end.line),
        endLine.slice(0, range.end.character),
      ].join("\n");
    },
    lineAt(line) {
      const lineNumber = typeof line === "number" ? line : line.line;
      const value = lines[lineNumber] || "";
      return {
        lineNumber,
        text: value,
        range: new Range(new Position(lineNumber, 0), new Position(lineNumber, value.length)),
        rangeIncludingLineBreak: new Range(new Position(lineNumber, 0), new Position(lineNumber, value.length + 1)),
        firstNonWhitespaceCharacterIndex: value.search(/\S|$/),
        isEmptyOrWhitespace: value.trim().length === 0,
      };
    },
    async save() {
      await fsp.writeFile(normalizedPath, text, "utf8");
      document.isDirty = false;
      saveTextDocumentEmitter.fire(document);
      return true;
    },
  };
  openDocuments.set(normalizedPath, document);
  return document;
}

function createNotebookDocument(fsPath, content = "") {
  const normalizedPath = normalizeFsPath(fsPath);
  const uri = toUri(normalizedPath);
  let parsed = null;
  try {
    parsed = content ? JSON.parse(content) : null;
  } catch {
    parsed = null;
  }
  const rawCells = Array.isArray(parsed?.cells) ? parsed.cells : [];
  const cells = rawCells.map((cell, index) => {
    const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "");
    const languageId = normalizeLanguageId(cell.metadata?.language || cell.metadata?.vscode?.languageId || (cell.cell_type === "markdown" ? "markdown" : "python"));
    const document = createTextDocument(`${normalizedPath}#cell-${index}`, source);
    document.languageId = languageId;
    return {
      index,
      notebook: null,
      kind: cell.cell_type === "markdown" ? NotebookCellKind.Markup : NotebookCellKind.Code,
      document,
      metadata: cell.metadata || {},
      outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
      executionSummary: cell.execution_count == null ? undefined : { executionOrder: cell.execution_count },
    };
  });
  const notebook = {
    uri,
    fileName: normalizedPath,
    notebookType: "jupyter-notebook",
    version: 1,
    isDirty: false,
    isUntitled: false,
    metadata: parsed?.metadata || {},
    get cellCount() {
      return cells.length;
    },
    cellAt(index) {
      return cells[index];
    },
    getCells(range) {
      if (!range) {
        return cells.slice();
      }
      return cells.slice(range.start, range.end);
    },
    async save() {
      saveNotebookDocumentEmitter.fire(notebook);
      return true;
    },
  };
  cells.forEach((cell) => {
    cell.notebook = notebook;
  });
  openNotebookDocuments.set(normalizedPath, notebook);
  return notebook;
}

function closeTextDocument(document) {
  if (!document) {
    return;
  }
  openDocuments.delete(normalizeFsPath(document.fileName));
  closeTextDocumentEmitter.fire(document);
}

function closeNotebookDocument(document) {
  if (!document) {
    return;
  }
  openNotebookDocuments.delete(normalizeFsPath(document.fileName || document.uri?.fsPath));
  closeNotebookDocumentEmitter.fire(document);
}

async function openTextDocumentInternal(target) {
  const uri = parseUri(target);
  if (uri.scheme && uri.scheme !== "file") {
    const provider = textDocumentContentProviderRegistry.get(uri.scheme);
    if (provider && typeof provider.provideTextDocumentContent === "function") {
      const text = await Promise.resolve(provider.provideTextDocumentContent(uri, { isCancellationRequested: false, onCancellationRequested() { return new Disposable(); } }));
      const document = createTextDocument(uri.toString(), String(text ?? ""));
      await activateExtensionsForDocument(document);
      return document;
    }
  }
  const fsPath = normalizeFsPath(uri.fsPath);
  if (openDocuments.has(fsPath)) {
    return openDocuments.get(fsPath);
  }
  const text = await fsp.readFile(fsPath, "utf8");
  const document = createTextDocument(fsPath, text);
  openTextDocumentEmitter.fire(document);
  setImmediate(() => {
    void activateExtensionsForDocument(document).catch((error) => {
      rememberHostError(error);
      console.error("background language extension activation failed", error);
    });
  });
  return document;
}

async function openDocumentFromHostRequest(request) {
  const fsPath = ensureWorkspaceDocumentPath(request.filePath);
  const text = typeof request.content === "string"
    ? request.content
    : (fs.existsSync(fsPath) ? await fsp.readFile(fsPath, "utf8") : "");
  const document = createTextDocument(fsPath, text);
  document.version = normalizeDocumentVersion(request.version);
  const requestedLanguageId = normalizeLanguageId(request.languageId || document.languageId);
  document.languageId = requestedLanguageId;
  const isNotebookDocument = isNotebookLanguage(requestedLanguageId) || fsPath.toLowerCase().endsWith(".ipynb");
  if (isNotebookDocument) {
    const notebook = createNotebookDocument(fsPath, text);
    activeNotebookEditor = {
      notebook,
      selection: { start: 0, end: Math.min(1, notebook.cellCount) },
      selections: [{ start: 0, end: Math.min(1, notebook.cellCount) }],
      visibleRanges: [{ start: 0, end: notebook.cellCount }],
      revealRange() {},
    };
    openNotebookDocumentEmitter.fire(notebook);
    changeNotebookDocumentEmitter.fire({ notebook, metadata: undefined, cells: { added: [], removed: [], changed: [] } });
  }
  openTextDocumentEmitter.fire(document);
  changeTextDocumentEmitter.fire({ document, contentChanges: [], reason: undefined });
  setImmediate(() => {
    void activateExtensionsForDocument(document).catch((error) => {
      rememberHostError(error);
      console.error("background language extension activation failed", error);
    });
  });
  return document;
}

async function changeDocumentFromHostRequest(request) {
  const fsPath = ensureWorkspaceDocumentPath(request.filePath);
  const previous = openDocuments.get(fsPath);
  const nextVersion = normalizeDocumentVersion(request.version);
  if (previous && nextVersion < previous.version) {
    return previous;
  }
  const text = typeof request.content === "string" ? request.content : "";
  const document = createTextDocument(fsPath, text);
  document.version = normalizeDocumentVersion(request.version);
  document.languageId = normalizeLanguageId(request.languageId || document.languageId);
  document.isDirty = true;
  changeTextDocumentEmitter.fire({
    document,
    contentChanges: [{ text, range: undefined, rangeLength: undefined }],
    reason: undefined,
  });
  return document;
}

async function saveDocumentFromHostRequest(request) {
  const document = await changeDocumentFromHostRequest(request);
  document.isDirty = false;
  saveTextDocumentEmitter.fire(document);
  return document;
}

function globToRegExp(pattern) {
  const source = normalizeFsPath(pattern)
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${source}$`);
}

function matchesGlob(pattern, relativePath) {
  if (!pattern) {
    return false;
  }
  const normalized = normalizeFsPath(relativePath).replace(/^\/+/, "");
  return globToRegExp(pattern).test(normalized);
}

async function walkFiles(rootPath, visitor) {
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
      await visitor(fullPath, entry);
    }
  }
}

async function findFilesInternal(include, exclude, maxResults) {
  if (!config.workspaceRootPath) {
    return [];
  }
  const basePath = include && include.baseUri ? uriFsPath(include.baseUri) : config.workspaceRootPath;
  const includePattern = include && include.pattern ? include.pattern : include;
  const excludePattern = exclude === undefined
    ? Object.keys(configuration["files.exclude"] || {})
    : exclude === null
      ? []
      : Array.isArray(exclude)
        ? exclude
        : [exclude];
  const results = [];
  await walkFiles(basePath, async (fullPath, entry) => {
    if (!entry.isFile()) {
      return;
    }
    const relative = normalizeFsPath(path.relative(basePath, fullPath));
    if (includePattern && !matchesGlob(includePattern, relative)) {
      return;
    }
    if (excludePattern.some((pattern) => matchesGlob(pattern, relative))) {
      return;
    }
    results.push(toUri(fullPath));
    if (typeof maxResults === "number" && maxResults > 0 && results.length >= maxResults) {
      throw new Error("__LATTICE_FIND_FILES_DONE__");
    }
  }).catch((error) => {
    if (!String(error && error.message || error).includes("__LATTICE_FIND_FILES_DONE__")) {
      throw error;
    }
  });
  return results;
}

async function statUri(target) {
  const fsPath = uriFsPath(target);
  const stats = await fsp.stat(fsPath);
  let type = FileType.Unknown;
  if (stats.isFile()) type |= FileType.File;
  if (stats.isDirectory()) type |= FileType.Directory;
  if (stats.isSymbolicLink()) type |= FileType.SymbolicLink;
  return {
    type,
    ctime: stats.ctimeMs,
    mtime: stats.mtimeMs,
    size: stats.size,
  };
}

async function readWorkspaceFile(target) {
  const fsPath = uriFsPath(target);
  try {
    return await fsp.readFile(fsPath);
  } catch (error) {
    if (error && error.code === "ENOENT" && /package\.nls\.[^.]+\.json$/i.test(fsPath)) {
      const fallbackPath = fsPath.replace(/package\.nls\.[^.]+\.json$/i, "package.nls.json");
      return await fsp.readFile(fallbackPath);
    }
    throw error;
  }
}

function getWorkspaceFolder() {
  if (!config.workspaceRootPath) {
    return undefined;
  }
  return {
    uri: toUri(config.workspaceRootPath),
    name: path.basename(config.workspaceRootPath),
    index: 0,
  };
}

function resolveCommandMeta(commandId) {
  for (const extension of extensions) {
    const items = Array.isArray(extension.commandItems) ? extension.commandItems : [];
    const match = items.find((item) => item && item.command === commandId);
    if (match) {
      return {
        title: match.title || commandId,
        category: match.category || null,
        extensionId: extension.id,
      };
    }
  }
  return {
    title: commandId,
    category: null,
    extensionId: currentActivationExtensionId || "unknown",
  };
}

function resolveViewMeta(viewId) {
  for (const extension of extensions) {
    const items = Array.isArray(extension.viewItems) ? extension.viewItems : [];
    const match = items.find((item) => item && item.id === viewId);
    if (match) {
      return {
        title: match.title || viewId,
        extensionId: extension.id,
        container: match.container || null,
      };
    }
  }
  return {
    title: viewId,
    extensionId: currentActivationExtensionId || "unknown",
    container: null,
  };
}

function registerHostView(viewId, kind, provider = null) {
  const meta = resolveViewMeta(viewId);
  viewRegistry.set(viewId, {
    id: viewId,
    title: meta.title,
    extensionId: meta.extensionId,
    container: meta.container,
    kind,
    provider,
  });
  return new Disposable(() => {
    const current = viewRegistry.get(viewId);
    if (current && current.kind === kind) {
      viewRegistry.delete(viewId);
    }
  });
}

function toWebviewUri(value) {
  if (!value) {
    return "";
  }
  const raw = typeof value.toString === "function" ? value.toString() : String(value);
  if (/^(?:https?:|data:)/i.test(raw)) {
    return raw;
  }
  let fsPath = value.fsPath || value.path || raw;
  if (/^file:/i.test(raw)) {
    try {
      fsPath = fileURLToPath(raw);
    } catch (_) {
      fsPath = raw.replace(/^file:\/+/i, "");
    }
  }
  const resourcePath = String(fsPath);
  let directorySuffix = "";
  try {
    if (require("fs").statSync(resourcePath).isDirectory()) {
      directorySuffix = "/";
    }
  } catch (_) {
    // A missing resource will be surfaced by the preview protocol when it is requested.
  }
  return `lattice-webview-resource:${encodeURIComponent(resourcePath)}${directorySuffix}`;
}

function serializeWebviewOptions(options) {
  if (!options || typeof options !== "object") {
    return {};
  }
  const result = {};
  if (typeof options.enableScripts === "boolean") result.enableScripts = options.enableScripts;
  if (typeof options.enableForms === "boolean") result.enableForms = options.enableForms;
  if (typeof options.retainContextWhenHidden === "boolean") {
    result.retainContextWhenHidden = options.retainContextWhenHidden;
  }
  return result;
}

function injectAcquireVsCodeApi(html, viewId) {
  const input = String(html || "");
  const apiScript = `<script>
window.acquireVsCodeApi = window.acquireVsCodeApi || function() {
  let state;
  return {
    postMessage: function(message) {
      window.parent && window.parent.postMessage({ type: "lattice-vscode-webview-message", viewId: ${JSON.stringify(viewId)}, message: message }, "*");
      return true;
    },
    getState: function() { return state; },
    setState: function(nextState) { state = nextState; return state; }
  };
};
</script>`;
  if (/<head[^>]*>/i.test(input)) {
    return input.replace(/<head([^>]*)>/i, `<head$1>${apiScript}`);
  }
  return `${apiScript}${input}`;
}

function createWebviewViewHost(viewId, entry) {
  let html = "";
  let options = {};
  const outboundMessages = [];
  const receiveMessageEmitter = new EventEmitter();
  const disposeEmitter = new EventEmitter();
  const visibilityEmitter = new EventEmitter();
  return {
    get html() {
      return html;
    },
    view: {
      viewType: viewId,
      title: entry.title,
      description: undefined,
      visible: true,
      onDidDispose: disposeEmitter.event,
      onDidChangeVisibility: visibilityEmitter.event,
      show() {},
      webview: {
        get html() {
          return html;
        },
        set html(value) {
          html = String(value || "");
        },
        get options() {
          return options;
        },
        set options(value) {
          options = value && typeof value === "object" ? value : {};
        },
        get cspSource() {
          return "vscode-webview:";
        },
        asWebviewUri(uri) {
          return toWebviewUri(uri);
        },
        onDidReceiveMessage: receiveMessageEmitter.event,
        postMessage(message) {
          outboundMessages.push(message);
          return Promise.resolve(true);
        },
      },
    },
    fireMessage(message) {
      receiveMessageEmitter.fire(message);
    },
    drainMessages() {
      return outboundMessages.splice(0, outboundMessages.length);
    },
  };
}

async function resolveRegisteredView(viewId) {
  if (!viewRegistry.has(viewId)) {
    const owner = findExtensionForView(viewId);
    if (owner) {
      await activateExtension(owner.id);
    }
  }
  const entry = viewRegistry.get(viewId);
  if (!entry) {
    throw new Error(`VS Code view not registered after activation: ${viewId}`);
  }
  if (entry.kind !== "webview") {
    throw new Error(`VS Code view ${viewId} is a ${entry.kind} view. Lattice can open webview views in-panel; tree views still require desktop VS Code.`);
  }
  if (entry.panel) {
    const session = webviewSessionRegistry.get(viewId);
    if (!session) {
      throw new Error(`VS Code webview panel session is not available: ${viewId}`);
    }
    return {
      viewId,
      title: entry.title,
      extensionId: entry.extensionId,
      html: injectAcquireVsCodeApi(session.html, viewId),
      messages: session.drainMessages(),
      options: serializeWebviewOptions(session.view.webview.options),
      source: "host",
    };
  }
  if (!entry.provider || typeof entry.provider.resolveWebviewView !== "function") {
    throw new Error(`VS Code webview provider is missing resolveWebviewView(): ${viewId}`);
  }
  const host = createWebviewViewHost(viewId, entry);
  const context = { state: undefined };
  const token = { isCancellationRequested: false, onCancellationRequested() { return new Disposable(); } };
  await Promise.resolve(entry.provider.resolveWebviewView(host.view, context, token));
  webviewSessionRegistry.set(viewId, host);
  return {
    viewId,
    title: entry.title,
    extensionId: entry.extensionId,
    html: injectAcquireVsCodeApi(host.html, viewId),
    messages: host.drainMessages(),
    options: serializeWebviewOptions(host.view.webview.options),
    source: "host",
  };
}

function postRegisteredViewMessage(viewId, message) {
  const session = webviewSessionRegistry.get(viewId);
  if (!session) {
    throw new Error(`VS Code webview view is not resolved yet: ${viewId}`);
  }
  session.fireMessage(message);
  return {
    viewId,
    messages: session.drainMessages(),
  };
}

function drainRegisteredViewMessages(viewId) {
  const session = webviewSessionRegistry.get(viewId);
  if (!session) {
    throw new Error(`VS Code webview view is not resolved yet: ${viewId}`);
  }
  return {
    viewId,
    messages: session.drainMessages(),
  };
}

function treeItemLabelToString(label) {
  if (typeof label === "string") {
    return label;
  }
  if (label && typeof label === "object") {
    return String(label.label || label.name || label.description || "");
  }
  return String(label || "");
}

function serializeTreeCommand(command) {
  if (!command || typeof command !== "object" || !command.command) {
    return undefined;
  }
  return {
    command: String(command.command),
    title: command.title ? String(command.title) : undefined,
    arguments: Array.isArray(command.arguments) ? command.arguments : undefined,
  };
}

function serializeCollapsibleState(value) {
  if (value === TreeItemCollapsibleState.Collapsed) {
    return "collapsed";
  }
  if (value === TreeItemCollapsibleState.Expanded) {
    return "expanded";
  }
  return "none";
}

async function serializeTreeElement(provider, element, indexPath, depth) {
  const rawItem = typeof provider.getTreeItem === "function"
    ? await Promise.resolve(provider.getTreeItem(element))
    : element;
  const item = rawItem || element || {};
  const collapsibleState = item.collapsibleState ?? TreeItemCollapsibleState.None;
  const snapshot = {
    id: String(item.id || indexPath || treeItemLabelToString(item.label || element)),
    label: treeItemLabelToString(item.label || item.resourceUri || element),
    description: item.description === undefined ? undefined : String(item.description),
    tooltip: item.tooltip === undefined ? undefined : String(item.tooltip),
    collapsibleState: serializeCollapsibleState(collapsibleState),
    command: serializeTreeCommand(item.command),
    children: [],
  };

  if (depth > 0 && collapsibleState !== TreeItemCollapsibleState.None && typeof provider.getChildren === "function") {
    const children = await Promise.resolve(provider.getChildren(element));
    snapshot.children = await serializeTreeChildren(provider, Array.isArray(children) ? children : [], depth - 1, indexPath);
  }

  return snapshot;
}

async function serializeTreeChildren(provider, children, depth, parentPath = "") {
  const limited = children.slice(0, 50);
  const snapshots = [];
  for (let index = 0; index < limited.length; index += 1) {
    snapshots.push(await serializeTreeElement(provider, limited[index], parentPath ? `${parentPath}/${index}` : String(index), depth));
  }
  return snapshots;
}

async function resolveRegisteredTree(viewId) {
  if (!viewRegistry.has(viewId)) {
    const owner = findExtensionForView(viewId);
    if (owner) {
      await activateExtension(owner.id);
    }
  }
  const entry = viewRegistry.get(viewId);
  if (!entry) {
    throw new Error(`VS Code tree view not registered after activation: ${viewId}`);
  }
  if (entry.kind !== "tree") {
    throw new Error(`VS Code view ${viewId} is a ${entry.kind} view, not a tree view.`);
  }
  const provider = entry.provider;
  if (!provider || typeof provider.getChildren !== "function") {
    throw new Error(`VS Code tree provider is missing getChildren(): ${viewId}`);
  }
  const rootChildren = await Promise.resolve(provider.getChildren(undefined));
  const items = await serializeTreeChildren(provider, Array.isArray(rootChildren) ? rootChildren : [], 2);
  return {
    viewId,
    title: entry.title,
    extensionId: entry.extensionId,
    items,
    source: "host",
  };
}

function createWebviewPanelHost(viewId, title, extensionId) {
  const host = createWebviewViewHost(viewId, { title, extensionId });
  const disposeEmitter = new EventEmitter();
  const viewStateEmitter = new EventEmitter();
  const panel = {
    viewType: viewId,
    title,
    iconPath: undefined,
    active: true,
    visible: true,
    viewColumn: 1,
    options: {},
    webview: host.view.webview,
    onDidDispose: disposeEmitter.event,
    onDidChangeViewState: viewStateEmitter.event,
    reveal() {
      panel.active = true;
      panel.visible = true;
      viewStateEmitter.fire({ webviewPanel: panel });
    },
    dispose() {
      panel.active = false;
      panel.visible = false;
      viewRegistry.delete(viewId);
      webviewSessionRegistry.delete(viewId);
      disposeEmitter.fire(undefined);
      disposeEmitter.dispose();
      viewStateEmitter.dispose();
    },
  };
  return { host, panel };
}

function createHostWebviewPanel(viewType, title) {
  const extensionId = currentActivationExtensionId || "unknown";
  const viewId = `webview-panel:${extensionId}:${viewType || "panel"}:${++webviewPanelCounter}`;
  const { host, panel } = createWebviewPanelHost(viewId, title || viewType || "VS Code Webview", extensionId);
  viewRegistry.set(viewId, {
    id: viewId,
    title: panel.title,
    extensionId,
    kind: "webview",
    provider: null,
    panel: true,
  });
  webviewSessionRegistry.set(viewId, host);
  return panel;
}

function createHostTerminal(options = {}) {
  const name = typeof options === "string" ? options : (options.name || `Lattice Terminal ${terminalCounter + 1}`);
  const cwd = typeof options === "object" && options.cwd
    ? (typeof options.cwd === "string" ? options.cwd : uriFsPath(options.cwd))
    : (config.workspaceRootPath || process.cwd());
  const shellPath = typeof options === "object" && options.shellPath
    ? options.shellPath
    : (process.env.ComSpec || process.env.SHELL || "cmd.exe");
  const shellArgs = typeof options === "object" && Array.isArray(options.shellArgs) ? options.shellArgs : [];
  const terminalId = `terminal:${++terminalCounter}`;
  let processHandle = null;
  const terminal = {
    name,
    processId: undefined,
    creationOptions: options,
    exitStatus: undefined,
    state: { isInteractedWith: false, shell: shellPath },
    show() {
      activeTerminal = terminal;
      activeTerminalEmitter.fire(terminal);
    },
    hide() {},
    sendText(text, addNewLine = true) {
      terminal.state.isInteractedWith = true;
      if (!processHandle || processHandle.killed) {
        processHandle = childProcess.spawn(shellPath, shellArgs, {
          cwd,
          env: process.env,
          windowsHide: true,
          stdio: ["pipe", "ignore", "ignore"],
        });
        terminal.processId = Promise.resolve(processHandle.pid);
        processHandle.on("exit", (code) => {
          terminal.exitStatus = { code };
          terminalCloseEmitter.fire(terminal);
        });
      }
      processHandle.stdin.write(String(text || ""));
      if (addNewLine) {
        processHandle.stdin.write("\n");
      }
    },
    dispose() {
      if (processHandle && !processHandle.killed) {
        processHandle.kill();
      }
      terminalRegistry.delete(terminalId);
      terminalCloseEmitter.fire(terminal);
    },
  };
  terminalRegistry.set(terminalId, terminal);
  activeTerminal = terminal;
  terminalOpenEmitter.fire(terminal);
  activeTerminalEmitter.fire(terminal);
  return terminal;
}

function createNotebookController(id, notebookType, label, executeHandler) {
  const controllerId = String(id || `lattice-notebook-controller-${notebookControllerRegistry.size + 1}`);
  const controller = {
    id: controllerId,
    notebookType: String(notebookType || "jupyter-notebook"),
    label: String(label || controllerId),
    description: undefined,
    detail: undefined,
    supportedLanguages: [],
    supportsExecutionOrder: false,
    executeHandler,
    interruptHandler: undefined,
    disposeHandler: undefined,
    createNotebookCellExecution(cell) {
      let state = NotebookCellExecutionState.Pending;
      return {
        cell,
        token: { isCancellationRequested: false, onCancellationRequested() { return new Disposable(); } },
        executionOrder: undefined,
        start(_startTime) {
          state = NotebookCellExecutionState.Executing;
        },
        end(_success, _endTime) {
          state = NotebookCellExecutionState.Idle;
        },
        clearOutput() {
          return Promise.resolve();
        },
        replaceOutput() {
          return Promise.resolve();
        },
        appendOutput() {
          return Promise.resolve();
        },
        replaceOutputItems() {
          return Promise.resolve();
        },
        appendOutputItems() {
          return Promise.resolve();
        },
        get state() {
          return state;
        },
      };
    },
    updateNotebookAffinity() {},
    dispose() {
      notebookControllerRegistry.delete(controllerId);
      if (typeof controller.disposeHandler === "function") {
        controller.disposeHandler();
      }
    },
  };
  notebookControllerRegistry.set(controllerId, controller);
  return controller;
}

function createRendererMessaging(rendererId) {
  const id = String(rendererId || "");
  const receiveEmitter = new EventEmitter();
  const messaging = {
    rendererId: id,
    onDidReceiveMessage: receiveEmitter.event,
    postMessage() {
      return Promise.resolve(true);
    },
    dispose() {
      notebookRendererMessagingRegistry.delete(id);
      receiveEmitter.dispose();
    },
  };
  notebookRendererMessagingRegistry.set(id, messaging);
  return messaging;
}

function createProviderRegistry() {
  const providers = new Set();
  return {
    register(provider) {
      providers.add(provider);
      return new Disposable(() => providers.delete(provider));
    },
    values() {
      return Array.from(providers);
    },
  };
}

const languageProviderRegistry = createProviderRegistry();
const debugProviderRegistry = createProviderRegistry();
const taskProviderRegistry = createProviderRegistry();
const activationEventPromises = new Map();

const LANGUAGE_PROVIDER_TIMEOUT_MS = 1200;
const LANGUAGE_PROVIDER_METHODS = {
  completion: "provideCompletionItems",
  hover: "provideHover",
  definition: "provideDefinition",
  references: "provideReferences",
  formatting: "provideDocumentFormattingEdits",
  rename: "provideRenameEdits",
  codeAction: "provideCodeActions",
};

function registerLanguageProvider(feature, argsLike) {
  const args = Array.from(argsLike || []);
  const selector = args[0];
  const provider = args[1];
  if (!provider || typeof provider !== "object") {
    throw new Error(`VS Code ${feature} provider is required.`);
  }
  return languageProviderRegistry.register({
    feature,
    selector,
    provider,
    triggerCharacters: feature === "completion" ? args.slice(2).map(String) : [],
    extensionId: currentActivationExtensionId || "unknown",
  });
}

function selectorPatternMatches(document, pattern) {
  const rawPattern = pattern && typeof pattern === "object" ? pattern.pattern : pattern;
  if (typeof rawPattern !== "string" || !rawPattern) {
    return true;
  }
  const workspaceRoot = config.workspaceRootPath || path.dirname(document.fileName);
  const relativePath = normalizeFsPath(path.relative(workspaceRoot, document.fileName));
  return matchesGlob(rawPattern, relativePath) || matchesGlob(rawPattern, normalizeFsPath(document.fileName));
}

function documentMatchesSelector(document, selector) {
  if (Array.isArray(selector)) {
    return selector.some((entry) => documentMatchesSelector(document, entry));
  }
  if (typeof selector === "string") {
    return normalizeLanguageId(selector) === normalizeLanguageId(document.languageId);
  }
  if (!selector || typeof selector !== "object") {
    return false;
  }
  if (selector.language && normalizeLanguageId(selector.language) !== normalizeLanguageId(document.languageId)) {
    return false;
  }
  if (selector.scheme && String(selector.scheme) !== String(document.uri?.scheme || "file")) {
    return false;
  }
  return selectorPatternMatches(document, selector.pattern);
}

function plainPosition(value) {
  if (!value) {
    return undefined;
  }
  return {
    line: Math.max(0, Number(value.line) || 0),
    character: Math.max(0, Number(value.character) || 0),
  };
}

function plainRange(value) {
  if (!value || !value.start || !value.end) {
    return undefined;
  }
  return { start: plainPosition(value.start), end: plainPosition(value.end) };
}

function markdownText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value.value === "string") {
    return value.value;
  }
  if (value && typeof value.language === "string" && typeof value.value === "string") {
    return `\u0060\u0060\u0060${value.language}\n${value.value}\n\u0060\u0060\u0060`;
  }
  return String(value ?? "");
}

function normalizeCompletionValue(value) {
  const items = Array.isArray(value) ? value : asArray(value?.items);
  return items.map((item) => {
    const label = typeof item === "string" ? item : item?.label;
    const normalizedLabel = typeof label === "string" ? label : String(label?.label || "");
    return {
      label: normalizedLabel,
      detail: typeof item?.detail === "string" ? item.detail : undefined,
      documentation: item?.documentation == null ? undefined : markdownText(item.documentation),
      kind: Number.isFinite(Number(item?.kind)) ? Number(item.kind) : undefined,
      insertText: typeof item?.insertText === "string"
        ? item.insertText
        : (typeof item?.insertText?.value === "string" ? item.insertText.value : undefined),
      filterText: typeof item?.filterText === "string" ? item.filterText : undefined,
      sortText: typeof item?.sortText === "string" ? item.sortText : undefined,
      preselect: Boolean(item?.preselect),
      range: plainRange(item?.range),
    };
  }).filter((item) => item.label);
}

function normalizeHoverValue(value) {
  if (!value) {
    return null;
  }
  return {
    contents: asArray(value.contents).map(markdownText).filter(Boolean),
    range: plainRange(value.range),
  };
}

function normalizeLocationValue(value) {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return values.map((location) => {
    const uri = location.targetUri || location.uri;
    const range = location.targetSelectionRange || location.targetRange || location.range;
    return {
      filePath: uriFsPath(uri),
      range: plainRange(range),
      targetRange: plainRange(location.targetRange),
      targetSelectionRange: plainRange(location.targetSelectionRange),
      originSelectionRange: plainRange(location.originSelectionRange),
    };
  }).filter((location) => location.filePath && location.range);
}

function normalizeDiagnosticValue(value) {
  return asArray(value).map((diagnostic) => ({
    message: String(diagnostic?.message || ""),
    severity: Number.isFinite(Number(diagnostic?.severity)) ? Number(diagnostic.severity) : DiagnosticSeverity.Error,
    code: diagnostic?.code == null
      ? undefined
      : (typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code),
    source: typeof diagnostic?.source === "string" ? diagnostic.source : undefined,
    range: plainRange(diagnostic?.range),
    tags: Array.isArray(diagnostic?.tags) ? diagnostic.tags.map(Number).filter(Number.isFinite) : undefined,
  })).filter((diagnostic) => diagnostic.message && diagnostic.range);
}

function normalizeTextEditValue(value) {
  return asArray(value).map((edit) => ({
    range: plainRange(edit?.range),
    newText: typeof edit?.newText === "string" ? edit.newText : "",
  })).filter((edit) => edit.range);
}

function normalizeWorkspaceEditValue(value) {
  if (!value) {
    return null;
  }
  let entries = [];
  if (typeof value.entries === "function") {
    entries = asArray(value.entries());
  } else if (value.changes && typeof value.changes === "object") {
    entries = Object.entries(value.changes).map(([uri, edits]) => [parseUri(uri), edits]);
  } else if (Array.isArray(value.documentChanges)) {
    entries = value.documentChanges.flatMap((change) => {
      const uri = change?.textDocument?.uri;
      return uri ? [[uri, change.edits]] : [];
    });
  }
  const changes = entries.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const filePath = uriFsPath(entry[0]);
    const edits = normalizeTextEditValue(entry[1]);
    return filePath && edits.length > 0 ? [{ filePath, edits }] : [];
  });
  return changes.length > 0 ? { changes } : null;
}

function normalizeCommandValue(value) {
  if (!value || typeof value.command !== "string") {
    return undefined;
  }
  return {
    command: value.command,
    title: typeof value.title === "string" ? value.title : value.command,
    arguments: Array.isArray(value.arguments) ? value.arguments : [],
  };
}

function normalizeCodeActionValue(value) {
  return asArray(value).map((action) => ({
    title: String(action?.title || action?.command?.title || ""),
    kind: typeof action?.kind === "string" ? action.kind : action?.kind?.value,
    isPreferred: Boolean(action?.isPreferred),
    disabled: action?.disabled
      ? { reason: String(action.disabled.reason || action.disabled) }
      : undefined,
    edit: normalizeWorkspaceEditValue(action?.edit),
    command: normalizeCommandValue(typeof action?.command === "string" ? action : action?.command),
  })).filter((action) => action.title);
}

function normalizeLanguageProviderValue(feature, value) {
  if (feature === "completion") return normalizeCompletionValue(value);
  if (feature === "hover") return normalizeHoverValue(value);
  if (feature === "definition") return normalizeLocationValue(value);
  if (feature === "references") return normalizeLocationValue(value);
  if (feature === "formatting") return normalizeTextEditValue(value);
  if (feature === "rename") return normalizeWorkspaceEditValue(value);
  if (feature === "codeAction") return normalizeCodeActionValue(value);
  return value;
}

function requestPosition(request) {
  return new Position(request?.position?.line, request?.position?.character);
}

function requestRange(request) {
  const start = request?.range?.start || request?.position || { line: 0, character: 0 };
  const end = request?.range?.end || start;
  return new Range(
    new Position(start.line, start.character),
    new Position(end.line, end.character),
  );
}

function invokeLanguageProvider(registration, document, request, token) {
  const methodName = LANGUAGE_PROVIDER_METHODS[request.feature];
  const handler = registration.provider?.[methodName];
  if (typeof handler !== "function") {
    throw new Error(`VS Code ${request.feature} provider does not implement ${methodName}.`);
  }
  const position = requestPosition(request);
  if (request.feature === "completion") {
    const triggerCharacter = typeof request.triggerCharacter === "string" ? request.triggerCharacter : undefined;
    return handler.call(registration.provider, document, position, token, {
      triggerKind: triggerCharacter ? 2 : 1,
      triggerCharacter,
    });
  }
  if (request.feature === "references") {
    return handler.call(registration.provider, document, position, { includeDeclaration: true }, token);
  }
  if (request.feature === "formatting") {
    const options = request.formattingOptions || {};
    return handler.call(registration.provider, document, {
      tabSize: Math.max(1, Number(options.tabSize) || 4),
      insertSpaces: options.insertSpaces !== false,
    }, token);
  }
  if (request.feature === "rename") {
    return handler.call(
      registration.provider,
      document,
      position,
      String(request.newName || ""),
      token,
    );
  }
  if (request.feature === "codeAction") {
    const context = request.context || {};
    return handler.call(
      registration.provider,
      document,
      requestRange(request),
      {
        diagnostics: asArray(context.diagnostics),
        only: context.only ? new CodeActionKind(context.only) : undefined,
        triggerKind: Number(context.triggerKind) || 1,
      },
      token,
    );
  }
  return handler.call(registration.provider, document, position, token);
}

function runProviderWithTimeout(task, tokenSource) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tokenSource.cancel();
      const error = new Error(`VS Code language provider timed out after ${LANGUAGE_PROVIDER_TIMEOUT_MS}ms.`);
      error.code = "LATTICE_PROVIDER_TIMEOUT";
      reject(error);
    }, LANGUAGE_PROVIDER_TIMEOUT_MS);
    Promise.resolve(task).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function diagnosticFeatureResponse(document) {
  const providers = [];
  const results = [];
  for (const collection of diagnosticCollections) {
    const entries = [];
    collection.forEach((candidateUri, diagnostics) => {
      if (uriFsPath(candidateUri) === document.fileName) {
        entries.push(...normalizeDiagnosticValue(diagnostics));
      }
    });
    if (entries.length > 0) {
      providers.push({
        extensionId: collection.extensionId || "unknown",
        durationMs: 0,
        status: "ok",
        value: entries,
      });
      results.push(...entries);
    }
  }
  return { providers, results };
}

async function requestLanguageFeature(request) {
  const feature = String(request.feature || "");
  if (feature !== "completion" && feature !== "hover" && feature !== "definition" && feature !== "diagnostics" && feature !== "references" && feature !== "formatting" && feature !== "rename" && feature !== "codeAction") {
    throw new Error(`Unsupported VS Code language feature: ${feature || "missing"}`);
  }
  const filePath = ensureWorkspaceDocumentPath(request.filePath);
  let document = openDocuments.get(filePath);
  if (!document) {
    document = await openDocumentFromHostRequest(request);
  }
  const requestedVersion = normalizeDocumentVersion(request.version);
  if (requestedVersion < document.version) {
    return {
      ok: true,
      feature,
      documentVersion: document.version,
      providers: [],
      results: [],
      stale: true,
    };
  }
  document.languageId = normalizeLanguageId(request.languageId || document.languageId);
  await activateExtensionsForDocument(document);

  if (feature === "diagnostics") {
    const diagnostics = diagnosticFeatureResponse(document);
    return { ok: true, feature, documentVersion: document.version, ...diagnostics };
  }

  const registrations = languageProviderRegistry.values().filter((registration) => {
    if (registration.feature !== feature || !documentMatchesSelector(document, registration.selector)) {
      return false;
    }
    if (feature === "completion" && request.triggerCharacter) {
      return registration.triggerCharacters.length === 0 || registration.triggerCharacters.includes(request.triggerCharacter);
    }
    return true;
  });
  const providers = [];
  const results = [];
  for (const registration of registrations) {
    const startedAt = Date.now();
    const tokenSource = new CancellationTokenSource();
    try {
      const rawValue = await runProviderWithTimeout(
        invokeLanguageProvider(registration, document, request, tokenSource.token),
        tokenSource,
      );
      const value = normalizeLanguageProviderValue(feature, rawValue);
      const empty = value == null || (Array.isArray(value) && value.length === 0);
      providers.push({
        extensionId: registration.extensionId,
        durationMs: Date.now() - startedAt,
        status: empty ? "empty" : "ok",
        value,
      });
      if (!empty) {
        if (Array.isArray(value)) results.push(...value);
        else results.push(value);
      }
    } catch (error) {
      providers.push({
        extensionId: registration.extensionId,
        durationMs: Date.now() - startedAt,
        status: error?.code === "LATTICE_PROVIDER_TIMEOUT" ? "timeout" : "error",
        error: error && error.message ? error.message : String(error),
      });
    } finally {
      tokenSource.dispose();
    }
  }
  return { ok: true, feature, documentVersion: document.version, providers, results };
}

function registerHostWebviewPanelSerializer(viewType, serializer) {
  const key = String(viewType || "");
  webviewPanelSerializerRegistry.set(key, {
    viewType: key,
    extensionId: currentActivationExtensionId || "unknown",
    serializer,
  });
  return new Disposable(() => {
    webviewPanelSerializerRegistry.delete(key);
  });
}

function registerHostUriHandler(handler) {
  const extensionId = currentActivationExtensionId || "unknown";
  uriHandlerRegistry.set(extensionId, handler);
  return new Disposable(() => {
    uriHandlerRegistry.delete(extensionId);
  });
}

function readConfigurationValue(section) {
  if (!section) {
    return configuration;
  }
  const parts = String(section).split(".").filter(Boolean);
  let current = configuration;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function createConfigurationView(section) {
  return {
    has(key) {
      if (!key) {
        return readConfigurationValue(section) !== undefined;
      }
      return readConfigurationValue(section ? `${section}.${key}` : key) !== undefined;
    },
    get(key, defaultValue) {
      const value = readConfigurationValue(key ? (section ? `${section}.${key}` : key) : section);
      return value === undefined ? defaultValue : value;
    },
    inspect(key) {
      const value = this.get(key);
      return {
        key: key ?? section ?? "",
        defaultValue: undefined,
        globalValue: value,
        workspaceValue: value,
        workspaceFolderValue: value,
      };
    },
    async update() {
      throw new Error("workspace.getConfiguration().update is not supported by the Lattice VS Code host bridge yet.");
    },
  };
}

async function runCommandById(commandId, args = []) {
  if (commandId === "setContext") {
    contextKeyRegistry.set(String(args[0] || ""), args[1]);
    return true;
  }
  if (commandId === "vscode.open" || commandId === "vscode.openWith" || commandId === "workbench.action.openSettings" || isKnownViewFocusCommand(commandId)) {
    return true;
  }
  if (!commandRegistry.has(commandId)) {
    const owner = findExtensionForCommand(commandId);
    if (owner) {
      await activateExtension(owner.id);
    }
  }

  const command = commandRegistry.get(commandId);
  if (!command || typeof command.handler !== "function") {
    throw new Error(`Command not found after activation: ${commandId}`);
  }

  const previousActivationExtensionId = currentActivationExtensionId;
  currentActivationExtensionId = command.extensionId || previousActivationExtensionId;
  try {
    return await Promise.resolve(command.handler(...args));
  } finally {
    currentActivationExtensionId = previousActivationExtensionId;
  }
}

function createVscodeApi() {
  return {
    version: "1.106.0",
    Disposable,
    EventEmitter,
    CancellationTokenSource,
    CancellationError,
    commands: {
      registerCommand(commandId, handler) {
        const meta = resolveCommandMeta(commandId);
        commandRegistry.set(commandId, {
          id: commandId,
          title: meta.title,
          extensionId: meta.extensionId,
          category: meta.category,
          handler,
        });
        return {
          dispose() {
            commandRegistry.delete(commandId);
          },
        };
      },
      registerTextEditorCommand(commandId, handler) {
        return this.registerCommand(commandId, handler);
      },
      async executeCommand(commandId, ...args) {
        return await runCommandById(commandId, args);
      },
      async getCommands() {
        return ["setContext", "vscode.open", "vscode.openWith", "workbench.action.openSettings", ...Array.from(commandRegistry.keys())];
      },
    },
    window: {
      showQuickPick,
      showInputBox,
      createQuickPick,
      createInputBox,
      async showInformationMessage(message) {
        return message;
      },
      async showWarningMessage(message) {
        return message;
      },
      async showErrorMessage(message) {
        return message;
      },
      async showTextDocument(document) {
        const editor = {
          document,
          selection: new Selection(new Position(0, 0), new Position(0, 0)),
          selections: [new Selection(new Position(0, 0), new Position(0, 0))],
          revealRange() {},
        };
        activeTextEditor = editor;
        return editor;
      },
      get activeTextEditor() {
        return activeTextEditor;
      },
      get visibleTextEditors() {
        return activeTextEditor ? [activeTextEditor] : [];
      },
      get activeNotebookEditor() {
        return activeNotebookEditor;
      },
      get visibleNotebookEditors() {
        return activeNotebookEditor ? [activeNotebookEditor] : [];
      },
      onDidChangeActiveTextEditor: activeTextEditorEmitter.event,
      onDidChangeVisibleTextEditors: visibleTextEditorsEmitter.event,
      onDidChangeTextEditorSelection: textEditorSelectionEmitter.event,
      onDidChangeActiveNotebookEditor: activeNotebookEditorEmitter.event,
      onDidChangeVisibleNotebookEditors: visibleNotebookEditorsEmitter.event,
      state: {
        focused: true,
        active: true,
      },
      onDidChangeWindowState: windowStateEmitter.event,
      tabGroups: {
        all: [],
        activeTabGroup: undefined,
        onDidChangeTabGroups: tabGroupsChangeEmitter.event,
        onDidChangeTabs: tabsChangeEmitter.event,
      },
      get terminals() {
        return Array.from(terminalRegistry.values());
      },
      get activeTerminal() {
        return activeTerminal;
      },
      onDidOpenTerminal: terminalOpenEmitter.event,
      onDidCloseTerminal: terminalCloseEmitter.event,
      onDidChangeActiveTerminal: activeTerminalEmitter.event,
      onDidChangeTerminalShellIntegration: terminalShellIntegrationEmitter.event,
      onDidStartTerminalShellExecution: terminalShellExecutionStartEmitter.event,
      onDidEndTerminalShellExecution: terminalShellExecutionEndEmitter.event,
      createTerminal(optionsOrName, shellPath, shellArgs) {
        if (typeof optionsOrName === "string") {
          return createHostTerminal({
            name: optionsOrName,
            shellPath,
            shellArgs: Array.isArray(shellArgs) ? shellArgs : [],
          });
        }
        return createHostTerminal(optionsOrName || {});
      },
      createOutputChannel(name) {
        const lines = [];
        const appendLogLine = (level, values) => {
          const rendered = values.map((value) => {
            if (typeof value === "string") {
              return value;
            }
            try {
              return JSON.stringify(value);
            } catch (_) {
              return String(value);
            }
          }).join(" ");
          lines.push(`[${level}] ${rendered}`);
        };
        return {
          name,
          append(value) {
            lines.push(String(value));
          },
          appendLine(value) {
            lines.push(String(value));
          },
          replace(value) {
            lines.length = 0;
            lines.push(String(value));
          },
          trace(...values) {
            appendLogLine("trace", values);
          },
          debug(...values) {
            appendLogLine("debug", values);
          },
          info(...values) {
            appendLogLine("info", values);
          },
          warn(...values) {
            appendLogLine("warn", values);
          },
          error(...values) {
            appendLogLine("error", values);
          },
          clear() {
            lines.length = 0;
          },
          show() {},
          hide() {},
          dispose() {
            lines.length = 0;
          },
        };
      },
      createTextEditorDecorationType(options = {}) {
        return {
          key: `lattice-decoration-${Math.random().toString(36).slice(2)}`,
          options,
          dispose() {},
        };
      },
      createStatusBarItem() {
        return {
          text: "",
          tooltip: undefined,
          command: undefined,
          color: undefined,
          backgroundColor: undefined,
          alignment: StatusBarAlignment.Left,
          priority: undefined,
          show() {},
          hide() {},
          dispose() {},
        };
      },
      async withProgress(_options, task) {
        const progress = { report() {} };
        const token = { isCancellationRequested: false, onCancellationRequested() { return new Disposable(); } };
        return await Promise.resolve(task(progress, token));
      },
      registerTreeDataProvider(viewId, treeDataProvider) {
        return registerHostView(String(viewId), "tree", treeDataProvider);
      },
      createTreeView(viewId, options = {}) {
        const disposable = registerHostView(String(viewId), "tree", options.treeDataProvider || null);
        return {
          title: String(viewId),
          description: undefined,
          message: undefined,
          selection: [],
          visible: true,
          onDidChangeVisibility() {
            return new Disposable();
          },
          onDidChangeSelection() {
            return new Disposable();
          },
          async reveal() {},
          dispose() {
            disposable.dispose();
          },
        };
      },
      registerWebviewViewProvider(viewId, provider) {
        return registerHostView(String(viewId), "webview", provider);
      },
      createWebviewPanel(viewType, title) {
        return createHostWebviewPanel(String(viewType || "webview"), String(title || viewType || "VS Code Webview"));
      },
      registerWebviewPanelSerializer(viewType, serializer) {
        return registerHostWebviewPanelSerializer(viewType, serializer);
      },
      registerCustomEditorProvider(viewType, provider) {
        const key = String(viewType || "");
        customEditorProviderRegistry.set(key, {
          viewType: key,
          extensionId: currentActivationExtensionId || "unknown",
          provider,
        });
        return new Disposable(() => {
          customEditorProviderRegistry.delete(key);
        });
      },
      registerUriHandler(handler) {
        return registerHostUriHandler(handler);
      },
      registerTerminalLinkProvider() {
        return new Disposable();
      },
    },
    languages: {
      onDidChangeDiagnostics: diagnosticsChangeEmitter.event,
      createDiagnosticCollection(name) {
        const diagnostics = new Map();
        const collection = {
          name: typeof name === "string" ? name : undefined,
          extensionId: currentActivationExtensionId || "unknown",
          set(uri, entries) {
            const filePath = uriFsPath(uri);
            diagnostics.set(filePath, Array.isArray(entries) ? entries : []);
            diagnosticsChangeEmitter.fire({ uris: [toUri(filePath)] });
          },
          delete(uri) {
            const filePath = uriFsPath(uri);
            diagnostics.delete(filePath);
            diagnosticsChangeEmitter.fire({ uris: [toUri(filePath)] });
          },
          clear() {
            const uris = Array.from(diagnostics.keys()).map(toUri);
            diagnostics.clear();
            diagnosticsChangeEmitter.fire({ uris });
          },
          forEach(callback) {
            for (const [filePath, entries] of diagnostics.entries()) {
              callback(toUri(filePath), entries, this);
            }
          },
          dispose() {
            diagnostics.clear();
            diagnosticCollections.delete(collection);
          },
        };
        diagnosticCollections.add(collection);
        return collection;
      },
      getDiagnostics(uri) {
        const results = [];
        for (const collection of diagnosticCollections) {
          if (uri) {
            collection.forEach((candidateUri, entries) => {
              if (uriFsPath(candidateUri) === uriFsPath(uri)) {
                results.push(...entries);
              }
            });
            continue;
          }
          collection.forEach((candidateUri, entries) => {
            results.push([candidateUri, entries]);
          });
        }
        return results;
      },
      registerCompletionItemProvider() { return registerLanguageProvider("completion", arguments); },
      registerHoverProvider() { return registerLanguageProvider("hover", arguments); },
      registerDefinitionProvider() { return registerLanguageProvider("definition", arguments); },
      registerReferenceProvider() { return registerLanguageProvider("references", arguments); },
      registerRenameProvider() { return registerLanguageProvider("rename", arguments); },
      registerCodeActionsProvider() { return registerLanguageProvider("codeAction", arguments); },
      registerDocumentFormattingEditProvider() { return registerLanguageProvider("formatting", arguments); },
      registerDocumentRangeFormattingEditProvider() { return registerLanguageProvider("rangeFormatting", arguments); },
      registerDocumentSymbolProvider() { return registerLanguageProvider("documentSymbols", arguments); },
      registerWorkspaceSymbolProvider() { return registerLanguageProvider("workspaceSymbols", arguments); },
      registerCodeLensProvider() { return registerLanguageProvider("codeLens", arguments); },
      registerInlayHintsProvider() { return registerLanguageProvider("inlayHints", arguments); },
      registerSignatureHelpProvider() { return registerLanguageProvider("signatureHelp", arguments); },
      registerDocumentHighlightProvider() { return registerLanguageProvider("documentHighlight", arguments); },
      registerSelectionRangeProvider() { return registerLanguageProvider("selectionRange", arguments); },
      registerFoldingRangeProvider() { return registerLanguageProvider("foldingRange", arguments); },
      registerLinkProvider() { return registerLanguageProvider("documentLink", arguments); },
      registerColorProvider() { return registerLanguageProvider("color", arguments); },
      setLanguageConfiguration() { return new Disposable(); },
    },
    debug: {
      get activeDebugSession() {
        return undefined;
      },
      get breakpoints() {
        return [];
      },
      onDidStartDebugSession: debugSessionEmitter.event,
      onDidTerminateDebugSession: debugSessionEmitter.event,
      onDidChangeActiveDebugSession: debugSessionEmitter.event,
      onDidReceiveDebugSessionCustomEvent: debugSessionEmitter.event,
      registerDebugConfigurationProvider() {
        return debugProviderRegistry.register(arguments);
      },
      registerDebugAdapterDescriptorFactory() {
        return debugProviderRegistry.register(arguments);
      },
      registerDebugAdapterTrackerFactory() {
        return debugProviderRegistry.register(arguments);
      },
      registerDebugVisualizationTreeProvider() {
        return debugProviderRegistry.register(arguments);
      },
      registerDebugVisualizationProvider() {
        return debugProviderRegistry.register(arguments);
      },
      async startDebugging() {
        return false;
      },
      addBreakpoints() {},
      removeBreakpoints() {},
    },
    tasks: {
      onDidStartTask: taskEmitter.event,
      onDidEndTask: taskEmitter.event,
      onDidStartTaskProcess: taskEmitter.event,
      onDidEndTaskProcess: taskEmitter.event,
      registerTaskProvider() {
        return taskProviderRegistry.register(arguments);
      },
      async fetchTasks() {
        return [];
      },
      async executeTask(task) {
        const execution = {
          task,
          terminate() {
            taskEmitter.fire({ execution });
          },
        };
        taskEmitter.fire({ execution });
        return execution;
      },
    },
    tests: {
      createTestController(id, label) {
        const controller = {
          id: String(id || ""),
          label: String(label || id || ""),
          items: createTestItemCollection(),
          resolveHandler: undefined,
          refreshHandler: undefined,
          createTestItem(itemId, itemLabel, uri) {
            return {
              id: String(itemId || ""),
              label: String(itemLabel || itemId || ""),
              uri,
              busy: false,
              canResolveChildren: false,
              children: createTestItemCollection(),
              description: undefined,
              error: undefined,
              range: undefined,
              sortText: undefined,
              tags: [],
            };
          },
          createRunProfile(profileLabel, kind, runHandler, isDefault = false, tag, supportsContinuousRun = false) {
            return {
              label: String(profileLabel || ""),
              kind,
              runHandler,
              isDefault: Boolean(isDefault),
              tag,
              supportsContinuousRun: Boolean(supportsContinuousRun),
              configureHandler: undefined,
              dispose() {},
            };
          },
          createTestRun(request) {
            return {
              request,
              token: { isCancellationRequested: false, onCancellationRequested() { return new Disposable(); } },
              enqueued() {},
              started() {},
              skipped() {},
              failed() {},
              errored() {},
              passed() {},
              appendOutput() {},
              end() {},
            };
          },
          invalidateTestResults() {},
          dispose() {
            controller.items.replace([]);
          },
        };
        return controller;
      },
    },
    lm: {
      registerTool() {
        return new Disposable();
      },
      tools: [],
      onDidChangeTools() {
        return new Disposable();
      },
    },
    notebooks: {
      createNotebookController,
      createNotebookControllerDetectionTask(handler) {
        return {
          dispose() {},
          handler,
        };
      },
      registerKernelSourceActionProvider() {
        return new Disposable();
      },
      createRendererMessaging,
    },
    workspace: {
      workspaceFolders: getWorkspaceFolder() ? [getWorkspaceFolder()] : undefined,
      get textDocuments() {
        return Array.from(openDocuments.values());
      },
      get notebookDocuments() {
        return Array.from(openNotebookDocuments.values());
      },
      get name() {
        return getWorkspaceFolder() ? getWorkspaceFolder().name : undefined;
      },
      get rootPath() {
        return config.workspaceRootPath || undefined;
      },
      isTrusted: true,
      onDidGrantWorkspaceTrust: workspaceTrustEmitter.event,
      registerPortAttributesProvider() {
        return new Disposable();
      },
      fs: {
        async stat(uri) {
          return await statUri(uri);
        },
        async readDirectory(uri) {
          const fsPath = uriFsPath(uri);
          const entries = await fsp.readdir(fsPath, { withFileTypes: true });
          return entries.map((entry) => {
            let type = FileType.Unknown;
            if (entry.isFile()) type |= FileType.File;
            if (entry.isDirectory()) type |= FileType.Directory;
            if (entry.isSymbolicLink()) type |= FileType.SymbolicLink;
            return [entry.name, type];
          });
        },
        async createDirectory(uri) {
          await fsp.mkdir(uriFsPath(uri), { recursive: true });
        },
        async readFile(uri) {
          const buffer = await readWorkspaceFile(uri);
          return Uint8Array.from(buffer);
        },
        async writeFile(uri, content) {
          await fsp.writeFile(uriFsPath(uri), Buffer.from(content));
        },
        async delete(uri, options = {}) {
          await fsp.rm(uriFsPath(uri), { recursive: Boolean(options.recursive), force: true });
        },
        async rename(oldUri, newUri, options = {}) {
          const oldPath = uriFsPath(oldUri);
          const newPath = uriFsPath(newUri);
          if (!options.overwrite) {
            let exists = false;
            try {
              await fsp.access(newPath);
              exists = true;
            } catch (_) {}
            if (exists) {
              throw new Error(`Target already exists: ${newPath}`);
            }
          }
          await fsp.rename(oldPath, newPath);
        },
        async copy(sourceUri, targetUri, options = {}) {
          const sourcePath = uriFsPath(sourceUri);
          const targetPath = uriFsPath(targetUri);
          if (!options.overwrite) {
            let exists = false;
            try {
              await fsp.access(targetPath);
              exists = true;
            } catch (_) {}
            if (exists) {
              throw new Error(`Target already exists: ${targetPath}`);
            }
          }
          await fsp.copyFile(sourcePath, targetPath);
        },
        isWritableFileSystem() {
          return true;
        },
      },
      getWorkspaceFolder() {
        return getWorkspaceFolder();
      },
      getConfiguration(section) {
        return createConfigurationView(section);
      },
      onDidChangeConfiguration(listener) {
        return configurationEmitter.event(listener);
      },
      onDidChangeWorkspaceFolders(listener) {
        return workspaceFoldersEmitter.event(listener);
      },
      onDidOpenTextDocument(listener) {
        return openTextDocumentEmitter.event(listener);
      },
      onDidChangeTextDocument(listener) {
        return changeTextDocumentEmitter.event(listener);
      },
      onDidOpenNotebookDocument(listener) {
        return openNotebookDocumentEmitter.event(listener);
      },
      onDidChangeNotebookDocument(listener) {
        return changeNotebookDocumentEmitter.event(listener);
      },
      onDidSaveTextDocument(listener) {
        return saveTextDocumentEmitter.event(listener);
      },
      onDidSaveNotebookDocument(listener) {
        return saveNotebookDocumentEmitter.event(listener);
      },
      onDidCloseTextDocument(listener) {
        return closeTextDocumentEmitter.event(listener);
      },
      onDidCloseNotebookDocument(listener) {
        return closeNotebookDocumentEmitter.event(listener);
      },
      async openTextDocument(target) {
        return await openTextDocumentInternal(target);
      },
      async findFiles(include, exclude, maxResults) {
        return await findFilesInternal(include, exclude, maxResults);
      },
      asRelativePath(target) {
        if (!config.workspaceRootPath) {
          return typeof target === "string" ? target : uriFsPath(target);
        }
        return normalizeFsPath(path.relative(config.workspaceRootPath, uriFsPath(target)));
      },
      createFileSystemWatcher() {
        return {
          onDidCreate() {
            return new Disposable();
          },
          onDidChange() {
            return new Disposable();
          },
          onDidDelete() {
            return new Disposable();
          },
          dispose() {},
        };
      },
      onDidCreateFiles(listener) {
        return createFilesEmitter.event(listener);
      },
      onDidDeleteFiles(listener) {
        return deleteFilesEmitter.event(listener);
      },
      onDidRenameFiles(listener) {
        return renameFilesEmitter.event(listener);
      },
      registerFileSystemProvider(scheme, provider) {
        const key = String(scheme || "");
        fileSystemProviderRegistry.set(key, provider);
        return new Disposable(() => {
          fileSystemProviderRegistry.delete(key);
        });
      },
      registerTextDocumentContentProvider(scheme, provider) {
        const key = String(scheme || "");
        textDocumentContentProviderRegistry.set(key, provider);
        return new Disposable(() => {
          textDocumentContentProviderRegistry.delete(key);
        });
      },
    },
    env: {
      appName: "Lattice",
      language: "en",
      machineId: "lattice-local",
      uriScheme: "lattice",
      uiKind: UIKind.Desktop,
      remoteName: undefined,
      sessionId: "lattice-session",
      isTelemetryEnabled: false,
      shell: process.env.SHELL || process.env.ComSpec || "",
      clipboard: {
        async readText() {
          return "";
        },
        async writeText() {},
      },
      async openExternal() {
        return true;
      },
      asExternalUri(uri) {
        return Promise.resolve(uri);
      },
      createTelemetryLogger() {
        return {
          isUsageEnabled: false,
          isErrorsEnabled: false,
          onDidChangeEnableStates() {
            return new Disposable();
          },
          logUsage() {},
          logError() {},
          dispose() {},
        };
      },
      onDidChangeShell() {
        return new Disposable();
      },
      onDidChangeTelemetryEnabled: telemetryEmitter.event,
    },
    l10n: {
      t(message, ...args) {
        const template = typeof message === "object" && message
          ? String(message.message || "")
          : String(message || "");
        const values = Array.isArray(args[0]) ? args[0] : args;
        return template.replace(/\{(\d+)\}/g, (_match, index) => {
          const value = values[Number(index)];
          return value === undefined ? "" : String(value);
        });
      },
      bundle: undefined,
      uri: undefined,
    },
    authentication: {
      async getSession() {
        return undefined;
      },
      async getAccounts() {
        return [];
      },
      onDidChangeSessions() {
        return new Disposable();
      },
    },
    extensions: {
      onDidChange: extensionChangeEmitter.event,
      get all() {
        return extensions.map((extension) => ({
          id: extension.id,
          extensionPath: extension.path,
          extensionUri: toUri(extension.path),
          packageJSON: extension.packageJSON || {},
          isActive: Boolean(extensionState.get(extension.id)?.active),
          extensionKind: 1,
          exports: extensionState.get(extension.id)?.exports,
          async activate() {
            return await activateExtension(extension.id);
          },
        }));
      },
      getExtension(extensionId) {
        const extension = extensions.find((candidate) => candidate.id === extensionId);
        if (!extension) {
          return undefined;
        }
        return {
          id: extension.id,
          extensionPath: extension.path,
          extensionUri: toUri(extension.path),
          packageJSON: extension.packageJSON || {},
          isActive: Boolean(extensionState.get(extension.id)?.active),
          extensionKind: 1,
          exports: extensionState.get(extension.id)?.exports,
          async activate() {
            return await activateExtension(extension.id);
          },
        };
      },
    },
    Uri: {
      file(fsPath) {
        return toUri(fsPath);
      },
      parse(value) {
        return parseUri(value);
      },
      from(value) {
        if (!value || typeof value !== "object") {
          return toUri("");
        }
        const scheme = value.scheme || "file";
        const fsPath = value.fsPath || value.path || "";
        if (scheme === "file") {
          return toUri(fsPath).with({
            authority: value.authority || "",
            query: value.query || "",
            fragment: value.fragment || "",
          });
        }
        return createUri({
          scheme,
          authority: value.authority || "",
          path: value.path || fsPath,
          query: value.query || "",
          fragment: value.fragment || "",
          fsPath,
        });
      },
      joinPath(base, ...segments) {
        return toUri(path.join(base.fsPath || base.path || "", ...segments));
      },
    },
    FileType,
    FileSystemError,
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticTag,
    TextEdit,
    WorkspaceEdit,
    CancellationTokenSource,
    CancellationError,
    CodeLens,
    CodeAction,
    CodeActionKind,
    CallHierarchyItem,
    TypeHierarchyItem,
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag,
    InsertTextFormat,
    DocumentLink,
    InlayHint,
    InlayHintKind,
    Position,
    Range,
    Selection,
    Location,
    SymbolInformation,
    SymbolKind,
    RelativePattern,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeColor,
    ThemeIcon,
    MarkdownString,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookCellKind,
    NotebookControllerAffinity,
    NotebookCellExecutionState,
    DebugConfigurationProviderTriggerKind,
    StatusBarAlignment,
    ProgressLocation,
    IndentAction,
    ExtensionMode,
    UIKind,
    LogLevel,
    TestRunProfileKind,
    TestMessage,
    LanguageModelTextPart,
    LanguageModelToolResult,
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
    ViewColumn: {
      Active: -1,
      Beside: -2,
      One: 1,
    },
  };
}

const vscodeApi = createVscodeApi();
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeApi;
  }
  return originalLoad.call(this, request, parent, isMain);
};

function createExtensionContext(extension) {
  const subscriptions = [];
  const workspaceFolder = getWorkspaceFolder();
  const storageRoot = config.workspaceRootPath || extension.path;
  return {
    subscriptions,
    extensionPath: extension.path,
    extensionUri: toUri(extension.path),
    extension: {
      id: extension.id,
      extensionPath: extension.path,
      extensionUri: toUri(extension.path),
      packageJSON: extension.packageJSON || {},
      isActive: true,
      extensionKind: 1,
    },
    globalState: createMemento(),
    workspaceState: createMemento(),
    storagePath: storageRoot,
    globalStoragePath: storageRoot,
    logPath: storageRoot,
    storageUri: toUri(storageRoot),
    globalStorageUri: toUri(storageRoot),
    logUri: toUri(storageRoot),
    secrets: createSecretStorage(extension.id),
    environmentVariableCollection: {
      replace() {},
      append() {},
      prepend() {},
      delete() {},
      clear() {},
      get() {
        return undefined;
      },
      forEach() {},
      [Symbol.iterator]: function* iterator() {},
    },
    asAbsolutePath(relativePath) {
      return path.resolve(extension.path, relativePath);
    },
    extensionMode: 1,
    languageModelAccessInformation: undefined,
    workspaceFolder,
  };
}

function resolveEntryPath(extension) {
  const main = typeof extension.main === "string" && extension.main.trim() ? extension.main.trim() : "";
  if (!main) {
    throw new Error(`Extension ${extension.id} is missing a CommonJS main entry`);
  }
  const entryPath = path.resolve(extension.path, main);
  try {
    return require.resolve(entryPath);
  } catch (_) {
    return entryPath;
  }
}

function findExtensionForCommand(commandId) {
  for (const extension of extensions) {
    const commandItems = Array.isArray(extension.commandItems) ? extension.commandItems : [];
    if (commandItems.some((item) => item && item.command === commandId)) {
      return extension;
    }
    const activationEvents = Array.isArray(extension.activationEvents) ? extension.activationEvents : [];
    if (activationEvents.includes(`onCommand:${commandId}`)) {
      return extension;
    }
  }
  return null;
}

function findExtensionForView(viewId) {
  for (const extension of extensions) {
    const viewItems = Array.isArray(extension.viewItems) ? extension.viewItems : [];
    if (viewItems.some((item) => item && item.id === viewId)) {
      return extension;
    }
    const activationEvents = Array.isArray(extension.activationEvents) ? extension.activationEvents : [];
    if (activationEvents.includes(`onView:${viewId}`)) {
      return extension;
    }
  }
  return null;
}

function extensionHandlesActivationEvent(extension, event) {
  const activationEvents = asArray(extension.activationEvents);
  if (activationEvents.includes(event)) {
    return true;
  }

  const contributes = extension.packageJSON?.contributes || {};
  if (event.startsWith("onCommand:")) {
    const commandId = event.slice("onCommand:".length);
    return asArray(extension.commandItems).some((item) => item && item.command === commandId);
  }
  if (event.startsWith("onView:")) {
    const viewId = event.slice("onView:".length);
    return asArray(extension.viewItems).some((item) => item && item.id === viewId);
  }
  if (event.startsWith("onLanguage:")) {
    const languageId = event.slice("onLanguage:".length);
    return asArray(contributes.languages).some((language) => language && language.id === languageId);
  }
  if (event.startsWith("onNotebook:")) {
    const notebookType = event.slice("onNotebook:".length);
    return asArray(contributes.notebooks).some((notebook) => notebook && (notebook.type === notebookType || notebook.notebookType === notebookType)) ||
      asArray(contributes.notebookRenderer).some((renderer) => renderer && renderer.notebookType === notebookType);
  }
  if (event.startsWith("onDebug")) {
    return asArray(contributes.debuggers).length > 0;
  }
  return false;
}

async function activateExtensionsForEvent(activationEvent, extensionFilter = () => true) {
  const event = String(activationEvent || "");
  if (!event) {
    return;
  }
  for (const extension of extensions) {
    if (extensionFilter(extension) && extensionHandlesActivationEvent(extension, event)) {
      try {
        await activateExtension(extension.id);
      } catch (error) {
        console.error("extension activation failed", error);
      }
    }
  }
}

function activateExtensionsForEventOnce(activationEvent) {
  const event = String(activationEvent || "");
  if (!event) {
    return Promise.resolve();
  }
  const existing = activationEventPromises.get(event);
  if (existing) {
    return existing;
  }
  const activation = activateExtensionsForEvent(event);
  activationEventPromises.set(event, activation);
  return activation;
}

async function activatePriorityExtensionsForEvent(activationEvent) {
  await activateExtensionsForEvent(activationEvent, isPriorityCodingAgentExtension);
}

async function activateExtensionsForDocument(document) {
  const languageId = normalizeLanguageId(document && document.languageId);
  await activateExtensionsForEventOnce(`onLanguage:${languageId}`);
  if (languageId === "jupyter" || normalizeFsPath(document?.fileName).toLowerCase().endsWith(".ipynb")) {
    await activateExtensionsForEventOnce("onNotebook:jupyter-notebook");
  }
}

async function activateViewById(viewId) {
  const normalizedViewId = String(viewId || "");
  const owner = findExtensionForView(normalizedViewId);
  if (!owner) {
    throw new Error(`Unknown contributed VS Code view: ${normalizedViewId}`);
  }
  await activateExtension(owner.id);
  const registered = viewRegistry.get(normalizedViewId);
  if (!registered) {
    throw new Error(`VS Code view not registered after activation: ${normalizedViewId}`);
  }
  return registered;
}

async function activateExtension(extensionId) {
  const extensionIndex = extensions.findIndex((candidate) => candidate.id === extensionId);
  const registeredExtension = extensionIndex >= 0 ? extensions[extensionIndex] : null;
  if (!registeredExtension) {
    throw new Error(`Unknown extension: ${extensionId}`);
  }

  const existing = extensionState.get(extensionId);
  if (existing && existing.active) {
    return existing.exports;
  }

  let extension = registeredExtension;
  let entryPath = resolveEntryPath(extension);
  if (!fs.existsSync(entryPath)) {
    extension = refreshExtensionMetadata(registeredExtension);
    extensions[extensionIndex] = extension;
    entryPath = resolveEntryPath(extension);
  }
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Extension entry not found: ${entryPath}`);
  }

  currentActivationExtensionId = extension.id;
  try {
    const loaded = require(entryPath);
    const context = createExtensionContext(extension);
    const exportsValue = loaded && typeof loaded.activate === "function"
      ? await Promise.resolve(loaded.activate(context))
      : loaded;
    extensionState.set(extensionId, {
      id: extension.id,
      active: true,
      module: loaded,
      context,
      exports: exportsValue,
    });
    lastError = null;
    return exportsValue;
  } catch (error) {
    const message = getHostErrorMessage(error);
    extensionState.set(extensionId, {
      id: extension.id,
      active: false,
      error: message,
      missingApi: detectMissingApi(message),
    });
    throw error;
  } finally {
    currentActivationExtensionId = null;
  }
}

async function deactivateAll() {
  for (const [extensionId, state] of extensionState.entries()) {
    try {
      if (state && state.module && typeof state.module.deactivate === "function") {
        await Promise.resolve(state.module.deactivate());
      }
      if (state && state.context && Array.isArray(state.context.subscriptions)) {
        for (const subscription of state.context.subscriptions) {
          try {
            subscription && typeof subscription.dispose === "function" && subscription.dispose();
          } catch (_) {}
        }
      }
    } catch (_) {}
    extensionState.set(extensionId, { ...state, active: false });
  }
}

async function activateStartupExtensions() {
  const startupExtensions = extensions.filter(isEagerActivationCandidate).slice(0, 3);
  for (const extension of startupExtensions) {
    try {
      await activateExtension(extension.id);
    } catch (error) {
      console.error("extension activation failed", error);
    }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

async function handleRequest(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) {
    return;
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    send({ ok: false, error: `Invalid JSON request: ${error.message}` });
    return;
  }

  try {
    if (request.type === "interaction-response") {
      const interactionId = String(request.interactionId || "");
      const pending = pendingInteractionRegistry.get(interactionId);
      if (!pending) {
        send({ ok: false, error: `Unknown VS Code host interaction: ${interactionId}`, snapshot: buildSnapshot() });
        return;
      }
      pendingInteractionRegistry.delete(interactionId);
      pending.resolve({
        cancelled: Boolean(request.cancelled),
        selectedIds: asArray(request.selectedIds).map(String),
        value: request.value,
      });
      return;
    }
    if (request.type === "snapshot") {
      send({ ok: true, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "activate-extension") {
      try {
        await activateExtension(request.extensionId);
      } catch (error) {
        console.error("extension activation failed", error);
      }
      send({ ok: true, snapshot: buildSnapshot("ready") });
      return;
    }
    if (request.type === "activate-view") {
      await activateViewById(request.viewId);
      send({ ok: true, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "run-command") {
      await runCommandById(request.commandId, Array.isArray(request.args) ? request.args : []);
      send({ ok: true, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "open-document") {
      await openDocumentFromHostRequest(request);
      send({ ok: true, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "change-document") {
      await changeDocumentFromHostRequest(request);
      send({ ok: true, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "save-document") {
      await saveDocumentFromHostRequest(request);
      send({ ok: true, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "language-feature") {
      const languageFeature = await requestLanguageFeature(request);
      send({ ...languageFeature, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "resolve-view") {
      const webview = await resolveRegisteredView(String(request.viewId || ""));
      send({ ok: true, webview, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "resolve-tree") {
      const tree = await resolveRegisteredTree(String(request.viewId || ""));
      send({ ok: true, tree, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "post-view-message") {
      const webviewMessages = postRegisteredViewMessage(String(request.viewId || ""), request.message);
      send({ ok: true, webviewMessages, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "drain-view-messages") {
      const webviewMessages = drainRegisteredViewMessages(String(request.viewId || ""));
      send({ ok: true, webviewMessages, snapshot: buildSnapshot() });
      return;
    }
    if (request.type === "shutdown") {
      await deactivateAll();
      send({ ok: true, snapshot: buildSnapshot("idle") });
      process.exit(0);
      return;
    }
    send({ ok: false, error: `Unknown request type: ${request.type || "missing"}` });
  } catch (error) {
    lastError = error && error.message ? error.message : String(error);
    send({ ok: false, error: lastError, snapshot: buildSnapshot("ready", lastError) });
  }
}

(async () => {
  try {
    await activateStartupExtensions();
    send({ ok: true, snapshot: buildSnapshot() });
    rl.on("line", (line) => {
      void handleRequest(line);
    });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    lastError = message;
    send({ ok: false, error: message, snapshot: buildSnapshot("error", message) });
  }
})();
"#
}

fn write_vscode_extension_host_artifacts(
    request: &VSCodeExtensionHostStartRequest,
    runtime: VSCodeExtensionHostRuntime,
) -> Result<(PathBuf, PathBuf), String> {
    let temp_root = env::temp_dir().join("lattice-vscode-extension-host");
    fs::create_dir_all(&temp_root).map_err(|error| error.to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let script_path = temp_root.join(format!("host-{session_id}.cjs"));
    let config_path = temp_root.join(format!("host-{session_id}.json"));
    fs::write(&script_path, vscode_extension_host_script()).map_err(|error| error.to_string())?;
    let config = json!({
        "parentPid": std::process::id(),
        "workspaceRootPath": request.workspace_root_path,
        "configuration": request.configuration.clone().unwrap_or_else(|| json!({})),
        "runtime": runtime.as_str(),
        "extensions": request.extensions,
    });
    let config_text = serde_json::to_string(&config).map_err(|error| error.to_string())?;
    fs::write(&config_path, config_text).map_err(|error| error.to_string())?;
    Ok((script_path, config_path))
}

async fn stop_managed_vscode_extension_host(host: ManagedVSCodeExtensionHost) {
    {
        let mut stdin = host.stdin.lock().await;
        let _ = stdin.write_all(br#"{"type":"shutdown"}"#).await;
        let _ = stdin.write_all(b"\n").await;
        let _ = stdin.flush().await;
    }

    {
        let mut child = host.child.lock().await;
        let _ = tokio::time::timeout(Duration::from_millis(1500), child.wait()).await;
        let _ = child.kill().await;
    }

    let _ = fs::remove_file(&host.script_path);
    let _ = fs::remove_file(&host.config_path);
}

fn stop_vscode_extension_host_on_window_destroyed(app: &AppHandle) {
    let state = app.state::<VSCodeExtensionHostState>();
    tauri::async_runtime::block_on(async {
        let existing = {
            let mut guard = state.process.lock().await;
            guard.take()
        };
        if let Some(host) = existing {
            stop_managed_vscode_extension_host(host).await;
        }
    });
}

async fn request_vscode_extension_host(
    host: &ManagedVSCodeExtensionHost,
    request: Value,
) -> Result<Value, String> {
    let _request_guard = host.request_lock.lock().await;
    let request_text = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    {
        let mut stdin = host.stdin.lock().await;
        stdin
            .write_all(request_text.as_bytes())
            .await
            .map_err(|error| error.to_string())?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| error.to_string())?;
        stdin.flush().await.map_err(|error| error.to_string())?;
    }

    let mut stdout = host.stdout.lock().await;
    let next_line = tokio::time::timeout(
        Duration::from_millis(VSCODE_EXTENSION_HOST_COMMAND_TIMEOUT_MS),
        stdout.next_line(),
    )
    .await
    .map_err(|_| "VS Code extension host request timed out".to_string())?
    .map_err(|error| error.to_string())?;

    let Some(line) = next_line else {
        return Err("VS Code extension host closed unexpectedly".to_string());
    };

    serde_json::from_str::<Value>(&line).map_err(|error| error.to_string())
}

async fn update_vscode_extension_host_snapshot(
    state: &VSCodeExtensionHostState,
    snapshot: VSCodeExtensionHostSnapshot,
) -> VSCodeExtensionHostSnapshot {
    let mut guard = state.snapshot.lock().await;
    *guard = snapshot.clone();
    snapshot
}

async fn current_vscode_extension_host_snapshot(
    state: &VSCodeExtensionHostState,
) -> VSCodeExtensionHostSnapshot {
    state.snapshot.lock().await.clone()
}

async fn clone_vscode_extension_host_process(
    state: &VSCodeExtensionHostState,
) -> Option<ManagedVSCodeExtensionHost> {
    let guard = state.process.lock().await;
    guard.as_ref().map(|host| ManagedVSCodeExtensionHost {
        child: Arc::clone(&host.child),
        stdin: Arc::clone(&host.stdin),
        stdout: Arc::clone(&host.stdout),
        request_lock: Arc::clone(&host.request_lock),
        runtime: host.runtime,
        script_path: host.script_path.clone(),
        config_path: host.config_path.clone(),
    })
}

async fn request_vscode_extension_host_snapshot_command(
    state: &VSCodeExtensionHostState,
    request: Value,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    let Some(host) = clone_vscode_extension_host_process(state).await else {
        return Ok(update_vscode_extension_host_snapshot(
            state,
            unavailable_vscode_extension_host_snapshot("VS Code extension host is not running."),
        )
        .await);
    };

    let payload = request_vscode_extension_host(&host, request).await?;
    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let current_snapshot = current_vscode_extension_host_snapshot(state).await;
    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or(current_snapshot);
    snapshot.runtime = host.runtime.as_str().to_string();
    if !ok {
        snapshot.last_error = payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(snapshot.last_error);
        if snapshot.status == "idle" {
            snapshot.status = "error".to_string();
        }
    }

    Ok(update_vscode_extension_host_snapshot(state, snapshot).await)
}

async fn request_vscode_extension_host_interactive_result(
    state: &VSCodeExtensionHostState,
    request: Value,
) -> Result<Value, String> {
    let Some(host) = clone_vscode_extension_host_process(state).await else {
        let snapshot = update_vscode_extension_host_snapshot(
            state,
            unavailable_vscode_extension_host_snapshot("VS Code extension host is not running."),
        )
        .await;
        return Ok(json!({ "ok": false, "snapshot": snapshot }));
    };

    let mut payload = request_vscode_extension_host(&host, request).await?;
    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let current_snapshot = current_vscode_extension_host_snapshot(state).await;
    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or(current_snapshot);
    snapshot.runtime = host.runtime.as_str().to_string();
    if !ok {
        snapshot.last_error = payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(snapshot.last_error);
        if snapshot.status == "idle" {
            snapshot.status = "error".to_string();
        }
    }

    let snapshot = update_vscode_extension_host_snapshot(state, snapshot).await;
    payload["snapshot"] = serde_json::to_value(snapshot).map_err(|error| error.to_string())?;
    Ok(payload)
}

#[tauri::command]
async fn desktop_start_vscode_extension_host(
    state: State<'_, VSCodeExtensionHostState>,
    preview_state: State<'_, DesktopPreviewState>,
    request: VSCodeExtensionHostStartRequest,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    let existing = {
        let mut guard = state.process.lock().await;
        guard.take()
    };
    if let Some(host) = existing {
        stop_managed_vscode_extension_host(host).await;
    }

    let extensions: Vec<VSCodeExtensionHostExtensionInput> = request
        .extensions
        .into_iter()
        .filter(|extension| {
            !extension.id.trim().is_empty()
                && !extension.path.trim().is_empty()
                && extension
                    .main
                    .as_deref()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false)
        })
        .collect();

    if extensions.is_empty() {
        let _ = set_extension_preview_roots(&preview_state, &[]);
        let snapshot = update_vscode_extension_host_snapshot(
            &state,
            unavailable_vscode_extension_host_snapshot(
                "No VS Code extensions with runnable desktop main entries were found.",
            ),
        )
        .await;
        return Ok(snapshot);
    }

    let Some((runtime_path, runtime_mode)) = resolve_vscode_extension_host_runtime() else {
        let _ = set_extension_preview_roots(&preview_state, &[]);
        let snapshot = update_vscode_extension_host_snapshot(
            &state,
            unavailable_vscode_extension_host_snapshot(
                "No Node-compatible runtime was found for the VS Code extension host.",
            ),
        )
        .await;
        return Ok(snapshot);
    };

    let start_request = VSCodeExtensionHostStartRequest {
        workspace_root_path: request.workspace_root_path.clone(),
        configuration: request.configuration.clone(),
        extensions,
    };
    set_extension_preview_roots(&preview_state, &start_request.extensions)?;
    let (script_path, config_path) =
        write_vscode_extension_host_artifacts(&start_request, runtime_mode)?;
    let mut command = Command::new(&runtime_path);
    configure_tokio_command(&mut command);
    command
        .arg(&script_path)
        .arg(&config_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if matches!(runtime_mode, VSCodeExtensionHostRuntime::CodeElectronNode) {
        command.env("ELECTRON_RUN_AS_NODE", "1");
    }
    if let Some(workspace_root) = request
        .workspace_root_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        command.current_dir(workspace_root);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let Some(stdin) = child.stdin.take() else {
        return Err("VS Code extension host stdin unavailable".to_string());
    };
    let Some(stdout) = child.stdout.take() else {
        return Err("VS Code extension host stdout unavailable".to_string());
    };
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[vscode-extension-host] {line}");
            }
        });
    }

    let mut bootstrap_lines = BufReader::new(stdout).lines();
    let bootstrap_line = tokio::time::timeout(
        Duration::from_millis(VSCODE_EXTENSION_HOST_COMMAND_TIMEOUT_MS),
        bootstrap_lines.next_line(),
    )
    .await
    .map_err(|_| "Timed out while starting the VS Code extension host".to_string())?
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "VS Code extension host exited before bootstrap".to_string())?;
    let bootstrap_payload: Value =
        serde_json::from_str(&bootstrap_line).map_err(|error| error.to_string())?;
    let bootstrap_ok = bootstrap_payload
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !bootstrap_ok {
        let message = bootstrap_payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("VS Code extension host failed to start")
            .to_string();
        let snapshot = update_vscode_extension_host_snapshot(
            &state,
            VSCodeExtensionHostSnapshot {
                status: "error".to_string(),
                runtime: runtime_mode.as_str().to_string(),
                last_error: Some(message.clone()),
                ..VSCodeExtensionHostSnapshot::default()
            },
        )
        .await;
        return Ok(snapshot);
    }

    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        bootstrap_payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or_default();
    snapshot.runtime = runtime_mode.as_str().to_string();
    snapshot.status = "ready".to_string();

    let managed = ManagedVSCodeExtensionHost {
        child: Arc::new(Mutex::new(child)),
        stdin: Arc::new(Mutex::new(stdin)),
        stdout: Arc::new(Mutex::new(bootstrap_lines)),
        request_lock: Arc::new(Mutex::new(())),
        runtime: runtime_mode,
        script_path,
        config_path,
    };

    {
        let mut guard = state.process.lock().await;
        *guard = Some(managed);
    }

    Ok(update_vscode_extension_host_snapshot(&state, snapshot).await)
}

#[tauri::command]
async fn desktop_stop_vscode_extension_host(
    state: State<'_, VSCodeExtensionHostState>,
    preview_state: State<'_, DesktopPreviewState>,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    let existing = {
        let mut guard = state.process.lock().await;
        guard.take()
    };
    if let Some(host) = existing {
        stop_managed_vscode_extension_host(host).await;
    }
    set_extension_preview_roots(&preview_state, &[])?;
    Ok(update_vscode_extension_host_snapshot(&state, VSCodeExtensionHostSnapshot::default()).await)
}

#[tauri::command]
async fn desktop_get_vscode_extension_host_snapshot(
    state: State<'_, VSCodeExtensionHostState>,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    Ok(current_vscode_extension_host_snapshot(&state).await)
}

#[tauri::command]
async fn desktop_activate_vscode_extension(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostActivateExtensionRequest,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    request_vscode_extension_host_snapshot_command(
        &state,
        json!({
            "type": "activate-extension",
            "extensionId": request.extension_id,
        }),
    )
    .await
}

#[tauri::command]
async fn desktop_activate_vscode_extension_view(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostViewRequest,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    let process = {
        let guard = state.process.lock().await;
        guard.as_ref().map(|host| ManagedVSCodeExtensionHost {
            child: Arc::clone(&host.child),
            stdin: Arc::clone(&host.stdin),
            stdout: Arc::clone(&host.stdout),
            request_lock: Arc::clone(&host.request_lock),
            runtime: host.runtime,
            script_path: host.script_path.clone(),
            config_path: host.config_path.clone(),
        })
    };

    let Some(host) = process else {
        return Ok(update_vscode_extension_host_snapshot(
            &state,
            unavailable_vscode_extension_host_snapshot("VS Code extension host is not running."),
        )
        .await);
    };

    let payload = request_vscode_extension_host(
        &host,
        json!({
            "type": "activate-view",
            "viewId": request.view_id,
        }),
    )
    .await?;

    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let current_snapshot = current_vscode_extension_host_snapshot(&state).await;
    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or(current_snapshot);
    snapshot.runtime = host.runtime.as_str().to_string();
    if !ok {
        snapshot.last_error = payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(snapshot.last_error);
    }

    Ok(update_vscode_extension_host_snapshot(&state, snapshot).await)
}

#[tauri::command]
async fn desktop_run_vscode_extension_command(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostCommandRequest,
) -> Result<Value, String> {
    request_vscode_extension_host_interactive_result(
        &state,
        json!({
            "type": "run-command",
            "commandId": request.command_id,
            "args": request.args.unwrap_or_default(),
        }),
    )
    .await
}

#[tauri::command]
async fn desktop_resolve_vscode_extension_interaction(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostInteractionResponseRequest,
) -> Result<Value, String> {
    request_vscode_extension_host_interactive_result(
        &state,
        json!({
            "type": "interaction-response",
            "interactionId": request.interaction_id,
            "cancelled": request.cancelled.unwrap_or(false),
            "selectedIds": request.selected_ids.unwrap_or_default(),
            "value": request.value,
        }),
    )
    .await
}

#[tauri::command]
async fn desktop_open_vscode_extension_document(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostOpenDocumentRequest,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    request_vscode_extension_host_snapshot_command(
        &state,
        json!({
            "type": "open-document",
            "filePath": request.file_path,
            "languageId": request.language_id,
            "content": request.content,
            "version": request.version,
        }),
    )
    .await
}

#[tauri::command]
async fn desktop_change_vscode_extension_document(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostDocumentSyncRequest,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    request_vscode_extension_host_snapshot_command(
        &state,
        json!({
            "type": "change-document",
            "filePath": request.file_path,
            "languageId": request.language_id,
            "content": request.content,
            "version": request.version,
        }),
    )
    .await
}

#[tauri::command]
async fn desktop_save_vscode_extension_document(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostDocumentSyncRequest,
) -> Result<VSCodeExtensionHostSnapshot, String> {
    request_vscode_extension_host_snapshot_command(
        &state,
        json!({
            "type": "save-document",
            "filePath": request.file_path,
            "languageId": request.language_id,
            "content": request.content,
            "version": request.version,
        }),
    )
    .await
}

#[tauri::command]
async fn desktop_request_vscode_extension_language_feature(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostLanguageFeatureRequest,
) -> Result<Value, String> {
    let Some(host) = clone_vscode_extension_host_process(&state).await else {
        return Err("VS Code extension host is not running.".to_string());
    };
    let payload = request_vscode_extension_host(
        &host,
        json!({
            "type": "language-feature",
            "feature": request.feature,
            "filePath": request.file_path,
            "languageId": request.language_id,
            "version": request.version,
            "position": request.position,
            "range": request.range,
            "triggerCharacter": request.trigger_character,
            "newName": request.new_name,
            "formattingOptions": request.formatting_options,
            "context": request.context,
        }),
    )
    .await?;
    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let current_snapshot = current_vscode_extension_host_snapshot(&state).await;
    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or(current_snapshot);
    snapshot.runtime = host.runtime.as_str().to_string();
    update_vscode_extension_host_snapshot(&state, snapshot).await;
    if !ok {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("VS Code language feature request failed.")
            .to_string());
    }
    let mut response = payload;
    if let Some(object) = response.as_object_mut() {
        object.remove("snapshot");
    }
    Ok(response)
}

#[tauri::command]
async fn desktop_resolve_vscode_extension_view(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostViewRequest,
) -> Result<VSCodeHostWebviewSnapshot, String> {
    let process = {
        let guard = state.process.lock().await;
        guard.as_ref().map(|host| ManagedVSCodeExtensionHost {
            child: Arc::clone(&host.child),
            stdin: Arc::clone(&host.stdin),
            stdout: Arc::clone(&host.stdout),
            request_lock: Arc::clone(&host.request_lock),
            runtime: host.runtime,
            script_path: host.script_path.clone(),
            config_path: host.config_path.clone(),
        })
    };

    let Some(host) = process else {
        let snapshot =
            unavailable_vscode_extension_host_snapshot("VS Code extension host is not running.");
        update_vscode_extension_host_snapshot(&state, snapshot).await;
        return Err("VS Code extension host is not running.".to_string());
    };

    let payload = request_vscode_extension_host(
        &host,
        json!({
            "type": "resolve-view",
            "viewId": request.view_id,
        }),
    )
    .await?;

    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let current_snapshot = current_vscode_extension_host_snapshot(&state).await;
    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or(current_snapshot);
    snapshot.runtime = host.runtime.as_str().to_string();
    if !ok {
        snapshot.last_error = payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(snapshot.last_error);
        update_vscode_extension_host_snapshot(&state, snapshot).await;
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("VS Code webview view failed to resolve.")
            .to_string());
    }

    update_vscode_extension_host_snapshot(&state, snapshot).await;
    serde_json::from_value(payload.get("webview").cloned().unwrap_or_else(|| json!({})))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_resolve_vscode_extension_tree(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostViewRequest,
) -> Result<VSCodeHostTreeSnapshot, String> {
    let process = {
        let guard = state.process.lock().await;
        guard.as_ref().map(|host| ManagedVSCodeExtensionHost {
            child: Arc::clone(&host.child),
            stdin: Arc::clone(&host.stdin),
            stdout: Arc::clone(&host.stdout),
            request_lock: Arc::clone(&host.request_lock),
            runtime: host.runtime,
            script_path: host.script_path.clone(),
            config_path: host.config_path.clone(),
        })
    };

    let Some(host) = process else {
        let snapshot =
            unavailable_vscode_extension_host_snapshot("VS Code extension host is not running.");
        update_vscode_extension_host_snapshot(&state, snapshot).await;
        return Err("VS Code extension host is not running.".to_string());
    };

    let payload = request_vscode_extension_host(
        &host,
        json!({
            "type": "resolve-tree",
            "viewId": request.view_id,
        }),
    )
    .await?;

    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let current_snapshot = current_vscode_extension_host_snapshot(&state).await;
    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or(current_snapshot);
    snapshot.runtime = host.runtime.as_str().to_string();
    if !ok {
        snapshot.last_error = payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(snapshot.last_error);
        update_vscode_extension_host_snapshot(&state, snapshot).await;
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("VS Code tree view failed to resolve.")
            .to_string());
    }

    update_vscode_extension_host_snapshot(&state, snapshot).await;
    serde_json::from_value(payload.get("tree").cloned().unwrap_or_else(|| json!({})))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_post_vscode_extension_view_message(
    state: State<'_, VSCodeExtensionHostState>,
    request: VSCodeExtensionHostViewMessageRequest,
) -> Result<VSCodeHostWebviewMessageResult, String> {
    let process = {
        let guard = state.process.lock().await;
        guard.as_ref().map(|host| ManagedVSCodeExtensionHost {
            child: Arc::clone(&host.child),
            stdin: Arc::clone(&host.stdin),
            stdout: Arc::clone(&host.stdout),
            request_lock: Arc::clone(&host.request_lock),
            runtime: host.runtime,
            script_path: host.script_path.clone(),
            config_path: host.config_path.clone(),
        })
    };

    let Some(host) = process else {
        let snapshot = update_vscode_extension_host_snapshot(
            &state,
            unavailable_vscode_extension_host_snapshot("VS Code extension host is not running."),
        )
        .await;
        return Ok(VSCodeHostWebviewMessageResult {
            view_id: request.view_id,
            messages: Vec::new(),
            snapshot,
        });
    };

    let payload = request_vscode_extension_host(
        &host,
        json!({
            "type": if request.drain_only.unwrap_or(false) { "drain-view-messages" } else { "post-view-message" },
            "viewId": request.view_id,
            "message": request.message,
        }),
    )
    .await?;

    let ok = payload.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let current_snapshot = current_vscode_extension_host_snapshot(&state).await;
    let mut snapshot: VSCodeExtensionHostSnapshot = serde_json::from_value(
        payload
            .get("snapshot")
            .cloned()
            .unwrap_or_else(|| json!({})),
    )
    .unwrap_or(current_snapshot);
    snapshot.runtime = host.runtime.as_str().to_string();
    if !ok {
        snapshot.last_error = payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(snapshot.last_error);
        if snapshot.status == "idle" {
            snapshot.status = "error".to_string();
        }
    }

    let snapshot = update_vscode_extension_host_snapshot(&state, snapshot).await;
    let webview_messages = payload
        .get("webviewMessages")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let view_id = webview_messages
        .get("viewId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let messages = serde_json::from_value(
        webview_messages
            .get("messages")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .unwrap_or_default();

    Ok(VSCodeHostWebviewMessageResult {
        view_id,
        messages,
        snapshot,
    })
}

#[tauri::command]
async fn desktop_typescript_diagnostics(
    app: AppHandle,
    state: State<'_, TypeScriptServiceState>,
    request: TypeScriptDiagnosticsRequest,
) -> Result<Vec<TypeScriptDiagnosticSnapshot>, String> {
    let service =
        ensure_typescript_service(&app, &state, request.workspace_root_path.as_deref()).await?;
    let payload = request_typescript_service(
        &service,
        json!({
            "type": "diagnostics",
            "filePath": request.file_path,
            "content": request.content,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("TypeScript diagnostics failed.")
            .to_string());
    }
    serde_json::from_value(
        payload
            .get("diagnostics")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_typescript_quick_info(
    app: AppHandle,
    state: State<'_, TypeScriptServiceState>,
    request: TypeScriptLanguageFeatureRequest,
) -> Result<Option<TypeScriptQuickInfoSnapshot>, String> {
    let service =
        ensure_typescript_service(&app, &state, request.workspace_root_path.as_deref()).await?;
    let payload = request_typescript_service(
        &service,
        json!({
            "type": "quickinfo",
            "filePath": request.file_path,
            "content": request.content,
            "offset": request.offset,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("TypeScript quick info failed.")
            .to_string());
    }
    serde_json::from_value(payload.get("quickInfo").cloned().unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_typescript_definition(
    app: AppHandle,
    state: State<'_, TypeScriptServiceState>,
    request: TypeScriptLanguageFeatureRequest,
) -> Result<Option<TypeScriptDefinitionSnapshot>, String> {
    let service =
        ensure_typescript_service(&app, &state, request.workspace_root_path.as_deref()).await?;
    let payload = request_typescript_service(
        &service,
        json!({
            "type": "definition",
            "filePath": request.file_path,
            "content": request.content,
            "offset": request.offset,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("TypeScript definition failed.")
            .to_string());
    }
    serde_json::from_value(payload.get("definition").cloned().unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_typescript_references(
    app: AppHandle,
    state: State<'_, TypeScriptServiceState>,
    request: TypeScriptLanguageFeatureRequest,
) -> Result<Vec<TypeScriptReferenceSnapshot>, String> {
    let service =
        ensure_typescript_service(&app, &state, request.workspace_root_path.as_deref()).await?;
    let payload = request_typescript_service(
        &service,
        json!({
            "type": "references",
            "filePath": request.file_path,
            "content": request.content,
            "offset": request.offset,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("TypeScript references failed.")
            .to_string());
    }
    serde_json::from_value(
        payload
            .get("references")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_python_diagnostics(
    state: State<'_, PythonAnalysisServiceState>,
    request: PythonDiagnosticsRequest,
) -> Result<Vec<PythonDiagnosticSnapshot>, String> {
    let service = ensure_python_analysis_service(&state, &request).await?;
    let payload = request_python_analysis_service(
        &service,
        json!({
            "type": "diagnostics",
            "filePath": request.file_path,
            "content": request.content,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Python diagnostics failed.")
            .to_string());
    }
    serde_json::from_value(
        payload
            .get("diagnostics")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_python_quick_info(
    state: State<'_, PythonAnalysisServiceState>,
    request: PythonLanguageFeatureRequest,
) -> Result<Option<PythonQuickInfoSnapshot>, String> {
    let diagnostics_request = PythonDiagnosticsRequest {
        workspace_root_path: request.workspace_root_path.clone(),
        python_path: request.python_path.clone(),
        file_path: request.file_path.clone(),
        content: request.content.clone(),
    };
    let service = ensure_python_analysis_service(&state, &diagnostics_request).await?;
    let payload = request_python_analysis_service(
        &service,
        json!({
            "type": "quickinfo",
            "filePath": request.file_path,
            "content": request.content,
            "offset": request.offset,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Python quick info failed.")
            .to_string());
    }
    serde_json::from_value(payload.get("quickInfo").cloned().unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_python_definition(
    state: State<'_, PythonAnalysisServiceState>,
    request: PythonLanguageFeatureRequest,
) -> Result<Option<PythonDefinitionSnapshot>, String> {
    let diagnostics_request = PythonDiagnosticsRequest {
        workspace_root_path: request.workspace_root_path.clone(),
        python_path: request.python_path.clone(),
        file_path: request.file_path.clone(),
        content: request.content.clone(),
    };
    let service = ensure_python_analysis_service(&state, &diagnostics_request).await?;
    let payload = request_python_analysis_service(
        &service,
        json!({
            "type": "definition",
            "filePath": request.file_path,
            "content": request.content,
            "offset": request.offset,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Python definition failed.")
            .to_string());
    }
    serde_json::from_value(payload.get("definition").cloned().unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_python_references(
    state: State<'_, PythonAnalysisServiceState>,
    request: PythonLanguageFeatureRequest,
) -> Result<Vec<PythonReferenceSnapshot>, String> {
    let diagnostics_request = PythonDiagnosticsRequest {
        workspace_root_path: request.workspace_root_path.clone(),
        python_path: request.python_path.clone(),
        file_path: request.file_path.clone(),
        content: request.content.clone(),
    };
    let service = ensure_python_analysis_service(&state, &diagnostics_request).await?;
    let payload = request_python_analysis_service(
        &service,
        json!({
            "type": "references",
            "filePath": request.file_path,
            "content": request.content,
            "offset": request.offset,
        }),
    )
    .await?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Python references failed.")
            .to_string());
    }
    serde_json::from_value(
        payload
            .get("references")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_rust_diagnostics(
    request: RustDiagnosticsRequest,
) -> Result<Vec<RustDiagnosticSnapshot>, String> {
    let feature_request = RustLanguageFeatureRequest {
        workspace_root_path: request.workspace_root_path,
        file_path: request.file_path,
        content: request.content,
        offset: 0,
    };
    let (runtime_path, runtime_mode) = resolve_vscode_extension_host_runtime()
        .ok_or_else(|| "No Node-compatible runtime was found for the Rust service.".to_string())?;
    let (script_path, request_path) =
        write_rust_language_feature_artifacts(&feature_request, "diagnostics")?;
    let mut command = Command::new(&runtime_path);
    configure_tokio_command(&mut command);
    command
        .arg(&script_path)
        .arg(&request_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if matches!(runtime_mode, VSCodeExtensionHostRuntime::CodeElectronNode) {
        command.env("ELECTRON_RUN_AS_NODE", "1");
    }
    let output = command.output().await.map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&request_path);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Rust diagnostics failed.".to_string()
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }
    let payload: Value = serde_json::from_str(&stdout).map_err(|error| error.to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Rust diagnostics failed.")
            .to_string());
    }
    serde_json::from_value(
        payload
            .get("diagnostics")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_rust_quick_info(
    request: RustLanguageFeatureRequest,
) -> Result<Option<RustQuickInfoSnapshot>, String> {
    let (runtime_path, runtime_mode) = resolve_vscode_extension_host_runtime()
        .ok_or_else(|| "No Node-compatible runtime was found for the Rust service.".to_string())?;
    let (script_path, request_path) = write_rust_language_feature_artifacts(&request, "quickinfo")?;
    let mut command = Command::new(&runtime_path);
    configure_tokio_command(&mut command);
    command
        .arg(&script_path)
        .arg(&request_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if matches!(runtime_mode, VSCodeExtensionHostRuntime::CodeElectronNode) {
        command.env("ELECTRON_RUN_AS_NODE", "1");
    }
    let output = command.output().await.map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&request_path);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Rust quick info failed.".to_string()
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(None);
    }
    let payload: Value = serde_json::from_str(&stdout).map_err(|error| error.to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Rust quick info failed.")
            .to_string());
    }
    serde_json::from_value(payload.get("quickInfo").cloned().unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_rust_definition(
    request: RustLanguageFeatureRequest,
) -> Result<Option<RustDefinitionSnapshot>, String> {
    let (runtime_path, runtime_mode) = resolve_vscode_extension_host_runtime()
        .ok_or_else(|| "No Node-compatible runtime was found for the Rust service.".to_string())?;
    let (script_path, request_path) =
        write_rust_language_feature_artifacts(&request, "definition")?;
    let mut command = Command::new(&runtime_path);
    configure_tokio_command(&mut command);
    command
        .arg(&script_path)
        .arg(&request_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if matches!(runtime_mode, VSCodeExtensionHostRuntime::CodeElectronNode) {
        command.env("ELECTRON_RUN_AS_NODE", "1");
    }
    let output = command.output().await.map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&request_path);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Rust definition failed.".to_string()
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(None);
    }
    let payload: Value = serde_json::from_str(&stdout).map_err(|error| error.to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Rust definition failed.")
            .to_string());
    }
    serde_json::from_value(payload.get("definition").cloned().unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_rust_references(
    request: RustLanguageFeatureRequest,
) -> Result<Vec<RustReferenceSnapshot>, String> {
    let (runtime_path, runtime_mode) = resolve_vscode_extension_host_runtime()
        .ok_or_else(|| "No Node-compatible runtime was found for the Rust service.".to_string())?;
    let (script_path, request_path) =
        write_rust_language_feature_artifacts(&request, "references")?;
    let mut command = Command::new(&runtime_path);
    configure_tokio_command(&mut command);
    command
        .arg(&script_path)
        .arg(&request_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if matches!(runtime_mode, VSCodeExtensionHostRuntime::CodeElectronNode) {
        command.env("ELECTRON_RUN_AS_NODE", "1");
    }
    let output = command.output().await.map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&request_path);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Rust references failed.".to_string()
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(Vec::new());
    }
    let payload: Value = serde_json::from_str(&stdout).map_err(|error| error.to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Rust references failed.")
            .to_string());
    }
    serde_json::from_value(
        payload
            .get("references")
            .cloned()
            .unwrap_or_else(|| json!([])),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_code_intelligence_status(
    app: AppHandle,
    workspace_root_path: Option<String>,
) -> Result<Vec<CodeIntelligenceProviderStatus>, String> {
    let typescript_status = match resolve_typescript_runtime_entry(&app) {
        Ok(path) => CodeIntelligenceProviderStatus {
            id: "typescript".to_string(),
            label: "TypeScript".to_string(),
            status: "ready".to_string(),
            detail: path.to_string_lossy().to_string(),
        },
        Err(message) => CodeIntelligenceProviderStatus {
            id: "typescript".to_string(),
            label: "TypeScript".to_string(),
            status: "unavailable".to_string(),
            detail: message,
        },
    };

    let python_status = match discover_python_environments(workspace_root_path.as_deref()) {
        Ok(environments) if !environments.is_empty() => CodeIntelligenceProviderStatus {
            id: "python".to_string(),
            label: "Python".to_string(),
            status: "ready".to_string(),
            detail: environments[0].path.clone(),
        },
        Ok(_) => CodeIntelligenceProviderStatus {
            id: "python".to_string(),
            label: "Python".to_string(),
            status: "unavailable".to_string(),
            detail: "No local Python interpreter detected.".to_string(),
        },
        Err(message) => CodeIntelligenceProviderStatus {
            id: "python".to_string(),
            label: "Python".to_string(),
            status: "error".to_string(),
            detail: message,
        },
    };

    let rust_status = if let Some(path) = resolve_command_path("rustc") {
        CodeIntelligenceProviderStatus {
            id: "rust".to_string(),
            label: "Rust".to_string(),
            status: "ready".to_string(),
            detail: path,
        }
    } else {
        CodeIntelligenceProviderStatus {
            id: "rust".to_string(),
            label: "Rust".to_string(),
            status: "unavailable".to_string(),
            detail: "Rust compiler not found on PATH.".to_string(),
        }
    };

    Ok(vec![typescript_status, python_status, rust_status])
}

mod diagnostics_profile;

fn main() {
    let mut context = tauri::generate_context!();
    let profile = match env::var("LATTICE_DIAGNOSTICS_PROFILE") {
        Ok(value) => Some(value),
        Err(env::VarError::NotPresent) => None,
        Err(error) => {
            eprintln!("Invalid LATTICE_DIAGNOSTICS_PROFILE: {error}");
            std::process::exit(1);
        }
    };
    context.config_mut().identifier = diagnostics_profile::diagnostics_identifier(
        &context.config().identifier,
        profile.as_deref(),
    )
    .unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
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
        .manage(workspace_watch::WorkspaceWatchState::default())
        .manage(drop_import::DropImportState::default())
        .manage(formula_ocr_runtime::FormulaOcrRuntimeState::default())
        .manage(ExecutionSessions::default())
        .manage(PythonSessions::default())
        .manage(PythonAnalysisServiceState::default())
        .manage(VSCodeExtensionHostState::default())
        .manage(vscode_workbench::VSCodeWorkbenchState::default())
        .manage(TypeScriptServiceState::default())
        .manage(AiHttpStreamState::default())
        .manage(debug_adapter::DebugAdapterState::default())
        .manage(agent_harness::AgentHarnessState::default())
        .invoke_handler(tauri::generate_handler![
            formula_ocr_runtime::formula_ocr_runtime_status,
            formula_ocr_runtime::formula_ocr_runtime_install,
            formula_ocr_runtime::formula_ocr_runtime_cancel,
            formula_ocr_runtime::formula_ocr_runtime_recognize,
            agent_harness::agent_harness_probe,
            agent_harness::agent_harness_catalog,
            agent_harness::agent_harness_connect,
            agent_harness::agent_harness_start,
            agent_harness::agent_harness_resume,
            agent_harness::agent_harness_turn,
            agent_harness::agent_harness_interrupt,
            agent_harness::agent_harness_approval,
            agent_harness::agent_harness_drain_events,
            agent_harness::agent_harness_disconnect,
            agent_harness::agent_harness_tool_result,
            agent_harness::agent_harness_read_scratch,
            get_setting,
            set_setting,
            remove_setting,
            clear_settings,
            shared_library_secure_get,
            shared_library_secure_set,
            shared_library_secure_remove,
            shared_library_queue_load,
            shared_library_queue_save,
            get_default_folder,
            set_default_folder,
            get_last_opened_folder,
            set_last_opened_folder,
            set_last_workspace_path,
            resolve_startup_workspace,
            clear_default_folder,
            desktop_read_dir,
            workspace_watch::desktop_watch_workspace,
            workspace_watch::desktop_unwatch_workspace,
            desktop_read_file_bytes_raw,
            desktop_read_text_file,
            desktop_read_text_file_chunk,
            desktop_write_file_bytes,
            drop_import::desktop_begin_drop_import,
            drop_import::desktop_write_drop_import,
            drop_import::desktop_commit_drop_import,
            drop_import::desktop_abort_drop_import,
            desktop_copy_path,
            desktop_move_path,
            desktop_rename_path,
            desktop_exists_path,
            desktop_file_metadata,
            desktop_is_directory,
            desktop_discover_vscode_profiles,
            desktop_get_source_control_status,
            desktop_get_source_control_diff,
            desktop_stage_source_control_paths,
            desktop_unstage_source_control_paths,
            desktop_stage_all_source_control_changes,
            desktop_unstage_all_source_control_changes,
            desktop_commit_source_control_changes,
            desktop_start_python_debug_session,
            desktop_start_node_debug_session,
            desktop_get_debug_session_status,
            desktop_set_debug_breakpoints,
            desktop_continue_debug_session,
            desktop_pause_debug_session,
            desktop_step_over_debug_session,
            desktop_step_into_debug_session,
            desktop_step_out_debug_session,
            desktop_restart_debug_session,
            desktop_stop_debug_session,
            desktop_get_debug_threads,
            desktop_get_debug_stack_trace,
            desktop_get_debug_scopes,
            desktop_get_debug_variables,
            desktop_evaluate_debug_expression,
            fetch_web_document,
            ai_native_http_request,
            ai_native_http_stream_start,
            ai_native_http_stream_cancel,
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
            desktop_open_in_vscode,
            desktop_start_vscode_extension_host,
            desktop_stop_vscode_extension_host,
            desktop_get_vscode_extension_host_snapshot,
            desktop_activate_vscode_extension,
            desktop_activate_vscode_extension_view,
            desktop_run_vscode_extension_command,
            desktop_resolve_vscode_extension_interaction,
            desktop_open_vscode_extension_document,
            desktop_change_vscode_extension_document,
            desktop_save_vscode_extension_document,
            desktop_request_vscode_extension_language_feature,
            desktop_resolve_vscode_extension_view,
            desktop_resolve_vscode_extension_tree,
            desktop_post_vscode_extension_view_message,
            vscode_workbench::desktop_start_vscode_workbench,
            vscode_workbench::desktop_get_vscode_workbench_status,
            vscode_workbench::desktop_open_vscode_workbench_resource,
            vscode_workbench::desktop_run_vscode_workbench_action,
            vscode_workbench::desktop_stop_vscode_workbench,
            desktop_typescript_diagnostics,
            desktop_typescript_quick_info,
            desktop_typescript_definition,
            desktop_typescript_references,
            desktop_python_diagnostics,
            desktop_python_quick_info,
            desktop_python_definition,
            desktop_python_references,
            desktop_rust_diagnostics,
            desktop_rust_quick_info,
            desktop_rust_definition,
            desktop_rust_references,
            desktop_code_intelligence_status,
            desktop_extract_pdf_page_text_layout,
            desktop_ocr_pdf_page_text_layout,
        ])
        .setup(|app| {
            let main_window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or_else(|| "Main window configuration is missing".to_string())?;
            let window = WebviewWindowBuilder::from_config(app, main_window_config)?.build()?;
            webview_failure::install(&window)?;
            #[cfg(target_os = "windows")]
            {
                let _ = window.set_decorations(false);
            }
            let _ = window.maximize();
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<workspace_watch::WorkspaceWatchState>().stop_window(window.label());
                window.state::<drop_import::DropImportState>().stop_window(window.label());
                window.state::<formula_ocr_runtime::FormulaOcrRuntimeState>().stop_window(window.label());
                if window.label() == "main" {
                    agent_harness::shutdown_all_blocking(&window.state::<agent_harness::AgentHarnessState>());
                }
                window.state::<AiHttpStreamState>().cancel_window(window.label());
                let state = window.state::<vscode_workbench::VSCodeWorkbenchState>();
                vscode_workbench::terminate_owned_process(&state);
                stop_vscode_extension_host_on_window_destroyed(window.app_handle());
            }
        })
        .run(context)
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
        RunnerType::CompiledNative => {
            Err("compiled-native is handled by the compile-run pipeline".to_string())
        }
        RunnerType::PythonPyodide => {
            Err("python-pyodide is not executable via Tauri backend".to_string())
        }
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
        return Err(availability
            .error
            .unwrap_or_else(|| format!("Command not available: {command_name}")));
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
    let python = if let Some(command) = request
        .command
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
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
        try_register_python_program(&mut results, &mut seen_paths, program, prefix_args, source);
    }

    results.sort_by(|left, right| match (&left.env_type, &right.env_type) {
        (PythonEnvironmentType::Venv, PythonEnvironmentType::System) => std::cmp::Ordering::Less,
        (PythonEnvironmentType::Conda, PythonEnvironmentType::System) => std::cmp::Ordering::Less,
        (PythonEnvironmentType::System, PythonEnvironmentType::Venv) => std::cmp::Ordering::Greater,
        (PythonEnvironmentType::System, PythonEnvironmentType::Conda) => {
            std::cmp::Ordering::Greater
        }
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
    probe_python_command(
        python_path.as_os_str().to_string_lossy().as_ref(),
        &[],
        source,
    )
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
    let env_type =
        classify_python_environment(&path, probe.prefix.as_deref(), probe.base_prefix.as_deref());
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

    if lowercase.contains(".venv")
        || prefix
            .zip(base_prefix)
            .map(|(left, right)| left != right)
            .unwrap_or(false)
    {
        return PythonEnvironmentType::Venv;
    }

    if lowercase.contains("conda")
        || lowercase.contains("miniconda")
        || lowercase.contains("anaconda")
    {
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
    probe_command_with_options(command, true)
}

fn probe_command_with_options(command: &str, include_version: bool) -> CommandAvailability {
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

    let version = if include_version { {
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
    .filter(|value| !value.is_empty()) } else { None };

    CommandAvailability {
        command: command.to_string(),
        available: true,
        resolved_path: Some(path),
        version,
        error: None,
    }
}

fn resolve_command_path(command: &str) -> Option<String> {
    let requested_path = Path::new(command);
    if (requested_path.is_absolute() || command.contains('/') || command.contains('\\'))
        && requested_path.is_file()
    {
        return Some(requested_path.to_string_lossy().into_owned());
    }
    let tool = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
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

pub(crate) fn configure_tokio_command(command: &mut Command) {
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
    fn native_webview_poll_does_not_replace_a_newer_redirect_callback() {
        let navigation_event = DesktopNativeWebviewSnapshot {
            label: "webview".to_string(),
            current_url: "http://127.0.0.1/final".to_string(),
            title: Some("Final page".to_string()),
            status: "ready".to_string(),
            last_error: None,
        };
        let state = desktop_native_webview_snapshot_after_poll(
            Some(navigation_event.clone()),
            "http://127.0.0.1/redirect".to_string(),
            "webview",
        );

        assert_eq!(state.current_url, "http://127.0.0.1/final");
        assert_eq!(state.title.as_deref(), Some("Final page"));
        assert_eq!(state.status, "ready");

        let initial = desktop_native_webview_snapshot_after_poll(
            None,
            "http://127.0.0.1/initial".to_string(),
            "webview",
        );
        assert_eq!(initial.current_url, "http://127.0.0.1/initial");
        assert_eq!(initial.label, "webview");
    }

    #[test]
    fn native_webview_finished_page_load_records_redirect_destination() {
        let navigation_event = DesktopNativeWebviewSnapshot {
            label: "webview".to_string(),
            current_url: "http://127.0.0.1/redirect".to_string(),
            title: None,
            status: "mounting".to_string(),
            last_error: None,
        };
        let state = desktop_native_webview_snapshot_after_page_load(
            Some(navigation_event),
            "http://127.0.0.1/final".to_string(),
            "webview",
        );
        assert_eq!(state.current_url, "http://127.0.0.1/final");
        assert_eq!(state.status, "ready");
        assert_eq!(desktop_native_webview_url_or_fallback(
            "http://127.0.0.1/final", "http://127.0.0.1/redirect"), "http://127.0.0.1/final");
        assert_eq!(desktop_native_webview_url_or_fallback(
            "javascript:alert(1)", "http://127.0.0.1/redirect"), "http://127.0.0.1/redirect");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn command_availability_can_check_ocr_path_without_launching_it() {
        let directory = tempfile::tempdir().expect("create OCR probe fixture");
        let marker = directory.path().join("launched.txt");
        let executable = directory.path().join("synthetic-ocr.cmd");
        fs::write(&executable, format!(
            "@echo off\r\necho launched>\"{}\"\r\necho synthetic-ocr-1.0\r\n",
            marker.display()
        )).expect("write OCR probe fixture");
        let availability = probe_command_availability(
            executable.to_string_lossy().into_owned(), Some(false)
        ).expect("check OCR path");
        assert!(availability.available);
        assert!(availability.resolved_path.is_some());
        assert!(availability.version.is_none());
        assert!(!marker.exists(), "path-only discovery must never start the OCR command");

        let normal = probe_command_availability(
            executable.to_string_lossy().into_owned(), None
        ).expect("check legacy version discovery");
        assert!(normal.version.as_deref().unwrap_or_default().contains("synthetic-ocr-1.0"));
        assert!(marker.exists(), "the control fixture must execute in legacy version mode");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn vscode_shell_script_detection_handles_command_shims() {
        assert!(is_windows_shell_script(Path::new(
            "C:/Users/test/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd"
        )));
        assert!(is_windows_shell_script(Path::new("C:/tools/code.bat")));
        assert!(!is_windows_shell_script(Path::new(
            "C:/Users/test/AppData/Local/Programs/Microsoft VS Code/Code.exe"
        )));
    }

    #[test]
    fn vscode_extension_host_script_exposes_view_registration_bridge() {
        let script = vscode_extension_host_script();
        assert!(script.contains("registerTreeDataProvider(viewId, treeDataProvider)"));
        assert!(script.contains("createTreeView(viewId, options = {})"));
        assert!(script.contains("registerWebviewViewProvider(viewId, provider)"));
        assert!(script.contains("request.type === \"activate-view\""));
        assert!(script.contains("container: meta.container"));
        assert!(script.contains("createWebviewPanel(viewType, title)"));
        assert!(script.contains("registerWebviewPanelSerializer(viewType, serializer)"));
        assert!(script.contains("registerUriHandler(handler)"));
        assert!(script.contains("registerTerminalLinkProvider()"));
        assert!(script.contains("uriHandlerRegistry"));
        assert!(script.contains("webview-panel:"));
        assert!(script.contains("TreeItemCollapsibleState"));
        assert!(script.contains("resolveRegisteredTree"));
        assert!(script.contains("request.type === \"resolve-tree\""));
        assert!(script.contains("function extensionHandlesActivationEvent(extension, event)"));
        assert!(script.contains("asArray(contributes.languages)"));
        assert!(script.contains("asArray(contributes.notebooks)"));
        assert!(script.contains("createStatusBarItem()"));
        assert!(script.contains("createTextEditorDecorationType(options = {})"));
        assert!(script.contains("withProgress(_options, task)"));
        assert!(script.contains("class CancellationTokenSource"));
        assert!(script.contains("CancellationTokenSource,"));
        assert!(script.contains("class CancellationError extends Error"));
        assert!(script.contains("function createUri(parts)"));
        assert!(script.contains("with(change = {})"));
        assert!(script.contains("isKnownViewFocusCommand(commandId)"));
        assert!(script.contains("require.resolve(entryPath)"));
        assert!(script.contains("findCurrentExtensionPath(extension)"));
        assert!(script.contains("refreshExtensionMetadata(extension)"));
        assert!(script.contains("packageJson.main"));
        assert!(script.contains("LogLevel"));
        assert!(script.contains("const UIKind"));
        assert!(script.contains("uiKind: UIKind.Desktop"));
        assert!(script.contains("class FileSystemError extends Error"));
        assert!(script.contains("static FileNotFound(uri)"));
        assert!(script.contains("class CodeLens"));
        assert!(script.contains("class CodeAction"));
        assert!(script.contains("class CallHierarchyItem"));
        assert!(script.contains("class TypeHierarchyItem"));
        assert!(script.contains("class SymbolInformation"));
        assert!(script.contains("class Location"));
        assert!(script.contains("class CompletionItem"));
        assert!(script.contains("class DocumentLink"));
        assert!(script.contains("class InlayHint"));
        assert!(script.contains("NotebookCellKind"));
        assert!(
            script.contains("createNotebookController(id, notebookType, label, executeHandler)")
        );
        assert!(script.contains("createNotebookControllerDetectionTask(handler)"));
        assert!(script.contains("registerKernelSourceActionProvider()"));
        assert!(script.contains("createRendererMessaging"));
        assert!(script.contains("extension event listener failed"));
        assert!(script.contains("result.catch"));
        assert!(script.contains("DebugConfigurationProviderTriggerKind"));
        assert!(script.contains("readWorkspaceFile"));
        assert!(script.contains("package.nls.json"));
        assert!(script.contains("registerPortAttributesProvider()"));
        assert!(script.contains("registerDebugVisualizationTreeProvider()"));
        assert!(script.contains("registerDebugVisualizationProvider()"));
        assert!(script.contains("onDidChangeActiveTerminal"));
        assert!(script.contains("onDidDeleteFiles(listener)"));
        assert!(script.contains("onDidCreateFiles(listener)"));
        assert!(script.contains("onDidRenameFiles(listener)"));
        assert!(script.contains("extension activation failed"));
        assert!(script.contains("activateExtensionsForDocument(document)"));
        assert!(script.contains("onLanguage:${languageId}"));
        assert!(script.contains("onNotebook:jupyter-notebook"));
        assert!(script.contains("request.type === \"open-document\""));
        assert!(script.contains("l10n:"));
        assert!(script.contains("t(message, ...args)"));
        assert!(script.contains("authentication:"));
        assert!(script.contains("clipboard:"));
        assert!(script.contains("openExternal()"));
        assert!(script.contains("createTelemetryLogger()"));
        assert!(script.contains("languages:"));
        assert!(script.contains("IndentAction"));
        assert!(script.contains("onDidChangeDiagnostics"));
        assert!(script.contains("openNotebookDocuments"));
        assert!(script.contains("createNotebookDocument(fsPath, content = \"\")"));
        assert!(script.contains("notebookDocuments"));
        assert!(script.contains("onDidOpenNotebookDocument(listener)"));
        assert!(script.contains("onDidChangeTextDocument(listener)"));
        assert!(script.contains("onDidChangeNotebookDocument(listener)"));
        assert!(script.contains("onDidSaveNotebookDocument(listener)"));
        assert!(script.contains("onDidCloseNotebookDocument(listener)"));
        assert!(script.contains("activeNotebookEditor"));
        assert!(script.contains("onDidChangeActiveNotebookEditor"));
        assert!(script.contains("onDidChangeVisibleNotebookEditors"));
        assert!(script.contains("registerCompletionItemProvider()"));
        assert!(script.contains("debug:"));
        assert!(script.contains("registerDebugConfigurationProvider()"));
        assert!(script.contains("tasks:"));
        assert!(script.contains("registerTaskProvider()"));
        assert!(script.contains("tests:"));
        assert!(script.contains("createTestController(id, label)"));
        assert!(script.contains("TestRunProfileKind"));
        assert!(script.contains("onDidGrantWorkspaceTrust"));
        assert!(script.contains("createTerminal(optionsOrName, shellPath, shellArgs)"));
        assert!(script.contains("onDidOpenTerminal"));
        assert!(script.contains("onDidStartTerminalShellExecution"));
        assert!(script.contains("childProcess.spawn"));
        assert!(script.contains("createSecretStorage(extensionId)"));
        assert!(script.contains("secrets: createSecretStorage(extension.id)"));
        assert!(script.contains("onDidChange: extensionChangeEmitter.event"));
        assert!(script.contains("process.on(\"unhandledRejection\""));
        assert!(script.contains("resolveRegisteredView(viewId)"));
        assert!(script.contains("request.type === \"resolve-view\""));
        assert!(script.contains("postRegisteredViewMessage"));
        assert!(script.contains("request.type === \"post-view-message\""));
        assert!(script.contains("drainRegisteredViewMessages"));
        assert!(script.contains("request.type === \"drain-view-messages\""));
        assert!(script.contains("window.acquireVsCodeApi"));
        assert!(script.contains("lattice-webview-resource"));
        assert!(script.contains("require(\"fs\").statSync(resourcePath).isDirectory()"));
        assert!(script.contains("${encodeURIComponent(resourcePath)}${directorySuffix}"));
        assert!(script.contains("viewRegistry"));
    }

    #[test]
    fn vscode_extension_host_keeps_extension_output_out_of_the_protocol_stream() {
        let script = vscode_extension_host_script();

        assert!(script
            .contains("const protocolStdoutWrite = process.stdout.write.bind(process.stdout);"));
        assert!(
            script.contains("process.stdout.write = (...args) => process.stderr.write(...args);")
        );
        assert!(script.contains("protocolStdoutWrite(JSON.stringify(message) + \"\\n\");"));
        assert!(script.contains("if (!isPriorityCodingAgentExtension(extension)) {"));
        assert!(script.contains(
            "const startupExtensions = extensions.filter(isEagerActivationCandidate).slice(0, 3);"
        ));
    }

    #[test]
    fn vscode_extension_host_exposes_lattice_interaction_bridge() {
        let script = vscode_extension_host_script();

        assert!(script.contains("function requestInteraction(interaction)"));
        assert!(script.contains("showQuickPick(itemsOrPromise, options = {})"));
        assert!(script.contains("showInputBox(options = {})"));
        assert!(script.contains("createQuickPick()"));
        assert!(script.contains("request.type === \"interaction-response\""));
        assert!(script.contains("const parentPid = Number(config.parentPid)"));
        assert!(script.contains("process.kill(parentPid, 0)"));
    }

    #[test]
    fn vscode_extension_host_completes_a_real_quick_pick_command() {
        use std::io::{BufRead, BufReader, Write};
        use std::sync::mpsc;

        let temp_dir = tempfile::tempdir().expect("create extension host fixture directory");
        let extension_dir = temp_dir.path().join("fixture-extension");
        fs::create_dir_all(&extension_dir).expect("create fixture extension directory");
        let script_path = temp_dir.path().join("host.cjs");
        let config_path = temp_dir.path().join("host-config.json");
        fs::write(&script_path, vscode_extension_host_script())
            .expect("write extension host script");
        fs::write(
            extension_dir.join("extension.js"),
            r#"const vscode = require("vscode");
exports.activate = (context) => {
  context.subscriptions.push(vscode.commands.registerCommand("fixture.choose", async () => {
    const selected = await vscode.window.showQuickPick(
      [{ label: "First" }, { label: "Second" }],
      { title: "Choose a fixture" }
    );
    if (selected && selected.label === "Second") {
      context.subscriptions.push(vscode.commands.registerCommand("fixture.selected", () => true));
    }
  }));
};
"#,
        )
        .expect("write fixture extension");
        fs::write(
            &config_path,
            serde_json::to_vec(&json!({
                "runtime": "node",
                "workspaceRootPath": temp_dir.path(),
                "configuration": {},
                "extensions": [{
                    "id": "fixture.quickpick",
                    "path": extension_dir,
                    "main": "extension.js",
                    "displayName": "QuickPick Fixture",
                    "packageJSON": {
                        "publisher": "fixture",
                        "name": "quickpick",
                        "main": "extension.js",
                        "activationEvents": ["onCommand:fixture.choose"],
                        "contributes": {
                            "commands": [{ "command": "fixture.choose", "title": "Choose Fixture" }]
                        }
                    },
                    "activationEvents": ["onCommand:fixture.choose"],
                    "commandItems": [{ "command": "fixture.choose", "title": "Choose Fixture" }],
                    "viewItems": []
                }]
            }))
            .expect("serialize extension host fixture config"),
        )
        .expect("write extension host fixture config");

        let mut child = StdCommand::new("node")
            .arg(&script_path)
            .arg(&config_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("start Node extension host fixture");
        let mut stdin = child.stdin.take().expect("extension host stdin");
        let stdout = child.stdout.take().expect("extension host stdout");
        let (line_tx, line_rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if line_tx.send(line).is_err() {
                    break;
                }
            }
        });

        let read_message = || -> Value {
            let line = line_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("extension host protocol response timed out")
                .expect("read extension host protocol response");
            serde_json::from_str(&line).expect("parse extension host protocol response")
        };
        let mut send_message = |message: Value| {
            writeln!(stdin, "{}", message).expect("write extension host protocol request");
            stdin
                .flush()
                .expect("flush extension host protocol request");
        };

        let startup = read_message();
        assert_eq!(startup.get("ok").and_then(Value::as_bool), Some(true));
        send_message(json!({ "type": "run-command", "commandId": "fixture.choose", "args": [] }));
        let interaction = read_message();
        assert_eq!(
            interaction
                .pointer("/interaction/type")
                .and_then(Value::as_str),
            Some("quickPick")
        );
        let interaction_id = interaction
            .pointer("/interaction/id")
            .and_then(Value::as_str)
            .expect("QuickPick interaction id")
            .to_string();
        send_message(json!({
            "type": "interaction-response",
            "interactionId": interaction_id,
            "cancelled": false,
            "selectedIds": ["item-1"]
        }));
        let completion = read_message();
        let registered_selected_command = completion
            .pointer("/snapshot/commands")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|command| command.get("id").and_then(Value::as_str) == Some("fixture.selected"));

        let _ = child.kill();
        let _ = child.wait();
        assert!(registered_selected_command);
    }

    #[test]
    fn vscode_extension_host_does_not_publish_unsupported_notebook_editor_events() {
        let script = vscode_extension_host_script();
        let open_document = script
            .split("async function openDocumentFromHostRequest(request) {")
            .nth(1)
            .expect("open document handler should exist")
            .split("async function changeDocumentFromHostRequest(request) {")
            .next()
            .expect("open document handler should have an end boundary");
        assert!(open_document.contains("setImmediate(() =>"));
        assert!(open_document.contains("void activateExtensionsForDocument(document)"));
        assert!(!open_document.contains("await activateExtensionsForDocument(document);"));
        assert!(!open_document.contains("activeNotebookEditorEmitter.fire("));
        assert!(!open_document.contains("visibleNotebookEditorsEmitter.fire("));
    }

    #[test]
    fn vscode_extension_host_activates_matching_language_extensions_on_demand() {
        let script = vscode_extension_host_script();
        let document_activation = script
            .split("async function activateExtensionsForDocument(document) {")
            .nth(1)
            .expect("document activation helper should exist");

        assert!(document_activation
            .contains("await activateExtensionsForEventOnce(`onLanguage:${languageId}`);"));
        assert!(document_activation
            .contains("await activateExtensionsForEventOnce(\"onNotebook:jupyter-notebook\");"));
    }

    #[test]
    fn vscode_extension_host_exposes_real_language_provider_requests() {
        let script = vscode_extension_host_script();

        assert!(script.contains("function registerLanguageProvider(feature, argsLike)"));
        assert!(script.contains("function documentMatchesSelector(document, selector)"));
        assert!(script.contains("async function requestLanguageFeature(request)"));
        assert!(script.contains("provideCompletionItems"));
        assert!(script.contains("provideHover"));
        assert!(script.contains("provideDefinition"));
        assert!(script.contains("LANGUAGE_PROVIDER_TIMEOUT_MS"));
        assert!(script.contains("request.type === \"language-feature\""));
    }

    #[test]
    fn vscode_extension_host_synchronizes_document_versions_and_events() {
        let script = vscode_extension_host_script();

        assert!(script.contains("async function changeDocumentFromHostRequest(request)"));
        assert!(script.contains("async function saveDocumentFromHostRequest(request)"));
        assert!(script.contains("document.version = normalizeDocumentVersion(request.version)"));
        assert!(script.contains("request.type === \"change-document\""));
        assert!(script.contains("request.type === \"save-document\""));
    }

    #[test]
    fn vscode_extension_host_language_provider_fixture_runs_end_to_end() {
        use std::io::{BufRead, BufReader, Write};
        use std::process::{Command as StdCommand, Stdio as StdStdio};

        if StdCommand::new("node").arg("--version").output().is_err() {
            eprintln!("skipping real extension-host fixture because Node.js is unavailable");
            return;
        }

        let fixture_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/vscode-language-provider-extension");
        let workspace_root = fixture_root.join("workspace");
        let document_path = workspace_root.join("demo.ts");
        let document_text =
            fs::read_to_string(&document_path).expect("fixture document should load");
        let temp_root = env::temp_dir().join(format!(
            "lattice-vscode-language-provider-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_root).expect("temporary extension host directory should exist");
        let script_path = temp_root.join("host.cjs");
        let config_path = temp_root.join("config.json");
        fs::write(&script_path, vscode_extension_host_script())
            .expect("extension host script should be written");
        let package_json: Value = serde_json::from_str(
            &fs::read_to_string(fixture_root.join("package.json"))
                .expect("fixture package should load"),
        )
        .expect("fixture package should parse");
        fs::write(
            &config_path,
            serde_json::to_vec(&json!({
                "workspaceRootPath": workspace_root,
                "configuration": {},
                "runtime": "node",
                "extensions": [{
                    "id": "lattice-tests.lattice-language-provider-fixture",
                    "path": fixture_root,
                    "main": "./extension.js",
                    "displayName": "Lattice Language Provider Fixture",
                    "packageJSON": package_json,
                    "activationEvents": ["onLanguage:typescript"],
                    "commandItems": [],
                    "viewItems": []
                }]
            }))
            .expect("extension host config should serialize"),
        )
        .expect("extension host config should be written");

        let mut command = StdCommand::new("node");
        command
            .arg(&script_path)
            .arg(&config_path)
            .stdin(StdStdio::piped())
            .stdout(StdStdio::piped())
            .stderr(StdStdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW_FLAG);
        }
        let mut child = command
            .spawn()
            .expect("extension host fixture should start");
        let mut stdin = child
            .stdin
            .take()
            .expect("extension host stdin should exist");
        let mut stdout = BufReader::new(
            child
                .stdout
                .take()
                .expect("extension host stdout should exist"),
        );
        let mut read_response = || {
            let mut line = String::new();
            stdout
                .read_line(&mut line)
                .expect("extension host response should be readable");
            serde_json::from_str::<Value>(&line).expect("extension host response should be JSON")
        };
        let mut send_request = |request: Value| {
            writeln!(
                stdin,
                "{}",
                serde_json::to_string(&request).expect("request should serialize")
            )
            .expect("extension host request should write");
            stdin.flush().expect("extension host request should flush");
        };

        assert_eq!(read_response()["ok"], true);
        send_request(json!({
            "type": "open-document",
            "filePath": document_path,
            "languageId": "typescript",
            "content": document_text,
            "version": 1
        }));
        assert_eq!(read_response()["ok"], true);

        send_request(json!({
            "type": "language-feature",
            "feature": "completion",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1,
            "position": { "line": 1, "character": 7 },
            "triggerCharacter": "."
        }));
        let completion = read_response();
        assert_eq!(completion["results"][0]["label"], "fixtureAnswer");
        assert_eq!(completion["providers"][0]["status"], "ok");

        send_request(json!({
            "type": "language-feature",
            "feature": "hover",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1,
            "position": { "line": 0, "character": 8 }
        }));
        assert_eq!(
            read_response()["results"][0]["contents"][0],
            "Lattice fixture hover"
        );

        send_request(json!({
            "type": "language-feature",
            "feature": "definition",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1,
            "position": { "line": 1, "character": 2 }
        }));
        assert!(read_response()["results"][0]["filePath"]
            .as_str()
            .unwrap_or_default()
            .ends_with("demo.ts"));

        send_request(json!({
            "type": "language-feature",
            "feature": "references",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1,
            "position": { "line": 1, "character": 2 }
        }));
        assert_eq!(read_response()["results"][0]["range"]["start"]["line"], 1);

        send_request(json!({
            "type": "language-feature",
            "feature": "formatting",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1,
            "formattingOptions": { "tabSize": 2, "insertSpaces": true }
        }));
        assert_eq!(read_response()["results"][0]["newText"], " = 42");

        send_request(json!({
            "type": "language-feature",
            "feature": "rename",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1,
            "position": { "line": 0, "character": 8 },
            "newName": "result"
        }));
        let rename = read_response();
        assert_eq!(
            rename["results"][0]["changes"][0]["edits"]
                .as_array()
                .map(Vec::len),
            Some(2)
        );

        send_request(json!({
            "type": "language-feature",
            "feature": "codeAction",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1,
            "range": {
                "start": { "line": 0, "character": 6 },
                "end": { "line": 0, "character": 12 }
            },
            "context": { "diagnostics": [], "only": "quickfix", "triggerKind": 1 }
        }));
        let code_action = read_response();
        assert_eq!(code_action["results"][0]["title"], "Use result");
        assert_eq!(
            code_action["results"][0]["command"]["command"],
            "fixture.afterFix"
        );

        send_request(json!({
            "type": "language-feature",
            "feature": "diagnostics",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 1
        }));
        assert_eq!(
            read_response()["results"][0]["message"],
            "fixture-version-1"
        );

        send_request(json!({
            "type": "change-document",
            "filePath": document_path,
            "languageId": "typescript",
            "content": "const answer = 43;\nanswer.toString();\n",
            "version": 2
        }));
        assert_eq!(read_response()["ok"], true);
        send_request(json!({
            "type": "language-feature",
            "feature": "diagnostics",
            "filePath": document_path,
            "languageId": "typescript",
            "version": 2
        }));
        assert_eq!(
            read_response()["results"][0]["message"],
            "fixture-version-2"
        );

        send_request(json!({ "type": "shutdown" }));
        assert_eq!(read_response()["ok"], true);
        let _ = child.wait();
        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn vscode_extension_host_webview_snapshot_deserializes() {
        let webview = serde_json::from_value::<VSCodeHostWebviewSnapshot>(json!({
            "viewId": "claude-code.chat",
            "title": "Claude Code",
            "extensionId": "anthropic.claude-code",
            "html": "<main>Claude</main>",
            "options": {
                "enableScripts": true,
                "enableForms": true,
                "retainContextWhenHidden": true
            },
            "source": "host"
        }))
        .expect("webview should deserialize");

        assert_eq!(webview.view_id, "claude-code.chat");
        assert!(webview.html.contains("Claude"));
        let serialized = serde_json::to_value(webview).expect("webview should serialize");
        assert_eq!(serialized["options"]["enableScripts"], true);
        assert_eq!(serialized["options"]["enableForms"], true);
        assert_eq!(serialized["options"]["retainContextWhenHidden"], true);
    }

    #[test]
    fn vscode_extension_host_tree_snapshot_deserializes() {
        let tree = serde_json::from_value::<VSCodeHostTreeSnapshot>(json!({
            "viewId": "python.environments",
            "title": "Python Environments",
            "extensionId": "ms-python.python",
            "items": [{
                "id": "item-0",
                "label": ".venv",
                "description": "Python 3.11",
                "collapsibleState": "none",
                "command": {
                    "command": "python.setInterpreter",
                    "title": "Select Interpreter",
                    "arguments": [".venv"]
                },
                "children": []
            }],
            "source": "host"
        }))
        .expect("tree should deserialize");

        assert_eq!(tree.view_id, "python.environments");
        assert_eq!(tree.items[0].label, ".venv");
        assert_eq!(
            tree.items[0]
                .command
                .as_ref()
                .map(|command| command.command.as_str()),
            Some("python.setInterpreter")
        );
    }

    #[test]
    fn vscode_extension_host_snapshot_deserializes_registered_views() {
        let snapshot = serde_json::from_value::<VSCodeExtensionHostSnapshot>(json!({
            "status": "ready",
            "runtime": "node",
            "commandCount": 0,
            "activeExtensionCount": 1,
            "commands": [],
            "views": [{
                "id": "codex.chat",
                "title": "Codex Chat",
                "extensionId": "openai.chatgpt",
                "kind": "webview",
                "source": "host"
            }],
            "extensions": [{
                "id": "openai.chatgpt",
                "displayName": "Codex",
                "status": "active",
                "commandCount": 3,
                "viewCount": 1,
                "missingApi": []
            }, {
                "id": "ms-python.python",
                "status": "failed",
                "commandCount": 0,
                "viewCount": 0,
                "error": "VS Code API shim missing: debug.registerDebugConfigurationProvider",
                "missingApi": ["debug.registerDebugConfigurationProvider"]
            }],
            "lastError": null
        }))
        .expect("snapshot should deserialize");

        assert_eq!(snapshot.views.len(), 1);
        assert_eq!(snapshot.views[0].kind, "webview");
        assert_eq!(snapshot.extensions.len(), 2);
        assert_eq!(snapshot.extensions[0].status, "active");
        assert_eq!(
            snapshot.extensions[1].missing_api,
            vec!["debug.registerDebugConfigurationProvider"]
        );
    }

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
        assert_eq!(
            settings.last_workspace_path.as_deref(),
            Some("C:/workspace")
        );
        assert_eq!(
            settings.extra.get("onboardingCompleted"),
            Some(&json!(true))
        );
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
    fn preview_content_types_allow_extension_webview_scripts_and_styles() {
        assert_eq!(
            get_preview_content_type(Path::new("webview/index.js")),
            "application/javascript"
        );
        assert_eq!(
            get_preview_content_type(Path::new("webview/index.mjs")),
            "application/javascript"
        );
        assert_eq!(
            get_preview_content_type(Path::new("webview/index.css")),
            "text/css"
        );
    }

    #[test]
    fn preview_path_allows_registered_extension_resources_only() {
        let temp_root = tempfile::tempdir().expect("create preview fixture root");
        let workspace_root = temp_root.path().join("workspace");
        let extension_root = temp_root.path().join("extension");
        let outside_root = temp_root.path().join("outside");
        fs::create_dir_all(&workspace_root).expect("create workspace root");
        fs::create_dir_all(&extension_root).expect("create extension root");
        fs::create_dir_all(&outside_root).expect("create outside root");
        let extension_resource = extension_root.join("webview.js");
        let outside_resource = outside_root.join("private.js");
        fs::write(&extension_resource, "extension resource").expect("write extension resource");
        fs::write(&outside_resource, "outside resource").expect("write outside resource");

        let preview_state = DesktopPreviewState {
            workspace_root: StdMutex::new(Some(
                fs::canonicalize(&workspace_root).expect("canonical workspace root"),
            )),
            extension_roots: StdMutex::new(vec![
                fs::canonicalize(&extension_root).expect("canonical extension root"),
            ]),
        };
        let request_for = |path: &Path| {
            let request_path = format!("/{}", path.to_string_lossy().replace('\\', "/"));
            http::Request::builder()
                .uri(request_path)
                .body(Vec::new())
                .expect("build preview request")
        };

        assert_eq!(
            resolve_preview_path(&preview_state, &request_for(&extension_resource))
                .expect("registered extension resource should resolve"),
            fs::canonicalize(&extension_resource).expect("canonical extension resource")
        );
        let error = resolve_preview_path(&preview_state, &request_for(&outside_resource))
            .expect_err("unregistered resource must be rejected");
        assert!(error.contains("registered extension roots"));
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
