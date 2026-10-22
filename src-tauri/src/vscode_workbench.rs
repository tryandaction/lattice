use std::{
    env, fs,
    io::Write,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command as StdCommand, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager, State};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};
use uuid::Uuid;

use crate::code_oss_runtime::{
    build_code_server_args, ensure_profile_defaults, resolve_runtime_layout, select_runtime,
    CodeOSSProfilePaths, CodeOSSRuntime, CodeOSSRuntimeKind,
};

#[cfg(windows)]
const CREATE_NO_WINDOW_FLAG: u32 = 0x08000000;

const BRIDGE_EXTENSION_ID: &str = "lattice.lattice-workbench-bridge";
const VSCODE_IMPORT_MARKER: &str = "latticeImportedFromVSCode";
const BRIDGE_RESOURCE_FILES: [&str; 4] = [
    "package.json",
    "extension.js",
    "extension.cjs",
    "server.cjs",
];
const OPEN_VSX_GALLERY: &str = r#"{"serviceUrl":"https://open-vsx.org/vscode/gallery","itemUrl":"https://open-vsx.org/vscode/item","resourceUrlTemplate":"https://open-vsx.org/vscode/asset/{publisher}/{name}/Microsoft.VisualStudio.Code.WebResources/{version}/{path}"}"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VSCodeWorkbenchReadiness {
    Preparing,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VSCodeWorkbenchRuntimeSnapshot {
    runtime_kind: Option<String>,
    runtime_version: Option<String>,
    code_oss_version: Option<String>,
    profile_path: Option<String>,
    legacy_fallback: bool,
}

