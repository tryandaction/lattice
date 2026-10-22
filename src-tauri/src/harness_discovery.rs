//! Bounded discovery: known native installation layouts, never shell wrappers.
use std::{collections::HashSet, path::{Path, PathBuf}};

pub(super) struct Roots {
    pub home: Option<PathBuf>,
    pub local: Option<PathBuf>,
    pub roaming: Option<PathBuf>,
    pub programs: Option<PathBuf>,
    pub path: Vec<PathBuf>,
}

impl Roots {
    pub fn current() -> Self {
        Self {
            home: std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from),
            local: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
            roaming: std::env::var_os("APPDATA").map(PathBuf::from),
            programs: std::env::var_os("PROGRAMFILES").map(PathBuf::from),
            path: std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect(),
        }
    }
}

fn children(root: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut entries: Vec<_> = std::fs::read_dir(root).into_iter().flatten().filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
        .map(|e| e.path()).collect();
    entries.sort();
    entries.truncate(256);
    entries
}

fn newest_native(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.sort_by(|a, b| {
        let modified = |p: &PathBuf| std::fs::metadata(p).and_then(|m| m.modified()).ok();
        modified(b).cmp(&modified(a)).then_with(|| a.cmp(b))
    });
    paths
}

pub(super) fn candidates(name: &str, roots: &Roots) -> Vec<PathBuf> {
    let binary = if cfg!(windows) { format!("{name}.exe") } else { name.into() };
    let mut paths = Vec::new();
    if let Some(home) = &roots.home {
        for directory in [".local/bin", ".codex/bin", ".claude/bin"] { paths.push(home.join(directory).join(&binary)); }
    }
    if let Some(local) = &roots.local {
        let directories = if name == "codex" { vec!["OpenAI/Codex/bin".into(), "Programs/Codex/resources".into(), "Programs/Codex/resources/bin".into()] } else { vec![format!("Programs/{name}"), name.into()] };
        for directory in directories {
            paths.push(local.join(directory).join(&binary));
        }
        if name == "codex" {
            paths.extend(newest_native(children(&local.join("OpenAI/Codex/bin"), "").into_iter().map(|version| version.join(&binary)).collect()));
            for package in children(&local.join("Packages"), "OpenAI.Codex_") {
                paths.push(package.join("LocalCache/Local/OpenAI/Codex/bin").join(&binary));
            }
        }
    }
    if let Some(programs) = &roots.programs { if name == "claude" { paths.push(programs.join(name).join(&binary)); } }
    if let Some(home) = &roots.home {
        for editor in [".vscode/extensions", ".vscode-insiders/extensions", ".cursor/extensions"] {
            let prefix = if name == "codex" { "openai.chatgpt-" } else { "anthropic.claude-code-" };
            let mut extensions = children(&home.join(editor), prefix);
            extensions.reverse();
            for extension in extensions {
                if name == "codex" {
                    for arch in ["windows-x86_64", "windows-aarch64"] { paths.push(extension.join("bin").join(arch).join(&binary)); }
                } else { paths.push(extension.join("resources/native-binary").join(&binary)); }
            }
        }
    }
    if let Some(roaming) = &roots.roaming {
        let modules = roaming.join("npm/node_modules");
        if name == "codex" {
            for package in [modules.join("@openai/codex"), modules.join("@openai/codex/node_modules/@openai/codex-win32-x64"), modules.join("@openai/codex-win32-x64"), modules.join("@openai/codex/node_modules/@openai/codex-win32-arm64")] {
                for arch in ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"] {
                    paths.push(package.join("vendor").join(arch).join("bin").join(&binary));
                    paths.push(package.join("vendor").join(arch).join("codex").join(&binary));
                }
            }
        } else {
            for package in ["@anthropic-ai/claude-code", "@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-win32-x64", "@anthropic-ai/claude-code-win32-x64"] {
                paths.push(modules.join(package).join(&binary));
            }
        }
    }
    // Preserve explicit layout priority; within each variable directory entries are sorted.
    paths.extend(roots.path.iter().map(|dir| dir.join(&binary)));
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(if cfg!(windows) { path.to_string_lossy().to_lowercase() } else { path.to_string_lossy().into_owned() }));
    paths
}

pub(super) fn resolve(name: &str, selected: Option<&str>, roots: &Roots) -> Result<PathBuf, String> {
    if let Some(selected) = selected.filter(|v| !v.trim().is_empty()) {
        let path = PathBuf::from(selected);
        if !path.is_absolute() { return Err("请选择本机可执行文件的绝对路径。".into()); }
        if cfg!(windows) && !path.extension().is_some_and(|v| v.eq_ignore_ascii_case("exe")) { return Err("仅接受 native .exe；不执行 .cmd/.bat 或任意 shell 模板。".into()); }
        return std::fs::canonicalize(path).map_err(|_| "保存的 Agent 程序已移动或卸载；请点击重新检测，或重新选择已安装的可执行文件。".into())
            .and_then(|path| if path.is_file() { Ok(path) } else { Err("请选择 Agent 可执行文件，不能选择目录。".into()) });
    }
    candidates(name, roots).into_iter().find(|path| path.is_file())
        .ok_or_else(|| format!("未发现已安装的 {name}。请先安装官方应用或 CLI，再点击重新检测；无需设置 PATH。"))
        .and_then(|path| std::fs::canonicalize(path).map_err(|_| "无法读取已安装的 Agent 路径。".into()))
}

