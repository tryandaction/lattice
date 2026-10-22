use serde::Serialize;
use std::{
    collections::HashSet,
    io,
    path::{Component, Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use crate::configure_tokio_command;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlChange {
    pub path: String,
    pub original_path: Option<String>,
    pub index: String,
    pub worktree: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflict: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlSnapshot {
    pub available: bool,
    pub repository_root: Option<String>,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<SourceControlChange>,
    pub error: Option<String>,
}

const CONFLICT_STATUSES: [&str; 7] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];
const MAX_GIT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const GIT_MUTATION_TIMEOUT: Duration = Duration::from_secs(10);
const GIT_DIFF_COMMIT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlDiff {
    pub path: String,
    pub staged: bool,
    pub content: String,
    pub binary: bool,
    pub truncated: bool,
    pub error: Option<String>,
}

struct GitCommandOutput {
    success: bool,
    status_code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

#[derive(Debug, Clone)]
enum GitOperation {
    Diff { path: String, staged: bool },
    StagePaths { paths: Vec<String> },
    UnstagePaths { paths: Vec<String> },
    StageAll,
    UnstageAll,
    Commit,
}

fn normalize_relative_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for value in paths {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err("A repository-relative path is required.".to_string());
        }
        let path = Path::new(trimmed);
        if path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::Prefix(_) | Component::RootDir | Component::ParentDir
                )
            })
        {
            return Err(format!(
                "Source Control path must stay inside the repository: {trimmed}"
            ));
        }

        let slash_path = trimmed.replace('\\', "/");
        if seen.insert(slash_path.clone()) {
            normalized.push(format!(":(literal){slash_path}"));
        }
    }

    if normalized.is_empty() {
        return Err("At least one repository-relative path is required.".to_string());
    }
    Ok(normalized)
}

fn build_git_arguments(operation: &GitOperation) -> Result<Vec<String>, String> {
    let args = match operation {
        GitOperation::Diff { path, staged } => {
            let literal = normalize_relative_paths(std::slice::from_ref(path))?
                .into_iter()
                .next()
                .expect("one validated path");
            let mut args = vec!["diff".to_string()];
            if *staged {
                args.push("--cached".to_string());
            }
            args.extend([
                "--no-ext-diff".to_string(),
                "--no-textconv".to_string(),
                "--unified=3".to_string(),
                "--".to_string(),
                literal,
            ]);
            args
        }
        GitOperation::StagePaths { paths } => {
            let mut args = vec!["add".to_string(), "--".to_string()];
            args.extend(normalize_relative_paths(paths)?);
            args
        }
        GitOperation::UnstagePaths { paths } => {
            let mut args = vec![
                "restore".to_string(),
                "--staged".to_string(),
                "--".to_string(),
            ];
            args.extend(normalize_relative_paths(paths)?);
            args
        }
        GitOperation::StageAll => vec![
            "add".to_string(),
            "-A".to_string(),
            "--".to_string(),
            ".".to_string(),
        ],
        GitOperation::UnstageAll => vec![
            "restore".to_string(),
            "--staged".to_string(),
            "--".to_string(),
            ".".to_string(),
        ],
        GitOperation::Commit => vec!["commit".to_string(), "--file=-".to_string()],
    };
    Ok(args)
}

fn bounded_utf8(bytes: &[u8], max_bytes: usize) -> (String, bool) {
    if bytes.len() <= max_bytes {
        return (String::from_utf8_lossy(bytes).into_owned(), false);
    }

    let text = String::from_utf8_lossy(bytes);
    let mut result = String::new();
    let mut bytes_used = 0usize;
    for character in text.chars() {
        let character_bytes = character.len_utf8();
        if bytes_used + character_bytes > max_bytes {
            break;
        }
        result.push(character);
        bytes_used += character_bytes;
    }
    (result, true)
}

async fn read_bounded<R>(mut reader: R) -> io::Result<(Vec<u8>, bool)>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut truncated = false;
    let mut buffer = [0u8; 8192];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let remaining = MAX_GIT_OUTPUT_BYTES.saturating_sub(output.len());
        let retained = read.min(remaining);
        output.extend_from_slice(&buffer[..retained]);
        truncated |= retained < read;
    }
    Ok((output, truncated))
}