impl Default for VSCodeWorkbenchRuntimeSnapshot {
    fn default() -> Self {
        Self {
            runtime_kind: None,
            runtime_version: None,
            code_oss_version: None,
            profile_path: None,
            legacy_fallback: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VSCodeWorkbenchSnapshot {
    status: String,
    phase: String,
    elapsed_seconds: u64,
    first_launch: bool,
    workspace_path: Option<String>,
    url: Option<String>,
    detail: String,
    cli_path: Option<String>,
    bridge_status: String,
    #[serde(flatten)]
    runtime: VSCodeWorkbenchRuntimeSnapshot,
}

impl Default for VSCodeWorkbenchSnapshot {
    fn default() -> Self {
        Self {
            status: "stopped".to_string(),
            phase: "stopped".to_string(),
            elapsed_seconds: 0,
            first_launch: false,
            workspace_path: None,
            url: None,
            detail: "VS Code Workbench is not running.".to_string(),
            cli_path: None,
            bridge_status: "stopped".to_string(),
            runtime: VSCodeWorkbenchRuntimeSnapshot::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VSCodeWorkbenchOpenRequest {
    request_id: u64,
    path: String,
    kind: String,
    line: Option<u32>,
    column: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VSCodeWorkbenchAction {
    FocusWorkbench,
    ClosePrimarySidebar,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VSCodeWorkbenchActionRequest {
    action: VSCodeWorkbenchAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VSCodeWorkbenchBridgeAcknowledgement {
    ok: bool,
    request_id: Option<u64>,
}

struct ManagedVSCodeWorkbench {
    child: Child,
    runtime_kind: CodeOSSRuntimeKind,
    runtime: VSCodeWorkbenchRuntimeSnapshot,
    workspace_path: String,
    url: String,
    probe_url: String,
    cli_path: String,
    started_at: Instant,
    commit_id: Option<String>,
    server_cache_root: Option<PathBuf>,
    first_launch: bool,
    bridge_token: String,
    bridge_url: String,
    stdout_log_path: PathBuf,
    stderr_log_path: PathBuf,
}

fn runtime_snapshot(
    runtime: &CodeOSSRuntime,
    profile: &CodeOSSProfilePaths,
) -> VSCodeWorkbenchRuntimeSnapshot {
    VSCodeWorkbenchRuntimeSnapshot {
        runtime_kind: Some(
            match runtime.kind {
                CodeOSSRuntimeKind::BundledCodeServer => "bundledCodeServer",
                CodeOSSRuntimeKind::LegacyVSCodeTunnel => "legacyVSCodeTunnel",
            }
            .to_string(),
        ),
        runtime_version: Some(runtime.runtime_version.clone()),
        code_oss_version: Some(runtime.code_oss_version.clone()),
        profile_path: Some(profile.root.to_string_lossy().to_string()),
        legacy_fallback: runtime.kind == CodeOSSRuntimeKind::LegacyVSCodeTunnel,
    }
}

#[derive(Default)]
pub struct VSCodeWorkbenchState {
    process: Mutex<Option<ManagedVSCodeWorkbench>>,
    snapshot: Mutex<VSCodeWorkbenchSnapshot>,
}

fn build_serve_web_args(
    port: u16,
    token: &str,
    workspace_path: &str,
    server_data_dir: Option<&str>,
    commit_id: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "serve-web".to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--connection-token".to_string(),
        token.to_string(),
        "--accept-server-license-terms".to_string(),
        "--disable-telemetry".to_string(),
        "--default-folder".to_string(),
        workspace_path.to_string(),
    ];
    if let Some(server_data_dir) = server_data_dir {
        args.push("--server-data-dir".to_string());
        args.push(server_data_dir.to_string());
    }
    if let Some(commit_id) = commit_id {
        args.push("--commit-id".to_string());
        args.push(commit_id.to_string());
    }
    args
}

fn build_runtime_args(
    runtime: &CodeOSSRuntime,
    port: u16,
    token: &str,
    workspace_path: &Path,
    profile: &CodeOSSProfilePaths,
    server_data_dir: Option<&str>,
    commit_id: Option<&str>,
) -> Result<Vec<String>, String> {
    match runtime.kind {
        CodeOSSRuntimeKind::BundledCodeServer => {
            let entrypoint = runtime.entrypoint.as_ref().ok_or_else(|| {
                "Bundled Code OSS runtime is missing its server entrypoint.".to_string()
            })?;
            // Tauri's resource resolver can return Windows verbatim paths (\\?\C:\...).
            // Passing that form as Node's ESM entrypoint makes code-server construct an
            // invalid file URL while importing VS Code's server-main.js.
            let mut args = vec![external_runtime_path(entrypoint)];
            args.extend(build_code_server_args(port, workspace_path, profile));
            Ok(args)
        }
        CodeOSSRuntimeKind::LegacyVSCodeTunnel => Ok(build_serve_web_args(
            port,
            token,
            &workspace_path.to_string_lossy(),
            server_data_dir,
            commit_id,
        )),
    }
}

fn build_authenticated_url(
    port: u16,
    token: &str,
    workspace_path: &Path,
) -> Result<String, String> {
    let normalized_path = external_runtime_path(workspace_path).replace('\\', "/");
    let remote_path = if normalized_path.starts_with('/') {
        normalized_path
    } else {
        format!("/{normalized_path}")
    };
    let folder_uri = format!("vscode-remote://remote{remote_path}");
    let mut url = reqwest::Url::parse(&format!("http://vscode.tauri.localhost:{port}/"))
        .map_err(|error| format!("Unable to construct the VS Code Workbench URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("tkn", token)
        .append_pair("folder", &folder_uri);
    Ok(url.to_string())
}

fn build_probe_url(port: u16, token: &str) -> String {
    format!("http://127.0.0.1:{port}/?tkn={token}")
}

fn build_bridge_environment(
    bridge_port: u16,
    bridge_token: &str,
    workspace_path: &str,
    runtime_kind: CodeOSSRuntimeKind,
) -> Vec<(String, String)> {
    let mut environment = vec![
        (
            "LATTICE_VSCODE_BRIDGE_PORT".to_string(),
            bridge_port.to_string(),
        ),
        (
            "LATTICE_VSCODE_BRIDGE_TOKEN".to_string(),
            bridge_token.to_string(),
        ),
        (
            "LATTICE_VSCODE_WORKSPACE".to_string(),
            workspace_path.to_string(),
        ),
    ];
    if runtime_kind == CodeOSSRuntimeKind::BundledCodeServer {
        environment.push((
            "EXTENSIONS_GALLERY".to_string(),
            OPEN_VSX_GALLERY.to_string(),
        ));
    }
    environment
}

fn classify_readiness(status: u16, body: &str) -> VSCodeWorkbenchReadiness {
    if status == 302 {
        return VSCodeWorkbenchReadiness::Ready;
    }
    if status == 202 {
        return VSCodeWorkbenchReadiness::Preparing;
    }
    if status >= 400 {
        return VSCodeWorkbenchReadiness::Error;
    }
    if (200..300).contains(&status)
        && (body.contains("vscode-workbench-web-configuration")
            || body.contains("workbenchWebConfiguration"))
    {
        return VSCodeWorkbenchReadiness::Ready;
    }
    VSCodeWorkbenchReadiness::Preparing
}

fn classify_preparing_phase(
    elapsed_seconds: u64,
    cache_ready: bool,
    staging_present: bool,
) -> &'static str {
    if cache_ready {
        "starting"
    } else if staging_present {
        "installing"
    } else if elapsed_seconds < 3 {
        "contacting"
    } else {
        "downloading"
    }
}

fn classify_runtime_preparing_phase(
    runtime_kind: CodeOSSRuntimeKind,
    elapsed_seconds: u64,
    cache_ready: bool,
    staging_present: bool,
) -> &'static str {
    match runtime_kind {
        CodeOSSRuntimeKind::BundledCodeServer => "starting",
        CodeOSSRuntimeKind::LegacyVSCodeTunnel => {
            classify_preparing_phase(elapsed_seconds, cache_ready, staging_present)
        }
    }
}

fn classify_combined_phase(workbench_ready: bool, bridge_ready: bool) -> &'static str {
    if !workbench_ready {
        "starting"
    } else if !bridge_ready {
        "connectingBridge"
    } else {
        "ready"
    }
}

fn server_cache_root(server_data_dir: Option<&Path>) -> Option<PathBuf> {
    let data_dir = server_data_dir.map(Path::to_path_buf).or_else(|| {
        env::var("USERPROFILE")
            .or_else(|_| env::var("HOME"))
            .ok()
            .map(PathBuf::from)
            .map(|home| home.join(".vscode"))
    })?;
    Some(data_dir.join("cli").join("serve-web"))
}

fn server_cache_state(cache_root: Option<&Path>, commit_id: Option<&str>) -> (bool, bool) {
    let (Some(cache_root), Some(commit_id)) = (cache_root, commit_id) else {
        return (false, false);
    };
    let cache_ready = cache_root.join(commit_id).is_dir();
    let staging_present = cache_root.join(format!("{commit_id}.staging")).exists();
    (cache_ready, staging_present)
}

fn phase_detail(phase: &str) -> &'static str {
    match phase {
        "contacting" => "Contacting the VS Code Server download service...",
        "downloading" => "Downloading the version-matched VS Code Server (approximately 160 MB)...",
        "installing" => "Installing the downloaded VS Code Server...",
        "starting" => "Starting the local VS Code Workbench...",
        "connectingBridge" => "Connecting Lattice Explorer to the VS Code Workbench...",
        _ => "Preparing the VS Code Workbench...",
    }
}

fn validate_resource_path(workspace_path: &Path, resource_path: &Path) -> Result<PathBuf, String> {
    let workspace = fs::canonicalize(workspace_path).map_err(|error| {
        format!(
            "Unable to resolve the active VS Code workspace '{}': {error}",
            workspace_path.display()
        )
    })?;
    let resource = fs::canonicalize(resource_path).map_err(|error| {
        format!(
            "Unable to resolve the requested VS Code resource '{}': {error}",
            resource_path.display()
        )
    })?;
    if !resource.is_file() {
        return Err(format!(
            "The requested VS Code resource is not a file: {}",
            resource.display()
        ));
    }

    #[cfg(windows)]
    let is_inside = PathBuf::from(resource.to_string_lossy().to_lowercase())
        .starts_with(PathBuf::from(workspace.to_string_lossy().to_lowercase()));
    #[cfg(not(windows))]
    let is_inside = resource.starts_with(&workspace);

    if !is_inside {
        return Err("The requested VS Code resource is outside the active workspace.".to_string());
    }
    Ok(resource)
}

fn external_runtime_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    if let Some(local) = value.strip_prefix(r"\\?\") {
        return local.to_string();
    }
    value.into_owned()
}

fn resolve_bridge_source_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resolve("resources/vscode-lattice-bridge", BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err(format!(
            "Bundled VS Code bridge directory is missing: {}",
            path.display()
        ));
    }
    Ok(path)
}

fn runtime_platform() -> Result<&'static str, String> {
    if cfg!(target_os = "windows") {
        Ok("win32")
    } else if cfg!(target_os = "macos") {
        Ok("darwin")
    } else if cfg!(target_os = "linux") {
        Ok("linux")
    } else {
        Err("This operating system is not supported by the bundled Code OSS runtime.".to_string())
    }
}

fn runtime_arch() -> Result<&'static str, String> {
    if cfg!(target_arch = "x86_64") {
        Ok("x64")
    } else if cfg!(target_arch = "aarch64") {
        Ok("arm64")
    } else {
        Err("This CPU architecture is not supported by the bundled Code OSS runtime.".to_string())
    }
}

fn resolve_bundled_code_oss_runtime(app: &AppHandle) -> Result<CodeOSSRuntime, String> {
    let runtime_root = app
        .path()
        .resolve("code-oss-runtime", BaseDirectory::Resource)
        .map_err(|error| format!("Unable to resolve the bundled Code OSS runtime: {error}"))?;
    resolve_runtime_layout(&runtime_root, runtime_platform()?, runtime_arch()?)
}

fn legacy_runtime_enabled() -> bool {
    env::var("LATTICE_ALLOW_LEGACY_VSCODE_WORKBENCH").is_ok_and(|value| value.trim() == "1")
}

fn resolve_code_oss_profile(app: &AppHandle) -> Result<CodeOSSProfilePaths, String> {
    let app_data = app.path().app_local_data_dir().map_err(|error| {
        format!("Unable to resolve the Lattice application data directory: {error}")
    })?;
    let profile = CodeOSSProfilePaths::new(&app_data.join("code-oss"));
    profile.ensure()?;
    Ok(profile)
}

fn extension_location_path(path: &Path) -> String {
    let value = external_runtime_path(path).replace('\\', "/");
    if cfg!(windows) && !value.starts_with('/') {
        format!("/{value}")
    } else {
        value
    }
}

fn is_bridge_registry_entry(entry: &serde_json::Value) -> bool {
    entry
        .pointer("/identifier/id")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|id| id.eq_ignore_ascii_case(BRIDGE_EXTENSION_ID))
}

fn is_vscode_imported_registry_entry(entry: &serde_json::Value) -> bool {
    entry
        .pointer(&format!("/metadata/{VSCODE_IMPORT_MARKER}"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn registry_entry_location(entry: &serde_json::Value) -> Option<PathBuf> {
    let value = entry.pointer("/location/path")?.as_str()?;
    #[cfg(windows)]
    let value = if value.starts_with('/')
        && value.as_bytes().get(2) == Some(&b':')
        && value.as_bytes().get(1).is_some_and(u8::is_ascii_alphabetic)
    {
        &value[1..]
    } else {
        value
    };
    Some(PathBuf::from(value))
}

fn registry_entry_matches_installed_extension(
    entry: &serde_json::Value,
    source_extensions_dir: &Path,
) -> bool {
    let Some(identifier) = entry
        .pointer("/identifier/id")
        .and_then(serde_json::Value::as_str)
    else {
        return false;
    };
    let Some(location) = registry_entry_location(entry) else {
        return false;
    };
    let Ok(source_root) = fs::canonicalize(source_extensions_dir) else {
        return false;
    };
    let Ok(location) = fs::canonicalize(location) else {
        return false;
    };

    #[cfg(windows)]
    let is_inside = PathBuf::from(location.to_string_lossy().to_lowercase())
        .starts_with(PathBuf::from(source_root.to_string_lossy().to_lowercase()));
    #[cfg(not(windows))]
    let is_inside = location.starts_with(&source_root);
    if !is_inside || !location.is_dir() {
        return false;
    }

    let Ok(package_bytes) = fs::read(location.join("package.json")) else {
        return false;
    };
    let Ok(package) = serde_json::from_slice::<serde_json::Value>(&package_bytes) else {
        return false;
    };
    let Some(publisher) = package.get("publisher").and_then(serde_json::Value::as_str) else {
        return false;
    };
    let Some(name) = package.get("name").and_then(serde_json::Value::as_str) else {
        return false;
    };
    identifier.eq_ignore_ascii_case(&format!("{publisher}.{name}"))
}

fn remove_imported_vscode_extensions(target_extensions_dir: &Path) -> Result<(), String> {
    let target_registry_path = target_extensions_dir.join("extensions.json");
    let Ok(target_bytes) = fs::read(&target_registry_path) else {
        return Ok(());
    };
    let mut target_registry: Vec<serde_json::Value> = serde_json::from_slice(&target_bytes)
        .map_err(|error| format!("Code OSS extension registry is invalid: {error}"))?;
    let original_len = target_registry.len();
    target_registry.retain(|entry| !is_vscode_imported_registry_entry(entry));
    if target_registry.len() == original_len {
        return Ok(());
    }
    write_extension_registry(
        &target_registry_path,
        &target_registry,
        "stage Code OSS extensions",
    )
}

fn write_extension_registry(
    registry_path: &Path,
    registry: &[serde_json::Value],
    action: &str,
) -> Result<(), String> {
    let encoded = serde_json::to_vec(registry)
        .map_err(|error| format!("Unable to encode Code OSS extensions: {error}"))?;
    let parent = registry_path.parent().ok_or_else(|| {
        format!("Unable to {action}: extension registry has no parent directory.")
    })?;
    fs::create_dir_all(parent).map_err(|error| format!("Unable to {action}: {error}"))?;
    let mut staging = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Unable to {action}: {error}"))?;
    staging
        .write_all(&encoded)
        .and_then(|_| staging.as_file().sync_all())
        .map_err(|error| format!("Unable to {action}: {error}"))?;
    staging
        .persist(registry_path)
        .map_err(|error| format!("Unable to {action}: {}", error.error))?;
    Ok(())
}

fn imported_extension_relative_location(identifier: &str, version: &str) -> Option<String> {
    let valid = |value: &str| {
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    };
    if !valid(identifier) || !valid(version) {
        return None;
    }
    Some(format!(
        "lattice-import-{}-{version}",
        identifier.to_lowercase()
    ))
}

fn ensure_imported_extension_link(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        let existing = fs::canonicalize(target).map_err(|error| {
            format!(
                "Unable to inspect imported extension link '{}': {error}",
                target.display()
            )
        })?;
        let source = fs::canonicalize(source).map_err(|error| {
            format!(
                "Unable to resolve imported extension '{}': {error}",
                source.display()
            )
        })?;
        if existing == source {
            return Ok(());
        }
        return Err(format!(
            "Imported extension link already exists with a different target: {}",
            target.display()
        ));
    }

    #[cfg(windows)]
    junction::create(source, target).map_err(|error| {
        format!(
            "Unable to create imported extension junction '{}': {error}",
            target.display()
        )
    })?;
    #[cfg(unix)]
    std::os::unix::fs::symlink(source, target).map_err(|error| {
        format!(
            "Unable to create imported extension link '{}': {error}",
            target.display()
        )
    })?;
    Ok(())
}

fn import_vscode_extensions(
    source_extensions_dir: &Path,
    target_extensions_dir: &Path,
) -> Result<usize, String> {
    let source_registry_path = source_extensions_dir.join("extensions.json");
    let Ok(source_bytes) = fs::read(&source_registry_path) else {
        return Ok(0);
    };
    let Ok(source_registry) = serde_json::from_slice::<Vec<serde_json::Value>>(&source_bytes)
    else {
        return Ok(0);
    };

    fs::create_dir_all(target_extensions_dir).map_err(|error| {
        format!("Unable to create the Lattice Code OSS extensions directory: {error}")
    })?;
    let target_registry_path = target_extensions_dir.join("extensions.json");
    let target_bytes = fs::read(&target_registry_path).unwrap_or_else(|_| b"[]".to_vec());
    let mut target_registry: Vec<serde_json::Value> = serde_json::from_slice(&target_bytes)
        .map_err(|error| format!("Code OSS extension registry is invalid: {error}"))?;
    let original_registry = target_registry.clone();
    target_registry.retain(|entry| !is_vscode_imported_registry_entry(entry));

    let mut owned_ids = target_registry
        .iter()
        .filter_map(|entry| {
            entry
                .pointer("/identifier/id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_lowercase)
        })
        .collect::<std::collections::HashSet<_>>();
    let mut imported_count = 0;
    for entry in source_registry {
        let Some(identifier) = entry
            .pointer("/identifier/id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let normalized_identifier = identifier.to_lowercase();
        if normalized_identifier == BRIDGE_EXTENSION_ID
            || owned_ids.contains(&normalized_identifier)
            || !registry_entry_matches_installed_extension(&entry, source_extensions_dir)
        {
            continue;
        }
        let Some(version) = entry
            .get("version")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let Some(relative_location) = imported_extension_relative_location(&identifier, &version)
        else {
            continue;
        };
        let Some(source_location) = registry_entry_location(&entry) else {
            continue;
        };
        let installed_timestamp = entry
            .pointer("/metadata/installedTimestamp")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        let target_location = target_extensions_dir.join(&relative_location);
        if ensure_imported_extension_link(&source_location, &target_location).is_err() {
            continue;
        }
        target_registry.push(serde_json::json!({
            "identifier": { "id": identifier },
            "version": version,
            "location": {
                "$mid": 1,
                "path": extension_location_path(&target_location),
                "scheme": "file"
            },
            "relativeLocation": relative_location,
            "metadata": {
                "isApplicationScoped": false,
                "isMachineScoped": false,
                "isBuiltin": false,
                "installedTimestamp": installed_timestamp,
                "pinned": true,
                "source": "vsix",
                (VSCODE_IMPORT_MARKER): true
            }
        }));
        owned_ids.insert(normalized_identifier);
        imported_count += 1;
    }

    if target_registry != original_registry {
        write_extension_registry(
            &target_registry_path,
            &target_registry,
            "update Code OSS extensions",
        )?;
    }
    Ok(imported_count)
}

fn install_bridge_extension(source_dir: &Path, extensions_dir: &Path) -> Result<bool, String> {
    let package_path = source_dir.join("package.json");
    let package: serde_json::Value = serde_json::from_slice(
        &fs::read(&package_path)
            .map_err(|error| format!("Unable to read bundled VS Code bridge manifest: {error}"))?,
    )
    .map_err(|error| format!("Bundled VS Code bridge manifest is invalid: {error}"))?;
    let publisher = package
        .get("publisher")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Bundled VS Code bridge publisher is missing.".to_string())?;
    let name = package
        .get("name")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Bundled VS Code bridge name is missing.".to_string())?;
    let version = package
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Bundled VS Code bridge version is missing.".to_string())?;
    if format!("{publisher}.{name}") != BRIDGE_EXTENSION_ID {
        return Err("Bundled VS Code bridge identity is invalid.".to_string());
    }

    fs::create_dir_all(extensions_dir)
        .map_err(|error| format!("Unable to create the VS Code extensions directory: {error}"))?;
    let relative_location = format!("{publisher}.{name}-{version}");
    let target_dir = extensions_dir.join(&relative_location);
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Unable to create the Lattice bridge directory: {error}"))?;

    let mut changed = false;
    for file_name in BRIDGE_RESOURCE_FILES {
        let source = source_dir.join(file_name);
        if !source.is_file() {
            return Err(format!(
                "Bundled VS Code bridge file is missing: {}",
                source.display()
            ));
        }
        let target = target_dir.join(file_name);
        let source_bytes = fs::read(&source).map_err(|error| {
            format!(
                "Unable to read bundled VS Code bridge file '{}': {error}",
                source.display()
            )
        })?;
        let current_bytes = fs::read(&target).ok();
        if current_bytes.as_deref() != Some(source_bytes.as_slice()) {
            fs::write(&target, source_bytes).map_err(|error| {
                format!(
                    "Unable to install VS Code bridge file '{}': {error}",
                    target.display()
                )
            })?;
            changed = true;
        }
    }

    let registry_path = extensions_dir.join("extensions.json");
    let registry_bytes = fs::read(&registry_path).unwrap_or_else(|_| b"[]".to_vec());
    let mut registry: Vec<serde_json::Value> = serde_json::from_slice(&registry_bytes)
        .map_err(|error| format!("VS Code extension registry is invalid: {error}"))?;
    let correct_entry_exists = registry
        .iter()
        .filter(|entry| is_bridge_registry_entry(entry))
        .count()
        == 1
        && registry.iter().any(|entry| {
            is_bridge_registry_entry(entry)
                && entry.get("version").and_then(serde_json::Value::as_str) == Some(version)
                && entry
                    .get("relativeLocation")
                    .and_then(serde_json::Value::as_str)
                    == Some(relative_location.as_str())
        });
    if !correct_entry_exists {
        registry.retain(|entry| !is_bridge_registry_entry(entry));
        let installed_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        registry.push(serde_json::json!({
            "identifier": { "id": BRIDGE_EXTENSION_ID },
            "version": version,
            "location": {
                "$mid": 1,
                "path": extension_location_path(&target_dir),
                "scheme": "file"
            },
            "relativeLocation": relative_location,
            "metadata": {
                "isApplicationScoped": false,
                "isMachineScoped": false,
                "isBuiltin": false,
                "installedTimestamp": installed_timestamp,
                "pinned": true,
                "source": "vsix"
            }
        }));
        let encoded = serde_json::to_vec(&registry)
            .map_err(|error| format!("Unable to encode the VS Code extension registry: {error}"))?;
        fs::write(&registry_path, encoded)
            .map_err(|error| format!("Unable to update the VS Code extension registry: {error}"))?;
        changed = true;
    }

    Ok(changed)
}

fn validate_workspace_path(workspace_path: &str) -> Result<String, String> {
    let trimmed = workspace_path.trim();
    if trimmed.is_empty() {
        return Err("A local workspace folder is required.".to_string());
    }
    let canonical = fs::canonicalize(trimmed)
        .map_err(|error| format!("Unable to resolve VS Code workspace '{trimmed}': {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("VS Code workspace is not a directory: {trimmed}"));
    }
    Ok(external_runtime_path(&canonical))
}

fn push_candidate(candidates: &mut Vec<PathBuf>, candidate: impl Into<PathBuf>) {
    let candidate = candidate.into();
    if !candidates.contains(&candidate) {
        candidates.push(candidate);
    }
}

fn command_locations(command: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    let output = {
        let mut locator = StdCommand::new("where.exe");
        locator.arg(command).creation_flags(CREATE_NO_WINDOW_FLAG);
        locator.output()
    };
    #[cfg(not(windows))]
    let output = StdCommand::new("which").arg(command).output();

    output
        .ok()
        .filter(|result| result.status.success())
        .map(|result| {
            String::from_utf8_lossy(&result.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

fn discover_vscode_cli() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(configured) = env::var("LATTICE_VSCODE_CLI") {
        push_candidate(&mut candidates, configured);
    }

    #[cfg(windows)]
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        let root = Path::new(&local_app_data).join("Programs");
        push_candidate(
            &mut candidates,
            root.join("Microsoft VS Code/bin/code-tunnel.exe"),
        );
        push_candidate(
            &mut candidates,
            root.join("Microsoft VS Code Insiders/bin/code-tunnel.exe"),
        );
    }

    for candidate in command_locations(if cfg!(windows) {
        "code-tunnel.exe"
    } else {
        "code-tunnel"
    }) {
        push_candidate(&mut candidates, candidate);
    }

    for code_path in command_locations(if cfg!(windows) { "code.cmd" } else { "code" }) {
        if let Some(parent) = code_path.parent() {
            push_candidate(
                &mut candidates,
                parent.join(if cfg!(windows) {
                    "code-tunnel.exe"
                } else {
                    "code-tunnel"
                }),
            );
        }
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "VS Code CLI with serve-web support was not found. Install or update desktop VS Code."
                .to_string()
        })
}

fn discover_vscode_server_data_dir() -> Option<PathBuf> {
    if let Ok(configured) = env::var("LATTICE_VSCODE_SERVER_DATA_DIR") {
        let configured = PathBuf::from(configured);
        if configured.is_dir() {
            return Some(configured);
        }
    }

    let home = env::var("USERPROFILE")
        .or_else(|_| env::var("HOME"))
        .ok()
        .map(PathBuf::from)?;
    let stable = home.join(".vscode");
    if stable.join("extensions").is_dir() {
        return Some(stable);
    }
    let insiders = home.join(".vscode-insiders");
    insiders.join("extensions").is_dir().then_some(insiders)
}

fn parse_vscode_commit(version_output: &str) -> Option<String> {
    version_output
        .split(|character: char| !character.is_ascii_hexdigit())
        .find(|part| {
            part.len() == 40 && part.chars().all(|character| character.is_ascii_hexdigit())
        })
        .map(str::to_string)
}

fn discover_vscode_commit(cli_path: &Path) -> Option<String> {
    let mut command = StdCommand::new(cli_path);
    command.arg("--version");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW_FLAG);
    command
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| parse_vscode_commit(&String::from_utf8_lossy(&output.stdout)))
}

fn reserve_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Unable to reserve a VS Code Workbench port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Unable to inspect the reserved port: {error}"))
}

async fn set_snapshot(
    state: &VSCodeWorkbenchState,
    snapshot: VSCodeWorkbenchSnapshot,
) -> VSCodeWorkbenchSnapshot {
    *state.snapshot.lock().await = snapshot.clone();
    snapshot
}

#[tauri::command]
pub async fn desktop_start_vscode_workbench(
    workspace_path: String,
    app: AppHandle,
    state: State<'_, VSCodeWorkbenchState>,
) -> Result<VSCodeWorkbenchSnapshot, String> {
    let workspace_path = validate_workspace_path(&workspace_path)?;

    {
        let mut process = state.process.lock().await;
        if let Some(managed) = process.as_mut() {
            match managed.child.try_wait() {
                Ok(None) if managed.workspace_path == workspace_path => {
                    drop(process);
                    return desktop_get_vscode_workbench_status(state).await;
                }
                Ok(None) => {
                    let _ = managed.child.start_kill();
                    let _ = managed.child.wait().await;
                }
                Ok(Some(_)) | Err(_) => {}
            }
            *process = None;
        }
    }

    let allow_legacy = legacy_runtime_enabled();
    let legacy_executable = if allow_legacy {
        discover_vscode_cli().ok()
    } else {
        None
    };
    let runtime = select_runtime(
        resolve_bundled_code_oss_runtime(&app),
        legacy_executable,
        allow_legacy,
    )?;
    let profile = resolve_code_oss_profile(&app)?;
    if runtime.kind == CodeOSSRuntimeKind::BundledCodeServer {
        ensure_profile_defaults(&profile)?;
    }
    let bridge_source_path = resolve_bridge_source_path(&app)?;
    let port = reserve_loopback_port()?;
    let mut bridge_port = reserve_loopback_port()?;
    while bridge_port == port {
        bridge_port = reserve_loopback_port()?;
    }
    let token = Uuid::new_v4().to_string();
    let bridge_token = Uuid::new_v4().to_string();
    let bridge_url = format!("http://127.0.0.1:{bridge_port}");
    let url = build_authenticated_url(port, &token, Path::new(&workspace_path))?;
    let probe_url = build_probe_url(port, &token);
    let server_data_dir = match runtime.kind {
        CodeOSSRuntimeKind::BundledCodeServer => None,
        CodeOSSRuntimeKind::LegacyVSCodeTunnel => discover_vscode_server_data_dir(),
    };
    let server_data_dir_text = server_data_dir
        .as_ref()
        .map(|path| path.to_string_lossy().to_string());
    let extensions_dir = match runtime.kind {
        CodeOSSRuntimeKind::BundledCodeServer => profile.extensions.clone(),
        CodeOSSRuntimeKind::LegacyVSCodeTunnel => server_data_dir
            .as_ref()
            .map(|path| path.join("extensions"))
            .ok_or_else(|| {
                "Unable to resolve the VS Code extensions directory for the current user."
                    .to_string()
            })?,
    };
    if runtime.kind == CodeOSSRuntimeKind::BundledCodeServer {
        if let Some(source) = discover_vscode_server_data_dir().map(|path| path.join("extensions"))
        {
            import_vscode_extensions(&source, &extensions_dir).map_err(|error| {
                format!("Unable to import desktop VS Code extensions before startup: {error}")
            })?;
        }
    }
    install_bridge_extension(&bridge_source_path, &extensions_dir)?;
    let commit_id = match runtime.kind {
        CodeOSSRuntimeKind::BundledCodeServer => None,
        CodeOSSRuntimeKind::LegacyVSCodeTunnel => discover_vscode_commit(&runtime.executable),
    };
    let server_cache_root = match runtime.kind {
        CodeOSSRuntimeKind::BundledCodeServer => None,
        CodeOSSRuntimeKind::LegacyVSCodeTunnel => server_cache_root(server_data_dir.as_deref()),
    };
    let first_launch = runtime.kind == CodeOSSRuntimeKind::LegacyVSCodeTunnel
        && !server_cache_state(server_cache_root.as_deref(), commit_id.as_deref()).0;
    let args = build_runtime_args(
        &runtime,
        port,
        &token,
        Path::new(&workspace_path),
        &profile,
        server_data_dir_text.as_deref(),
        commit_id.as_deref(),
    )?;
    let runtime_metadata = runtime_snapshot(&runtime, &profile);
    let stdout_log_path = profile.logs.join("workbench-runtime.stdout.log");
    let stderr_log_path = profile.logs.join("workbench-runtime.stderr.log");
    let stdout_log = fs::File::create(&stdout_log_path).map_err(|error| {
        format!(
            "Unable to create VS Code Workbench stdout log '{}': {error}",
            stdout_log_path.display()
        )
    })?;
    let stderr_log = fs::File::create(&stderr_log_path).map_err(|error| {
        format!(
            "Unable to create VS Code Workbench stderr log '{}': {error}",
            stderr_log_path.display()
        )
    })?;
    let executable_path = external_runtime_path(&runtime.executable);
    let mut command = Command::new(&executable_path);
    command
        .args(args)
        .envs(build_bridge_environment(
            bridge_port,
            &bridge_token,
            &workspace_path,
            runtime.kind,
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log))
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW_FLAG);

    let child = command.spawn().map_err(|error| {
        format!(
            "Unable to start VS Code Workbench with '{}': {error}",
            runtime.executable.display()
        )
    })?;
    let cli_path = executable_path;
    *state.process.lock().await = Some(ManagedVSCodeWorkbench {
        child,
        runtime_kind: runtime.kind,
        runtime: runtime_metadata.clone(),
        workspace_path: workspace_path.clone(),
        url,
        probe_url,
        cli_path: cli_path.clone(),
        started_at: Instant::now(),
        commit_id,
        server_cache_root,
        first_launch,
        bridge_token,
        bridge_url,
        stdout_log_path,
        stderr_log_path,
    });

    let phase = classify_runtime_preparing_phase(runtime.kind, 0, !first_launch, false);

    Ok(set_snapshot(
        &state,
        VSCodeWorkbenchSnapshot {
            status: "preparing".to_string(),
            phase: phase.to_string(),
            elapsed_seconds: 0,
            first_launch,
            workspace_path: Some(workspace_path),
            url: None,
            detail: phase_detail(phase).to_string(),
            cli_path: Some(cli_path),
            bridge_status: "waiting".to_string(),
            runtime: runtime_metadata,
        },
    )
    .await)
}

#[tauri::command]
pub async fn desktop_get_vscode_workbench_status(
    state: State<'_, VSCodeWorkbenchState>,
) -> Result<VSCodeWorkbenchSnapshot, String> {
    let (
        url,
        probe_url,
        workspace_path,
        cli_path,
        elapsed_seconds,
        first_launch,
        phase,
        bridge_url,
        bridge_token,
        runtime,
        stdout_log_path,
        stderr_log_path,
    ) = {
        let mut process = state.process.lock().await;
        let Some(managed) = process.as_mut() else {
            return Ok(state.snapshot.lock().await.clone());
        };
        match managed.child.try_wait() {
            Ok(Some(exit_status)) => {
                let snapshot = VSCodeWorkbenchSnapshot {
                    status: "error".to_string(),
                    phase: "error".to_string(),
                    elapsed_seconds: managed.started_at.elapsed().as_secs(),
                    first_launch: managed.first_launch,
                    workspace_path: Some(managed.workspace_path.clone()),
                    url: None,
                    detail: format!(
                        "VS Code Workbench exited before it became ready: {exit_status}. Logs: '{}' and '{}'.",
                        managed.stdout_log_path.display(),
                        managed.stderr_log_path.display(),
                    ),
                    cli_path: Some(managed.cli_path.clone()),
                    bridge_status: "error".to_string(),
                    runtime: managed.runtime.clone(),
                };
                *process = None;
                return Ok(set_snapshot(&state, snapshot).await);
            }
            Err(error) => {
                let snapshot = VSCodeWorkbenchSnapshot {
                    status: "error".to_string(),
                    phase: "error".to_string(),
                    elapsed_seconds: managed.started_at.elapsed().as_secs(),
                    first_launch: managed.first_launch,
                    workspace_path: Some(managed.workspace_path.clone()),
                    url: None,
                    detail: format!("Unable to inspect VS Code Workbench: {error}"),
                    cli_path: Some(managed.cli_path.clone()),
                    bridge_status: "error".to_string(),
                    runtime: managed.runtime.clone(),
                };
                *process = None;
                return Ok(set_snapshot(&state, snapshot).await);
            }
            Ok(None) => {
                let elapsed_seconds = managed.started_at.elapsed().as_secs();
                let (cache_ready, staging_present) = server_cache_state(
                    managed.server_cache_root.as_deref(),
                    managed.commit_id.as_deref(),
                );
                let phase = classify_runtime_preparing_phase(
                    managed.runtime_kind,
                    elapsed_seconds,
                    cache_ready,
                    staging_present,
                );
                (
                    managed.url.clone(),
                    managed.probe_url.clone(),
                    managed.workspace_path.clone(),
                    managed.cli_path.clone(),
                    elapsed_seconds,
                    managed.first_launch,
                    phase,
                    managed.bridge_url.clone(),
                    managed.bridge_token.clone(),
                    managed.runtime.clone(),
                    managed.stdout_log_path.clone(),
                    managed.stderr_log_path.clone(),
                )
            }
        }
    };

    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?
        .get(&probe_url)
        .send()
        .await;

    let snapshot = match response {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            match classify_readiness(status, &body) {
                VSCodeWorkbenchReadiness::Ready => {
                    let bridge_ready = reqwest::Client::builder()
                        .timeout(Duration::from_secs(2))
                        .build()
                        .ok()
                        .map(|client| {
                            client
                                .get(format!("{bridge_url}/health"))
                                .bearer_auth(&bridge_token)
                                .send()
                        });
                    let bridge_ready = match bridge_ready {
                        Some(request) => request
                            .await
                            .map(|response| response.status().is_success())
                            .unwrap_or(false),
                        None => false,
                    };
                    let combined_phase = classify_combined_phase(true, bridge_ready);
                    if bridge_ready {
                        VSCodeWorkbenchSnapshot {
                            status: "ready".to_string(),
                            phase: combined_phase.to_string(),
                            elapsed_seconds,
                            first_launch,
                            workspace_path: Some(workspace_path),
                            url: Some(url),
                            detail: "The real VS Code Workbench and Lattice bridge are ready."
                                .to_string(),
                            cli_path: Some(cli_path),
                            bridge_status: "ready".to_string(),
                            runtime,
                        }
                    } else {
                        VSCodeWorkbenchSnapshot {
                            status: "preparing".to_string(),
                            phase: combined_phase.to_string(),
                            elapsed_seconds,
                            first_launch,
                            workspace_path: Some(workspace_path),
                            url: Some(url),
                            detail: phase_detail(combined_phase).to_string(),
                            cli_path: Some(cli_path),
                            bridge_status: "connecting".to_string(),
                            runtime,
                        }
                    }
                }
                VSCodeWorkbenchReadiness::Preparing => VSCodeWorkbenchSnapshot {
                    status: "preparing".to_string(),
                    phase: phase.to_string(),
                    elapsed_seconds,
                    first_launch,
                    workspace_path: Some(workspace_path),
                    url: None,
                    detail: phase_detail(phase).to_string(),
                    cli_path: Some(cli_path),
                    bridge_status: "waiting".to_string(),
                    runtime,
                },
                VSCodeWorkbenchReadiness::Error => VSCodeWorkbenchSnapshot {
                    status: "error".to_string(),
                    phase: "error".to_string(),
                    elapsed_seconds,
                    first_launch,
                    workspace_path: Some(workspace_path),
                    url: None,
                    detail: format!(
                        "VS Code Workbench returned HTTP {status}: {}. Logs: '{}' and '{}'.",
                        body.trim().chars().take(300).collect::<String>(),
                        stdout_log_path.display(),
                        stderr_log_path.display(),
                    ),
                    cli_path: Some(cli_path),
                    bridge_status: "error".to_string(),
                    runtime,
                },
            }
        }
        Err(_) => VSCodeWorkbenchSnapshot {
            status: "preparing".to_string(),
            phase: phase.to_string(),
            elapsed_seconds,
            first_launch,
            workspace_path: Some(workspace_path),
            url: None,
            detail: phase_detail(phase).to_string(),
            cli_path: Some(cli_path),
            bridge_status: "waiting".to_string(),
            runtime,
        },
    };

    Ok(set_snapshot(&state, snapshot).await)
}

async fn post_bridge_request<T: Serialize>(
    bridge_url: &str,
    bridge_token: &str,
    endpoint: &str,
    payload: &T,
) -> Result<(), String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|error| error.to_string())?
        .post(format!("{bridge_url}{endpoint}"))
        .bearer_auth(bridge_token)
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("Unable to reach the VS Code Workbench bridge: {error}"))?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    Err(format!(
        "VS Code Workbench bridge returned HTTP {status}: {detail}"
    ))
}

