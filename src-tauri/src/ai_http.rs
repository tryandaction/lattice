use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::Serialize;
use tauri::ipc::Channel;

const MAX_AI_REQUEST_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_AI_RESPONSE_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_ACTIVE_AI_STREAMS: usize = 16;

#[derive(Clone, Copy)]
struct StreamTimeouts {
    first_response: Duration,
    idle: Duration,
    total: Duration,
}

impl Default for StreamTimeouts {
    fn default() -> Self {
        Self { first_response: Duration::from_secs(30), idle: Duration::from_secs(30), total: Duration::from_secs(600) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiNativeHttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Events emitted by the native streaming transport. Bytes are intentionally
/// kept as an array so binary-safe SSE framing is preserved across IPC.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiNativeHttpStreamEvent {
    Headers {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        data: Vec<u8>,
    },
    End,
    Error {
        message: String,
    },
}

struct StreamEntry {
    owner: String,
    cancelled: Arc<AtomicBool>,
    abort: Option<tokio::task::AbortHandle>,
}

#[derive(Clone, Default)]
pub struct AiHttpStreamState {
    entries: Arc<Mutex<HashMap<String, StreamEntry>>>,
}

impl AiHttpStreamState {
    fn cancel(&self, request_id: &str, owner: &str) -> Result<bool, String> {
        let mut entries = self.entries.lock().expect("AI stream registry poisoned");
        let Some(entry) = entries.get(request_id) else {
            return Ok(false);
        };
        if entry.owner != owner {
            return Err("AI HTTP stream belongs to another window.".to_string());
        }
        let entry = entries.remove(request_id).expect("checked stream entry");
        entry.cancelled.store(true, Ordering::Release);
        if let Some(abort) = entry.abort {
            abort.abort();
        }
        Ok(true)
    }

    pub fn cancel_window(&self, owner: &str) {
        self.entries
            .lock()
            .expect("AI stream registry poisoned")
            .retain(|_, entry| {
                if entry.owner != owner {
                    return true;
                }
                entry.cancelled.store(true, Ordering::Release);
                if let Some(abort) = &entry.abort {
                    abort.abort();
                }
                false
            });
    }

    fn remove_if_owner(&self, request_id: &str, cancelled: &Arc<AtomicBool>) {
        let mut entries = self.entries.lock().expect("AI stream registry poisoned");
        if entries
            .get(request_id)
            .is_some_and(|entry| Arc::ptr_eq(&entry.cancelled, cancelled))
        {
            entries.remove(request_id);
        }
    }
}

fn validate_ai_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("AI provider URL must use HTTP or HTTPS.".to_string()),
    }
}