async fn execute_git(
    repository: &Path,
    args: &[String],
    stdin: Option<&[u8]>,
    timeout: Duration,
) -> Result<GitCommandOutput, String> {
    let mut command = Command::new("git");
    configure_tokio_command(&mut command);
    command
        .arg("-C")
        .arg(repository)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            "Git is not installed or is not available on PATH.".to_string()
        } else {
            error.to_string()
        }
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Git stdout was not captured.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Git stderr was not captured.".to_string())?;
    let stdout_task = tokio::spawn(read_bounded(stdout));
    let stderr_task = tokio::spawn(read_bounded(stderr));

    if let Some(input) = stdin {
        let mut child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Git stdin was not available.".to_string())?;
        child_stdin
            .write_all(input)
            .await
            .map_err(|error| error.to_string())?;
        child_stdin
            .shutdown()
            .await
            .map_err(|error| error.to_string())?;
    }

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(result) => result.map_err(|error| error.to_string())?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(format!(
                "Git command timed out after {} seconds.",
                timeout.as_secs()
            ));
        }
    };
    let (stdout, stdout_truncated) = stdout_task
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let (stderr, stderr_truncated) = stderr_task
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;

    Ok(GitCommandOutput {
        success: status.success(),
        status_code: status.code(),
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}

fn git_failure(output: &GitCommandOutput) -> String {
    let (stderr, _) = bounded_utf8(&output.stderr, MAX_GIT_OUTPUT_BYTES);
    let message = stderr.trim();
    if message.is_empty() {
        match output.status_code {
            Some(code) => format!("Git exited with status {code}."),
            None => "Git was terminated before returning an exit status.".to_string(),
        }
    } else if output.stderr_truncated {
        format!("{message}\n[Git error output truncated]")
    } else {
        message.to_string()
    }
}

fn parse_tracking_count(branch_info: &str, marker: &str) -> u32 {
    branch_info
        .split(marker)
        .nth(1)
        .and_then(|value| value.split([',', ']', ' ']).next())
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
}

fn parse_branch(branch_info: &str) -> Option<String> {
    let value = branch_info.trim();
    if value == "HEAD (no branch)" || value == "HEAD" {
        return None;
    }
    for prefix in ["No commits yet on ", "Initial commit on "] {
        if let Some(branch) = value.strip_prefix(prefix) {
            return (!branch.is_empty()).then(|| branch.to_string());
        }
    }
    value
        .split("...")
        .next()
        .filter(|branch| !branch.is_empty())
        .map(str::to_string)
}

fn parse_porcelain_v1_z(
    output: &[u8],
    repository_root: &str,
) -> Result<SourceControlSnapshot, String> {
    let fields = output
        .split(|byte| *byte == 0)
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    let mut position = 0usize;
    let mut branch = None;
    let mut ahead = 0;
    let mut behind = 0;

    if let Some(header) = fields.first().filter(|field| field.starts_with(b"## ")) {
        let branch_info = String::from_utf8_lossy(&header[3..]).into_owned();
        branch = parse_branch(&branch_info);
        ahead = parse_tracking_count(&branch_info, "ahead ");
        behind = parse_tracking_count(&branch_info, "behind ");
        position = 1;
    }

    let mut changes = Vec::new();
    while position < fields.len() {
        let field = fields[position];
        position += 1;
        if field.len() < 3 {
            return Err("Git returned an invalid porcelain status entry.".to_string());
        }

        let index = field[0] as char;
        let worktree = field[1] as char;
        let status = format!("{index}{worktree}");
        let path_offset = if field.get(2) == Some(&b' ') { 3 } else { 2 };
        if field.len() < path_offset {
            return Err("Git returned a status entry without a path.".to_string());
        }
        let path = String::from_utf8_lossy(&field[path_offset..]).into_owned();
        if path.is_empty() {
            return Err("Git returned a status entry without a path.".to_string());
        }

        let renamed_or_copied = matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C');
        let original_path = if renamed_or_copied {
            let original = fields
                .get(position)
                .ok_or_else(|| "Git returned an incomplete rename status entry.".to_string())?;
            position += 1;
            Some(String::from_utf8_lossy(original).into_owned())
        } else {
            None
        };
        let untracked = status == "??";
        let conflict = CONFLICT_STATUSES.contains(&status.as_str());

        changes.push(SourceControlChange {
            path,
            original_path,
            index: index.to_string(),
            worktree: worktree.to_string(),
            status,
            staged: !untracked && index != ' ',
            unstaged: untracked || worktree != ' ',
            conflict,
            untracked,
        });
    }

    Ok(SourceControlSnapshot {
        available: true,
        repository_root: Some(repository_root.replace('\\', "/")),
        branch,
        ahead,
        behind,
        changes,
        error: None,
    })
}

fn unavailable_snapshot(message: impl Into<String>) -> SourceControlSnapshot {
    SourceControlSnapshot {
        error: Some(message.into()),
        ..SourceControlSnapshot::default()
    }
}

async fn git_output(workspace: &Path, args: &[&str]) -> Result<GitCommandOutput, String> {
    let arguments = args
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    execute_git(workspace, &arguments, None, GIT_MUTATION_TIMEOUT).await
}

async fn resolve_repository_root(path: &str) -> Result<PathBuf, String> {
    let workspace = PathBuf::from(path.trim());
    if !workspace.is_dir() {
        return Err("Open a workspace folder before using Source Control.".to_string());
    }
    let output = git_output(&workspace, &["rev-parse", "--show-toplevel"]).await?;
    if !output.success {
        let message = git_failure(&output);
        if message
            .to_ascii_lowercase()
            .contains("not a git repository")
        {
            return Err("This workspace is not a Git repository.".to_string());
        }
        return Err(message);
    }
    let (root, _) = bounded_utf8(&output.stdout, MAX_GIT_OUTPUT_BYTES);
    let root = root.trim();
    if root.is_empty() {
        return Err("Git did not return a repository root.".to_string());
    }
    Ok(PathBuf::from(root))
}

async fn source_control_status_for_repository(
    repository: &Path,
) -> Result<SourceControlSnapshot, String> {
    let output = git_output(
        repository,
        &["status", "--porcelain=v1", "-z", "-b", "--ahead-behind"],
    )
    .await?;
    if !output.success {
        return Err(git_failure(&output));
    }
    parse_porcelain_v1_z(&output.stdout, &repository.to_string_lossy())
}

#[tauri::command]
pub async fn desktop_get_source_control_status(
    path: String,
) -> Result<SourceControlSnapshot, String> {
    let repository = match resolve_repository_root(&path).await {
        Ok(repository) => repository,
        Err(error) => return Ok(unavailable_snapshot(error)),
    };
    match source_control_status_for_repository(&repository).await {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => Ok(unavailable_snapshot(error)),
    }
}

async fn refresh_after_mutation(repository: &Path) -> Result<SourceControlSnapshot, String> {
    source_control_status_for_repository(repository)
        .await
        .map_err(|error| format!("Git operation succeeded, but status refresh failed: {error}"))
}

async fn execute_mutation(
    workspace: &str,
    operation: GitOperation,
    stdin: Option<&[u8]>,
    timeout: Duration,
) -> Result<SourceControlSnapshot, String> {
    let repository = resolve_repository_root(workspace).await?;
    let args = build_git_arguments(&operation)?;
    let output = execute_git(&repository, &args, stdin, timeout).await?;
    if !output.success {
        return Err(git_failure(&output));
    }
    refresh_after_mutation(&repository).await
}

async fn read_untracked_preview(
    repository: &Path,
    path: &str,
) -> Result<SourceControlDiff, String> {
    let normalized = normalize_relative_paths(&[path.to_string()])?;
    let relative = normalized[0]
        .strip_prefix(":(literal)")
        .expect("validated literal pathspec");
    let repository_root = tokio::fs::canonicalize(repository)
        .await
        .map_err(|error| error.to_string())?;
    let file_path = tokio::fs::canonicalize(repository.join(relative))
        .await
        .map_err(|error| error.to_string())?;
    if !file_path.starts_with(&repository_root) {
        return Err("Source Control path resolves outside the repository.".to_string());
    }
    let file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|error| error.to_string())?;
    let (bytes, truncated) = read_bounded(file)
        .await
        .map_err(|error| error.to_string())?;
    let binary = bytes.contains(&0);
    let (content, utf8_truncated) = if binary {
        (String::new(), false)
    } else {
        bounded_utf8(&bytes, MAX_GIT_OUTPUT_BYTES)
    };

    Ok(SourceControlDiff {
        path: path.to_string(),
        staged: false,
        content,
        binary,
        truncated: truncated || utf8_truncated,
        error: None,
    })
}

