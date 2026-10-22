use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeOSSRuntimeKind {
    BundledCodeServer,
    LegacyVSCodeTunnel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeOSSRuntime {
    pub kind: CodeOSSRuntimeKind,
    pub executable: PathBuf,
    pub entrypoint: Option<PathBuf>,
    pub runtime_version: String,
    pub code_oss_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeOSSProfilePaths {
    pub root: PathBuf,
    pub user_data: PathBuf,
    pub extensions: PathBuf,
    pub logs: PathBuf,
}

impl CodeOSSProfilePaths {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            user_data: root.join("user-data"),
            extensions: root.join("extensions"),
            logs: root.join("logs"),
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        for directory in [&self.root, &self.user_data, &self.extensions, &self.logs] {
            fs::create_dir_all(directory).map_err(|error| {
                format!(
                    "Unable to create Code OSS profile directory '{}': {error}",
                    directory.display()
                )
            })?;
        }
        Ok(())
    }
}

pub fn ensure_profile_defaults(profile: &CodeOSSProfilePaths) -> Result<(), String> {
    let user_dir = profile.user_data.join("User");
    fs::create_dir_all(&user_dir).map_err(|error| {
        format!(
            "Unable to create the Code OSS user settings directory '{}': {error}",
            user_dir.display()
        )
    })?;

    let settings_path = user_dir.join("settings.json");
    if settings_path.is_file() {
        return Ok(());
    }

    let temporary_path = user_dir.join("settings.json.lattice-tmp");
    let settings = serde_json::to_vec_pretty(&serde_json::json!({
        "http.systemCertificatesNode": true
    }))
    .map_err(|error| format!("Unable to encode Code OSS profile defaults: {error}"))?;
    fs::write(&temporary_path, settings).map_err(|error| {
        format!(
            "Unable to stage Code OSS profile defaults '{}': {error}",
            temporary_path.display()
        )
    })?;
    if let Err(error) = fs::rename(&temporary_path, &settings_path) {
        if settings_path.is_file() {
            let _ = fs::remove_file(&temporary_path);
            return Ok(());
        }
        return Err(format!(
            "Unable to install Code OSS profile defaults '{}': {error}",
            settings_path.display()
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionManifest {
    schema_version: u32,
    distribution: String,
    runtime_version: String,
    code_oss_version: String,
    node_version: String,
    platform: String,
    arch: String,
    entrypoint: String,
}

fn validate_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Code OSS entrypoint must stay inside the bundled runtime.".to_string());
    }
    Ok(path)
}

pub fn resolve_runtime_layout(
    runtime_root: &Path,
    platform: &str,
    arch: &str,
) -> Result<CodeOSSRuntime, String> {
    let manifest_path = runtime_root.join("provision-manifest.json");
    let manifest: ProvisionManifest =
        serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
            format!(
                "Bundled Code OSS provision manifest is missing or unreadable '{}': {error}",
                manifest_path.display()
            )
        })?)
        .map_err(|error| format!("Bundled Code OSS provision manifest is invalid: {error}"))?;

    if manifest.schema_version != 1 || manifest.distribution != "code-server" {
        return Err("Bundled Code OSS provision manifest is unsupported.".to_string());
    }
    if manifest.platform != platform || manifest.arch != arch {
        return Err(format!(
            "Bundled Code OSS runtime targets {}-{}, but this application requires {platform}-{arch}.",
            manifest.platform, manifest.arch
        ));
    }
    let node_major = manifest
        .node_version
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok());
    if node_major != Some(22) {
        return Err("Bundled Code OSS runtime requires Node 22.".to_string());
    }

    let executable = runtime_root.join(if platform == "win32" {
        Path::new("bin").join("node.exe")
    } else {
        Path::new("bin").join("node")
    });
    let entrypoint = runtime_root.join(validate_relative_path(&manifest.entrypoint)?);
    if !executable.is_file() {
        return Err(format!(
            "Bundled Node executable is missing: {}",
            executable.display()
        ));
    }
    if !entrypoint.is_file() {
        return Err(format!(
            "Bundled Code OSS entrypoint is missing: {}",
            entrypoint.display()
        ));
    }

    Ok(CodeOSSRuntime {
        kind: CodeOSSRuntimeKind::BundledCodeServer,
        executable,
        entrypoint: Some(entrypoint),
        runtime_version: manifest.runtime_version,
        code_oss_version: manifest.code_oss_version,
    })
}