#[tauri::command]
pub async fn ai_native_http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<AiNativeHttpResponse, String> {
    let parsed_url = validate_ai_url(&url)?;
    let parsed_method = reqwest::Method::from_bytes(method.trim().as_bytes())
        .map_err(|error| format!("Invalid AI HTTP method: {error}"))?;
    let body = body.unwrap_or_default();
    if body.len() > MAX_AI_REQUEST_BODY_BYTES {
        return Err("AI provider request body is too large.".to_string());
    }

    let timeout = timeout_ms.unwrap_or(30_000).clamp(1_000, 300_000);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_millis(timeout))
        .user_agent("Lattice/2.3.2 (+https://github.com/tryandaction/lattice)")
        .build()
        .map_err(|error| error.to_string())?;

    let mut request = client.request(parsed_method, parsed_url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if !body.is_empty() {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    if let Some(length) = response.content_length() {
        if length > MAX_AI_RESPONSE_BODY_BYTES as u64 {
            return Err("AI provider response body is too large.".to_string());
        }
    }

    let response_headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let response_body = response.bytes().await.map_err(|error| error.to_string())?;
    if response_body.len() > MAX_AI_RESPONSE_BODY_BYTES {
        return Err("AI provider response body is too large.".to_string());
    }
    let body = String::from_utf8(response_body.to_vec())
        .map_err(|_| "AI provider response was not valid UTF-8.".to_string())?;

    Ok(AiNativeHttpResponse {
        status,
        headers: response_headers,
        body,
    })
}

fn validate_stream_request_id(request_id: &str) -> Result<(), String> {
    let id = request_id.trim();
    if id.is_empty() || id.len() > 128 || id.chars().any(|character| character.is_control()) {
        return Err("AI HTTP stream request id is invalid.".to_string());
    }
    Ok(())
}

fn validate_ai_body(body: &str) -> Result<(), String> {
    if body.len() > MAX_AI_REQUEST_BODY_BYTES {
        return Err("AI provider request body is too large.".to_string());
    }
    Ok(())
}

fn response_headers(response: &reqwest::Response) -> HashMap<String, String> {
    response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect()
}

async fn run_native_http_stream(
    state: AiHttpStreamState,
    request_id: String,
    cancelled: Arc<AtomicBool>,
    request: reqwest::RequestBuilder,
    timeouts: StreamTimeouts,
    mut on_event: impl FnMut(AiNativeHttpStreamEvent) -> Result<(), ()>,
) {
    if cancelled.load(Ordering::Acquire) {
        state.remove_if_owner(&request_id, &cancelled);
        return;
    }
    let send_error = |on_event: &mut dyn FnMut(AiNativeHttpStreamEvent) -> Result<(), ()>,
                      message: String| {
        if !cancelled.load(Ordering::Acquire) {
            let _ = on_event(AiNativeHttpStreamEvent::Error { message });
        }
    };

    let started = std::time::Instant::now();
    let response = match tokio::time::timeout(timeouts.first_response.min(timeouts.total), request.send()).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            send_error(&mut on_event, error.to_string());
            state.remove_if_owner(&request_id, &cancelled);
            return;
        }
        Err(_) => {
            let phase = if timeouts.total <= timeouts.first_response { "overall" } else { "first-response" };
            send_error(&mut on_event, format!("AI request {phase} timed out."));
            state.remove_if_owner(&request_id, &cancelled);
            return;
        }
    };
    if cancelled.load(Ordering::Acquire) {
        state.remove_if_owner(&request_id, &cancelled);
        return;
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_AI_RESPONSE_BODY_BYTES as u64)
    {
        send_error(
            &mut on_event,
            "AI provider response body is too large.".to_string(),
        );
        state.remove_if_owner(&request_id, &cancelled);
        return;
    }
    let status = response.status().as_u16();
    if on_event(AiNativeHttpStreamEvent::Headers {
        status,
        headers: response_headers(&response),
    })
    .is_err()
    {
        cancelled.store(true, Ordering::Release);
        state.remove_if_owner(&request_id, &cancelled);
        return;
    }

    let mut response = response;
    let mut received = 0usize;
    loop {
        if cancelled.load(Ordering::Acquire) {
            state.remove_if_owner(&request_id, &cancelled);
            return;
        }
        let total_left = timeouts.total.saturating_sub(started.elapsed());
        let silence_left = if received == 0 { timeouts.first_response.saturating_sub(started.elapsed()) } else { timeouts.idle };
        let phase = if total_left <= silence_left { "overall" } else if received == 0 { "first-response" } else { "idle" };
        let wait = total_left.min(silence_left);
        if wait.is_zero() {
            send_error(&mut on_event, format!("AI request {phase} timed out."));
            state.remove_if_owner(&request_id, &cancelled);
            return;
        }
        let chunk = match tokio::time::timeout(wait, response.chunk()).await {
            Ok(Ok(Some(chunk))) => chunk,
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                send_error(&mut on_event, error.to_string());
                state.remove_if_owner(&request_id, &cancelled);
                return;
            }
            Err(_) => {
                send_error(&mut on_event, format!("AI request {phase} timed out."));
                state.remove_if_owner(&request_id, &cancelled);
                return;
            }
        };
        received = received.saturating_add(chunk.len());
        if received > MAX_AI_RESPONSE_BODY_BYTES {
            send_error(
                &mut on_event,
                "AI provider response body is too large.".to_string(),
            );
            state.remove_if_owner(&request_id, &cancelled);
            return;
        }
        if on_event(AiNativeHttpStreamEvent::Chunk {
            data: chunk.to_vec(),
        })
        .is_err()
        {
            cancelled.store(true, Ordering::Release);
            state.remove_if_owner(&request_id, &cancelled);
            return;
        }
    }
    if !cancelled.load(Ordering::Acquire) {
        let _ = on_event(AiNativeHttpStreamEvent::End);
    }
    state.remove_if_owner(&request_id, &cancelled);
}

