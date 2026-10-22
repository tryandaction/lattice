use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::{io::AsyncReadExt, process::Command};

const MANIFEST: &str = include_str!("formula-ocr-runtime-manifest.json");
const RUNNER: &str = include_str!("formula-ocr-runner.py");
// Canonical path/size/SHA256 records derived from every entry of the pinned
// archives, plus the managed _pth file. runner.py is checked against RUNNER.
const INSTALLED_FILE_COUNT: usize = 3241;
const INSTALLED_INVENTORY_SHA256: &str =
    "7ff191f31265d20ec66a12f3c3a45bcdd6c2871f9f2aad4e8197a96c64a6b37a";
const EXTRACT: &str = r#"
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath($env:LATTICE_OCR_STAGE)
$assets=Get-Content -LiteralPath (Join-Path $root 'assets.json') -Raw|ConvertFrom-Json
foreach($asset in $assets){
  if($asset.kind -ne 'archive'){continue}
  $dest=Join-Path $root $asset.target
  [IO.Directory]::CreateDirectory($dest)|Out-Null
  $zip=[IO.Compression.ZipFile]::OpenRead((Join-Path $root ('downloads/'+$asset.name)))
  try {
    foreach($entry in $zip.Entries){
      $parts=$entry.FullName.Replace('\','/').Split('/')
      if($parts | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_.Contains(':') }){throw 'Unsafe archive'}
      if($entry.FullName.StartsWith('/') -or $entry.FullName.StartsWith('\')){throw 'Unsafe archive'}
      if((($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960){throw 'Archive link rejected'}
      $file=[IO.Path]::GetFullPath((Join-Path $dest $entry.FullName))
      if(-not $file.StartsWith(($dest.TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe destination'}
      if($entry.FullName.EndsWith('/')){[IO.Directory]::CreateDirectory($file)|Out-Null;continue}
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))|Out-Null
      $input=$entry.Open();$output=[IO.File]::Open($file,[IO.FileMode]::CreateNew)
      try {$input.CopyTo($output)}finally{$output.Dispose();$input.Dispose()}
    }
  } finally {$zip.Dispose()}
}
[IO.File]::WriteAllText((Join-Path $root 'python/python311._pth'),"python311.zip`r`n.`r`n../site-packages`r`nimport site`r`n",[Text.Encoding]::ASCII)
"#;

#[derive(Clone, Deserialize, Serialize)]
struct Asset {
    name: String,
    url: String,
    sha256: String,
    size: u64,
    target: String,
    kind: String,
}
#[derive(Deserialize)]
struct Manifest {
    id: String,
    assets: Vec<Asset>,
    #[serde(rename = "downloadBytes")]
    download_bytes: u64,
}
#[derive(Clone, Deserialize, Serialize)]
struct InstalledFile {
    path: String,
    size: u64,
    sha256: String,
}
#[derive(Deserialize, Serialize)]
struct Complete {
    id: String,
    manifest_sha256: String,
    files: Vec<InstalledFile>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub status: String,
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub request_id: Option<String>,
    pub error_code: Option<String>,
}
struct Job {
    owner: String,
    kind: String,
    cancelled: Arc<AtomicBool>,
    status: RuntimeStatus,
    active: bool,
    sequence: u64,
}
#[derive(Default)]
struct Jobs {
    jobs: HashMap<String, Job>,
    cancelled: VecDeque<(String, String, Instant)>,
    sequence: u64,
}
#[derive(Default)]
pub struct FormulaOcrRuntimeState {
    jobs: Mutex<Jobs>,
}
impl FormulaOcrRuntimeState {
    fn claim(&self, owner: &str, kind: &str) -> Result<(String, Arc<AtomicBool>), String> {
        self.claim_id(owner, kind, uuid::Uuid::new_v4().to_string())
    }
    fn claim_install(&self, owner: &str, request_id: Option<String>) -> Result<(String, Arc<AtomicBool>), String> {
        match request_id {
            Some(id) => self.claim_id(owner, "install", id),
            None => self.claim(owner, "install"),
        }
    }
    fn claim_id(
        &self,
        owner: &str,
        kind: &str,
        id: String,
    ) -> Result<(String, Arc<AtomicBool>), String> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("OCR_TASK_ID".into());
        }
        let mut state = self.jobs.lock().map_err(|_| "OCR_STATE")?;
        state
            .cancelled
            .retain(|(_, _, at)| at.elapsed() < Duration::from_secs(120));
        if state.jobs.contains_key(&id) {
            return Err("OCR_DUPLICATE_TASK".into());
        }
        if state.jobs.values().any(|job| {
            job.active && (kind == "install" || job.kind == "install" || job.kind == kind)
        }) {
            return Err("OCR_BUSY".into());
        }
        if state.jobs.len() >= 64 {
            state.jobs.retain(|_, job| job.active);
        }
        let cancelled = state
            .cancelled
            .iter()
            .any(|(window, request, _)| window == owner && request == &id);
        state
            .cancelled
            .retain(|(window, request, _)| window != owner || request != &id);
        let cancel = Arc::new(AtomicBool::new(cancelled));
        state.sequence += 1;
        let sequence = state.sequence;
        state.jobs.insert(
            id.clone(),
            Job {
                owner: owner.into(),
                kind: kind.into(),
                cancelled: cancel.clone(),
                active: true,
                sequence,
                status: RuntimeStatus {
                    status: "installing".into(),
                    phase: "preparing".into(),
                    downloaded_bytes: 0,
                    total_bytes: manifest().download_bytes,
                    request_id: Some(id.clone()),
                    error_code: None,
                },
            },
        );
        Ok((id, cancel))
    }
    pub fn cancel(&self, owner: &str, id: &str) -> bool {
        if id.is_empty() || id.len() > 128 {
            return false;
        }
        if let Ok(mut state) = self.jobs.lock() {
            if let Some(job) = state.jobs.get(id) {
                if job.owner != owner || !job.active {
                    return false;
                }
                job.cancelled.store(true, Ordering::SeqCst);
                return true;
            }
            state.cancelled.retain(|(window, request, at)| {
                at.elapsed() < Duration::from_secs(120) && (window != owner || request != id)
            });
            if state.cancelled.len() >= 64 {
                state.cancelled.pop_front();
            }
            state
                .cancelled
                .push_back((owner.into(), id.into(), Instant::now()));
            return true;
        }
        false
    }
    pub fn stop_window(&self, owner: &str) {
        if let Ok(state) = self.jobs.lock() {
            for job in state
                .jobs
                .values()
                .filter(|job| job.owner == owner && job.active)
            {
                job.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }
    fn cancelled(&self, id: &str) -> bool {
        self.jobs
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .jobs
                    .get(id)
                    .map(|job| job.cancelled.load(Ordering::SeqCst))
            })
            .unwrap_or(true)
    }
    fn progress(&self, id: &str, phase: &str, bytes: u64) {
        if let Ok(mut state) = self.jobs.lock() {
            if let Some(job) = state.jobs.get_mut(id).filter(|job| job.active) {
                job.status.phase = phase.into();
                job.status.downloaded_bytes = bytes;
            }
        }
    }
    fn finish(&self, id: &str, result: &Result<(), String>) {
        if let Ok(mut state) = self.jobs.lock() {
            if let Some(job) = state.jobs.get_mut(id) {
                job.active = false;
                let cancelled = job.cancelled.load(Ordering::SeqCst);
                job.status.status = if cancelled {
                    "cancelled"
                } else if result.is_ok() {
                    "ready"
                } else {
                    "error"
                }
                .into();
                job.status.error_code = if cancelled {
                    Some("OCR_CANCELLED".into())
                } else {
                    result.as_ref().err().cloned()
                };
            }
        }
    }
    fn latest_install(&self, owner: &str) -> Result<Option<RuntimeStatus>, String> {
        let state = self.jobs.lock().map_err(|_| "OCR_STATE")?;
        Ok(state
            .jobs
            .values()
            .filter(|job| job.owner == owner && job.kind == "install")
            .max_by_key(|job| (job.active, job.sequence))
            .map(|job| job.status.clone()))
    }
}
struct JobGuard<'a> {
    state: &'a FormulaOcrRuntimeState,
    id: String,
    cancel: Arc<AtomicBool>,
    finished: bool,
}
impl<'a> JobGuard<'a> {
    fn new(state: &'a FormulaOcrRuntimeState, id: String, cancel: Arc<AtomicBool>) -> Self {
        Self {
            state,
            id,
            cancel,
            finished: false,
        }
    }
    fn finish<T>(&mut self, result: &Result<T, String>) {
        self.state
            .finish(&self.id, &result.as_ref().map(|_| ()).map_err(Clone::clone));
        self.finished = true;
    }
}
impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        if !self.finished {
            self.cancel.store(true, Ordering::SeqCst);
            self.state.finish(&self.id, &Err("OCR_TASK_ABORTED".into()));
        }
    }
}
fn manifest() -> Manifest {
    serde_json::from_str(MANIFEST).expect("compiled OCR manifest")
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn file_digest(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(|_| "OCR_FILE")?;
    let mut hash = Sha256::new();
    let mut b = [0u8; 65536];
    loop {
        let n = f.read(&mut b).map_err(|_| "OCR_FILE")?;
        if n == 0 {
            break;
        }
        hash.update(&b[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "OCR_STORAGE")?
        .join("formula-ocr")
        .join(manifest().id))
}
fn safe_relative(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(char::from(92))
        && !name.contains(':')
        && name
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}
fn plain_path(root: &Path, relative: &str) -> Option<PathBuf> {
    if !safe_relative(relative) || is_link(&fs::symlink_metadata(root).ok()?) {
        return None;
    }
    let canonical = fs::canonicalize(root).ok()?;
    let mut path = root.to_path_buf();
    for component in relative.split('/') {
        path.push(component);
        if is_link(&fs::symlink_metadata(&path).ok()?) {
            return None;
        }
    }
    fs::canonicalize(&path)
        .ok()?
        .starts_with(canonical)
        .then_some(path)
}
fn trusted_inventory(files: &[InstalledFile]) -> bool {
    if files.len() != INSTALLED_FILE_COUNT + 1 {
        return false;
    }
    let mut seen = HashSet::new();
    if files.iter().any(|file| {
        !safe_relative(&file.path)
            || !seen.insert(file.path.to_ascii_lowercase())
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit())
    }) {
        return false;
    }
    let runner = files.iter().find(|file| file.path == "runner.py");
    if !runner.is_some_and(|file| {
        file.size == RUNNER.len() as u64 && file.sha256 == digest(RUNNER.as_bytes())
    }) {
        return false;
    }
    let mut records = files
        .iter()
        .filter(|file| file.path != "runner.py")
        .collect::<Vec<_>>();
    records.sort_by(|left, right| left.path.cmp(&right.path));
    let canonical = records
        .iter()
        .map(|file| format!("{}\t{}\t{}\n", file.path, file.size, file.sha256))
        .collect::<String>();
    digest(canonical.as_bytes()) == INSTALLED_INVENTORY_SHA256
}
fn read_complete(root: &Path) -> Option<Complete> {
    let marker = plain_path(root, "complete.json")?;
    if fs::metadata(&marker).ok()?.len() > 2 * 1024 * 1024 {
        return None;
    }
    let complete: Complete = serde_json::from_slice(&fs::read(marker).ok()?).ok()?;
    if complete.id != manifest().id
        || complete.manifest_sha256 != digest(MANIFEST.as_bytes())
        || !trusted_inventory(&complete.files)
    {
        return None;
    }
    Some(complete)
}
fn complete(root: &Path) -> Option<Complete> {
    let complete = read_complete(root)?;
    let mut actual = HashMap::new();
    metadata_inventory(root, root, &mut actual).ok()?;
    if actual.len() != complete.files.len()
        || complete
            .files
            .iter()
            .any(|file| actual.get(&file.path) != Some(&file.size))
    {
        return None;
    }
    Some(complete)
}
fn metadata_inventory(
    root: &Path,
    dir: &Path,
    output: &mut HashMap<String, u64>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|_| "OCR_STORAGE")? {
        let entry = entry.map_err(|_| "OCR_STORAGE")?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| "OCR_STORAGE")?;
        if is_link(&metadata) {
            return Err("OCR_STORAGE".into());
        }
        let name = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| "OCR_STORAGE")?
            .to_string_lossy()
            .replace(char::from(92), "/");
        if name == "downloads" || name == "assets.json" || name == "complete.json" {
            continue;
        }
        if metadata.is_dir() {
            metadata_inventory(root, &entry.path(), output)?
        } else if metadata.is_file() {
            output.insert(name, metadata.len());
        }
        if output.len() > INSTALLED_FILE_COUNT + 1 {
            return Err("OCR_INTEGRITY".into());
        }
    }
    Ok(())
}
// Status is a structural check; every launch/repair performs full byte validation.
fn runtime_ready(root: &Path) -> bool {
    complete(root).is_some()
}
fn validate_runtime(root: &Path) -> Result<(), String> {
    validate_runtime_cancel(root, None)
}
fn validate_runtime_cancel(root: &Path, cancel: Option<&AtomicBool>) -> Result<(), String> {
    let complete = read_complete(root).ok_or("OCR_NOT_INSTALLED")?;
    let mut actual = Vec::new();
    inventory_cancel(root, root, &mut actual, cancel)?;
    if actual.len() != complete.files.len() || !trusted_inventory(&actual) {
        return Err("OCR_INTEGRITY".into());
    }
    if cancel.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        return Err("OCR_CANCELLED".into());
    }
    Ok(())
}
fn validated_png(data: &str) -> Result<Vec<u8>, String> {
    let b = data
        .strip_prefix("data:image/png;base64,")
        .ok_or("OCR_IMAGE_TYPE")?;
    if b.len() > 24 * 1024 * 1024 {
        return Err("OCR_IMAGE_SIZE".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b)
        .map_err(|_| "OCR_IMAGE_ENCODING")?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("OCR_IMAGE_TYPE".into());
    }
    let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .map_err(|_| "OCR_IMAGE_ENCODING")?;
    if image.width() > 8192
        || image.height() > 8192
        || image.width() as u64 * image.height() as u64 > 16_000_000
    {
        return Err("OCR_IMAGE_SIZE".into());
    }
    Ok(bytes)
}
async fn until_cancelled(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(100)).await
    }
}
async fn bounded_process(
    mut cmd: Command,
    cancel: Arc<AtomicBool>,
    seconds: u64,
) -> Result<Vec<u8>, String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("OCR_CANCELLED".into());
    }
    crate::configure_tokio_command(&mut cmd);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|_| "OCR_PROCESS")?;
    let mut out = child.stdout.take().ok_or("OCR_PROCESS")?;
    let mut err = child.stderr.take().ok_or("OCR_PROCESS")?;
    // Keep pipe reads in this future: dropping cancellation/timeout must drop
    // both readers instead of detaching a task that still waits for descendants.
    let work = async {
        let stdout = async {
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 8192];
            loop {
                let count = out.read(&mut buffer).await.map_err(|_| "OCR_PROCESS")?;
                if count == 0 {
                    break;
                }
                if bytes.len() + count > 1024 * 1024 {
                    return Err("OCR_OUTPUT_SIZE");
                }
                bytes.extend_from_slice(&buffer[..count]);
            }
            Ok::<_, &str>(bytes)
        };
        let stderr = async {
            let mut count = 0usize;
            let mut buffer = [0u8; 8192];
            loop {
                let length = err.read(&mut buffer).await.map_err(|_| "OCR_PROCESS")?;
                if length == 0 {
                    break;
                }
                count += length;
                if count > 65536 {
                    return Err("OCR_OUTPUT_SIZE");
                }
            }
            Ok::<_, &str>(())
        };
        let wait = async { child.wait().await.map_err(|_| "OCR_PROCESS") };
        let (status, bytes, _) = tokio::try_join!(wait, stdout, stderr)?;
        if !status.success() {
            return Err("OCR_PROCESS_FAILED");
        }
        Ok::<_, &str>(bytes)
    };
    let result = tokio::select! {
        result=work => result.map_err(String::from),
        _=until_cancelled(cancel.clone()) => Err("OCR_CANCELLED".into()),
        _=tokio::time::sleep(Duration::from_secs(seconds)) => Err("OCR_TIMEOUT".into()),
    };
    if result.is_err() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("OCR_CANCELLED".into());
    }
    result
}
fn python_command(root: &Path) -> Command {
    let mut cmd = Command::new(root.join("python/python.exe"));
    cmd.arg("-I")
        .arg("-B")
        .arg(root.join("runner.py"))
        .env("PYTHONIOENCODING", "utf-8")
        .env("OMP_NUM_THREADS", "2");
    cmd
}
async fn health(root: &Path, cancel: Arc<AtomicBool>) -> Result<(), String> {
    let mut cmd = python_command(root);
    cmd.arg("--health");
    let bytes = bounded_process(cmd, cancel, 90).await?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "OCR_HEALTH")?;
    if value["ready"] != true || value["engine"] != "pix2text-mfr-1.5" {
        return Err("OCR_HEALTH".into());
    }
    Ok(())
}
fn inventory(root: &Path, dir: &Path, output: &mut Vec<InstalledFile>) -> Result<(), String> {
    inventory_cancel(root, dir, output, None)
}
fn inventory_cancel(
    root: &Path,
    dir: &Path,
    output: &mut Vec<InstalledFile>,
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|_| "OCR_STORAGE")? {
        if cancel.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
            return Err("OCR_CANCELLED".into());
        }
        let e = entry.map_err(|_| "OCR_STORAGE")?;
        let metadata = fs::symlink_metadata(e.path()).map_err(|_| "OCR_STORAGE")?;
        if is_link(&metadata) {
            return Err("OCR_STORAGE".into());
        }
        if output.len() > INSTALLED_FILE_COUNT + 1 {
            return Err("OCR_INTEGRITY".into());
        }
        let m = metadata.file_type();
        if m.is_dir() {
            inventory_cancel(root, &e.path(), output, cancel)?
        } else if m.is_file() {
            let name = e
                .path()
                .strip_prefix(root)
                .map_err(|_| "OCR_STORAGE")?
                .to_string_lossy()
                .replace(char::from(92), "/");
            if !name.starts_with("downloads/") && name != "assets.json" && name != "complete.json" {
                output.push(InstalledFile {
                    path: name,
                    size: metadata.len(),
                    sha256: file_digest(&e.path())?,
                })
            }
        }
    }
    Ok(())
}
fn replace_install(stage: &Path, target: &Path, cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("OCR_CANCELLED".into());
    }
    let parent = target.parent().ok_or("OCR_STORAGE")?;
    if fs::canonicalize(stage.parent().ok_or("OCR_STORAGE")?).ok() != fs::canonicalize(parent).ok()
    {
        return Err("OCR_STORAGE".into());
    }
    let backup = parent.join(format!(
        "quarantine-{}-{}",
        manifest().id,
        uuid::Uuid::new_v4()
    ));
    let had_old = fs::symlink_metadata(target).is_ok();
    if had_old {
        fs::rename(target, &backup).map_err(|_| "OCR_REPAIR_BACKUP")?
    }
    let replacement = if cancel.load(Ordering::SeqCst) {
        Err("OCR_CANCELLED")
    } else {
        fs::rename(stage, target).map_err(|_| "OCR_INSTALL_COMMIT")
    };
    if let Err(error) = replacement {
        if had_old && fs::rename(&backup, target).is_err() {
            return Err("OCR_REPAIR_ROLLBACK".into());
        }
        return Err(error.into());
    }
    // Keep the old directory quarantined for manual recovery; never recursively
    // follow or delete a corrupt tree that could contain a replaced junction.
    Ok(())
}
async fn install(
    app: &tauri::AppHandle,
    state: &FormulaOcrRuntimeState,
    id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    install_at(&runtime_root(app)?, state, id, cancel).await
}
async fn install_at(
    target: &Path,
    state: &FormulaOcrRuntimeState,
    id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err("OCR_UNSUPPORTED_PLATFORM".into());
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("OCR_CANCELLED".into());
    }
    let parent = target.parent().ok_or("OCR_STORAGE")?;
    fs::create_dir_all(parent).map_err(|_| "OCR_STORAGE")?;
    if is_link(&fs::symlink_metadata(parent).map_err(|_| "OCR_STORAGE")?) {
        return Err("OCR_STORAGE".into());
    }
    let verify_target = target.to_path_buf();
    let verify_cancel = cancel.clone();
    let valid = tokio::task::spawn_blocking(move || {
        validate_runtime_cancel(&verify_target, Some(&verify_cancel))
    })
    .await
    .map_err(|_| "OCR_TASK")?
    .is_ok();
    if valid && health(target, cancel.clone()).await.is_ok() {
        return Ok(());
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("OCR_CANCELLED".into());
    }
    let stage = tempfile::Builder::new()
        .prefix("install-")
        .tempdir_in(parent)
        .map_err(|_| "OCR_STORAGE")?;
    fs::create_dir(stage.path().join("downloads")).map_err(|_| "OCR_STORAGE")?;
    let cache = parent.join("downloads");
    fs::create_dir_all(&cache).map_err(|_| "OCR_STORAGE")?;
    if is_link(&fs::symlink_metadata(&cache).map_err(|_| "OCR_STORAGE")?) {
        return Err("OCR_STORAGE".into());
    }
    let m = manifest();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(25))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|_| "OCR_DOWNLOAD")?;
    let mut total = 0;
    for asset in &m.assets {
        if cancel.load(Ordering::SeqCst) {
            return Err("OCR_CANCELLED".into());
        }
        let cached = cache.join(&asset.sha256);
        let valid = fs::symlink_metadata(&cached)
            .map(|s| !is_link(&s) && s.is_file() && s.len() == asset.size)
            .unwrap_or(false)
            && file_digest(&cached).ok().as_deref() == Some(&asset.sha256);
        if !valid {
            let mut response = tokio::select! {r=client.get(&asset.url).send()=>r.map_err(|_|"OCR_DOWNLOAD")?,_=until_cancelled(cancel.clone())=>return Err("OCR_CANCELLED".into())};
            if !response.status().is_success() {
                return Err("OCR_DOWNLOAD".into());
            }
            let temp = tempfile::NamedTempFile::new_in(&cache).map_err(|_| "OCR_STORAGE")?;
            let mut file = tokio::fs::File::from_std(temp.reopen().map_err(|_| "OCR_STORAGE")?);
            let mut size = 0;
            let mut hasher = Sha256::new();
            loop {
                let chunk = tokio::select! {c=response.chunk()=>c.map_err(|_|"OCR_DOWNLOAD")?,_=until_cancelled(cancel.clone())=>return Err("OCR_CANCELLED".into())};
                let Some(chunk) = chunk else { break };
                size += chunk.len() as u64;
                if size > asset.size {
                    return Err("OCR_DOWNLOAD_SIZE".into());
                }
                hasher.update(&chunk);
                tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                    .await
                    .map_err(|_| "OCR_STORAGE")?;
                state.progress(id, "downloading", total + size);
            }
            drop(file);
            if size != asset.size || format!("{:x}", hasher.finalize()) != asset.sha256 {
                return Err("OCR_DOWNLOAD_HASH".into());
            }
            temp.persist(&cached).map_err(|_| "OCR_STORAGE")?;
        }
        let copied = stage.path().join("downloads").join(&asset.name);
        fs::copy(&cached, &copied).map_err(|_| "OCR_STORAGE")?;
        if file_digest(&copied)? != asset.sha256 {
            return Err("OCR_DOWNLOAD_HASH".into());
        }
        total += asset.size;
        state.progress(id, "downloading", total);
    }
    state.progress(id, "extracting", total);
    fs::write(
        stage.path().join("assets.json"),
        serde_json::to_vec(&m.assets).map_err(|_| "OCR_MANIFEST")?,
    )
    .map_err(|_| "OCR_STORAGE")?;
    let mut cmd = Command::new(
        PathBuf::from(std::env::var_os("SystemRoot").ok_or("OCR_SYSTEM")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    );
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", EXTRACT])
        .env("LATTICE_OCR_STAGE", stage.path());
    bounded_process(cmd, cancel.clone(), 120).await?;
    fs::create_dir(stage.path().join("models")).map_err(|_| "OCR_STORAGE")?;
    for a in m.assets.iter().filter(|a| a.kind == "file") {
        fs::copy(
            stage.path().join("downloads").join(&a.name),
            stage.path().join(&a.target),
        )
        .map_err(|_| "OCR_STORAGE")?;
    }
    fs::write(stage.path().join("runner.py"), RUNNER).map_err(|_| "OCR_STORAGE")?;
    state.progress(id, "checking", total);
    health(stage.path(), cancel.clone()).await?;
    let mut files = Vec::new();
    inventory(stage.path(), stage.path(), &mut files)?;
    if !trusted_inventory(&files) {
        return Err("OCR_INVENTORY".into());
    }
    let complete = Complete {
        id: m.id,
        manifest_sha256: digest(MANIFEST.as_bytes()),
        files,
    };
    fs::write(
        stage.path().join("complete.json"),
        serde_json::to_vec(&complete).map_err(|_| "OCR_STORAGE")?,
    )
    .map_err(|_| "OCR_STORAGE")?;
    validate_runtime_cancel(stage.path(), Some(&cancel))?;
    replace_install(stage.path(), target, &cancel)
}
#[tauri::command]
pub async fn formula_ocr_runtime_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FormulaOcrRuntimeState>,
) -> Result<RuntimeStatus, String> {
    if let Some(status) = state.latest_install(window.label())? {
        if status.status != "ready" {
            return Ok(status);
        }
    }
    let root = runtime_root(&app)?;
    let ready = tokio::task::spawn_blocking(move || runtime_ready(&root))
        .await
        .map_err(|_| "OCR_TASK")?;
    Ok(RuntimeStatus {
        status: if !cfg!(all(windows, target_arch = "x86_64")) {
            "unsupported"
        } else if ready {
            "ready"
        } else {
            "missing"
        }
        .into(),
        phase: String::new(),
        downloaded_bytes: 0,
        total_bytes: manifest().download_bytes,
        request_id: None,
        error_code: None,
    })
}
#[tauri::command]
pub async fn formula_ocr_runtime_install(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FormulaOcrRuntimeState>,
    request_id: Option<String>,
) -> Result<(), String> {
    let (id, cancel) = state.claim_install(window.label(), request_id)?;
    let mut guard = JobGuard::new(&state, id.clone(), cancel.clone());
    let result = install(&app, &state, &id, cancel).await;
    guard.finish(&result);
    result
}
#[tauri::command]
pub fn formula_ocr_runtime_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FormulaOcrRuntimeState>,
    request_id: String,
) -> bool {
    state.cancel(window.label(), &request_id)
}
fn validate_recognition(value: serde_json::Value) -> Result<serde_json::Value,String> {
    let latex=value["latex"].as_str().ok_or("OCR_OUTPUT")?;
    if latex.trim().is_empty() { return Err("OCR_EMPTY".into()); }
    if latex.len()>80000 { return Err("OCR_OUTPUT_SIZE".into()); }
    let ended=value["endedWithEos"].as_bool().ok_or("OCR_OUTPUT")?;
    let truncated=value["truncated"].as_bool().ok_or("OCR_OUTPUT")?;
    if value["engine"]!="pix2text-mfr-1.5" || ended==truncated || !value["tokenCount"].as_u64().is_some_and(|count|(2..=1024).contains(&count)) { return Err("OCR_OUTPUT".into()); }
    Ok(value)
}
#[tauri::command]
pub async fn formula_ocr_runtime_recognize(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FormulaOcrRuntimeState>,
    request_id: String,
    image_data_url: String,
) -> Result<serde_json::Value, String> {
    let (id, cancel) = state.claim_id(window.label(), "recognition", request_id)?;
    let mut guard = JobGuard::new(&state, id, cancel.clone());
    let result = async {
        if cancel.load(Ordering::SeqCst) {
            return Err("OCR_CANCELLED".into());
        }
        let root = runtime_root(&app)?;
        let preprocessing_cancel = cancel.clone();
        let (bytes, root) = tokio::task::spawn_blocking(move || {
            let bytes = validated_png(&image_data_url)?;
            validate_runtime_cancel(&root, Some(&preprocessing_cancel))?;
            Ok::<_, String>((bytes, root))
        })
        .await
        .map_err(|_| "OCR_TASK".to_string())??;
        if cancel.load(Ordering::SeqCst) {
            return Err("OCR_CANCELLED".into());
        }
        let temp = tempfile::Builder::new()
            .suffix(".png")
            .tempfile()
            .map_err(|_| "OCR_STORAGE")?;
        fs::write(temp.path(), bytes).map_err(|_| "OCR_STORAGE")?;
        let mut cmd = python_command(&root);
        cmd.arg(temp.path());
        bounded_process(cmd, cancel.clone(), 90)
            .await
            .and_then(|out| {
                serde_json::from_slice::<serde_json::Value>(&out).map_err(|_| "OCR_OUTPUT".into())
            })
            .and_then(validate_recognition)
    }
    .await;
    guard.finish(&result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_uses_caller_id_and_retains_early_cancellation_without_reusing_previous_id() {
        let state = FormulaOcrRuntimeState::default();
        assert!(state.cancel("main", "first-install"));
        let (first, cancel) = state.claim_install("main", Some("first-install".into())).unwrap();
        assert_eq!(first, "first-install");
        assert!(cancel.load(Ordering::SeqCst));
        state.finish(&first, &Err("OCR_CANCELLED".into()));
        assert!(!state.cancel("main", &first));
        let (second, cancel) = state.claim_install("main", Some("second-install".into())).unwrap();
        assert_eq!(second, "second-install");
        assert!(!cancel.load(Ordering::SeqCst));
        assert!(!state.cancel("other-window", &second));
        assert!(!cancel.load(Ordering::SeqCst));
        state.finish(&second, &Ok(()));
        let (legacy, _) = state.claim_install("main", None).unwrap();
        assert_ne!(legacy, first);
        assert_ne!(legacy, second);
    }

    #[test]
    fn recognition_requires_real_completion_metadata_and_preserves_partial_output() {
        let complete=serde_json::json!({"latex":"x+y","engine":"pix2text-mfr-1.5","endedWithEos":true,"truncated":false,"tokenCount":12});
        assert!(validate_recognition(complete.clone()).is_ok());
        let mut partial=complete.clone();partial["endedWithEos"]=serde_json::json!(false);partial["truncated"]=serde_json::json!(true);
        assert_eq!(validate_recognition(partial.clone()).unwrap(),partial);
        for invalid in [serde_json::json!({"latex":"x+y"}),serde_json::json!({"latex":" ","engine":"pix2text-mfr-1.5","endedWithEos":true,"truncated":false,"tokenCount":2}),serde_json::json!({"latex":"x+y","engine":"pix2text-mfr-1.5","endedWithEos":true,"truncated":true,"tokenCount":12}),serde_json::json!({"latex":"x+y","engine":"pix2text-mfr-1.5","endedWithEos":true,"truncated":false,"tokenCount":1025})] { assert!(validate_recognition(invalid).is_err()); }
    }

    #[test]
    fn incomplete_or_altered_runtime_never_becomes_ready() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!runtime_ready(dir.path()));
        std::fs::write(dir.path().join("complete.json"), "{}").unwrap();
        assert!(!runtime_ready(dir.path()));
    }

    #[test]
    fn forged_duplicate_inventory_without_python_or_models_is_not_ready() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("runner.py"), RUNNER).unwrap();
        fs::write(dir.path().join("dummy"), "x").unwrap();
        let files = vec![
            InstalledFile {
                path: "dummy".into(),
                size: 1,
                sha256: digest(b"x")
            };
            20
        ];
        let marker = Complete {
            id: manifest().id,
            manifest_sha256: digest(MANIFEST.as_bytes()),
            files,
        };
        fs::write(
            dir.path().join("complete.json"),
            serde_json::to_vec(&marker).unwrap(),
        )
        .unwrap();
        assert!(
            !runtime_ready(dir.path()),
            "self-reported duplicate files must not establish a runnable install"
        );
    }

    #[test]
    fn cancellation_arriving_before_recognition_registration_is_retained() {
        let state = FormulaOcrRuntimeState::default();
        assert!(
            state.cancel("main", "early-task"),
            "early cancellation must remain pending for its requesting window"
        );
        let (id, cancel) = state
            .claim_id("main", "recognition", "early-task".into())
            .unwrap();
        assert!(cancel.load(Ordering::SeqCst));
        state.finish(&id, &Err("OCR_CANCELLED".into()));
        assert!(state
            .claim_id("main", "recognition", "next-task".into())
            .is_ok());
    }
    #[test]
    fn duplicate_request_and_early_return_do_not_leave_the_runtime_busy() {
        let state = FormulaOcrRuntimeState::default();
        let (id, cancel) = state
            .claim_id("main", "recognition", "first".into())
            .unwrap();
        {
            let _guard = JobGuard::new(&state, id, cancel);
        }
        assert!(state
            .claim_id("main", "recognition", "first".into())
            .is_err());
        assert!(state
            .claim_id("main", "recognition", "second".into())
            .is_ok());
        assert_eq!(
            state
                .jobs
                .lock()
                .unwrap()
                .jobs
                .values()
                .filter(|job| job.active)
                .count(),
            1
        );
    }
    #[test]
    fn installation_and_recognition_exclude_each_other_and_latest_status_is_deterministic() {
        let state = FormulaOcrRuntimeState::default();
        let (id, _) = state.claim("main", "install").unwrap();
        assert!(state.claim("main", "recognition").is_err());
        state.finish(&id, &Err("OCR_CANCELLED".into()));
        let (next, _) = state.claim("main", "install").unwrap();
        state.finish(&next, &Ok(()));
        assert_eq!(
            state.latest_install("main").unwrap().unwrap().request_id,
            Some(next)
        );
    }
    #[test]
    fn failed_stage_promotion_restores_the_previous_owned_directory() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("runtime");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("previous"), b"safe").unwrap();
        assert!(replace_install(
            &dir.path().join("missing-stage"),
            &target,
            &AtomicBool::new(false)
        )
        .is_err());
        assert_eq!(fs::read(target.join("previous")).unwrap(), b"safe");
        let stage = dir.path().join("stage");
        fs::create_dir(&stage).unwrap();
        fs::write(stage.join("next"), b"new").unwrap();
        replace_install(&stage, &target, &AtomicBool::new(false)).unwrap();
        assert_eq!(fs::read(target.join("next")).unwrap(), b"new");
        assert!(fs::read_dir(dir.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("quarantine-")));
    }
    #[tokio::test]
    #[ignore = "Explicit local cached Windows CPU runtime install and corruption recovery; no network/model request"]
    async fn cached_install_validates_ready_cancellation_and_corruption_repair() {
        let source = PathBuf::from(
            std::env::var_os("LATTICE_OCR_TEST_ASSET_CACHE")
                .expect("set explicit verified asset cache"),
        );
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("downloads");
        fs::create_dir(&cache).unwrap();
        for asset in manifest().assets {
            let path = source.join(&asset.name);
            assert_eq!(file_digest(&path).unwrap(), asset.sha256);
            fs::copy(path, cache.join(asset.sha256)).unwrap();
        }
        let target = dir.path().join(manifest().id);
        let state = FormulaOcrRuntimeState::default();
        let (id, cancel) = state.claim("test", "install").unwrap();
        install_at(&target, &state, &id, cancel).await.unwrap();
        state.finish(&id, &Ok(()));
        assert!(runtime_ready(&target));
        validate_runtime(&target).unwrap();
        let (id, cancel) = state.claim("test", "install").unwrap();
        cancel.store(true, Ordering::SeqCst);
        assert_eq!(
            install_at(&target, &state, &id, cancel).await.unwrap_err(),
            "OCR_CANCELLED"
        );
        state.finish(&id, &Err("OCR_CANCELLED".into()));
        assert!(runtime_ready(&target));
        let model = target.join("models/tokenizer.json");
        let mut bytes = fs::read(&model).unwrap();
        bytes[0] ^= 1;
        fs::write(&model, bytes).unwrap();
        assert!(validate_runtime(&target).is_err());
        let (id, cancel) = state.claim("test", "install").unwrap();
        install_at(&target, &state, &id, cancel).await.unwrap();
        state.finish(&id, &Ok(()));
        assert!(runtime_ready(&target));
        health(&target, Arc::new(AtomicBool::new(false)))
            .await
            .unwrap();
        fs::remove_file(target.join("python/python.exe")).unwrap();
        assert!(!runtime_ready(&target));
        let (id, cancel) = state.claim("test", "install").unwrap();
        install_at(&target, &state, &id, cancel).await.unwrap();
        state.finish(&id, &Ok(()));
        assert!(runtime_ready(&target));
    }

    #[tokio::test]
    async fn process_deadline_also_bounds_inherited_stdout_pipes() {
        let mut cmd = if cfg!(windows) {
            let mut command = Command::new(
                PathBuf::from(std::env::var_os("SystemRoot").unwrap())
                    .join("System32/WindowsPowerShell/v1.0/powershell.exe"),
            );
            command.args(["-NoProfile","-NonInteractive","-Command","$p=[Diagnostics.ProcessStartInfo]::new();$p.FileName=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe';$p.Arguments='-NoProfile -NonInteractive -Command Start-Sleep -Seconds 3';$p.UseShellExecute=$false;$p.CreateNoWindow=$true;[Diagnostics.Process]::Start($p)|Out-Null;Start-Sleep -Seconds 3"]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 3 & sleep 3"]);
            command
        };
        cmd.stdin(Stdio::null());
        let result = tokio::time::timeout(
            Duration::from_millis(1600),
            bounded_process(cmd, Arc::new(AtomicBool::new(false)), 1),
        )
        .await;
        assert!(
            result.is_ok(),
            "timeout must not wait indefinitely for inherited output pipes"
        );
        assert!(result.unwrap().is_err());
    }

    #[test]
    fn image_payload_requires_actual_png_and_has_a_bounded_size() {
        assert!(validated_png("data:image/png;base64,AAAA").is_err());
        assert!(validated_png("data:text/plain;base64,aGVsbG8=").is_err());
        assert!(validated_png(&format!(
            "data:image/png;base64,{}",
            "A".repeat(25 * 1024 * 1024)
        ))
        .is_err());
    }

    #[test]
    fn task_cancellation_is_owned_by_the_requesting_window() {
        let state = FormulaOcrRuntimeState::default();
        let (id, _) = state.claim("main", "recognition").unwrap();
        assert!(!state.cancel("other", &id));
        assert!(state.cancel("main", &id));
        assert!(state.cancelled(&id));
    }
}