#[tauri::command]
pub async fn desktop_get_source_control_diff(
    path: String,
    file_path: String,
    staged: bool,
) -> Result<SourceControlDiff, String> {
    let repository = resolve_repository_root(&path).await?;
    if !staged {
        let snapshot = source_control_status_for_repository(&repository).await?;
        if snapshot
            .changes
            .iter()
            .any(|change| change.path == file_path && change.untracked)
        {
            return read_untracked_preview(&repository, &file_path).await;
        }
    }

    let args = build_git_arguments(&GitOperation::Diff {
        path: file_path.clone(),
        staged,
    })?;
    let output = execute_git(&repository, &args, None, GIT_DIFF_COMMIT_TIMEOUT).await?;
    if !output.success {
        return Ok(SourceControlDiff {
            path: file_path,
            staged,
            error: Some(git_failure(&output)),
            ..SourceControlDiff::default()
        });
    }
    let (content, utf8_truncated) = bounded_utf8(&output.stdout, MAX_GIT_OUTPUT_BYTES);
    let binary = content.contains("Binary files ") || content.contains("GIT binary patch");
    Ok(SourceControlDiff {
        path: file_path,
        staged,
        content,
        binary,
        truncated: output.stdout_truncated || utf8_truncated,
        error: None,
    })
}