#[tauri::command]
pub async fn ai_native_http_stream_start(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AiHttpStreamState>,
    request_id: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    idle_timeout_ms: Option<u64>,
    total_timeout_ms: Option<u64>,
    on_event: Channel<AiNativeHttpStreamEvent>,
) -> Result<(), String> {
    validate_stream_request_id(&request_id)?;
    let request_id = request_id.trim().to_string();
    let parsed_url = validate_ai_url(&url)?;
    let parsed_method = reqwest::Method::from_bytes(method.trim().as_bytes())
        .map_err(|error| format!("Invalid AI HTTP method: {error}"))?;
    let body = body.unwrap_or_default();
    validate_ai_body(&body)?;
    let timeout = timeout_ms.unwrap_or(30_000).clamp(1_000, 300_000);
    let timeouts = StreamTimeouts {
        first_response: Duration::from_millis(timeout),
        idle: Duration::from_millis(idle_timeout_ms.unwrap_or(timeout).clamp(1_000, 300_000)),
        total: Duration::from_millis(total_timeout_ms.unwrap_or(600_000).clamp(1_000, 1_800_000)),
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .connect_timeout(Duration::from_millis(timeout.min(30_000)))
        .user_agent(concat!("Lattice/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.request(parsed_method, parsed_url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    if !body.is_empty() {
        request = request.body(body);
    }

    start_stream(
        state.inner(),
        window.label().to_string(),
        request_id,
        request,
        timeouts,
        move |event| on_event.send(event).map_err(|_| ()),
    )
}

fn start_stream(
    state: &AiHttpStreamState,
    owner: String,
    request_id: String,
    request: reqwest::RequestBuilder,
    timeouts: StreamTimeouts,
    on_event: impl FnMut(AiNativeHttpStreamEvent) -> Result<(), ()> + Send + 'static,
) -> Result<(), String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut entries = state.entries.lock().expect("AI stream registry poisoned");
        if entries.contains_key(&request_id) {
            return Err("AI HTTP stream request is already active.".to_string());
        }
        if entries.len() >= MAX_ACTIVE_AI_STREAMS {
            return Err(
                "Too many active AI HTTP streams. Stop a request before starting another."
                    .to_string(),
            );
        }
        // Reserve the id before spawning. This closes the early-cancel race;
        // cancel can mark this entry even before the task receives the request.
        entries.insert(
            request_id.clone(),
            StreamEntry {
                owner,
                cancelled: Arc::clone(&cancelled),
                abort: None,
            },
        );
    }
    let task_state = state.clone();
    let task_id = request_id.clone();
    let task_cancelled = Arc::clone(&cancelled);
    let task = tokio::spawn(run_native_http_stream(
        task_state,
        task_id,
        task_cancelled,
        request,
        timeouts,
        on_event,
    ));
    let abort = task.abort_handle();
    let mut entries = state.entries.lock().expect("AI stream registry poisoned");
    if let Some(entry) = entries
        .get_mut(&request_id)
        .filter(|entry| Arc::ptr_eq(&entry.cancelled, &cancelled))
    {
        entry.abort = Some(abort.clone());
        if entry.cancelled.load(Ordering::Acquire) {
            abort.abort();
        }
    } else if cancelled.load(Ordering::Acquire) {
        abort.abort();
    }
    Ok(())
}