pub(super) fn installed(name: &str, roots: &Roots) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    candidates(name, roots).into_iter().filter(|p| p.is_file())
        .filter_map(|p| std::fs::canonicalize(p).ok())
        .filter(|p| seen.insert(p.to_string_lossy().to_lowercase())).take(3).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn roots(home: &Path) -> Roots { Roots { home: Some(home.into()), local: None, roaming: None, programs: None, path: Vec::new() } }
    fn binary(name: &str) -> String { if cfg!(windows) { format!("{name}.exe") } else { name.into() } }
    #[test]
    fn native_home_install_does_not_need_path() {
        let root = tempfile::tempdir().unwrap(); let bin = root.path().join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap(); let path = bin.join(binary("claude")); std::fs::write(&path, []).unwrap();
        assert_eq!(resolve("claude", None, &roots(root.path())).unwrap(), std::fs::canonicalize(path).unwrap());
    }
    #[test]
    fn explicit_missing_does_not_silently_switch_installs() {
        let root = tempfile::tempdir().unwrap(); let missing = root.path().join(binary("claude"));
        assert!(resolve("claude", Some(&missing.to_string_lossy()), &roots(root.path())).unwrap_err().contains("重新检测"));
        assert!(resolve("claude", Some("relative.exe"), &roots(root.path())).is_err());
    }
    #[test]
    fn extension_order_and_duplicates_are_deterministic() {
        let root = tempfile::tempdir().unwrap();
        for name in ["openai.chatgpt-z", "openai.chatgpt-a"] { std::fs::create_dir_all(root.path().join(".vscode/extensions").join(name)).unwrap(); }
        let mut input = roots(root.path()); input.path = vec![root.path().join(".local/bin"), root.path().join(".local/bin")];
        let paths = candidates("codex", &input);
        assert_eq!(paths, candidates("codex", &input));
        assert_eq!(paths.iter().filter(|p| **p == root.path().join(".local/bin").join(binary("codex"))).count(), 1);
        assert!(paths.iter().position(|p| p.to_string_lossy().contains("chatgpt-z")).unwrap() < paths.iter().position(|p| p.to_string_lossy().contains("chatgpt-a")).unwrap());
    }
    #[test]
    fn npm_native_vendor_is_discovered() {
        let root = tempfile::tempdir().unwrap(); let package = root.path().join("npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin");
        std::fs::create_dir_all(&package).unwrap(); let path = package.join(binary("codex")); std::fs::write(&path, []).unwrap();
        let mut input = roots(root.path()); input.roaming = Some(root.path().into());
        assert_eq!(resolve("codex", None, &input).unwrap(), std::fs::canonicalize(path).unwrap());
    }
    #[test]
    fn explicit_binary_wins_and_shell_shims_are_not_discovered() {
        let root = tempfile::tempdir().unwrap(); let bin = root.path().join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap(); std::fs::write(bin.join("claude.cmd"), []).unwrap();
        let input = roots(root.path()); assert!(resolve("claude", None, &input).is_err());
        let native = root.path().join(binary("chosen")); std::fs::write(&native, []).unwrap();
        assert_eq!(resolve("claude", Some(&native.to_string_lossy()), &input).unwrap(), std::fs::canonicalize(&native).unwrap());
        if cfg!(windows) { assert!(resolve("claude", Some(&bin.join("claude.cmd").to_string_lossy()), &input).unwrap_err().contains("native .exe")); }
    }
    #[test]
    fn detected_candidates_are_bounded_and_keep_alternative_installs() {
        let root = tempfile::tempdir().unwrap(); let mut input = roots(root.path());
        for i in 0..5 {
            let dir = root.path().join(format!("path-{i}")); std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(binary("codex")), []).unwrap(); input.path.push(dir);
        }
        let alternatives = installed("codex", &input);
        assert_eq!(alternatives.len(), 3);
        assert!(alternatives[0].to_string_lossy().contains("path-0"));
        assert!(alternatives[1].to_string_lossy().contains("path-1"));
    }
    #[test]
    fn desktop_hash_names_do_not_override_newer_install_timestamp() {
        let root = tempfile::tempdir().unwrap(); let mut input = roots(root.path()); input.local = Some(root.path().into());
        let mut expected = None;
        for (hash, seconds) in [("aaaa-old", 100), ("zzzz-new", 200)] {
            let directory = root.path().join("OpenAI/Codex/bin").join(hash); std::fs::create_dir_all(&directory).unwrap();
            let executable = directory.join(binary("codex")); std::fs::write(&executable, []).unwrap();
            std::fs::File::options().write(true).open(&executable).unwrap().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds)).unwrap();
            if seconds == 200 { expected = Some(std::fs::canonicalize(executable).unwrap()); }
        }
        assert_eq!(installed("codex", &input)[0], expected.unwrap());
    }
}