#[tauri::command]
pub async fn desktop_stage_source_control_paths(
    path: String,
    paths: Vec<String>,
) -> Result<SourceControlSnapshot, String> {
    execute_mutation(
        &path,
        GitOperation::StagePaths { paths },
        None,
        GIT_MUTATION_TIMEOUT,
    )
    .await
}

#[tauri::command]
pub async fn desktop_unstage_source_control_paths(
    path: String,
    paths: Vec<String>,
) -> Result<SourceControlSnapshot, String> {
    execute_mutation(
        &path,
        GitOperation::UnstagePaths { paths },
        None,
        GIT_MUTATION_TIMEOUT,
    )
    .await
}

#[tauri::command]
pub async fn desktop_stage_all_source_control_changes(
    path: String,
) -> Result<SourceControlSnapshot, String> {
    execute_mutation(&path, GitOperation::StageAll, None, GIT_MUTATION_TIMEOUT).await
}

#[tauri::command]
pub async fn desktop_unstage_all_source_control_changes(
    path: String,
) -> Result<SourceControlSnapshot, String> {
    execute_mutation(&path, GitOperation::UnstageAll, None, GIT_MUTATION_TIMEOUT).await
}

#[tauri::command]
pub async fn desktop_commit_source_control_changes(
    path: String,
    message: String,
) -> Result<SourceControlSnapshot, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("A commit message is required.".to_string());
    }
    let repository = resolve_repository_root(&path).await?;
    let snapshot = source_control_status_for_repository(&repository).await?;
    if snapshot.changes.iter().any(|change| change.conflict) {
        return Err("Resolve all merge conflicts before committing.".to_string());
    }
    if !snapshot.changes.iter().any(|change| change.staged) {
        return Err("Stage at least one change before committing.".to_string());
    }

    let args = build_git_arguments(&GitOperation::Commit)?;
    let mut stdin = message.as_bytes().to_vec();
    stdin.push(b'\n');
    let output = execute_git(&repository, &args, Some(&stdin), GIT_DIFF_COMMIT_TIMEOUT).await?;
    if !output.success {
        return Err(git_failure(&output));
    }
    refresh_after_mutation(&repository).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn run_fixture_git(
        repository: &Path,
        args: &[&str],
        stdin: Option<&[u8]>,
    ) -> GitCommandOutput {
        let arguments = args
            .iter()
            .map(|value| (*value).to_string())
            .collect::<Vec<_>>();
        let output = execute_git(repository, &arguments, stdin, GIT_DIFF_COMMIT_TIMEOUT)
            .await
            .expect("fixture Git command should start");
        assert!(
            output.success,
            "fixture Git command failed: {}",
            git_failure(&output)
        );
        output
    }

    #[test]
    fn parses_nul_porcelain_status_without_corrupting_paths() {
        let snapshot = parse_porcelain_v1_z(
            b"## main...origin/main [ahead 2, behind 1]\0M  src/lib.rs\0 M notes with spaces.md\0?? \xE6\x96\xB0\xE5\xBB\xBA.txt\0R  new name.rs\0old name.rs\0UU conflict.txt\0",
            "C:/repo",
        )
        .expect("status should parse");

        assert_eq!(snapshot.repository_root.as_deref(), Some("C:/repo"));
        assert_eq!(snapshot.branch.as_deref(), Some("main"));
        assert_eq!(snapshot.ahead, 2);
        assert_eq!(snapshot.behind, 1);
        assert_eq!(snapshot.changes.len(), 5);

        assert!(snapshot.changes[0].staged);
        assert!(!snapshot.changes[0].unstaged);
        assert_eq!(snapshot.changes[1].path, "notes with spaces.md");
        assert!(snapshot.changes[1].unstaged);
        assert_eq!(snapshot.changes[2].path, "\u{65b0}\u{5efa}.txt");
        assert!(snapshot.changes[2].untracked);
        assert_eq!(snapshot.changes[3].path, "new name.rs");
        assert_eq!(
            snapshot.changes[3].original_path.as_deref(),
            Some("old name.rs")
        );
        assert!(snapshot.changes[4].conflict);
    }

    #[test]
    fn represents_detached_head_without_inventing_a_branch() {
        let snapshot = parse_porcelain_v1_z(b"## HEAD (no branch)\0", "C:/repo")
            .expect("detached status should parse");

        assert_eq!(snapshot.branch, None);
        assert_eq!(snapshot.ahead, 0);
        assert_eq!(snapshot.behind, 0);
        assert!(snapshot.changes.is_empty());
    }

    #[test]
    fn rejects_unsafe_paths_and_preserves_literal_special_characters() {
        assert!(normalize_relative_paths(&["".to_string()]).is_err());
        assert!(normalize_relative_paths(&["../secret.txt".to_string()]).is_err());
        assert!(normalize_relative_paths(&["C:/outside.txt".to_string()]).is_err());

        let paths = normalize_relative_paths(&[
            "src/[draft]*.ts".to_string(),
            "src/[draft]*.ts".to_string(),
            "notes/read me.md".to_string(),
        ])
        .expect("safe relative paths should normalize");

        assert_eq!(
            paths,
            vec![
                ":(literal)src/[draft]*.ts".to_string(),
                ":(literal)notes/read me.md".to_string(),
            ]
        );
    }

    #[test]
    fn builds_only_the_approved_git_argument_vectors() {
        assert_eq!(
            build_git_arguments(&GitOperation::Diff {
                path: "src/app.ts".to_string(),
                staged: false,
            })
            .unwrap(),
            vec![
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--unified=3",
                "--",
                ":(literal)src/app.ts"
            ]
        );
        assert_eq!(
            build_git_arguments(&GitOperation::Diff {
                path: "src/app.ts".to_string(),
                staged: true,
            })
            .unwrap(),
            vec![
                "diff",
                "--cached",
                "--no-ext-diff",
                "--no-textconv",
                "--unified=3",
                "--",
                ":(literal)src/app.ts"
            ]
        );
        assert_eq!(
            build_git_arguments(&GitOperation::StagePaths {
                paths: vec!["a.ts".to_string(), "b.ts".to_string()],
            })
            .unwrap(),
            vec!["add", "--", ":(literal)a.ts", ":(literal)b.ts"]
        );
        assert_eq!(
            build_git_arguments(&GitOperation::UnstagePaths {
                paths: vec!["a.ts".to_string()],
            })
            .unwrap(),
            vec!["restore", "--staged", "--", ":(literal)a.ts"]
        );
        assert_eq!(
            build_git_arguments(&GitOperation::StageAll).unwrap(),
            vec!["add", "-A", "--", "."]
        );
        assert_eq!(
            build_git_arguments(&GitOperation::UnstageAll).unwrap(),
            vec!["restore", "--staged", "--", "."]
        );
        assert_eq!(
            build_git_arguments(&GitOperation::Commit).unwrap(),
            vec!["commit", "--file=-"]
        );
    }

    #[test]
    fn truncates_output_on_a_utf8_boundary() {
        let (content, truncated) = bounded_utf8(b"alpha\xE6\x96\xB0beta", 7);
        assert_eq!(content, "alpha");
        assert!(truncated);

        let (content, truncated) = bounded_utf8(b"short", 10);
        assert_eq!(content, "short");
        assert!(!truncated);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn real_git_smoke_covers_status_diff_stage_unstage_and_commit() {
        let temporary = tempfile::Builder::new()
            .prefix("lattice-scm-smoke-")
            .tempdir()
            .expect("temporary repository should be created");
        let repository = temporary.path().to_path_buf();
        let temporary_path = repository.clone();

        run_fixture_git(&repository, &["init"], None).await;
        run_fixture_git(
            &repository,
            &["config", "user.name", "Lattice SCM Smoke"],
            None,
        )
        .await;
        run_fixture_git(
            &repository,
            &["config", "user.email", "lattice-smoke@example.invalid"],
            None,
        )
        .await;
        std::fs::write(repository.join("tracked.txt"), "baseline\n")
            .expect("tracked fixture should be written");
        run_fixture_git(&repository, &["add", "--", "tracked.txt"], None).await;
        run_fixture_git(
            &repository,
            &["commit", "--file=-"],
            Some(b"Initial fixture\n"),
        )
        .await;

        let nested = repository.join("nested");
        std::fs::create_dir(&nested).expect("nested workspace should be created");
        std::fs::write(repository.join("tracked.txt"), "baseline\nworking change\n")
            .expect("tracked fixture should be modified");
        std::fs::write(repository.join("new file.txt"), "untracked content\n")
            .expect("untracked fixture should be written");

        let nested_path = nested.to_string_lossy().into_owned();
        let status = desktop_get_source_control_status(nested_path.clone())
            .await
            .expect("status should resolve from a repository child");
        assert!(status.available);
        let reported_root = std::fs::canonicalize(PathBuf::from(
            status.repository_root.expect("repository root"),
        ))
        .expect("reported repository root should canonicalize");
        let expected_root = std::fs::canonicalize(&repository)
            .expect("fixture repository root should canonicalize");
        assert_eq!(reported_root, expected_root);
        assert!(status
            .changes
            .iter()
            .any(|change| change.path == "tracked.txt" && change.unstaged));
        assert!(status
            .changes
            .iter()
            .any(|change| change.path == "new file.txt" && change.untracked));

        let working_diff =
            desktop_get_source_control_diff(nested_path.clone(), "tracked.txt".to_string(), false)
                .await
                .expect("working diff should load");
        assert!(working_diff.content.contains("+working change"));

        let staged = desktop_stage_source_control_paths(
            nested_path.clone(),
            vec!["tracked.txt".to_string(), "new file.txt".to_string()],
        )
        .await
        .expect("paths should stage");
        assert!(staged
            .changes
            .iter()
            .any(|change| change.path == "tracked.txt" && change.staged));
        assert!(staged
            .changes
            .iter()
            .any(|change| change.path == "new file.txt" && change.staged));

        let staged_diff =
            desktop_get_source_control_diff(nested_path.clone(), "tracked.txt".to_string(), true)
                .await
                .expect("staged diff should load");
        assert!(staged_diff.content.contains("+working change"));

        let unstaged = desktop_unstage_source_control_paths(
            nested_path.clone(),
            vec!["new file.txt".to_string()],
        )
        .await
        .expect("path should unstage without deleting its content");
        assert!(unstaged
            .changes
            .iter()
            .any(|change| change.path == "new file.txt" && change.untracked));
        assert_eq!(
            std::fs::read_to_string(repository.join("new file.txt")).unwrap(),
            "untracked content\n"
        );

        let staged_all = desktop_stage_all_source_control_changes(nested_path.clone())
            .await
            .expect("all changes should stage");
        assert!(staged_all.changes.iter().all(|change| change.staged));

        let committed = desktop_commit_source_control_changes(
            nested_path.clone(),
            "SCM smoke commit".to_string(),
        )
        .await
        .expect("confirmed local commit should complete");
        assert!(committed.changes.is_empty());
        let log = run_fixture_git(&repository, &["log", "-1", "--pretty=%s"], None).await;
        assert_eq!(
            String::from_utf8_lossy(&log.stdout).trim(),
            "SCM smoke commit"
        );

        std::fs::write(repository.join("tracked.txt"), "post-commit change\n")
            .expect("post-commit fixture should be modified");
        let staged_again = desktop_stage_all_source_control_changes(nested_path.clone())
            .await
            .expect("post-commit change should stage");
        assert!(staged_again.changes.iter().any(|change| change.staged));
        let unstaged_all = desktop_unstage_all_source_control_changes(nested_path)
            .await
            .expect("all changes should unstage");
        assert!(unstaged_all
            .changes
            .iter()
            .any(|change| change.unstaged && !change.staged));

        drop(temporary);
        assert!(
            !temporary_path.exists(),
            "temporary repository should be deleted"
        );
    }
}