pub fn select_runtime(
    bundled: Result<CodeOSSRuntime, String>,
    legacy_executable: Option<PathBuf>,
    allow_legacy: bool,
) -> Result<CodeOSSRuntime, String> {
    match bundled {
        Ok(runtime) => Ok(runtime),
        Err(bundled_error) if allow_legacy => {
            let executable = legacy_executable.ok_or_else(|| {
                format!(
                    "{bundled_error} Legacy VS Code fallback was enabled, but no code-tunnel executable was found."
                )
            })?;
            Ok(CodeOSSRuntime {
                kind: CodeOSSRuntimeKind::LegacyVSCodeTunnel,
                executable,
                entrypoint: None,
                runtime_version: "external".to_string(),
                code_oss_version: "external".to_string(),
            })
        }
        Err(bundled_error) => Err(format!(
            "{bundled_error} Run `npm run prepare:code-oss-runtime` and rebuild Lattice. External VS Code fallback is disabled in production."
        )),
    }
}

pub fn build_code_server_args(
    port: u16,
    workspace_path: &Path,
    profile: &CodeOSSProfilePaths,
) -> Vec<String> {
    vec![
        "--bind-addr".to_string(),
        format!("127.0.0.1:{port}"),
        "--auth".to_string(),
        "none".to_string(),
        "--disable-telemetry".to_string(),
        "--user-data-dir".to_string(),
        profile.user_data.to_string_lossy().to_string(),
        "--extensions-dir".to_string(),
        profile.extensions.to_string_lossy().to_string(),
        workspace_path.to_string_lossy().to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::{ensure_profile_defaults, CodeOSSProfilePaths};
    use serde_json::Value;
    use std::{fs, path::Path};
    use uuid::Uuid;

    fn temporary_profile() -> CodeOSSProfilePaths {
        CodeOSSProfilePaths::new(
            &std::env::temp_dir().join(format!("lattice-code-oss-profile-test-{}", Uuid::new_v4())),
        )
    }

    #[test]
    fn profile_defaults_use_node_system_certificates_on_first_launch() {
        let profile = temporary_profile();
        profile.ensure().expect("profile directories");

        ensure_profile_defaults(&profile).expect("profile defaults");

        let settings_path = profile.user_data.join("User").join("settings.json");
        let settings: Value =
            serde_json::from_slice(&fs::read(&settings_path).expect("settings file"))
                .expect("valid settings JSON");
        assert_eq!(settings["http.systemCertificatesNode"], true);

        fs::remove_dir_all(&profile.root).expect("remove profile");
    }

    #[test]
    fn profile_defaults_never_overwrite_existing_user_settings() {
        let profile = temporary_profile();
        profile.ensure().expect("profile directories");
        let user_dir = profile.user_data.join("User");
        fs::create_dir_all(&user_dir).expect("user directory");
        let settings_path = user_dir.join("settings.json");
        let original = br#"{
          // Keep JSONC comments and explicit user choices intact.
          "http.systemCertificatesNode": false,
          "editor.fontSize": 15,
        }"#;
        fs::write(&settings_path, original).expect("existing settings");

        ensure_profile_defaults(&profile).expect("profile defaults");

        assert_eq!(
            fs::read(Path::new(&settings_path)).expect("settings file"),
            original
        );

        fs::remove_dir_all(&profile.root).expect("remove profile");
    }
}