#[tauri::command]
pub async fn desktop_open_vscode_workbench_resource(
    request: VSCodeWorkbenchOpenRequest,
    state: State<'_, VSCodeWorkbenchState>,
) -> Result<VSCodeWorkbenchBridgeAcknowledgement, String> {
    if request.kind != "text" && request.kind != "notebook" {
        return Err("VS Code Workbench resource kind must be text or notebook.".to_string());
    }

    let (workspace_path, bridge_url, bridge_token) = {
        let process = state.process.lock().await;
        let managed = process
            .as_ref()
            .ok_or_else(|| "VS Code Workbench is not running.".to_string())?;
        (
            managed.workspace_path.clone(),
            managed.bridge_url.clone(),
            managed.bridge_token.clone(),
        )
    };
    let canonical = validate_resource_path(Path::new(&workspace_path), Path::new(&request.path))?;
    let request_id = request.request_id;
    let payload = VSCodeWorkbenchOpenRequest {
        path: external_runtime_path(&canonical),
        ..request
    };
    post_bridge_request(&bridge_url, &bridge_token, "/open", &payload).await?;
    Ok(VSCodeWorkbenchBridgeAcknowledgement {
        ok: true,
        request_id: Some(request_id),
    })
}

#[tauri::command]
pub async fn desktop_run_vscode_workbench_action(
    request: VSCodeWorkbenchActionRequest,
    state: State<'_, VSCodeWorkbenchState>,
) -> Result<VSCodeWorkbenchBridgeAcknowledgement, String> {
    let (bridge_url, bridge_token) = {
        let process = state.process.lock().await;
        let managed = process
            .as_ref()
            .ok_or_else(|| "VS Code Workbench is not running.".to_string())?;
        (managed.bridge_url.clone(), managed.bridge_token.clone())
    };
    post_bridge_request(&bridge_url, &bridge_token, "/action", &request).await?;
    Ok(VSCodeWorkbenchBridgeAcknowledgement {
        ok: true,
        request_id: None,
    })
}