#[tauri::command]
pub fn ai_native_http_stream_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AiHttpStreamState>,
    request_id: String,
) -> Result<bool, String> {
    state.cancel(request_id.trim(), window.label())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::{mpsc, oneshot},
        time::timeout,
    };

    async fn server(
        head: String,
        first: Vec<u8>,
        tail: Vec<u8>,
    ) -> (String, oneshot::Sender<()>, oneshot::Receiver<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/stream", listener.local_addr().unwrap());
        let (release, hold) = oneshot::channel();
        let (closed, closed_rx) = oneshot::channel();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 4096];
            socket.read(&mut buffer).await.unwrap();
            socket.write_all(head.as_bytes()).await.unwrap();
            if socket.write_all(&first).await.is_err() {
                let _ = closed.send(());
                return;
            }
            tokio::select! {
                _ = hold => { let _ = socket.write_all(&tail).await; },
                result = socket.read(&mut buffer) => { assert!(matches!(result, Ok(0) | Err(_))); },
            }
            let _ = closed.send(());
        });
        (url, release, closed_rx)
    }

    fn begin(
        state: &AiHttpStreamState,
        id: &str,
        url: &str,
    ) -> mpsc::UnboundedReceiver<AiNativeHttpStreamEvent> {
        let (sender, receiver) = mpsc::unbounded_channel();
        start_stream(
            state,
            "main".into(),
            id.into(),
            reqwest::Client::new().get(url),
            StreamTimeouts::default(),
            move |event| sender.send(event).map_err(|_| ()),
        )
        .unwrap();
        receiver
    }

    async fn event(
        receiver: &mut mpsc::UnboundedReceiver<AiNativeHttpStreamEvent>,
    ) -> AiNativeHttpStreamEvent {
        timeout(Duration::from_secs(3), receiver.recv())
            .await
            .unwrap()
            .unwrap()
    }

    async fn assert_clean(state: &AiHttpStreamState) {
        timeout(Duration::from_secs(2), async {
            while !state.entries.lock().unwrap().is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn applies_first_payload_and_idle_deadlines_after_headers() {
        for initial_data in [false, true] {
            let first = if initial_data { b"1\r\nx\r\n".to_vec() } else { vec![] };
            let (url, _hold, _closed) = server("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".into(), first, vec![]).await;
            let state = AiHttpStreamState::default();
            let (sender, mut events) = mpsc::unbounded_channel();
            start_stream(&state, "main".into(), "stalled".into(), reqwest::Client::new().get(url),
                StreamTimeouts { first_response: Duration::from_millis(600), idle: Duration::from_millis(400), total: Duration::from_secs(5) },
                move |event| sender.send(event).map_err(|_| ())).unwrap();
            assert!(matches!(event(&mut events).await, AiNativeHttpStreamEvent::Headers { .. }));
            if initial_data { assert!(matches!(event(&mut events).await, AiNativeHttpStreamEvent::Chunk { .. })); }
            let terminal = timeout(Duration::from_secs(2), events.recv()).await.expect("native deadline was not enforced").unwrap();
            let label = if initial_data { "idle" } else { "first-response" };
            assert!(matches!(terminal, AiNativeHttpStreamEvent::Error { message } if message.contains(label)));
            assert_clean(&state).await;
        }
    }

    #[tokio::test]
    async fn active_stream_outlives_idle_limit_but_not_overall_deadline() {
        for limited in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/active", listener.local_addr().unwrap());
            tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 1024]; socket.read(&mut request).await.unwrap();
                socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
                for _ in 0..8 {
                    if socket.write_all(b"1\r\nx\r\n").await.is_err() { return; }
                    tokio::time::sleep(Duration::from_millis(150)).await;
                }
                let _ = socket.write_all(b"0\r\n\r\n").await;
            });
            let state = AiHttpStreamState::default();
            let (sender, mut events) = mpsc::unbounded_channel();
            start_stream(&state, "main".into(), "active".into(), reqwest::Client::new().get(url),
                StreamTimeouts { first_response: Duration::from_secs(1), idle: Duration::from_millis(500), total: Duration::from_millis(if limited { 700 } else { 3000 }) },
                move |event| sender.send(event).map_err(|_| ())).unwrap();
            let mut bytes = 0;
            loop {
                match event(&mut events).await {
                    AiNativeHttpStreamEvent::Headers { .. } => {},
                    AiNativeHttpStreamEvent::Chunk { data } => { bytes += data.len(); },
                    AiNativeHttpStreamEvent::End => { assert!(!limited); assert_eq!(bytes, 8); break; },
                    AiNativeHttpStreamEvent::Error { message } => { assert!(limited && message.contains("overall"), "{message}"); assert!(bytes > 0 && bytes < 8); break; },
                }
            }
            assert_clean(&state).await;
        }
    }

    #[tokio::test]
    async fn streams_first_sse_chunk_before_server_finishes() {
        let (url, finish, _) = server("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n".into(), b"9\r\ndata: a\n\n\r\n".to_vec(), b"9\r\ndata: b\n\n\r\n0\r\n\r\n".to_vec()).await;
        let state = AiHttpStreamState::default();
        let mut events = begin(&state, "first", &url);
        assert!(matches!(
            event(&mut events).await,
            AiNativeHttpStreamEvent::Headers { status: 200, .. }
        ));
        assert!(
            matches!(event(&mut events).await, AiNativeHttpStreamEvent::Chunk { data } if data == b"data: a\n\n")
        );
        assert!(events.try_recv().is_err());
        finish.send(()).unwrap();
        assert!(
            matches!(event(&mut events).await, AiNativeHttpStreamEvent::Chunk { data } if data == b"data: b\n\n")
        );
        assert!(matches!(
            event(&mut events).await,
            AiNativeHttpStreamEvent::End
        ));
        assert_clean(&state).await;
    }

    #[tokio::test]
    async fn cancel_is_owner_scoped_drops_connection_and_removes_registry_entry() {
        let (url, _hold, closed) = server("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n".into(), b"9\r\ndata: a\n\n\r\n".to_vec(), vec![]).await;
        let state = AiHttpStreamState::default();
        let mut events = begin(&state, "cancel", &url);
        let _ = event(&mut events).await;
        let _ = event(&mut events).await;
        assert!(state.cancel("cancel", "other").is_err());
        assert!(state.cancel("cancel", "main").unwrap());
        assert!(!state.cancel("cancel", "main").unwrap());
        timeout(Duration::from_secs(3), closed)
            .await
            .unwrap()
            .unwrap();
        assert_clean(&state).await;
        assert!(timeout(Duration::from_secs(1), events.recv())
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn preserves_provider_error_status_and_body() {
        let (url, finish, _) = server(
            "HTTP/1.1 429 Too Many Requests\r\nContent-Length: 4\r\n\r\n".into(),
            b"slow".to_vec(),
            vec![],
        )
        .await;
        let state = AiHttpStreamState::default();
        let mut events = begin(&state, "http-error", &url);
        assert!(matches!(
            event(&mut events).await,
            AiNativeHttpStreamEvent::Headers { status: 429, .. }
        ));
        assert!(
            matches!(event(&mut events).await, AiNativeHttpStreamEvent::Chunk { data } if data == b"slow")
        );
        assert!(matches!(
            event(&mut events).await,
            AiNativeHttpStreamEvent::End
        ));
        let _ = finish.send(());
        assert_clean(&state).await;
    }

    #[tokio::test]
    async fn rejects_declared_and_chunked_oversize_responses_and_cleans_up() {
        for declared in [true, false] {
            let head = if declared {
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                    MAX_AI_RESPONSE_BODY_BYTES + 1
                )
            } else {
                "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_string()
            };
            let data = if declared {
                vec![]
            } else {
                let size = MAX_AI_RESPONSE_BODY_BYTES + 1;
                let mut data = format!("{size:x}\r\n").into_bytes();
                data.resize(data.len() + size, b'x');
                data.extend_from_slice(b"\r\n0\r\n\r\n");
                data
            };
            let (url, finish, _) = server(head, data, vec![]).await;
            let state = AiHttpStreamState::default();
            let mut events = begin(&state, "large", &url);
            let mut bytes = 0;
            loop {
                match event(&mut events).await {
                    AiNativeHttpStreamEvent::Error { message } => {
                        assert!(message.contains("too large"));
                        break;
                    }
                    AiNativeHttpStreamEvent::Chunk { data } => {
                        bytes += data.len();
                        assert!(bytes <= MAX_AI_RESPONSE_BODY_BYTES);
                    }
                    AiNativeHttpStreamEvent::End => panic!("oversize must not finish successfully"),
                    _ => {}
                }
            }
            let _ = finish.send(());
            assert_clean(&state).await;
        }
    }

    #[tokio::test]
    async fn transport_error_cleans_up_and_window_close_cancels_all_owned_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let state = AiHttpStreamState::default();
        let mut events = begin(&state, "failed", &url);
        assert!(matches!(
            event(&mut events).await,
            AiNativeHttpStreamEvent::Error { .. }
        ));
        assert_clean(&state).await;
        let (url, _hold, closed) = server(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".into(),
            vec![],
            vec![],
        )
        .await;
        let mut events = begin(&state, "window", &url);
        let _ = event(&mut events).await;
        state.cancel_window("other");
        assert_eq!(state.entries.lock().unwrap().len(), 1);
        state.cancel_window("main");
        timeout(Duration::from_secs(3), closed)
            .await
            .unwrap()
            .unwrap();
        assert_clean(&state).await;
    }

    #[test]
    fn accepts_only_http_provider_urls() {
        assert!(validate_ai_url("https://gateway.example/v1/messages").is_ok());
        assert!(validate_ai_url("file:///tmp/secret").is_err());
        assert!(validate_ai_url("not a url").is_err());
    }

    #[test]
    fn stream_events_match_frontend_protocol_and_request_limits() {
        assert_eq!(
            serde_json::to_value(AiNativeHttpStreamEvent::End).unwrap(),
            serde_json::json!({"type":"end"})
        );
        assert_eq!(
            serde_json::to_value(AiNativeHttpStreamEvent::Chunk { data: vec![65, 66] }).unwrap(),
            serde_json::json!({"type":"chunk", "data":[65,66]})
        );
        assert!(validate_stream_request_id(" ").is_err());
        assert!(validate_stream_request_id("bad\nrequest").is_err());
        assert!(validate_ai_body(&"x".repeat(MAX_AI_REQUEST_BODY_BYTES + 1)).is_err());
    }

    #[tokio::test]
    async fn bounds_active_tasks_and_cancels_before_network_start() {
        let state = AiHttpStreamState::default();
        let client = reqwest::Client::new();
        for index in 0..MAX_ACTIVE_AI_STREAMS {
            start_stream(
                &state,
                "main".into(),
                index.to_string(),
                client.get("http://127.0.0.1:1"),
                StreamTimeouts::default(),
                |_| Ok(()),
            )
            .unwrap();
        }
        assert!(start_stream(
            &state,
            "main".into(),
            "overflow".into(),
            client.get("http://127.0.0.1:1"),
            StreamTimeouts::default(),
            |_| Ok(())
        )
        .unwrap_err()
        .contains("Too many"));
        assert!(start_stream(
            &state,
            "main".into(),
            "0".into(),
            client.get("http://127.0.0.1:1"),
            StreamTimeouts::default(),
            |_| Ok(())
        )
        .unwrap_err()
        .contains("already active"));
        state.cancel_window("main");
        assert_clean(&state).await;
    }

    #[tokio::test]
    async fn timeout_and_disconnected_consumer_release_streams() {
        for disconnected in [false, true] {
            let (url, _hold, closed) = server(
                "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".into(),
                vec![],
                vec![],
            )
            .await;
            let state = AiHttpStreamState::default();
            let (sender, mut receiver) = mpsc::unbounded_channel();
            start_stream(
                &state,
                "main".into(),
                "timeout".into(),
                reqwest::Client::new()
                    .get(url)
                    .timeout(Duration::from_millis(150)),
                StreamTimeouts::default(),
                move |event| {
                    if disconnected {
                        return Err(());
                    }
                    sender.send(event).map_err(|_| ())
                },
            )
            .unwrap();
            if !disconnected {
                assert!(matches!(
                    event(&mut receiver).await,
                    AiNativeHttpStreamEvent::Headers { .. }
                ));
                assert!(matches!(
                    event(&mut receiver).await,
                    AiNativeHttpStreamEvent::Error { .. }
                ));
            }
            timeout(Duration::from_secs(3), closed)
                .await
                .unwrap()
                .unwrap();
            assert_clean(&state).await;
        }
    }
}
