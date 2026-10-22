use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{tcp::OwnedWriteHalf, TcpListener, TcpStream},
    process::{Child, Command},
    sync::{broadcast, mpsc, oneshot, Mutex},
    task::JoinHandle,
    time::{sleep, timeout, Instant},
};

use crate::configure_tokio_command;

pub(crate) const MAX_DAP_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_DAP_HEADER_BYTES: usize = 16 * 1024;
const MAX_DEBUG_ENVIRONMENT_BYTES: usize = 128 * 1024;
const MAX_DEBUG_ENVIRONMENT_ENTRIES: usize = 512;
const DAP_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
// debugpy can take several seconds to import on a cold Windows filesystem. This
// is only a failure ceiling; successful sessions continue as soon as the port opens.
const DEBUGPY_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const DEBUGPY_STOP_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_ADAPTER_OUTPUT_BYTES: usize = 1024 * 1024;
const DAP_LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const DEBUG_EVENT_NAME: &str = "debug://event";

#[derive(Debug, Clone, Copy)]
pub enum DebugControlAction {
    Continue,
    Pause,
    StepOver,
    StepInto,
    StepOut,
}

pub enum DebugQuery {
    Threads,
    StackTrace {
        thread_id: i64,
        start_frame: u32,
        levels: u32,
    },
    Scopes {
        frame_id: i64,
    },
    Variables {
        variables_reference: i64,
        start: u32,
        count: u32,
    },
    Evaluate {
        expression: String,
        frame_id: Option<i64>,
        context: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugEventEnvelope {
    pub session_id: String,
    pub event: String,
    pub body: Value,
}

pub(crate) fn build_debugpy_adapter_arguments(port: u16) -> Vec<String> {
    vec![
        "-m".to_string(),
        "debugpy.adapter".to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ]
}

pub(crate) fn build_js_debug_adapter_arguments(entry: &std::path::Path, port: u16) -> Vec<String> {
    vec![
        entry.to_string_lossy().to_string(),
        port.to_string(),
        "127.0.0.1".to_string(),
    ]
}

pub(crate) fn build_debug_control_request(
    action: DebugControlAction,
    thread_id: i64,
) -> (&'static str, Value) {
    match action {
        DebugControlAction::Continue => (
            "continue",
            serde_json::json!({ "threadId": thread_id, "singleThread": false }),
        ),
        DebugControlAction::Pause => ("pause", serde_json::json!({ "threadId": thread_id })),
        DebugControlAction::StepOver => (
            "next",
            serde_json::json!({ "threadId": thread_id, "singleThread": false }),
        ),
        DebugControlAction::StepInto => (
            "stepIn",
            serde_json::json!({ "threadId": thread_id, "singleThread": false }),
        ),
        DebugControlAction::StepOut => (
            "stepOut",
            serde_json::json!({ "threadId": thread_id, "singleThread": false }),
        ),
    }
}

pub(crate) fn build_debug_query_request(
    query: DebugQuery,
) -> Result<(&'static str, Value), String> {
    match query {
        DebugQuery::Threads => Ok(("threads", serde_json::json!({}))),
        DebugQuery::StackTrace {
            thread_id,
            start_frame,
            levels,
        } => Ok((
            "stackTrace",
            serde_json::json!({
                "threadId": thread_id,
                "startFrame": start_frame,
                "levels": levels.min(200),
            }),
        )),
        DebugQuery::Scopes { frame_id } => {
            Ok(("scopes", serde_json::json!({ "frameId": frame_id })))
        }
        DebugQuery::Variables {
            variables_reference,
            start,
            count,
        } => Ok((
            "variables",
            serde_json::json!({
                "variablesReference": variables_reference,
                "start": start,
                "count": count.min(500),
            }),
        )),
        DebugQuery::Evaluate {
            expression,
            frame_id,
            context,
        } => {
            let expression = expression.trim();
            if expression.is_empty() {
                return Err("Debug evaluation requires a non-empty expression.".to_string());
            }
            if expression.len() > 4096 {
                return Err("Debug evaluation exceeds the 4096-byte limit.".to_string());
            }
            if !matches!(context.as_str(), "repl" | "watch" | "hover") {
                return Err("Debug evaluation context must be repl, watch, or hover.".to_string());
            }
            let mut arguments = serde_json::json!({
                "expression": expression,
                "context": context,
            });
            if let Some(frame_id) = frame_id {
                arguments["frameId"] = Value::from(frame_id);
            }
            Ok(("evaluate", arguments))
        }
    }
}

pub(crate) fn normalize_debug_event(session_id: &str, event: &Value) -> DebugEventEnvelope {
    DebugEventEnvelope {
        session_id: session_id.to_string(),
        event: event
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or("adapterMessage")
            .to_string(),
        body: event.get("body").cloned().unwrap_or(Value::Null),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PythonDebugTarget {
    Program { value: String },
    Module { value: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonDebugLaunchRequest {
    pub name: String,
    pub workspace_root_path: String,
    pub python: Option<String>,
    pub target: PythonDebugTarget,
    pub cwd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub just_my_code: bool,
    #[serde(default)]
    pub stop_on_entry: bool,
    #[serde(default = "default_true")]
    pub sub_process: bool,
    #[serde(default)]
    pub breakpoints: Vec<DebugSourceBreakpoint>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSourceBreakpoint {
    pub path: String,
    pub line: u32,
}

#[derive(Debug)]
pub(crate) struct ValidatedPythonDebugLaunch {
    pub name: String,
    pub workspace_root: PathBuf,
    pub python: String,
    pub program: Option<PathBuf>,
    pub module: Option<String>,
    pub cwd: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub just_my_code: bool,
    pub stop_on_entry: bool,
    pub sub_process: bool,
    pub breakpoints: Vec<DebugSourceBreakpoint>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDebugLaunchRequest {
    pub name: String,
    pub workspace_root_path: String,
    pub program: String,
    pub cwd: String,
    #[serde(default = "default_node_runtime")]
    pub runtime_executable: String,
    #[serde(default)]
    pub runtime_args: Vec<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub stop_on_entry: bool,
    #[serde(default = "default_true")]
    pub source_maps: bool,
    #[serde(default)]
    pub smart_step: bool,
    #[serde(default)]
    pub skip_files: Vec<String>,
    #[serde(default)]
    pub out_files: Vec<String>,
    #[serde(default)]
    pub breakpoints: Vec<DebugSourceBreakpoint>,
}

#[derive(Debug, Clone)]
pub(crate) struct ValidatedNodeDebugLaunch {
    pub name: String,
    pub workspace_root: PathBuf,
    pub program: PathBuf,
    pub cwd: PathBuf,
    pub runtime_executable: String,
    pub runtime_args: Vec<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub stop_on_entry: bool,
    pub source_maps: bool,
    pub smart_step: bool,
    pub skip_files: Vec<String>,
    pub out_files: Vec<String>,
    pub breakpoints: Vec<DebugSourceBreakpoint>,
}

fn default_true() -> bool {
    true
}

fn default_node_runtime() -> String {
    "node".to_string()
}

fn canonical_workspace_child(
    workspace_root: &std::path::Path,
    value: &str,
    adapter: &str,
    label: &str,
) -> Result<PathBuf, String> {
    let requested = PathBuf::from(value);
    let joined = if requested.is_absolute() {
        requested
    } else {
        workspace_root.join(requested)
    };
    let canonical = std::fs::canonicalize(joined)
        .map_err(|error| format!("{adapter} debug {label} could not be resolved: {error}"))?;
    if !canonical.starts_with(workspace_root) {
        return Err(format!(
            "{adapter} debug {label} must stay inside the workspace."
        ));
    }
    Ok(canonical)
}

fn validate_debug_environment(
    adapter: &str,
    environment: &HashMap<String, String>,
) -> Result<(), String> {
    if environment.len() > MAX_DEBUG_ENVIRONMENT_ENTRIES
        || environment
            .iter()
            .map(|(key, value)| key.len() + value.len())
            .sum::<usize>()
            > MAX_DEBUG_ENVIRONMENT_BYTES
    {
        return Err(format!(
            "{adapter} debug environment exceeds the 128 KiB limit."
        ));
    }
    if environment
        .iter()
        .any(|(key, value)| key.is_empty() || key.contains(['=', '\0']) || value.contains('\0'))
    {
        return Err(format!(
            "{adapter} debug environment contains an invalid key or value."
        ));
    }
    Ok(())
}

fn validate_debug_string_list(
    adapter: &str,
    label: &str,
    values: &[String],
    max_entries: usize,
    max_bytes: usize,
) -> Result<(), String> {
    if values.len() > max_entries || values.iter().map(String::len).sum::<usize>() > max_bytes {
        return Err(format!(
            "{adapter} debug {label} exceeds the supported limit."
        ));
    }
    if values.iter().any(|value| value.contains('\0')) {
        return Err(format!(
            "{adapter} debug {label} contains an invalid value."
        ));
    }
    Ok(())
}

fn validate_workspace_glob(
    workspace_root: &std::path::Path,
    value: &str,
    label: &str,
) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err(format!("Node debug {label} contains an invalid value."));
    }
    let requested = PathBuf::from(trimmed);
    if requested
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(format!(
            "Node debug {label} must stay inside the workspace."
        ));
    }
    let resolved = if requested.is_absolute() {
        let mut existing_ancestor = requested.clone();
        while !existing_ancestor.exists() {
            if !existing_ancestor.pop() {
                return Err(format!(
                    "Node debug {label} must stay inside the workspace."
                ));
            }
        }
        let canonical_ancestor = std::fs::canonicalize(&existing_ancestor)
            .map_err(|error| format!("Node debug {label} could not be resolved: {error}"))?;
        if !canonical_ancestor.starts_with(workspace_root) {
            return Err(format!(
                "Node debug {label} must stay inside the workspace."
            ));
        }
        requested
    } else {
        workspace_root.join(requested)
    };
    Ok(resolved.to_string_lossy().to_string())
}

fn is_python_module(value: &str) -> bool {
    !value.is_empty()
        && value.split('.').all(|segment| {
            let mut characters = segment.chars();
            characters
                .next()
                .is_some_and(|character| character == '_' || character.is_ascii_alphabetic())
                && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
        })
}

pub(crate) fn validate_python_debug_request(
    request: PythonDebugLaunchRequest,
) -> Result<ValidatedPythonDebugLaunch, String> {
    let workspace_root = std::fs::canonicalize(request.workspace_root_path.trim())
        .map_err(|error| format!("Python debug workspace could not be resolved: {error}"))?;
    if !workspace_root.is_dir() {
        return Err("Python debug workspace must be a directory.".to_string());
    }
    let cwd = canonical_workspace_child(&workspace_root, request.cwd.trim(), "Python", "cwd")?;
    if !cwd.is_dir() {
        return Err("Python debug cwd must be a directory.".to_string());
    }

    let (program, module) = match request.target {
        PythonDebugTarget::Program { value } => {
            let program =
                canonical_workspace_child(&workspace_root, value.trim(), "Python", "program")?;
            if !program.is_file() {
                return Err("Python debug program must be a regular file.".to_string());
            }
            (Some(program), None)
        }
        PythonDebugTarget::Module { value } => {
            let module = value.trim();
            if !is_python_module(module) {
                return Err("Python debug module must be a dotted Python identifier.".to_string());
            }
            (None, Some(module.to_string()))
        }
    };

    validate_debug_environment("Python", &request.env)?;

    let mut seen_breakpoints = HashSet::new();
    let mut breakpoints = Vec::new();
    for breakpoint in request.breakpoints {
        if breakpoint.line == 0 {
            return Err("Python debug breakpoint lines must start at 1.".to_string());
        }
        let path = canonical_workspace_child(
            &workspace_root,
            breakpoint.path.trim(),
            "Python",
            "breakpoint source",
        )?;
        if !path.is_file() {
            return Err("Python debug breakpoint source must be a regular file.".to_string());
        }
        if seen_breakpoints.insert((path.clone(), breakpoint.line)) {
            breakpoints.push(DebugSourceBreakpoint {
                path: path.to_string_lossy().to_string(),
                line: breakpoint.line,
            });
        }
    }

    Ok(ValidatedPythonDebugLaunch {
        name: request.name,
        workspace_root,
        python: request.python.unwrap_or_else(|| "python".to_string()),
        program,
        module,
        cwd,
        args: request.args,
        env: request.env,
        just_my_code: request.just_my_code,
        stop_on_entry: request.stop_on_entry,
        sub_process: request.sub_process,
        breakpoints,
    })
}

pub(crate) fn validate_node_debug_request(
    request: NodeDebugLaunchRequest,
) -> Result<ValidatedNodeDebugLaunch, String> {
    let workspace_root = std::fs::canonicalize(request.workspace_root_path.trim())
        .map_err(|error| format!("Node debug workspace could not be resolved: {error}"))?;
    if !workspace_root.is_dir() {
        return Err("Node debug workspace must be a directory.".to_string());
    }
    let program =
        canonical_workspace_child(&workspace_root, request.program.trim(), "Node", "program")?;
    if !program.is_file() {
        return Err("Node debug program must be a regular file.".to_string());
    }
    let cwd = canonical_workspace_child(&workspace_root, request.cwd.trim(), "Node", "cwd")?;
    if !cwd.is_dir() {
        return Err("Node debug cwd must be a directory.".to_string());
    }

    let runtime_executable = request.runtime_executable.trim();
    if runtime_executable.is_empty() || runtime_executable.contains('\0') {
        return Err("Node debug runtimeExecutable contains an invalid value.".to_string());
    }
    validate_debug_string_list("Node", "runtimeArgs", &request.runtime_args, 128, 64 * 1024)?;
    validate_debug_string_list("Node", "args", &request.args, 512, 128 * 1024)?;
    validate_debug_string_list("Node", "skipFiles", &request.skip_files, 256, 64 * 1024)?;
    validate_debug_string_list("Node", "outFiles", &request.out_files, 256, 64 * 1024)?;
    validate_debug_environment("Node", &request.env)?;

    let out_files = request
        .out_files
        .iter()
        .map(|value| validate_workspace_glob(&workspace_root, value, "outFiles"))
        .collect::<Result<Vec<_>, _>>()?;
    let mut seen_breakpoints = HashSet::new();
    let mut breakpoints = Vec::new();
    for breakpoint in request.breakpoints {
        if breakpoint.line == 0 {
            return Err("Node debug breakpoint lines must start at 1.".to_string());
        }
        let path = canonical_workspace_child(
            &workspace_root,
            breakpoint.path.trim(),
            "Node",
            "breakpoint source",
        )?;
        if !path.is_file() {
            return Err("Node debug breakpoint source must be a regular file.".to_string());
        }
        if seen_breakpoints.insert((path.clone(), breakpoint.line)) {
            breakpoints.push(DebugSourceBreakpoint {
                path: path.to_string_lossy().to_string(),
                line: breakpoint.line,
            });
        }
    }

    Ok(ValidatedNodeDebugLaunch {
        name: request.name,
        workspace_root,
        program,
        cwd,
        runtime_executable: runtime_executable.to_string(),
        runtime_args: request.runtime_args,
        args: request.args,
        env: request.env,
        stop_on_entry: request.stop_on_entry,
        source_maps: request.source_maps,
        smart_step: request.smart_step,
        skip_files: request.skip_files,
        out_files,
        breakpoints,
    })
}

pub(crate) trait DebugEventSink: Send + Sync {
    fn emit(&self, session_id: &str, event: &Value) -> Result<(), String>;
}

type PendingDapResponses = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>;

struct ReverseDapRequest {
    command: String,
    arguments: Value,
    responder: oneshot::Sender<Result<Value, String>>,
}

pub(crate) struct DapClient {
    writer: Arc<Mutex<OwnedWriteHalf>>,
    next_seq: Arc<AtomicI64>,
    pending: PendingDapResponses,
    events: broadcast::Sender<Value>,
    reader_task: JoinHandle<()>,
}

struct PendingDapRequest {
    command: String,
    receiver: oneshot::Receiver<Result<Value, String>>,
}

impl PendingDapRequest {
    async fn wait(self, duration: Duration) -> Result<Value, String> {
        let response = timeout(duration, self.receiver)
            .await
            .map_err(|_| format!("DAP {} request timed out.", self.command))?
            .map_err(|_| format!("DAP {} request was cancelled.", self.command))??;
        if response
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(response.get("body").cloned().unwrap_or(Value::Null));
        }
        let message = response
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("The debug adapter rejected the request.");
        Err(format!("DAP {} failed: {message}", self.command))
    }
}

impl DapClient {
    fn new(stream: TcpStream, session_id: String, sink: Arc<dyn DebugEventSink>) -> Arc<Self> {
        Self::new_with_reverse_requests(stream, session_id, sink, None)
    }

    fn new_with_reverse_requests(
        stream: TcpStream,
        session_id: String,
        sink: Arc<dyn DebugEventSink>,
        reverse_requests: Option<mpsc::Sender<ReverseDapRequest>>,
    ) -> Arc<Self> {
        let (mut reader, writer) = stream.into_split();
        let writer = Arc::new(Mutex::new(writer));
        let reader_writer = Arc::clone(&writer);
        let next_seq = Arc::new(AtomicI64::new(1));
        let reader_next_seq = Arc::clone(&next_seq);
        let pending: PendingDapResponses = Arc::new(Mutex::new(HashMap::new()));
        let reader_pending = Arc::clone(&pending);
        let (events, _) = broadcast::channel(128);
        let reader_events = events.clone();
        let reader_task = tokio::spawn(async move {
            let mut decoder = DapDecoder::new();
            let mut buffer = [0_u8; 16 * 1024];
            let terminal_error = loop {
                let count = match reader.read(&mut buffer).await {
                    Ok(0) => break "The debug adapter closed the connection.".to_string(),
                    Ok(count) => count,
                    Err(error) => break format!("The debug adapter connection failed: {error}"),
                };
                let messages = match decoder.push(&buffer[..count]) {
                    Ok(messages) => messages,
                    Err(error) => break error,
                };
                for message in messages {
                    match message.get("type").and_then(Value::as_str) {
                        Some("response") => {
                            if let Some(request_seq) =
                                message.get("request_seq").and_then(Value::as_i64)
                            {
                                if let Some(sender) =
                                    reader_pending.lock().await.remove(&request_seq)
                                {
                                    let _ = sender.send(Ok(message));
                                }
                            }
                        }
                        Some("event") => {
                            let _ = reader_events.send(message.clone());
                            let _ = sink.emit(&session_id, &message);
                        }
                        Some("request") => {
                            let request_seq = message.get("seq").and_then(Value::as_i64);
                            let command = message
                                .get("command")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown");
                            if let Some(request_seq) = request_seq {
                                let arguments = message
                                    .get("arguments")
                                    .cloned()
                                    .unwrap_or_else(|| serde_json::json!({}));
                                let handled = if let Some(sender) = reverse_requests.as_ref() {
                                    let (responder, response) = oneshot::channel();
                                    if sender
                                        .send(ReverseDapRequest {
                                            command: command.to_string(),
                                            arguments,
                                            responder,
                                        })
                                        .await
                                        .is_ok()
                                    {
                                        response.await.unwrap_or_else(|_| {
                                            Err("The internal reverse request handler stopped."
                                                .to_string())
                                        })
                                    } else {
                                        Err("The internal reverse request handler is unavailable."
                                            .to_string())
                                    }
                                } else {
                                    Err(format!(
                                        "Lattice does not support adapter reverse request '{command}'."
                                    ))
                                };
                                let response = serde_json::json!({
                                    "seq": reader_next_seq.fetch_add(1, Ordering::Relaxed),
                                    "type": "response",
                                    "request_seq": request_seq,
                                    "success": handled.is_ok(),
                                    "command": command,
                                    "body": handled.as_ref().ok().cloned().unwrap_or_else(|| serde_json::json!({})),
                                    "message": handled.err(),
                                });
                                if let Ok(frame) = encode_dap_message(&response) {
                                    let _ = reader_writer.lock().await.write_all(&frame).await;
                                }
                            }
                            let _ = sink.emit(&session_id, &message);
                        }
                        _ => {
                            let _ = sink.emit(&session_id, &message);
                        }
                    }
                }
            };

            let mut pending = reader_pending.lock().await;
            for (_, sender) in pending.drain() {
                let _ = sender.send(Err(terminal_error.clone()));
            }
        });

        Arc::new(Self {
            writer,
            next_seq,
            pending,
            events,
            reader_task,
        })
    }

    fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    async fn begin_request(
        &self,
        command: &str,
        arguments: Value,
    ) -> Result<PendingDapRequest, String> {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let message = serde_json::json!({
            "seq": seq,
            "type": "request",
            "command": command,
            "arguments": arguments,
        });
        let frame = encode_dap_message(&message)?;
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(seq, sender);
        if let Err(error) = self.writer.lock().await.write_all(&frame).await {
            self.pending.lock().await.remove(&seq);
            return Err(format!("Unable to send DAP {command} request: {error}"));
        }
        Ok(PendingDapRequest {
            command: command.to_string(),
            receiver,
        })
    }

    async fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        self.begin_request(command, arguments)
            .await?
            .wait(DAP_REQUEST_TIMEOUT)
            .await
    }
}

impl Drop for DapClient {
    fn drop(&mut self) {
        self.reader_task.abort();
    }
}

async fn wait_for_dap_event(
    receiver: &mut broadcast::Receiver<Value>,
    event_name: &str,
    duration: Duration,
) -> Result<Value, String> {
    timeout(duration, async {
        loop {
            match receiver.recv().await {
                Ok(event) if event.get("event").and_then(Value::as_str) == Some(event_name) => {
                    return Ok(event);
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => {
                    return Err("The debug adapter event stream closed.".to_string())
                }
            }
        }
    })
    .await
    .map_err(|_| format!("Timed out waiting for DAP {event_name} event."))?
}

async fn configure_debug_breakpoints(
    client: &Arc<DapClient>,
    session_id: &str,
    breakpoints: &[DebugSourceBreakpoint],
    sink: &Arc<dyn DebugEventSink>,
) -> Result<(), String> {
    let mut breakpoints_by_path: HashMap<&str, Vec<u32>> = HashMap::new();
    for breakpoint in breakpoints {
        breakpoints_by_path
            .entry(&breakpoint.path)
            .or_default()
            .push(breakpoint.line);
    }
    for (path, lines) in breakpoints_by_path {
        let response = client
            .request(
                "setBreakpoints",
                serde_json::json!({
                    "source": { "path": path },
                    "breakpoints": lines
                        .into_iter()
                        .map(|line| serde_json::json!({ "line": line }))
                        .collect::<Vec<_>>(),
                    "sourceModified": false,
                }),
            )
            .await?;
        let _ = sink.emit(
            session_id,
            &serde_json::json!({
                "type": "event",
                "event": "breakpoints",
                "body": {
                    "source": { "path": path },
                    "breakpoints": response
                        .get("breakpoints")
                        .cloned()
                        .unwrap_or_else(|| Value::Array(Vec::new())),
                },
            }),
        );
    }
    Ok(())
}

pub(crate) async fn configure_python_debug_connection(
    stream: TcpStream,
    session_id: String,
    launch: &ValidatedPythonDebugLaunch,
    sink: Arc<dyn DebugEventSink>,
) -> Result<Arc<DapClient>, String> {
    let client = DapClient::new(stream, session_id.clone(), Arc::clone(&sink));
    let mut events = client.subscribe();
    client
        .request(
            "initialize",
            serde_json::json!({
                "clientID": "lattice",
                "clientName": "Lattice",
                "adapterID": "debugpy",
                "pathFormat": "path",
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "supportsVariableType": true,
                "supportsVariablePaging": true,
                "supportsRunInTerminalRequest": false,
            }),
        )
        .await?;

    let mut launch_arguments = serde_json::json!({
        "name": launch.name,
        "type": "debugpy",
        "request": "launch",
        "cwd": launch.cwd,
        "args": launch.args,
        "env": launch.env,
        "justMyCode": launch.just_my_code,
        "stopOnEntry": launch.stop_on_entry,
        "subProcess": launch.sub_process,
        "python": launch.python,
        "console": "internalConsole",
        "redirectOutput": true,
    });
    if let Some(program) = &launch.program {
        launch_arguments["program"] = Value::String(program.to_string_lossy().to_string());
    }
    if let Some(module) = &launch.module {
        launch_arguments["module"] = Value::String(module.clone());
    }
    let launch_pending = client.begin_request("launch", launch_arguments).await?;
    wait_for_dap_event(&mut events, "initialized", DAP_LAUNCH_TIMEOUT).await?;

    configure_debug_breakpoints(&client, &session_id, &launch.breakpoints, &sink).await?;
    client
        .request(
            "setExceptionBreakpoints",
            serde_json::json!({ "filters": ["Uncaught"] }),
        )
        .await?;
    client
        .request("configurationDone", serde_json::json!({}))
        .await?;
    launch_pending.wait(Duration::from_secs(30)).await?;
    Ok(client)
}

pub(crate) async fn configure_node_debug_connection(
    stream: TcpStream,
    session_id: String,
    launch: &ValidatedNodeDebugLaunch,
    sink: Arc<dyn DebugEventSink>,
) -> Result<Arc<DapClient>, String> {
    configure_node_debug_connection_inner(stream, session_id, launch, sink, None)
        .await
        .map(|(client, _)| client)
}

async fn configure_node_target_connection(
    stream: TcpStream,
    session_id: String,
    configuration: Value,
    launch: &ValidatedNodeDebugLaunch,
    sink: Arc<dyn DebugEventSink>,
) -> Result<Arc<DapClient>, String> {
    let client = DapClient::new(stream, session_id.clone(), Arc::clone(&sink));
    let mut events = client.subscribe();
    client
        .request(
            "initialize",
            serde_json::json!({
                "clientID": "lattice",
                "clientName": "Lattice",
                "adapterID": "pwa-node",
                "pathFormat": "path",
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "supportsVariableType": true,
                "supportsVariablePaging": true,
                "supportsRunInTerminalRequest": false,
            }),
        )
        .await?;
    let mut target_launch = configuration;
    let target_launch_object = target_launch
        .as_object_mut()
        .ok_or_else(|| "js-debug startDebugging configuration must be an object.".to_string())?;
    target_launch_object.insert("request".to_string(), Value::String("launch".to_string()));
    let launch_pending = client.begin_request("launch", target_launch).await?;
    wait_for_dap_event(&mut events, "initialized", DAP_LAUNCH_TIMEOUT).await?;
    configure_debug_breakpoints(&client, &session_id, &launch.breakpoints, &sink).await?;
    client
        .request(
            "setExceptionBreakpoints",
            serde_json::json!({ "filters": ["uncaught"] }),
        )
        .await?;
    client
        .request("configurationDone", serde_json::json!({}))
        .await?;
    let launch_sink = Arc::clone(&sink);
    let launch_session_id = session_id.clone();
    tokio::spawn(async move {
        if let Err(error) = launch_pending.wait(DAP_LAUNCH_TIMEOUT).await {
            let _ = launch_sink.emit(
                &launch_session_id,
                &serde_json::json!({
                    "type": "event",
                    "event": "output",
                    "body": {
                        "category": "stderr",
                        "output": format!("js-debug target launch failed: {error}\n"),
                    },
                }),
            );
        }
    });
    Ok(client)
}

async fn configure_node_debug_connection_inner(
    stream: TcpStream,
    session_id: String,
    launch: &ValidatedNodeDebugLaunch,
    sink: Arc<dyn DebugEventSink>,
    target_address: Option<std::net::SocketAddr>,
) -> Result<(Arc<DapClient>, Arc<Mutex<Vec<Arc<DapClient>>>>), String> {
    let target_clients = Arc::new(Mutex::new(Vec::new()));
    let reverse_sender = if let Some(address) = target_address {
        let (sender, mut receiver) = mpsc::channel::<ReverseDapRequest>(8);
        let handler_launch = launch.clone();
        let handler_sink = Arc::clone(&sink);
        let handler_session_id = session_id.clone();
        let handler_target_clients = Arc::clone(&target_clients);
        tokio::spawn(async move {
            while let Some(request) = receiver.recv().await {
                let result = async {
                    if request.command != "startDebugging" {
                        return Err(format!(
                            "Lattice does not support adapter reverse request '{}'.",
                            request.command
                        ));
                    }
                    let requested_mode = request
                        .arguments
                        .get("request")
                        .and_then(Value::as_str)
                        .unwrap_or("launch");
                    if requested_mode != "launch" {
                        return Err(
                            "js-debug target sessions support only launch requests.".to_string()
                        );
                    }
                    let configuration = request
                        .arguments
                        .get("configuration")
                        .cloned()
                        .ok_or_else(|| {
                            "js-debug startDebugging request is missing configuration.".to_string()
                        })?;
                    let _pending_target_id = configuration
                        .get("__pendingTargetId")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty() && value.len() <= 256)
                        .ok_or_else(|| {
                            "js-debug startDebugging request has no valid pending target id."
                                .to_string()
                        })?;
                    let stream = timeout(DAP_REQUEST_TIMEOUT, TcpStream::connect(address))
                        .await
                        .map_err(|_| {
                            "Timed out connecting the js-debug target session.".to_string()
                        })?
                        .map_err(|error| {
                            format!("Unable to connect the js-debug target session: {error}")
                        })?;
                    let target_client = configure_node_target_connection(
                        stream,
                        handler_session_id.clone(),
                        configuration,
                        &handler_launch,
                        Arc::clone(&handler_sink),
                    )
                    .await?;
                    handler_target_clients.lock().await.push(target_client);
                    Ok(serde_json::json!({}))
                }
                .await;
                if let Err(error) = &result {
                    let _ = handler_sink.emit(
                        &handler_session_id,
                        &serde_json::json!({
                            "type": "event",
                            "event": "output",
                            "body": {
                                "category": "stderr",
                                "output": format!("js-debug target handshake failed: {error}\n"),
                            },
                        }),
                    );
                }
                let _ = request.responder.send(result);
            }
        });
        Some(sender)
    } else {
        None
    };

    let client = DapClient::new_with_reverse_requests(
        stream,
        session_id.clone(),
        Arc::clone(&sink),
        reverse_sender,
    );
    let mut events = client.subscribe();
    client
        .request(
            "initialize",
            serde_json::json!({
                "clientID": "lattice",
                "clientName": "Lattice",
                "adapterID": "pwa-node",
                "pathFormat": "path",
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "supportsVariableType": true,
                "supportsVariablePaging": true,
                "supportsRunInTerminalRequest": false,
                "supportsStartDebuggingRequest": target_address.is_some(),
            }),
        )
        .await?;

    let launch_pending = client
        .begin_request(
            "launch",
            serde_json::json!({
                "name": launch.name,
                "type": "pwa-node",
                "request": "launch",
                "program": launch.program,
                "cwd": launch.cwd,
                "runtimeExecutable": launch.runtime_executable,
                "runtimeArgs": launch.runtime_args,
                "args": launch.args,
                "env": launch.env,
                "stopOnEntry": launch.stop_on_entry,
                "sourceMaps": launch.source_maps,
                "smartStep": launch.smart_step,
                "skipFiles": launch.skip_files,
                "outFiles": launch.out_files,
                "console": "internalConsole",
                "internalConsoleOptions": "openOnSessionStart",
                "autoAttachChildProcesses": false,
                "__workspaceFolder": launch.workspace_root,
            }),
        )
        .await?;
    wait_for_dap_event(&mut events, "initialized", DAP_LAUNCH_TIMEOUT).await?;
    configure_debug_breakpoints(&client, &session_id, &launch.breakpoints, &sink).await?;
    client
        .request(
            "setExceptionBreakpoints",
            serde_json::json!({ "filters": ["uncaught"] }),
        )
        .await?;
    client
        .request("configurationDone", serde_json::json!({}))
        .await?;
    launch_pending.wait(DAP_LAUNCH_TIMEOUT).await?;
    if target_address.is_some() {
        timeout(DAP_LAUNCH_TIMEOUT, async {
            loop {
                if !target_clients.lock().await.is_empty() {
                    break;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_| "Timed out waiting for the js-debug target session.".to_string())?;
    }
    Ok((client, target_clients))
}

pub(crate) struct StartedDebugSession {
    pub adapter_label: &'static str,
    pub adapter: Child,
    pub client: Arc<DapClient>,
    pub target_clients: Arc<Mutex<Vec<Arc<DapClient>>>>,
}

async fn verify_debugpy_available(python: &str) -> Result<(), String> {
    let mut command = Command::new(python);
    configure_tokio_command(&mut command);
    command
        .args(["-c", "import debugpy; print(debugpy.__version__)"])
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .kill_on_drop(true);
    let output = timeout(DEBUGPY_CONNECT_TIMEOUT, command.output())
        .await
        .map_err(|_| "Timed out while checking whether debugpy is installed.".to_string())?
        .map_err(|error| format!("Unable to start the configured Python interpreter: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if error.is_empty() {
        "The configured Python interpreter does not provide debugpy.".to_string()
    } else {
        format!("The configured Python interpreter cannot load debugpy: {error}")
    })
}

async fn verify_node_available(node: &str) -> Result<(), String> {
    let mut command = Command::new(node);
    configure_tokio_command(&mut command);
    command.arg("--version").kill_on_drop(true);
    let output = timeout(DEBUGPY_CONNECT_TIMEOUT, command.output())
        .await
        .map_err(|_| "Timed out while checking the Node.js runtime.".to_string())?
        .map_err(|error| format!("Unable to start the Node.js runtime: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if error.is_empty() {
        "The configured Node.js runtime is unavailable.".to_string()
    } else {
        format!("The configured Node.js runtime failed its version probe: {error}")
    })
}

async fn forward_adapter_output<R>(
    mut reader: R,
    session_id: String,
    category: &'static str,
    sink: Arc<dyn DebugEventSink>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buffer = [0_u8; 4096];
    let mut emitted = 0_usize;
    loop {
        let count = match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        if emitted >= MAX_ADAPTER_OUTPUT_BYTES {
            continue;
        }
        let remaining = MAX_ADAPTER_OUTPUT_BYTES - emitted;
        let visible = count.min(remaining);
        emitted += visible;
        let output = String::from_utf8_lossy(&buffer[..visible]).to_string();
        let _ = sink.emit(
            &session_id,
            &serde_json::json!({
                "type": "event",
                "event": "output",
                "body": { "category": category, "output": output },
            }),
        );
    }
}

pub(crate) async fn start_python_debug_session_inner(
    session_id: String,
    launch: ValidatedPythonDebugLaunch,
    sink: Arc<dyn DebugEventSink>,
) -> Result<StartedDebugSession, String> {
    verify_debugpy_available(&launch.python).await?;

    let reservation = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Unable to reserve a local debug adapter port: {error}"))?;
    let address = reservation
        .local_addr()
        .map_err(|error| format!("Unable to read the local debug adapter port: {error}"))?;
    drop(reservation);

    let mut command = Command::new(&launch.python);
    configure_tokio_command(&mut command);
    command
        .args(build_debugpy_adapter_arguments(address.port()))
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut adapter = command
        .spawn()
        .map_err(|error| format!("Unable to start debugpy.adapter: {error}"))?;

    let deadline = Instant::now() + DEBUGPY_CONNECT_TIMEOUT;
    let stream = loop {
        match TcpStream::connect(address).await {
            Ok(stream) => break stream,
            Err(error) => {
                if let Some(status) = adapter.try_wait().map_err(|wait_error| {
                    format!("Unable to inspect debugpy.adapter: {wait_error}")
                })? {
                    let mut stderr = String::new();
                    if let Some(pipe) = adapter.stderr.take() {
                        let _ = pipe
                            .take(MAX_ADAPTER_OUTPUT_BYTES as u64)
                            .read_to_string(&mut stderr)
                            .await;
                    }
                    let detail = stderr.trim();
                    return Err(if detail.is_empty() {
                        format!("debugpy.adapter exited with status {status} before accepting DAP.")
                    } else {
                        format!("debugpy.adapter exited before accepting DAP: {detail}")
                    });
                }
                if Instant::now() >= deadline {
                    let _ = adapter.kill().await;
                    let _ = adapter.wait().await;
                    let mut stderr = String::new();
                    if let Some(pipe) = adapter.stderr.take() {
                        let _ = pipe
                            .take(MAX_ADAPTER_OUTPUT_BYTES as u64)
                            .read_to_string(&mut stderr)
                            .await;
                    }
                    let detail = stderr.trim();
                    return Err(format!(
                        "Timed out connecting to debugpy.adapter on 127.0.0.1:{}. Last error: {error}{}",
                        address.port(),
                        if detail.is_empty() {
                            String::new()
                        } else {
                            format!(". Adapter stderr: {detail}")
                        }
                    ));
                }
                sleep(Duration::from_millis(25)).await;
            }
        }
    };

    if let Some(stdout) = adapter.stdout.take() {
        tokio::spawn(forward_adapter_output(
            stdout,
            session_id.clone(),
            "console",
            Arc::clone(&sink),
        ));
    }
    if let Some(stderr) = adapter.stderr.take() {
        tokio::spawn(forward_adapter_output(
            stderr,
            session_id.clone(),
            "stderr",
            Arc::clone(&sink),
        ));
    }

    let client = match configure_python_debug_connection(stream, session_id, &launch, sink).await {
        Ok(client) => client,
        Err(error) => {
            let _ = adapter.kill().await;
            let _ = adapter.wait().await;
            return Err(error);
        }
    };
    Ok(StartedDebugSession {
        adapter_label: "debugpy.adapter",
        adapter,
        client,
        target_clients: Arc::new(Mutex::new(Vec::new())),
    })
}

pub(crate) async fn start_node_debug_session_inner(
    session_id: String,
    launch: ValidatedNodeDebugLaunch,
    node_runtime: String,
    adapter_entry: PathBuf,
    sink: Arc<dyn DebugEventSink>,
) -> Result<StartedDebugSession, String> {
    verify_node_available(&node_runtime).await?;
    if !adapter_entry.is_file() {
        return Err(format!(
            "Bundled js-debug adapter not found: {}",
            adapter_entry.to_string_lossy()
        ));
    }

    let reservation = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Unable to reserve a local debug adapter port: {error}"))?;
    let address = reservation
        .local_addr()
        .map_err(|error| format!("Unable to read the local debug adapter port: {error}"))?;
    drop(reservation);

    let mut command = Command::new(&node_runtime);
    configure_tokio_command(&mut command);
    command
        .args(build_js_debug_adapter_arguments(
            &adapter_entry,
            address.port(),
        ))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut adapter = command
        .spawn()
        .map_err(|error| format!("Unable to start vscode-js-debug: {error}"))?;

    let deadline = Instant::now() + DEBUGPY_CONNECT_TIMEOUT;
    let stream = loop {
        match TcpStream::connect(address).await {
            Ok(stream) => break stream,
            Err(error) => {
                if let Some(status) = adapter.try_wait().map_err(|wait_error| {
                    format!("Unable to inspect vscode-js-debug: {wait_error}")
                })? {
                    let mut stderr = String::new();
                    if let Some(pipe) = adapter.stderr.take() {
                        let _ = pipe
                            .take(MAX_ADAPTER_OUTPUT_BYTES as u64)
                            .read_to_string(&mut stderr)
                            .await;
                    }
                    let detail = stderr.trim();
                    return Err(if detail.is_empty() {
                        format!("vscode-js-debug exited with status {status} before accepting DAP.")
                    } else {
                        format!("vscode-js-debug exited before accepting DAP: {detail}")
                    });
                }
                if Instant::now() >= deadline {
                    let _ = adapter.kill().await;
                    let _ = adapter.wait().await;
                    return Err(format!(
                        "Timed out connecting to vscode-js-debug on 127.0.0.1:{}. Last error: {error}",
                        address.port()
                    ));
                }
                sleep(Duration::from_millis(25)).await;
            }
        }
    };

    if let Some(stdout) = adapter.stdout.take() {
        tokio::spawn(forward_adapter_output(
            stdout,
            session_id.clone(),
            "console",
            Arc::clone(&sink),
        ));
    }
    if let Some(stderr) = adapter.stderr.take() {
        tokio::spawn(forward_adapter_output(
            stderr,
            session_id.clone(),
            "stderr",
            Arc::clone(&sink),
        ));
    }

    let (client, target_clients) = match configure_node_debug_connection_inner(
        stream,
        session_id,
        &launch,
        sink,
        Some(address),
    )
    .await
    {
        Ok(configured) => configured,
        Err(error) => {
            let _ = adapter.kill().await;
            let _ = adapter.wait().await;
            return Err(error);
        }
    };
    Ok(StartedDebugSession {
        adapter_label: "vscode-js-debug",
        adapter,
        client,
        target_clients,
    })
}

pub(crate) async fn stop_debug_session_inner(
    session: &mut StartedDebugSession,
) -> Result<(), String> {
    let target_clients = session.target_clients.lock().await.clone();
    for target_client in target_clients.iter().rev() {
        if let Ok(request) = target_client
            .begin_request(
                "disconnect",
                serde_json::json!({ "restart": false, "terminateDebuggee": true }),
            )
            .await
        {
            let _ = request.wait(DEBUGPY_STOP_TIMEOUT).await;
        }
    }
    let disconnect = session
        .client
        .begin_request(
            "disconnect",
            serde_json::json!({ "restart": false, "terminateDebuggee": true }),
        )
        .await;
    if let Ok(request) = disconnect {
        let _ = request.wait(DEBUGPY_STOP_TIMEOUT).await;
    }

    if session
        .adapter
        .try_wait()
        .map_err(|error| format!("Unable to inspect {}: {error}", session.adapter_label))?
        .is_none()
    {
        let _ = session.adapter.start_kill();
        if timeout(DEBUGPY_STOP_TIMEOUT, session.adapter.wait())
            .await
            .is_err()
        {
            let _ = session.adapter.kill().await;
            let _ = session.adapter.wait().await;
        }
    }
    Ok(())
}

struct TauriDebugEventSink {
    app: AppHandle,
}

impl DebugEventSink for TauriDebugEventSink {
    fn emit(&self, session_id: &str, event: &Value) -> Result<(), String> {
        self.app
            .emit(DEBUG_EVENT_NAME, normalize_debug_event(session_id, event))
            .map_err(|error| error.to_string())
    }
}

struct ManagedDebugSession {
    id: String,
    name: String,
    debug_type: &'static str,
    workspace_root: PathBuf,
    started: Mutex<StartedDebugSession>,
}

#[derive(Default)]
pub struct DebugAdapterState {
    start_lock: Mutex<()>,
    session: Mutex<Option<Arc<ManagedDebugSession>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionSnapshot {
    pub session_id: String,
    pub name: String,
    pub lifecycle: String,
}

fn session_snapshot(session: &ManagedDebugSession, lifecycle: &str) -> DebugSessionSnapshot {
    DebugSessionSnapshot {
        session_id: session.id.clone(),
        name: session.name.clone(),
        lifecycle: lifecycle.to_string(),
    }
}

async fn ensure_debug_session_slot_available(state: &DebugAdapterState) -> Result<(), String> {
    let mut slot = state.session.lock().await;
    if let Some(existing) = slot.as_ref() {
        let exited = existing
            .started
            .lock()
            .await
            .adapter
            .try_wait()
            .map_err(|error| format!("Unable to inspect the active debug adapter: {error}"))?
            .is_some();
        if !exited {
            return Err(
                "A debug session is already active. Stop it before starting another one."
                    .to_string(),
            );
        }
        slot.take();
    }
    Ok(())
}

fn resolve_js_debug_adapter_entry(app: &AppHandle) -> Result<PathBuf, String> {
    let entry = app
        .path()
        .resolve(
            "resources/vscode-js-debug/js-debug/src/dapDebugServer.js",
            BaseDirectory::Resource,
        )
        .map_err(|error| error.to_string())?;
    if entry.is_file() {
        Ok(entry)
    } else {
        Err(format!(
            "Bundled js-debug adapter not found: {}",
            entry.to_string_lossy()
        ))
    }
}

async fn resolve_active_session(
    state: &DebugAdapterState,
    session_id: &str,
) -> Result<Arc<ManagedDebugSession>, String> {
    let session = state
        .session
        .lock()
        .await
        .clone()
        .ok_or_else(|| "There is no active debug session.".to_string())?;
    if session.id != session_id {
        return Err("The debug request belongs to a stale session.".to_string());
    }
    Ok(session)
}

async fn active_client(
    state: &DebugAdapterState,
    session_id: &str,
) -> Result<Arc<DapClient>, String> {
    let session = resolve_active_session(state, session_id).await?;
    let started = session.started.lock().await;
    let target_client = started.target_clients.lock().await.last().cloned();
    Ok(target_client.unwrap_or_else(|| Arc::clone(&started.client)))
}

#[tauri::command]
pub async fn desktop_start_python_debug_session(
    request: PythonDebugLaunchRequest,
    app: AppHandle,
    state: State<'_, DebugAdapterState>,
) -> Result<DebugSessionSnapshot, String> {
    let _start_guard = state.start_lock.lock().await;
    ensure_debug_session_slot_available(&state).await?;

    let launch = validate_python_debug_request(request)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let name = launch.name.clone();
    let workspace_root = launch.workspace_root.clone();
    let sink: Arc<dyn DebugEventSink> = Arc::new(TauriDebugEventSink { app });
    let started = start_python_debug_session_inner(session_id.clone(), launch, sink).await?;
    let managed = Arc::new(ManagedDebugSession {
        id: session_id,
        name,
        debug_type: "Python",
        workspace_root,
        started: Mutex::new(started),
    });
    let snapshot = session_snapshot(&managed, "running");
    *state.session.lock().await = Some(managed);
    Ok(snapshot)
}

#[tauri::command]
pub async fn desktop_start_node_debug_session(
    request: NodeDebugLaunchRequest,
    app: AppHandle,
    state: State<'_, DebugAdapterState>,
) -> Result<DebugSessionSnapshot, String> {
    let _start_guard = state.start_lock.lock().await;
    ensure_debug_session_slot_available(&state).await?;

    let launch = validate_node_debug_request(request)?;
    let adapter_entry = resolve_js_debug_adapter_entry(&app)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let name = launch.name.clone();
    let workspace_root = launch.workspace_root.clone();
    let sink: Arc<dyn DebugEventSink> = Arc::new(TauriDebugEventSink { app });
    let started = start_node_debug_session_inner(
        session_id.clone(),
        launch,
        "node".to_string(),
        adapter_entry,
        sink,
    )
    .await?;
    let managed = Arc::new(ManagedDebugSession {
        id: session_id,
        name,
        debug_type: "Node",
        workspace_root,
        started: Mutex::new(started),
    });
    let snapshot = session_snapshot(&managed, "running");
    *state.session.lock().await = Some(managed);
    Ok(snapshot)
}

#[tauri::command]
pub async fn desktop_get_debug_session_status(
    session_id: String,
    state: State<'_, DebugAdapterState>,
) -> Result<DebugSessionSnapshot, String> {
    let session = resolve_active_session(&state, &session_id).await?;
    let mut started = session.started.lock().await;
    let lifecycle = if started
        .adapter
        .try_wait()
        .map_err(|error| format!("Unable to inspect {}: {error}", started.adapter_label))?
        .is_some()
    {
        "terminated"
    } else {
        "running"
    };
    Ok(session_snapshot(&session, lifecycle))
}

#[tauri::command]
pub async fn desktop_set_debug_breakpoints(
    session_id: String,
    source_path: String,
    lines: Vec<u32>,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    let session = resolve_active_session(&state, &session_id).await?;
    let source = canonical_workspace_child(
        &session.workspace_root,
        source_path.trim(),
        session.debug_type,
        "breakpoint source",
    )?;
    if !source.is_file() {
        return Err(format!(
            "{} debug breakpoint source must be a regular file.",
            session.debug_type
        ));
    }
    if lines.iter().any(|line| *line == 0) {
        return Err(format!(
            "{} debug breakpoint lines must start at 1.",
            session.debug_type
        ));
    }
    let mut unique_lines = lines;
    unique_lines.sort_unstable();
    unique_lines.dedup();
    let client = active_client(&state, &session_id).await?;
    client
        .request(
            "setBreakpoints",
            serde_json::json!({
                "source": { "path": source.to_string_lossy() },
                "breakpoints": unique_lines
                    .into_iter()
                    .map(|line| serde_json::json!({ "line": line }))
                    .collect::<Vec<_>>(),
                "sourceModified": false,
            }),
        )
        .await
}

async fn run_debug_control(
    state: &DebugAdapterState,
    session_id: &str,
    action: DebugControlAction,
    thread_id: i64,
) -> Result<Value, String> {
    let client = active_client(state, session_id).await?;
    let (command, arguments) = build_debug_control_request(action, thread_id);
    client.request(command, arguments).await
}

#[tauri::command]
pub async fn desktop_continue_debug_session(
    session_id: String,
    thread_id: i64,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_control(&state, &session_id, DebugControlAction::Continue, thread_id).await
}

#[tauri::command]
pub async fn desktop_pause_debug_session(
    session_id: String,
    thread_id: i64,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_control(&state, &session_id, DebugControlAction::Pause, thread_id).await
}

#[tauri::command]
pub async fn desktop_step_over_debug_session(
    session_id: String,
    thread_id: i64,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_control(&state, &session_id, DebugControlAction::StepOver, thread_id).await
}

#[tauri::command]
pub async fn desktop_step_into_debug_session(
    session_id: String,
    thread_id: i64,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_control(&state, &session_id, DebugControlAction::StepInto, thread_id).await
}

#[tauri::command]
pub async fn desktop_step_out_debug_session(
    session_id: String,
    thread_id: i64,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_control(&state, &session_id, DebugControlAction::StepOut, thread_id).await
}

async fn run_debug_query(
    state: &DebugAdapterState,
    session_id: &str,
    query: DebugQuery,
) -> Result<Value, String> {
    let client = active_client(state, session_id).await?;
    let (command, arguments) = build_debug_query_request(query)?;
    client.request(command, arguments).await
}

#[tauri::command]
pub async fn desktop_get_debug_threads(
    session_id: String,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_query(&state, &session_id, DebugQuery::Threads).await
}

#[tauri::command]
pub async fn desktop_get_debug_stack_trace(
    session_id: String,
    thread_id: i64,
    start_frame: Option<u32>,
    levels: Option<u32>,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_query(
        &state,
        &session_id,
        DebugQuery::StackTrace {
            thread_id,
            start_frame: start_frame.unwrap_or(0),
            levels: levels.unwrap_or(50),
        },
    )
    .await
}

#[tauri::command]
pub async fn desktop_get_debug_scopes(
    session_id: String,
    frame_id: i64,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_query(&state, &session_id, DebugQuery::Scopes { frame_id }).await
}

#[tauri::command]
pub async fn desktop_get_debug_variables(
    session_id: String,
    variables_reference: i64,
    start: Option<u32>,
    count: Option<u32>,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_query(
        &state,
        &session_id,
        DebugQuery::Variables {
            variables_reference,
            start: start.unwrap_or(0),
            count: count.unwrap_or(200),
        },
    )
    .await
}

#[tauri::command]
pub async fn desktop_evaluate_debug_expression(
    session_id: String,
    expression: String,
    frame_id: Option<i64>,
    context: Option<String>,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    run_debug_query(
        &state,
        &session_id,
        DebugQuery::Evaluate {
            expression,
            frame_id,
            context: context.unwrap_or_else(|| "watch".to_string()),
        },
    )
    .await
}

#[tauri::command]
pub async fn desktop_restart_debug_session(
    session_id: String,
    state: State<'_, DebugAdapterState>,
) -> Result<Value, String> {
    active_client(&state, &session_id)
        .await?
        .request("restart", serde_json::json!({}))
        .await
}

#[tauri::command]
pub async fn desktop_stop_debug_session(
    session_id: String,
    state: State<'_, DebugAdapterState>,
) -> Result<DebugSessionSnapshot, String> {
    let session = {
        let mut slot = state.session.lock().await;
        let session = slot
            .as_ref()
            .cloned()
            .ok_or_else(|| "There is no active debug session.".to_string())?;
        if session.id != session_id {
            return Err("The debug request belongs to a stale session.".to_string());
        }
        slot.take();
        session
    };
    let mut started = session.started.lock().await;
    stop_debug_session_inner(&mut started).await?;
    drop(started);
    Ok(session_snapshot(&session, "terminated"))
}

pub(crate) fn encode_dap_message(message: &Value) -> Result<Vec<u8>, String> {
    let body =
        serde_json::to_vec(message).map_err(|_| "DAP message could not be encoded".to_string())?;
    if body.len() > MAX_DAP_MESSAGE_BYTES {
        return Err("DAP frame exceeds the 8 MiB limit".to_string());
    }

    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend_from_slice(&body);
    Ok(frame)
}

pub(crate) struct DapDecoder {
    buffer: Vec<u8>,
}

impl DapDecoder {
    pub(crate) fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, String> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();

        loop {
            let Some(header_end) = self
                .buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
            else {
                if self.buffer.len() > MAX_DAP_HEADER_BYTES {
                    return Err("DAP frame header exceeds the 16 KiB limit".to_string());
                }
                break;
            };

            let headers = std::str::from_utf8(&self.buffer[..header_end])
                .map_err(|_| "DAP frame header is not valid UTF-8".to_string())?;
            let content_length = headers
                .split("\r\n")
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.trim()
                        .eq_ignore_ascii_case("content-length")
                        .then_some(value.trim())
                })
                .ok_or_else(|| "DAP frame is missing Content-Length".to_string())?
                .parse::<usize>()
                .map_err(|_| "DAP Content-Length is invalid".to_string())?;

            if content_length > MAX_DAP_MESSAGE_BYTES {
                return Err("DAP frame exceeds the 8 MiB limit".to_string());
            }

            let body_start = header_end + 4;
            let frame_end = body_start
                .checked_add(content_length)
                .ok_or_else(|| "DAP Content-Length is invalid".to_string())?;
            if self.buffer.len() < frame_end {
                break;
            }

            let message: Value = serde_json::from_slice(&self.buffer[body_start..frame_end])
                .map_err(|_| "DAP frame contains invalid JSON".to_string())?;
            let valid_type = message
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|value| matches!(value, "request" | "response" | "event"));
            if !valid_type {
                return Err("DAP message is missing a valid type".to_string());
            }

            self.buffer.drain(..frame_end);
            messages.push(message);
        }

        Ok(messages)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_debug_control_request, build_debug_query_request, build_debugpy_adapter_arguments,
        configure_python_debug_connection, encode_dap_message, normalize_debug_event,
        start_python_debug_session_inner, stop_debug_session_inner, validate_python_debug_request,
        DapDecoder, DebugControlAction, DebugEventSink, DebugQuery, PythonDebugLaunchRequest,
        PythonDebugTarget, MAX_DAP_MESSAGE_BYTES,
    };
    use serde_json::{json, Value};
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::Duration,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn frame(value: &Value) -> Vec<u8> {
        let body = serde_json::to_vec(value).expect("serialize fixture");
        format!("Content-Length: {}\r\n\r\n", body.len())
            .into_bytes()
            .into_iter()
            .chain(body)
            .collect()
    }

    #[test]
    fn codec_encodes_a_dap_content_length_frame() {
        let message = json!({
            "seq": 1,
            "type": "request",
            "command": "threads",
        });

        let encoded = encode_dap_message(&message).expect("encode request");

        assert_eq!(encoded, frame(&message));
    }

    #[test]
    fn codec_decodes_partial_and_adjacent_frames() {
        let first = json!({ "seq": 1, "type": "event", "event": "initialized" });
        let second = json!({ "seq": 2, "type": "event", "event": "terminated" });
        let bytes = [frame(&first), frame(&second)].concat();
        let mut decoder = DapDecoder::new();
        let mut decoded = Vec::new();

        for byte in bytes {
            decoded.extend(decoder.push(&[byte]).expect("decode byte"));
        }

        assert_eq!(decoded, vec![first, second]);
    }

    #[test]
    fn codec_rejects_invalid_or_missing_content_lengths() {
        let mut missing = DapDecoder::new();
        let mut invalid = DapDecoder::new();

        assert_eq!(
            missing
                .push(b"Content-Type: application/json\r\n\r\n{}")
                .expect_err("missing length must fail"),
            "DAP frame is missing Content-Length"
        );
        assert_eq!(
            invalid
                .push(b"Content-Length: nope\r\n\r\n{}")
                .expect_err("invalid length must fail"),
            "DAP Content-Length is invalid"
        );
    }

    #[test]
    fn codec_rejects_oversized_invalid_json_and_missing_types() {
        let mut oversized = DapDecoder::new();
        let mut invalid_json = DapDecoder::new();
        let mut missing_type = DapDecoder::new();

        let oversized_header = format!("Content-Length: {}\r\n\r\n", MAX_DAP_MESSAGE_BYTES + 1);
        assert_eq!(
            oversized
                .push(oversized_header.as_bytes())
                .expect_err("oversized frame must fail"),
            "DAP frame exceeds the 8 MiB limit"
        );
        assert_eq!(
            invalid_json
                .push(b"Content-Length: 1\r\n\r\n{")
                .expect_err("invalid JSON must fail"),
            "DAP frame contains invalid JSON"
        );
        assert_eq!(
            missing_type
                .push(b"Content-Length: 9\r\n\r\n{\"seq\":1}")
                .expect_err("missing type must fail"),
            "DAP message is missing a valid type"
        );
    }

    fn python_request(
        workspace_root: &std::path::Path,
        target: PythonDebugTarget,
    ) -> PythonDebugLaunchRequest {
        PythonDebugLaunchRequest {
            name: "Debug fixture".to_string(),
            workspace_root_path: workspace_root.to_string_lossy().to_string(),
            python: Some("python".to_string()),
            target,
            cwd: workspace_root.to_string_lossy().to_string(),
            args: vec!["--mode".to_string(), "test".to_string()],
            env: HashMap::from([("LATTICE_DEBUG".to_string(), "1".to_string())]),
            just_my_code: false,
            stop_on_entry: true,
            sub_process: false,
            breakpoints: Vec::new(),
        }
    }

    fn node_request(
        workspace_root: &std::path::Path,
        program: &std::path::Path,
    ) -> super::NodeDebugLaunchRequest {
        super::NodeDebugLaunchRequest {
            name: "Debug Node fixture".to_string(),
            workspace_root_path: workspace_root.to_string_lossy().to_string(),
            program: program.to_string_lossy().to_string(),
            cwd: workspace_root.to_string_lossy().to_string(),
            runtime_executable: "node".to_string(),
            runtime_args: vec!["--enable-source-maps".to_string()],
            args: vec!["--mode".to_string(), "test".to_string()],
            env: HashMap::from([("NODE_ENV".to_string(), "development".to_string())]),
            stop_on_entry: true,
            source_maps: true,
            smart_step: true,
            skip_files: vec!["<node_internals>/**".to_string()],
            out_files: vec![format!("{}/dist/**/*.js", workspace_root.to_string_lossy())],
            breakpoints: vec![super::DebugSourceBreakpoint {
                path: program.to_string_lossy().to_string(),
                line: 1,
            }],
        }
    }

    #[test]
    fn node_session_validation_accepts_workspace_launch_and_rejects_escapes() {
        let workspace = tempfile::tempdir().expect("workspace fixture");
        let program = workspace.path().join("app.js");
        std::fs::write(&program, "const value = 42;\nconsole.log(value);\n")
            .expect("node program fixture");

        let validated =
            super::validate_node_debug_request(node_request(workspace.path(), &program))
                .expect("Node launch should validate");
        assert_eq!(validated.program, std::fs::canonicalize(&program).unwrap());
        assert_eq!(validated.runtime_executable, "node");
        assert_eq!(validated.breakpoints[0].line, 1);

        let outside = tempfile::tempdir().expect("outside fixture");
        let outside_program = outside.path().join("outside.js");
        std::fs::write(&outside_program, "console.log('outside');\n").expect("outside program");
        let program_error =
            super::validate_node_debug_request(node_request(workspace.path(), &outside_program))
                .expect_err("outside program must fail");
        assert_eq!(
            program_error,
            "Node debug program must stay inside the workspace."
        );

        let mut out_files_escape = node_request(workspace.path(), &program);
        out_files_escape.out_files = vec!["../dist/**/*.js".to_string()];
        assert_eq!(
            super::validate_node_debug_request(out_files_escape)
                .expect_err("outside outFiles must fail"),
            "Node debug outFiles must stay inside the workspace."
        );
    }

    #[test]
    fn session_validation_accepts_workspace_programs_and_modules() {
        let workspace = tempfile::tempdir().expect("workspace fixture");
        let program = workspace.path().join("app.py");
        std::fs::write(&program, "value = 42\n").expect("program fixture");

        let mut program_request = python_request(
            workspace.path(),
            PythonDebugTarget::Program {
                value: program.to_string_lossy().to_string(),
            },
        );
        program_request.breakpoints = vec![super::DebugSourceBreakpoint {
            path: program.to_string_lossy().to_string(),
            line: 1,
        }];
        let module_request = python_request(
            workspace.path(),
            PythonDebugTarget::Module {
                value: "package.module_name".to_string(),
            },
        );

        let validated_program =
            validate_python_debug_request(program_request).expect("program should validate");
        let validated_module =
            validate_python_debug_request(module_request).expect("module should validate");

        assert_eq!(
            validated_program.workspace_root,
            std::fs::canonicalize(workspace.path()).expect("canonical workspace")
        );
        assert_eq!(
            validated_program.program.as_deref(),
            Some(
                std::fs::canonicalize(program)
                    .expect("canonical program")
                    .as_path()
            )
        );
        assert_eq!(
            validated_program.breakpoints[0].path,
            validated_program
                .program
                .as_ref()
                .expect("validated program")
                .to_string_lossy()
        );
        assert_eq!(
            validated_module.module.as_deref(),
            Some("package.module_name")
        );
    }

    #[test]
    fn session_validation_rejects_paths_outside_the_workspace() {
        let workspace = tempfile::tempdir().expect("workspace fixture");
        let outside = tempfile::tempdir().expect("outside fixture");
        let outside_program = outside.path().join("outside.py");
        std::fs::write(&outside_program, "print('outside')\n").expect("outside program");

        let program_error = validate_python_debug_request(python_request(
            workspace.path(),
            PythonDebugTarget::Program {
                value: outside_program.to_string_lossy().to_string(),
            },
        ))
        .expect_err("outside program must fail");
        let mut cwd_request = python_request(
            workspace.path(),
            PythonDebugTarget::Module {
                value: "package.module".to_string(),
            },
        );
        cwd_request.cwd = outside.path().to_string_lossy().to_string();
        let cwd_error =
            validate_python_debug_request(cwd_request).expect_err("outside cwd must fail");
        let mut breakpoint_request = python_request(
            workspace.path(),
            PythonDebugTarget::Module {
                value: "package.module".to_string(),
            },
        );
        breakpoint_request.breakpoints = vec![super::DebugSourceBreakpoint {
            path: outside_program.to_string_lossy().to_string(),
            line: 1,
        }];
        let breakpoint_error = validate_python_debug_request(breakpoint_request)
            .expect_err("outside breakpoint must fail");

        assert_eq!(
            program_error,
            "Python debug program must stay inside the workspace."
        );
        assert_eq!(
            cwd_error,
            "Python debug cwd must stay inside the workspace."
        );
        assert_eq!(
            breakpoint_error,
            "Python debug breakpoint source must stay inside the workspace."
        );
    }

    #[test]
    fn session_validation_rejects_invalid_modules_and_oversized_environments() {
        let workspace = tempfile::tempdir().expect("workspace fixture");
        let invalid_module = python_request(
            workspace.path(),
            PythonDebugTarget::Module {
                value: "package/invalid-module".to_string(),
            },
        );
        let mut oversized_environment = python_request(
            workspace.path(),
            PythonDebugTarget::Module {
                value: "package.module".to_string(),
            },
        );
        oversized_environment.env = HashMap::from([("VALUE".to_string(), "x".repeat(128 * 1024))]);

        assert_eq!(
            validate_python_debug_request(invalid_module).expect_err("invalid module must fail"),
            "Python debug module must be a dotted Python identifier."
        );
        assert_eq!(
            validate_python_debug_request(oversized_environment)
                .expect_err("oversized environment must fail"),
            "Python debug environment exceeds the 128 KiB limit."
        );
    }

    #[derive(Default)]
    struct RecordingEventSink {
        events: Mutex<Vec<Value>>,
    }

    impl DebugEventSink for RecordingEventSink {
        fn emit(&self, _session_id: &str, event: &Value) -> Result<(), String> {
            self.events
                .lock()
                .expect("event sink lock")
                .push(event.clone());
            Ok(())
        }
    }

    async fn write_fake_message(stream: &mut tokio::net::TcpStream, message: Value) {
        stream
            .write_all(&encode_dap_message(&message).expect("encode fake response"))
            .await
            .expect("write fake response");
    }

    #[tokio::test]
    async fn session_rejects_unsupported_reverse_requests_without_hanging_adapter() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake adapter");
        let address = listener.local_addr().expect("fake adapter address");
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept DAP client");
            write_fake_message(
                &mut stream,
                json!({
                    "seq": 31,
                    "type": "request",
                    "command": "runInTerminal",
                    "arguments": {},
                }),
            )
            .await;

            let mut decoder = DapDecoder::new();
            let mut buffer = [0_u8; 4096];
            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    let count = stream
                        .read(&mut buffer)
                        .await
                        .expect("read reverse response");
                    assert!(count > 0, "client closed before reverse response");
                    if let Some(response) = decoder
                        .push(&buffer[..count])
                        .expect("decode reverse response")
                        .into_iter()
                        .next()
                    {
                        return response;
                    }
                }
            })
            .await
            .expect("reverse request response timeout")
        });

        let stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect fake adapter");
        let sink = Arc::new(RecordingEventSink::default());
        let client = super::DapClient::new(stream, "reverse-request".to_string(), sink);
        let response = server.await.expect("fake adapter task");

        assert_eq!(response["type"], "response");
        assert_eq!(response["request_seq"], 31);
        assert_eq!(response["command"], "runInTerminal");
        assert_eq!(response["success"], false);
        assert!(response["message"]
            .as_str()
            .is_some_and(|message| message.contains("does not support adapter reverse request")));
        drop(client);
    }

    #[tokio::test]
    async fn session_protocol_configures_breakpoints_before_running() {
        let workspace = tempfile::tempdir().expect("workspace fixture");
        let program = workspace.path().join("app.py");
        std::fs::write(&program, "value = 42\nprint(value)\n").expect("program fixture");
        let mut request = python_request(
            workspace.path(),
            PythonDebugTarget::Program {
                value: program.to_string_lossy().to_string(),
            },
        );
        request.breakpoints = vec![super::DebugSourceBreakpoint {
            path: program.to_string_lossy().to_string(),
            line: 1,
        }];
        let launch = validate_python_debug_request(request).expect("valid launch");
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake adapter");
        let address = listener.local_addr().expect("fake adapter address");
        let commands = Arc::new(Mutex::new(Vec::<String>::new()));
        let server_commands = Arc::clone(&commands);

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept DAP client");
            let mut decoder = DapDecoder::new();
            let mut buffer = [0_u8; 4096];
            let mut server_seq = 1_i64;
            let mut launch_request_seq = None;
            loop {
                let count = stream.read(&mut buffer).await.expect("read DAP request");
                if count == 0 {
                    break;
                }
                for message in decoder.push(&buffer[..count]).expect("decode DAP request") {
                    let command = message["command"]
                        .as_str()
                        .expect("request command")
                        .to_string();
                    let request_seq = message["seq"].as_i64().expect("request sequence");
                    server_commands
                        .lock()
                        .expect("commands lock")
                        .push(command.clone());

                    if command == "launch" {
                        launch_request_seq = Some(request_seq);
                        write_fake_message(
                            &mut stream,
                            json!({ "seq": server_seq, "type": "event", "event": "initialized" }),
                        )
                        .await;
                        server_seq += 1;
                        continue;
                    }

                    let body = if command == "initialize" {
                        json!({ "supportsConfigurationDoneRequest": true })
                    } else if command == "setBreakpoints" {
                        json!({ "breakpoints": [{ "verified": true, "line": 1 }] })
                    } else {
                        json!({})
                    };
                    write_fake_message(
                        &mut stream,
                        json!({
                            "seq": server_seq,
                            "type": "response",
                            "request_seq": request_seq,
                            "success": true,
                            "command": command,
                            "body": body,
                        }),
                    )
                    .await;
                    server_seq += 1;

                    if command == "configurationDone" {
                        write_fake_message(
                            &mut stream,
                            json!({
                                "seq": server_seq,
                                "type": "response",
                                "request_seq": launch_request_seq.expect("launch sequence"),
                                "success": true,
                                "command": "launch",
                                "body": {},
                            }),
                        )
                        .await;
                        break;
                    }
                }
                if server_commands
                    .lock()
                    .expect("commands lock")
                    .last()
                    .is_some_and(|command| command == "configurationDone")
                {
                    break;
                }
            }
        });

        let stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect fake adapter");
        let sink = Arc::new(RecordingEventSink::default());
        let client = configure_python_debug_connection(
            stream,
            "debug-session-1".to_string(),
            &launch,
            sink.clone(),
        )
        .await
        .expect("configure debug connection");
        server.await.expect("fake adapter task");

        assert_eq!(
            *commands.lock().expect("commands lock"),
            vec![
                "initialize",
                "launch",
                "setBreakpoints",
                "setExceptionBreakpoints",
                "configurationDone",
            ]
        );
        assert!(sink
            .events
            .lock()
            .expect("events lock")
            .iter()
            .any(|event| event["event"] == "initialized"));
        assert!(sink
            .events
            .lock()
            .expect("events lock")
            .iter()
            .any(|event| {
                event["event"] == "breakpoints"
                    && event["body"]["breakpoints"][0]["verified"] == true
            }));
        drop(client);
    }

    #[tokio::test]
    async fn node_session_protocol_configures_js_debug_before_running() {
        let workspace = tempfile::tempdir().expect("workspace fixture");
        let program = workspace.path().join("app.js");
        std::fs::write(&program, "const value = 42;\nconsole.log(value);\n")
            .expect("node program fixture");
        let launch = super::validate_node_debug_request(node_request(workspace.path(), &program))
            .expect("valid Node launch");
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake adapter");
        let address = listener.local_addr().expect("fake adapter address");
        let commands = Arc::new(Mutex::new(Vec::<String>::new()));
        let launch_arguments = Arc::new(Mutex::new(Value::Null));
        let server_commands = Arc::clone(&commands);
        let server_launch_arguments = Arc::clone(&launch_arguments);

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept DAP client");
            let mut decoder = DapDecoder::new();
            let mut buffer = [0_u8; 4096];
            let mut server_seq = 1_i64;
            let mut launch_request_seq = None;
            loop {
                let count = stream.read(&mut buffer).await.expect("read DAP request");
                if count == 0 {
                    break;
                }
                for message in decoder.push(&buffer[..count]).expect("decode DAP request") {
                    let command = message["command"]
                        .as_str()
                        .expect("request command")
                        .to_string();
                    let request_seq = message["seq"].as_i64().expect("request sequence");
                    server_commands
                        .lock()
                        .expect("commands lock")
                        .push(command.clone());
                    if command == "launch" {
                        *server_launch_arguments
                            .lock()
                            .expect("launch arguments lock") = message["arguments"].clone();
                        launch_request_seq = Some(request_seq);
                        write_fake_message(
                            &mut stream,
                            json!({ "seq": server_seq, "type": "event", "event": "initialized" }),
                        )
                        .await;
                        server_seq += 1;
                        continue;
                    }
                    let body = if command == "setBreakpoints" {
                        json!({ "breakpoints": [{ "verified": true, "line": 1 }] })
                    } else {
                        json!({})
                    };
                    write_fake_message(
                        &mut stream,
                        json!({
                            "seq": server_seq,
                            "type": "response",
                            "request_seq": request_seq,
                            "success": true,
                            "command": command,
                            "body": body,
                        }),
                    )
                    .await;
                    server_seq += 1;
                    if command == "configurationDone" {
                        write_fake_message(
                            &mut stream,
                            json!({
                                "seq": server_seq,
                                "type": "response",
                                "request_seq": launch_request_seq.expect("launch sequence"),
                                "success": true,
                                "command": "launch",
                                "body": {},
                            }),
                        )
                        .await;
                        return;
                    }
                }
            }
        });

        let stream = tokio::net::TcpStream::connect(address)
            .await
            .expect("connect fake adapter");
        let sink = Arc::new(RecordingEventSink::default());
        let client = super::configure_node_debug_connection(
            stream,
            "node-debug-session".to_string(),
            &launch,
            sink,
        )
        .await
        .expect("configure Node debug connection");
        server.await.expect("fake adapter task");

        assert_eq!(
            *commands.lock().expect("commands lock"),
            vec![
                "initialize",
                "launch",
                "setBreakpoints",
                "setExceptionBreakpoints",
                "configurationDone",
            ]
        );
        let launch_arguments = launch_arguments.lock().expect("launch arguments lock");
        assert_eq!(launch_arguments["type"], "pwa-node");
        assert_eq!(launch_arguments["console"], "internalConsole");
        assert_eq!(launch_arguments["autoAttachChildProcesses"], false);
        assert_eq!(launch_arguments["sourceMaps"], true);
        assert_eq!(launch_arguments["smartStep"], true);
        assert_eq!(
            launch_arguments["__workspaceFolder"],
            launch.workspace_root.to_string_lossy().as_ref()
        );
        drop(client);
    }

    async fn wait_for_recorded_event(sink: &RecordingEventSink, event_name: &str) -> Value {
        let result = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if let Some(event) = sink
                    .events
                    .lock()
                    .expect("events lock")
                    .iter()
                    .find(|event| event["event"] == event_name)
                    .cloned()
                {
                    return event;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await;
        match result {
            Ok(event) => event,
            Err(_) => panic!(
                "debug event {event_name} timeout; received events: {:?}",
                sink.events.lock().expect("events lock")
            ),
        }
    }

    #[tokio::test]
    async fn session_real_debugpy_smoke() {
        if std::env::var("LATTICE_REAL_DEBUGPY_SMOKE").as_deref() != Ok("1") {
            return;
        }

        let workspace = tempfile::tempdir().expect("workspace fixture");
        let temporary_path = workspace.path().to_path_buf();
        assert!(
            !temporary_path.starts_with(
                std::fs::canonicalize(env!("CARGO_MANIFEST_DIR"))
                    .expect("canonical manifest directory")
            ),
            "real debug smoke must not use the Lattice repository"
        );
        let program = workspace.path().join("debug_fixture.py");
        std::fs::write(
            &program,
            "def main():\n    lattice_value = 42\n    print(lattice_value)\nmain()\n",
        )
        .expect("debug fixture");
        let mut request = python_request(
            workspace.path(),
            PythonDebugTarget::Program {
                value: program.to_string_lossy().to_string(),
            },
        );
        request.breakpoints = vec![super::DebugSourceBreakpoint {
            path: program.to_string_lossy().to_string(),
            line: 3,
        }];
        request.stop_on_entry = false;
        let launch = validate_python_debug_request(request).expect("valid launch");
        let sink = Arc::new(RecordingEventSink::default());
        let session_result = start_python_debug_session_inner(
            "real-debugpy-smoke".to_string(),
            launch,
            sink.clone(),
        )
        .await;
        let mut session = match session_result {
            Ok(session) => session,
            Err(error) => panic!(
                "start real debugpy session: {error}; received events: {:?}",
                sink.events.lock().expect("events lock")
            ),
        };

        let stopped = wait_for_recorded_event(&sink, "stopped").await;
        let thread_id = stopped["body"]["threadId"]
            .as_i64()
            .expect("stopped thread id");
        let threads = session
            .client
            .request("threads", json!({}))
            .await
            .expect("load threads");
        assert!(threads["threads"]
            .as_array()
            .is_some_and(|threads| !threads.is_empty()));
        let stack = session
            .client
            .request(
                "stackTrace",
                json!({ "threadId": thread_id, "startFrame": 0, "levels": 20 }),
            )
            .await
            .expect("load stack");
        let frame_id = stack["stackFrames"][0]["id"]
            .as_i64()
            .expect("top frame id");
        let scopes = session
            .client
            .request("scopes", json!({ "frameId": frame_id }))
            .await
            .expect("load scopes");
        let locals_reference = scopes["scopes"]
            .as_array()
            .and_then(|scopes| scopes.iter().find(|scope| scope["name"] == "Locals"))
            .and_then(|scope| scope["variablesReference"].as_i64())
            .expect("locals reference");
        let variables = session
            .client
            .request(
                "variables",
                json!({ "variablesReference": locals_reference }),
            )
            .await
            .expect("load variables");
        assert!(variables["variables"].as_array().is_some_and(|variables| {
            variables
                .iter()
                .any(|variable| variable["name"] == "lattice_value" && variable["value"] == "42")
        }));

        session
            .client
            .request(
                "continue",
                json!({ "threadId": thread_id, "singleThread": false }),
            )
            .await
            .expect("continue debuggee");
        wait_for_recorded_event(&sink, "terminated").await;
        stop_debug_session_inner(&mut session)
            .await
            .expect("stop real debug session");
        assert!(session
            .adapter
            .try_wait()
            .expect("adapter status")
            .is_some());
        drop(session);
        if workspace.close().is_err() {
            for _ in 0..40 {
                if !temporary_path.exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
                let _ = std::fs::remove_dir_all(&temporary_path);
            }
        }
        assert!(
            !temporary_path.exists(),
            "temporary workspace should be deleted"
        );
    }

    #[tokio::test]
    async fn node_session_real_js_debug_smoke() {
        if std::env::var("LATTICE_REAL_NODE_DEBUG_SMOKE").as_deref() != Ok("1") {
            return;
        }

        let workspace = tempfile::tempdir().expect("workspace fixture");
        let program = workspace.path().join("debug_fixture.js");
        std::fs::write(
            &program,
            "function main() {\n  const latticeValue = 42;\n  console.log(latticeValue);\n}\nmain();\n",
        )
        .expect("Node debug fixture");
        let mut request = node_request(workspace.path(), &program);
        request.breakpoints = vec![super::DebugSourceBreakpoint {
            path: program.to_string_lossy().to_string(),
            line: 3,
        }];
        request.stop_on_entry = false;
        let launch = super::validate_node_debug_request(request).expect("valid Node launch");
        let adapter_entry = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("vscode-js-debug")
            .join("js-debug")
            .join("src")
            .join("dapDebugServer.js");
        let sink = Arc::new(RecordingEventSink::default());
        let session_result = super::start_node_debug_session_inner(
            "real-js-debug-smoke".to_string(),
            launch,
            "node".to_string(),
            adapter_entry,
            sink.clone(),
        )
        .await;
        let mut session = match session_result {
            Ok(session) => session,
            Err(error) => panic!(
                "start real js-debug session: {error}; received events: {:?}",
                sink.events.lock().expect("events lock")
            ),
        };

        let stopped = wait_for_recorded_event(&sink, "stopped").await;
        let thread_id = stopped["body"]["threadId"]
            .as_i64()
            .expect("stopped thread id");
        let target_client = session
            .target_clients
            .lock()
            .await
            .last()
            .cloned()
            .expect("active Node target client");
        let stack = target_client
            .request(
                "stackTrace",
                json!({ "threadId": thread_id, "startFrame": 0, "levels": 20 }),
            )
            .await
            .expect("load Node stack");
        let frame_id = stack["stackFrames"][0]["id"]
            .as_i64()
            .expect("top Node frame id");
        let scopes = target_client
            .request("scopes", json!({ "frameId": frame_id }))
            .await
            .expect("load Node scopes");
        let locals_reference = scopes["scopes"]
            .as_array()
            .and_then(|scopes| {
                scopes.iter().find(|scope| {
                    scope["name"]
                        .as_str()
                        .is_some_and(|name| name.contains("Local"))
                })
            })
            .and_then(|scope| scope["variablesReference"].as_i64())
            .expect("Node locals reference");
        let variables = target_client
            .request(
                "variables",
                json!({ "variablesReference": locals_reference }),
            )
            .await
            .expect("load Node variables");
        assert!(variables["variables"].as_array().is_some_and(|variables| {
            variables
                .iter()
                .any(|variable| variable["name"] == "latticeValue" && variable["value"] == "42")
        }));

        target_client
            .request(
                "continue",
                json!({ "threadId": thread_id, "singleThread": false }),
            )
            .await
            .expect("continue Node debuggee");
        wait_for_recorded_event(&sink, "terminated").await;
        super::stop_debug_session_inner(&mut session)
            .await
            .expect("stop real Node debug session");
    }

    #[test]
    fn session_builds_fixed_adapter_and_control_requests() {
        assert_eq!(
            build_debugpy_adapter_arguments(43123),
            vec![
                "-m",
                "debugpy.adapter",
                "--host",
                "127.0.0.1",
                "--port",
                "43123",
            ]
        );
        assert_eq!(
            build_debug_control_request(DebugControlAction::Continue, 7),
            ("continue", json!({ "threadId": 7, "singleThread": false }))
        );
        assert_eq!(
            build_debug_control_request(DebugControlAction::Pause, 7),
            ("pause", json!({ "threadId": 7 }))
        );
        assert_eq!(
            build_debug_control_request(DebugControlAction::StepOver, 7),
            ("next", json!({ "threadId": 7, "singleThread": false }))
        );
        assert_eq!(
            build_debug_control_request(DebugControlAction::StepInto, 7),
            ("stepIn", json!({ "threadId": 7, "singleThread": false }))
        );
        assert_eq!(
            build_debug_control_request(DebugControlAction::StepOut, 7),
            ("stepOut", json!({ "threadId": 7, "singleThread": false }))
        );
    }

    #[test]
    fn session_normalizes_events_with_their_session_identity() {
        let envelope = normalize_debug_event(
            "debug-session-1",
            &json!({
                "seq": 12,
                "type": "event",
                "event": "stopped",
                "body": { "reason": "breakpoint", "threadId": 7 },
            }),
        );

        assert_eq!(envelope.session_id, "debug-session-1");
        assert_eq!(envelope.event, "stopped");
        assert_eq!(
            envelope.body,
            json!({ "reason": "breakpoint", "threadId": 7 })
        );
    }

    #[test]
    fn session_builds_bounded_query_requests() {
        assert_eq!(
            build_debug_query_request(DebugQuery::Threads).expect("threads query"),
            ("threads", json!({}))
        );
        assert_eq!(
            build_debug_query_request(DebugQuery::StackTrace {
                thread_id: 7,
                start_frame: 5,
                levels: 50,
            })
            .expect("stack query"),
            (
                "stackTrace",
                json!({ "threadId": 7, "startFrame": 5, "levels": 50 })
            )
        );
        assert_eq!(
            build_debug_query_request(DebugQuery::Variables {
                variables_reference: 9,
                start: 0,
                count: 200,
            })
            .expect("variables query"),
            (
                "variables",
                json!({ "variablesReference": 9, "start": 0, "count": 200 })
            )
        );
        assert_eq!(
            build_debug_query_request(DebugQuery::Evaluate {
                expression: "lattice_value + 1".to_string(),
                frame_id: Some(11),
                context: "watch".to_string(),
            })
            .expect("evaluate query"),
            (
                "evaluate",
                json!({
                    "expression": "lattice_value + 1",
                    "frameId": 11,
                    "context": "watch",
                })
            )
        );
        assert_eq!(
            build_debug_query_request(DebugQuery::Evaluate {
                expression: " ".to_string(),
                frame_id: None,
                context: "repl".to_string(),
            })
            .expect_err("empty expression must fail"),
            "Debug evaluation requires a non-empty expression."
        );
    }
}