#[tauri::command]
pub async fn desktop_stop_vscode_workbench(
    state: State<'_, VSCodeWorkbenchState>,
) -> Result<VSCodeWorkbenchSnapshot, String> {
    if let Some(mut managed) = state.process.lock().await.take() {
        let _ = managed.child.start_kill();
        let _ = managed.child.wait().await;
    }
    Ok(set_snapshot(&state, VSCodeWorkbenchSnapshot::default()).await)
}

pub fn terminate_owned_process(state: &VSCodeWorkbenchState) {
    if let Ok(mut process) = state.process.try_lock() {
        if let Some(managed) = process.as_mut() {
            let _ = managed.child.start_kill();
        }
        *process = None;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_authenticated_url, build_bridge_environment, build_probe_url, build_runtime_args,
        build_serve_web_args, classify_combined_phase, classify_preparing_phase,
        classify_readiness, classify_runtime_preparing_phase, extension_location_path,
        external_runtime_path, import_vscode_extensions, install_bridge_extension,
        registry_entry_location, remove_imported_vscode_extensions, runtime_snapshot,
        validate_resource_path, VSCodeWorkbenchAction, VSCodeWorkbenchActionRequest,
        VSCodeWorkbenchOpenRequest, VSCodeWorkbenchReadiness,
    };
    use crate::code_oss_runtime::{
        build_code_server_args, resolve_runtime_layout, select_runtime, CodeOSSProfilePaths,
        CodeOSSRuntimeKind,
    };
    use serde_json::Value;
    use std::{fs, path::Path};
    use uuid::Uuid;

    #[test]
    fn bundled_code_oss_layout_requires_matching_runtime_artifacts() {
        let root =
            std::env::temp_dir().join(format!("lattice-code-oss-layout-test-{}", Uuid::new_v4()));
        let node = root.join("bin").join("node.exe");
        let entrypoint = root
            .join("node_modules")
            .join("code-server")
            .join("out")
            .join("node")
            .join("entry.js");
        fs::create_dir_all(node.parent().expect("node parent")).expect("node directory");
        fs::create_dir_all(entrypoint.parent().expect("entrypoint parent"))
            .expect("entrypoint directory");
        fs::write(&node, b"node").expect("node executable");
        fs::write(&entrypoint, b"entry").expect("server entrypoint");
        fs::write(
            root.join("provision-manifest.json"),
            r#"{
              "schemaVersion": 1,
              "distribution": "code-server",
              "runtimeVersion": "4.128.0",
              "codeOssVersion": "1.128.0",
              "nodeVersion": "22.18.0",
              "platform": "win32",
              "arch": "x64",
              "entrypoint": "node_modules/code-server/out/node/entry.js"
            }"#,
        )
        .expect("runtime manifest");

        let runtime = resolve_runtime_layout(&root, "win32", "x64").expect("bundled runtime");
        assert_eq!(runtime.kind, CodeOSSRuntimeKind::BundledCodeServer);
        assert_eq!(runtime.executable, node);
        assert_eq!(runtime.entrypoint.as_deref(), Some(entrypoint.as_path()));
        assert_eq!(runtime.runtime_version, "4.128.0");
        assert_eq!(runtime.code_oss_version, "1.128.0");

        fs::remove_dir_all(root).expect("remove runtime fixture");
    }

    #[test]
    fn bundled_code_oss_layout_rejects_missing_or_wrong_architecture() {
        let missing =
            std::env::temp_dir().join(format!("lattice-code-oss-missing-test-{}", Uuid::new_v4()));
        assert!(resolve_runtime_layout(&missing, "win32", "x64").is_err());
    }

    #[test]
    fn code_server_args_are_loopback_only_and_use_the_lattice_profile() {
        let profile = CodeOSSProfilePaths::new(Path::new("C:/Lattice/code-oss"));
        let args = build_code_server_args(43119, Path::new("C:/work/lattice"), &profile);
        let expected_user_data = profile.user_data.to_string_lossy().to_string();
        let expected_extensions = profile.extensions.to_string_lossy().to_string();

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--bind-addr", "127.0.0.1:43119"]));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--user-data-dir" && pair[1] == expected_user_data));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--extensions-dir" && pair[1] == expected_extensions));
        assert!(args.windows(2).any(|pair| pair == ["--auth", "none"]));
        assert!(args.contains(&"--disable-telemetry".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("C:/work/lattice"));
        assert!(!args.iter().any(|argument| argument.contains("commit-id")));
        assert!(!args
            .iter()
            .any(|argument| argument.contains("server-data-dir")));
    }

    #[test]
    fn bundled_runtime_command_starts_the_packaged_entrypoint() {
        let profile = CodeOSSProfilePaths::new(Path::new("C:/Lattice/code-oss"));
        let runtime = crate::code_oss_runtime::CodeOSSRuntime {
            kind: CodeOSSRuntimeKind::BundledCodeServer,
            executable: Path::new("C:/Lattice/code-oss-runtime/bin/node.exe").to_path_buf(),
            entrypoint: Some(
                Path::new("C:/Lattice/code-oss-runtime/node_modules/code-server/out/node/entry.js")
                    .to_path_buf(),
            ),
            runtime_version: "4.128.0".to_string(),
            code_oss_version: "1.128.0".to_string(),
        };

        let args = build_runtime_args(
            &runtime,
            43119,
            "unused-token",
            Path::new("C:/work/lattice"),
            &profile,
            None,
            None,
        )
        .expect("bundled runtime arguments");

        assert_eq!(
            args.first().map(String::as_str),
            Some("C:/Lattice/code-oss-runtime/node_modules/code-server/out/node/entry.js")
        );
        assert!(args.windows(2).any(|pair| pair == ["--auth", "none"]));
        assert!(!args.iter().any(|argument| argument == "serve-web"));
    }

    #[test]
    fn bundled_runtime_command_removes_windows_verbatim_entrypoint_prefix() {
        let profile = CodeOSSProfilePaths::new(Path::new("C:/Lattice/code-oss"));
        let runtime = crate::code_oss_runtime::CodeOSSRuntime {
            kind: CodeOSSRuntimeKind::BundledCodeServer,
            executable: Path::new(r"\\?\C:\Lattice\code-oss-runtime\bin\node.exe").to_path_buf(),
            entrypoint: Some(
                Path::new(
                    r"\\?\C:\Lattice\code-oss-runtime\node_modules\code-server\out\node\entry.js",
                )
                .to_path_buf(),
            ),
            runtime_version: "4.128.0".to_string(),
            code_oss_version: "1.128.0".to_string(),
        };

        let args = build_runtime_args(
            &runtime,
            43119,
            "unused-token",
            Path::new("C:/work/lattice"),
            &profile,
            None,
            None,
        )
        .expect("bundled runtime arguments");

        assert_eq!(
            args.first().map(String::as_str),
            Some(r"C:\Lattice\code-oss-runtime\node_modules\code-server\out\node\entry.js")
        );
        assert!(!args[0].starts_with(r"\\?\"));
    }

    #[test]
    fn bundled_runtime_never_reports_a_network_download_phase() {
        assert_eq!(
            classify_runtime_preparing_phase(
                CodeOSSRuntimeKind::BundledCodeServer,
                0,
                false,
                false,
            ),
            "starting"
        );
        assert_eq!(
            classify_runtime_preparing_phase(
                CodeOSSRuntimeKind::BundledCodeServer,
                30,
                false,
                true,
            ),
            "starting"
        );
        assert_eq!(
            classify_runtime_preparing_phase(
                CodeOSSRuntimeKind::LegacyVSCodeTunnel,
                5,
                false,
                false,
            ),
            "downloading"
        );
    }

    #[test]
    fn bundled_runtime_snapshot_exposes_truthful_diagnostics() {
        let profile = CodeOSSProfilePaths::new(Path::new("C:/Lattice/code-oss"));
        let runtime = crate::code_oss_runtime::CodeOSSRuntime {
            kind: CodeOSSRuntimeKind::BundledCodeServer,
            executable: Path::new("C:/Lattice/runtime/bin/node.exe").to_path_buf(),
            entrypoint: Some(Path::new("C:/Lattice/runtime/entry.js").to_path_buf()),
            runtime_version: "4.128.0".to_string(),
            code_oss_version: "1.128.0".to_string(),
        };

        assert_eq!(
            serde_json::to_value(runtime_snapshot(&runtime, &profile)).expect("runtime snapshot"),
            serde_json::json!({
                "runtimeKind": "bundledCodeServer",
                "runtimeVersion": "4.128.0",
                "codeOssVersion": "1.128.0",
                "profilePath": "C:/Lattice/code-oss",
                "legacyFallback": false,
            })
        );
    }

    #[test]
    fn production_runtime_selection_rejects_a_missing_bundle() {
        let error = select_runtime(
            Err("bundle is corrupt".to_string()),
            Some(Path::new("C:/VSCode/code-tunnel.exe").to_path_buf()),
            false,
        )
        .expect_err("production must not use an external VS Code fallback");

        assert!(error.contains("bundle is corrupt"));
        assert!(error.contains("prepare:code-oss-runtime"));
    }

    #[test]
    fn legacy_runtime_selection_requires_explicit_development_opt_in() {
        let runtime = select_runtime(
            Err("bundle is corrupt".to_string()),
            Some(Path::new("C:/VSCode/code-tunnel.exe").to_path_buf()),
            true,
        )
        .expect("explicit fallback");

        assert_eq!(runtime.kind, CodeOSSRuntimeKind::LegacyVSCodeTunnel);
        assert_eq!(runtime.executable, Path::new("C:/VSCode/code-tunnel.exe"));
        assert!(runtime.entrypoint.is_none());
    }

    #[test]
    fn serve_web_args_are_loopback_only_and_token_protected() {
        let args = build_serve_web_args(
            43119,
            "secret-token",
            "C:/work/lattice",
            Some("C:/Users/test/.vscode"),
            Some("fc3def6774c76082adf699d366f31a557ce5573f"),
        );

        assert_eq!(args[0], "serve-web");
        assert!(args.windows(2).any(|pair| pair == ["--host", "127.0.0.1"]));
        assert!(args.windows(2).any(|pair| pair == ["--port", "43119"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--connection-token", "secret-token"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--default-folder", "C:/work/lattice"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--server-data-dir", "C:/Users/test/.vscode"]));
        assert!(args
            .windows(2)
            .any(|pair| { pair == ["--commit-id", "fc3def6774c76082adf699d366f31a557ce5573f",] }));
        assert!(args.contains(&"--accept-server-license-terms".to_string()));
        assert!(args.contains(&"--disable-telemetry".to_string()));
        assert!(!args.contains(&"--without-connection-token".to_string()));
    }

    #[test]
    fn authenticated_url_is_same_site_with_tauri_and_has_no_unsupported_payload() {
        let url = build_authenticated_url(43119, "token-123", Path::new("C:/work/lattice project"))
            .expect("authenticated URL");
        let parsed = reqwest::Url::parse(&url).expect("parse authenticated URL");
        assert_eq!(parsed.host_str(), Some("vscode.tauri.localhost"));
        assert_eq!(parsed.port(), Some(43119));
        let query = parsed
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            query.get("tkn").map(|value| value.as_ref()),
            Some("token-123")
        );
        assert_eq!(
            query.get("folder").map(|value| value.as_ref()),
            Some("vscode-remote://remote/C:/work/lattice project")
        );
        assert!(!url.contains("payload="));
    }

    #[test]
    fn external_runtime_paths_remove_windows_verbatim_prefixes() {
        assert_eq!(
            external_runtime_path(Path::new(r"\\?\C:\work\lattice")),
            r"C:\work\lattice"
        );
        assert_eq!(
            external_runtime_path(Path::new(r"\\?\UNC\server\share\project")),
            r"\\server\share\project"
        );
        assert_eq!(
            external_runtime_path(Path::new(r"C:\work\lattice")),
            r"C:\work\lattice"
        );
    }

    #[test]
    fn authenticated_url_never_contains_a_windows_verbatim_prefix() {
        let url = build_authenticated_url(
            43119,
            "token-123",
            Path::new(r"\\?\C:\work\lattice project"),
        )
        .expect("authenticated URL");
        let parsed = reqwest::Url::parse(&url).expect("parse authenticated URL");
        let query = parsed
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            query.get("folder").map(|value| value.as_ref()),
            Some("vscode-remote://remote/C:/work/lattice project")
        );
        assert!(!url.contains("%3F"));
    }

    #[test]
    fn probe_url_remains_on_the_loopback_address() {
        assert_eq!(
            build_probe_url(43119, "token-123"),
            "http://127.0.0.1:43119/?tkn=token-123"
        );
    }

    #[test]
    fn bridge_installer_copies_and_registers_without_an_external_cli() {
        let root =
            std::env::temp_dir().join(format!("lattice-vscode-bridge-test-{}", Uuid::new_v4()));
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("vscode-lattice-bridge");
        fs::create_dir_all(&root).expect("temporary extensions directory");
        fs::write(
            root.join("extensions.json"),
            r#"[{"identifier":{"id":"example.keep"},"version":"2.0.0"}]"#,
        )
        .expect("seed extension registry");

        assert!(install_bridge_extension(&source, &root).expect("first install"));
        assert!(!install_bridge_extension(&source, &root).expect("idempotent install"));

        let installed = root
            .join("lattice.lattice-workbench-bridge-1.0.1")
            .join("package.json");
        assert!(installed.is_file());
        let registry: Value = serde_json::from_slice(
            &fs::read(root.join("extensions.json")).expect("read extension registry"),
        )
        .expect("parse extension registry");
        let entries = registry.as_array().expect("extension registry array");
        assert!(entries.iter().any(|entry| {
            entry.pointer("/identifier/id").and_then(Value::as_str) == Some("example.keep")
        }));
        assert_eq!(
            entries
                .iter()
                .filter(|entry| {
                    entry.pointer("/identifier/id").and_then(Value::as_str)
                        == Some("lattice.lattice-workbench-bridge")
                })
                .count(),
            1
        );

        fs::remove_dir_all(root).expect("remove temporary extensions directory");
    }

    #[test]
    fn vscode_extension_import_is_external_safe_and_idempotent() {
        let root = std::env::temp_dir().join(format!(
            "lattice-vscode-extension-import-test-{}",
            Uuid::new_v4()
        ));
        let source = root.join("source");
        let target = root.join("target");
        let imported_location = source.join("example.imported-1.0.0");
        let owned_location = source.join("example.owned-1.0.0");
        fs::create_dir_all(&imported_location).expect("imported extension directory");
        fs::create_dir_all(&owned_location).expect("owned extension directory");
        fs::create_dir_all(&target).expect("target extension directory");
        fs::write(
            imported_location.join("package.json"),
            r#"{"publisher":"example","name":"imported","version":"1.0.0"}"#,
        )
        .expect("imported extension manifest");
        fs::write(
            owned_location.join("package.json"),
            r#"{"publisher":"example","name":"owned","version":"1.0.0"}"#,
        )
        .expect("owned extension manifest");

        let registry_entry = |id: &str, location: &Path| {
            serde_json::json!({
                "identifier": { "id": id },
                "version": "1.0.0",
                "location": {
                    "$mid": 1,
                    "path": extension_location_path(location),
                    "scheme": "file"
                },
                "relativeLocation": location.file_name().and_then(|name| name.to_str()),
                "metadata": { "source": "gallery" }
            })
        };
        fs::write(
            source.join("extensions.json"),
            serde_json::to_vec(&vec![
                registry_entry("example.imported", &imported_location),
                registry_entry("example.owned", &owned_location),
                registry_entry("example.missing", &source.join("missing")),
            ])
            .expect("source registry"),
        )
        .expect("write source registry");
        fs::write(
            target.join("extensions.json"),
            serde_json::to_vec(&vec![registry_entry("example.owned", &owned_location)])
                .expect("target registry"),
        )
        .expect("write target registry");

        assert_eq!(
            import_vscode_extensions(&source, &target).expect("first import"),
            1
        );
        let first_bytes = fs::read(target.join("extensions.json")).expect("first registry");
        let first_registry: Vec<Value> =
            serde_json::from_slice(&first_bytes).expect("parse first registry");
        assert_eq!(first_registry.len(), 2);
        assert!(first_registry.iter().any(|entry| {
            entry.pointer("/identifier/id").and_then(Value::as_str) == Some("example.imported")
                && entry
                    .pointer("/metadata/latticeImportedFromVSCode")
                    .and_then(Value::as_bool)
                    == Some(true)
        }));
        let imported_entry = first_registry
            .iter()
            .find(|entry| {
                entry.pointer("/identifier/id").and_then(Value::as_str) == Some("example.imported")
            })
            .expect("imported registry entry");
        let imported_link = registry_entry_location(imported_entry).expect("imported link path");
        assert!(imported_link.starts_with(&target));
        assert_eq!(
            fs::canonicalize(imported_link).expect("resolve imported link"),
            fs::canonicalize(&imported_location).expect("resolve imported source")
        );
        assert_eq!(
            imported_entry
                .pointer("/metadata/source")
                .and_then(Value::as_str),
            Some("vsix")
        );
        assert_eq!(
            imported_entry
                .pointer("/metadata/pinned")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            first_registry
                .iter()
                .filter(|entry| {
                    entry.pointer("/identifier/id").and_then(Value::as_str) == Some("example.owned")
                })
                .count(),
            1
        );

        assert_eq!(
            import_vscode_extensions(&source, &target).expect("second import"),
            1
        );
        assert_eq!(
            fs::read(target.join("extensions.json")).expect("second registry"),
            first_bytes
        );

        remove_imported_vscode_extensions(&target).expect("stage startup registry");
        let staged_registry: Vec<Value> = serde_json::from_slice(
            &fs::read(target.join("extensions.json")).expect("staged registry"),
        )
        .expect("parse staged registry");
        assert_eq!(staged_registry.len(), 1);
        assert_eq!(
            staged_registry[0]
                .pointer("/identifier/id")
                .and_then(Value::as_str),
            Some("example.owned")
        );

        fs::remove_dir_all(root).expect("remove extension import fixture");
    }

    #[test]
    fn bridge_environment_is_scoped_to_the_owned_workbench_process() {
        let environment = build_bridge_environment(
            43120,
            "bridge-secret",
            "C:/work/lattice",
            CodeOSSRuntimeKind::BundledCodeServer,
        );
        assert!(environment.contains(&(
            "LATTICE_VSCODE_BRIDGE_PORT".to_string(),
            "43120".to_string(),
        )));
        assert!(environment.contains(&(
            "LATTICE_VSCODE_BRIDGE_TOKEN".to_string(),
            "bridge-secret".to_string(),
        )));
        assert!(environment.contains(&(
            "LATTICE_VSCODE_WORKSPACE".to_string(),
            "C:/work/lattice".to_string(),
        )));
        let gallery = environment
            .iter()
            .find(|(key, _)| key == "EXTENSIONS_GALLERY")
            .map(|(_, value)| value)
            .expect("Open VSX gallery environment");
        assert_eq!(
            serde_json::from_str::<Value>(gallery).expect("Open VSX gallery JSON"),
            serde_json::json!({
                "serviceUrl": "https://open-vsx.org/vscode/gallery",
                "itemUrl": "https://open-vsx.org/vscode/item",
                "resourceUrlTemplate": "https://open-vsx.org/vscode/asset/{publisher}/{name}/Microsoft.VisualStudio.Code.WebResources/{version}/{path}",
            })
        );

        let legacy = build_bridge_environment(
            43120,
            "bridge-secret",
            "C:/work/lattice",
            CodeOSSRuntimeKind::LegacyVSCodeTunnel,
        );
        assert!(!legacy.iter().any(|(key, _)| key == "EXTENSIONS_GALLERY"));
    }

    #[test]
    fn resource_validation_rejects_paths_outside_the_workspace() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR"));
        let inside = workspace.join("src").join("vscode_workbench.rs");
        let outside = workspace
            .parent()
            .expect("repository root")
            .join("package.json");

        assert!(validate_resource_path(workspace, &inside).is_ok());
        assert!(validate_resource_path(workspace, &outside).is_err());
    }

    #[test]
    fn bridge_requests_use_a_strict_camel_case_json_contract() {
        let open = VSCodeWorkbenchOpenRequest {
            request_id: 7,
            path: "C:/work/lattice/src/main.ts".to_string(),
            kind: "text".to_string(),
            line: Some(4),
            column: Some(2),
        };
        assert_eq!(
            serde_json::to_value(open).expect("open request"),
            serde_json::json!({
                "requestId": 7,
                "path": "C:/work/lattice/src/main.ts",
                "kind": "text",
                "line": 4,
                "column": 2,
            })
        );

        let action = VSCodeWorkbenchActionRequest {
            action: VSCodeWorkbenchAction::ClosePrimarySidebar,
        };
        assert_eq!(
            serde_json::to_value(action).expect("action request"),
            serde_json::json!({ "action": "closePrimarySidebar" })
        );
    }

    #[test]
    fn ready_workbench_waits_for_the_bridge() {
        assert_eq!(classify_combined_phase(true, false), "connectingBridge");
        assert_eq!(classify_combined_phase(true, true), "ready");
    }

    #[test]
    fn readiness_distinguishes_download_page_from_workbench() {
        assert_eq!(classify_readiness(302, ""), VSCodeWorkbenchReadiness::Ready);
        assert_eq!(
            classify_readiness(202, "downloading"),
            VSCodeWorkbenchReadiness::Preparing
        );
        assert_eq!(
            classify_readiness(
                200,
                "<script id=\"vscode-workbench-web-configuration\"></script>"
            ),
            VSCodeWorkbenchReadiness::Ready
        );
        assert_eq!(
            classify_readiness(200, "not the workbench"),
            VSCodeWorkbenchReadiness::Preparing
        );
        assert_eq!(
            classify_readiness(500, "failed"),
            VSCodeWorkbenchReadiness::Error
        );
    }

    #[test]
    fn preparing_phase_reports_real_startup_work() {
        assert_eq!(classify_preparing_phase(0, false, false), "contacting");
        assert_eq!(classify_preparing_phase(5, false, false), "downloading");
        assert_eq!(classify_preparing_phase(5, false, true), "installing");
        assert_eq!(classify_preparing_phase(5, true, false), "starting");
    }
}
