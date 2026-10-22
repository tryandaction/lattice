//! External imports own only their private staging tree; final names are never removed.
use std::{collections::HashMap, fs, io::{self, Write}, path::{Path, PathBuf}, sync::Mutex};
use serde::Deserialize;
use tauri::{State, WebviewWindow};

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ImportKind { File, Directory }

struct ImportStage {
    owner: String,
    target: PathBuf,
    kind: ImportKind,
    folder: tempfile::TempDir,
}

#[derive(Default)]
pub struct DropImportState { stages: Mutex<HashMap<String, ImportStage>> }

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".."
        && !name.ends_with(['.', ' '])
        && !name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
}

impl DropImportState {
    pub fn stop_window(&self, owner: &str) {
        if let Ok(mut stages) = self.stages.lock() { stages.retain(|_, stage| stage.owner != owner); }
    }

    fn begin(&self, owner: &str, target: &Path, kind: ImportKind) -> Result<String, String> {
        let target = fs::canonicalize(target).map_err(|error| error.to_string())?;
        if !target.is_dir() { return Err("Import target is not a directory".into()); }
        let folder = tempfile::Builder::new().prefix(".lattice-import-").tempdir_in(&target).map_err(|error| error.to_string())?;
        if kind == ImportKind::Directory { fs::create_dir(folder.path().join("payload")).map_err(|error| error.to_string())?; }
        let token = uuid::Uuid::new_v4().to_string();
        self.stages.lock().map_err(|_| "Import staging unavailable")?.insert(token.clone(), ImportStage { owner: owner.into(), target, kind, folder });
        Ok(token)
    }

    fn write(&self, owner: &str, token: &str, path: &[String], kind: ImportKind, data: &[u8], append: bool) -> Result<(), String> {
        if data.len() > 1024 * 1024 { return Err("Import chunk exceeds 1 MiB".into()); }
        let stages = self.stages.lock().map_err(|_| "Import staging unavailable")?;
        let stage = stages.get(token).filter(|stage| stage.owner == owner).ok_or("Unknown import staging token")?;
        if path.iter().any(|name| !valid_name(name)) || (stage.kind == ImportKind::File && !path.is_empty()) {
            return Err("Invalid import staging path".into());
        }
        let mut target = stage.folder.path().join("payload");
        for name in path {
            let meta = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
            if !meta.is_dir() || meta.file_type().is_symlink() { return Err("Invalid staging ancestor".into()); }
            target.push(name);
        }
        if kind == ImportKind::Directory {
            if path.is_empty() || !data.is_empty() || append { return Err("Invalid staging directory write".into()); }
            fs::create_dir(target).map_err(|error| error.to_string())
        } else {
            let mut options = fs::OpenOptions::new();
            options.write(true);
            if append {
                let meta = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
                if !meta.is_file() || meta.file_type().is_symlink() { return Err("Invalid staging file".into()); }
                options.append(true);
            } else { options.create_new(true); }
            let mut file = options.open(target).map_err(|error| error.to_string())?;
            file.write_all(data).map_err(|error| error.to_string())
        }
    }

    fn abort(&self, owner: &str, token: &str) -> Result<(), String> {
        let mut stages = self.stages.lock().map_err(|_| "Import staging unavailable")?;
        if stages.get(token).is_some_and(|stage| stage.owner != owner) { return Err("Unknown import staging token".into()); }
        if let Some(stage) = stages.remove(token) { stage.folder.close().map_err(|error| error.to_string())?; }
        Ok(())
    }

    fn commit(&self, owner: &str, token: &str, name: &str) -> Result<String, String> {
        if !valid_name(name) { return Err("Invalid imported entry name".into()); }
        let mut stages = self.stages.lock().map_err(|_| "Import staging unavailable")?;
        let stage = stages.get(token).filter(|stage| stage.owner == owner).ok_or("Unknown import staging token")?;
        let payload = stage.folder.path().join("payload");
        let metadata = fs::symlink_metadata(&payload).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || metadata.is_dir() != (stage.kind == ImportKind::Directory) {
            return Err("Invalid import staging payload".into());
        }
        for counter in 0..10_000 {
            let candidate = collision_name(name, stage.kind, counter);
            let destination = stage.target.join(&candidate);
            match move_noclobber(&payload, &destination) {
                Ok(()) => {
                    // Only the now-empty private container is dropped. Final output is never cleanup-owned.
                    stages.remove(token);
                    return Ok(candidate);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists || fs::symlink_metadata(&destination).is_ok() => continue,
                Err(error) => return Err(error.to_string()),
            }
        }
        Err("No free import name after 10000 attempts".into())
    }
}

fn collision_name(name: &str, kind: ImportKind, counter: usize) -> String {
    if counter == 0 { return name.into(); }
    let split = if kind == ImportKind::File { name.rfind('.').filter(|index| *index > 0).unwrap_or(name.len()) } else { name.len() };
    format!("{} ({counter}){}", &name[..split], &name[split..])
}

#[cfg(windows)]
fn move_noclobber(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" { fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32; }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // flags=0: no REPLACE_EXISTING and no COPY_ALLOWED fallback. Same-volume rename commits the whole item.
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0) } == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn move_noclobber(source: &Path, target: &Path) -> io::Result<()> {
    if source.is_dir() { return Err(io::Error::new(io::ErrorKind::Unsupported, "Atomic directory import is available on Windows only")); }
    fs::hard_link(source, target)?;
    // A failed unlink leaves only a private staging link, never damages the committed file.
    let _ = fs::remove_file(source);
    Ok(())
}

#[tauri::command]
pub fn desktop_begin_drop_import(window: WebviewWindow, state: State<'_, DropImportState>, target: String, kind: ImportKind) -> Result<String, String> {
    state.begin(window.label(), Path::new(&target), kind)
}
#[tauri::command]
pub fn desktop_write_drop_import(window: WebviewWindow, state: State<'_, DropImportState>, token: String, path: Vec<String>, kind: ImportKind, data: Vec<u8>, append: bool) -> Result<(), String> {
    state.write(window.label(), &token, &path, kind, &data, append)
}
#[tauri::command]
pub fn desktop_commit_drop_import(window: WebviewWindow, state: State<'_, DropImportState>, token: String, name: String) -> Result<String, String> {
    state.commit(window.label(), &token, &name)
}
#[tauri::command]
pub fn desktop_abort_drop_import(window: WebviewWindow, state: State<'_, DropImportState>, token: String) -> Result<(), String> {
    state.abort(window.label(), &token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stage_file(state: &DropImportState, root: &Path, bytes: &[u8]) -> String {
        let token = state.begin("test-window", root, ImportKind::File).unwrap();
        state.write("test-window", &token, &[], ImportKind::File, bytes, false).unwrap();
        token
    }

    #[test]
    fn external_file_created_after_staging_is_not_overwritten_or_cleanup_owned() {
        let root = tempfile::tempdir().unwrap();
        let state = DropImportState::default();
        let token = stage_file(&state, root.path(), b"imported bytes");
        fs::write(root.path().join("paper.pdf"), b"external bytes").unwrap();
        assert_eq!(state.commit("test-window", &token, "paper.pdf").unwrap(), "paper (1).pdf");
        state.abort("test-window", &token).unwrap();
        assert_eq!(fs::read(root.path().join("paper.pdf")).unwrap(), b"external bytes");
        assert_eq!(fs::read(root.path().join("paper (1).pdf")).unwrap(), b"imported bytes");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn external_directory_created_after_staging_is_never_merged_or_removed() {
        let root = tempfile::tempdir().unwrap();
        let state = DropImportState::default();
        let token = state.begin("test-window", root.path(), ImportKind::Directory).unwrap();
        state.write("test-window", &token, &["child.txt".into()], ImportKind::File, b"new child", false).unwrap();
        fs::create_dir(root.path().join("assets")).unwrap();
        fs::write(root.path().join("assets/external.txt"), b"precious").unwrap();
        assert_eq!(state.commit("test-window", &token, "assets").unwrap(), "assets (1)");
        state.abort("test-window", &token).unwrap();
        assert_eq!(fs::read(root.path().join("assets/external.txt")).unwrap(), b"precious");
        assert!(!root.path().join("assets/child.txt").exists());
        assert_eq!(fs::read(root.path().join("assets (1)/child.txt")).unwrap(), b"new child");
    }

    #[test]
    fn abort_after_cancel_or_failure_only_removes_private_stage() {
        let root = tempfile::tempdir().unwrap();
        let state = DropImportState::default();
        let token = stage_file(&state, root.path(), b"incomplete");
        fs::write(root.path().join("note.md"), b"external bytes").unwrap();
        assert!(state.write("test-window", &token, &["../note.md".into()], ImportKind::File, b"bad", false).is_err());
        state.abort("test-window", &token).unwrap();
        assert_eq!(fs::read(root.path().join("note.md")).unwrap(), b"external bytes");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn commit_rejects_invalid_names_and_cross_window_tokens_without_losing_stage() {
        let root = tempfile::tempdir().unwrap();
        let state = DropImportState::default();
        let token = stage_file(&state, root.path(), b"safe");
        for name in ["../paper.pdf", "a/b", "a\\b", "C:paper.pdf", "paper.", "paper ", ""] {
            assert!(state.commit("test-window", &token, name).is_err());
        }
        assert!(state.commit("other-window", &token, "paper.pdf").is_err());
        assert!(state.abort("other-window", &token).is_err());
        assert!(state.write("other-window", &token, &[], ImportKind::File, b"changed", true).is_err());
        assert_eq!(state.commit("test-window", &token, "paper.pdf").unwrap(), "paper.pdf");
        assert_eq!(fs::read(root.path().join("paper.pdf")).unwrap(), b"safe");
    }

    #[test]
    fn staging_chunks_form_the_complete_file_before_it_appears_at_final_name() {
        let root = tempfile::tempdir().unwrap();
        let state = DropImportState::default();
        let token = stage_file(&state, root.path(), b"first");
        state.write("test-window", &token, &[], ImportKind::File, b"second", true).unwrap();
        assert!(!root.path().join("result.txt").exists());
        state.commit("test-window", &token, "result.txt").unwrap();
        assert_eq!(fs::read(root.path().join("result.txt")).unwrap(), b"firstsecond");
    }

    #[test]
    fn two_os_commits_racing_for_one_destination_have_exactly_one_winner() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first-stage");
        let second = root.path().join("second-stage");
        fs::write(&first, b"first").unwrap(); fs::write(&second, b"second").unwrap();
        let target = root.path().join("result");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let workers: Vec<_> = [first.clone(), second.clone()].into_iter().map(|source| {
            let barrier = barrier.clone(); let destination = target.clone();
            std::thread::spawn(move || { barrier.wait(); move_noclobber(&source, &destination).is_ok() })
        }).collect();
        barrier.wait();
        assert_eq!(workers.into_iter().map(|worker| usize::from(worker.join().unwrap())).sum::<usize>(), 1);
        assert!(matches!(fs::read(target).unwrap().as_slice(), b"first" | b"second"));
        assert_eq!(usize::from(first.exists()) + usize::from(second.exists()), 1);
    }
}
