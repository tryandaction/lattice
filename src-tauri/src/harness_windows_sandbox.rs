//! No-inference MXC preflight. Never grant native tools from version strings alone.
use serde_json::Value;
use std::path::{Path,PathBuf};
use std::net::{TcpListener,TcpStream};

pub(super) const COMMAND_ENVIRONMENT: &[&str] = &["PATH","PATHEXT","SystemRoot","WINDIR","SystemDrive","ComSpec","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","PROGRAMFILES","PROGRAMFILES(X86)","PROGRAMW6432","HOME","LANG","LC_ALL"];

/// Confirm the applied policy, not just the arguments we asked the CLI to use.
pub(super) fn command_environment_isolated(response: &Value) -> bool {
    let config=&response["config"];
    let policy=&config["shell_environment_policy"];
    config["allow_login_shell"].as_bool()==Some(false)
        && policy["experimental_use_profile"].as_bool()==Some(false)
        && policy["ignore_default_excludes"].as_bool()==Some(false)
        && policy["filters"].is_null()
        && policy["include_only"]==serde_json::json!(COMMAND_ENVIRONMENT)
}

pub(super) struct ScopeProbe {
    _root: tempfile::TempDir,
    pub(super) workspace: PathBuf,
    pub(super) scratch: PathBuf,
    outside: PathBuf,
    marker: String,
    network: TcpListener,
    pub(super) profile: String,
}
impl ScopeProbe {
    pub(super) fn new(parent: &Path) -> Result<Self,String> {
        let root=tempfile::Builder::new().prefix("mxc-preflight-").tempdir_in(parent).map_err(|_| "Cannot create isolated MXC preflight".to_string())?;
        let workspace=root.path().join("workspace");let scratch=root.path().join("scratch");let outside=root.path().join("outside");
        for directory in [&workspace,&scratch,&outside] { std::fs::create_dir(directory).map_err(|_| "Cannot prepare MXC preflight directories".to_string())?; }
        let marker=uuid::Uuid::new_v4().simple().to_string();
        std::fs::write(workspace.join("read.txt"),&marker).map_err(|_| "Cannot write MXC preflight read marker".to_string())?;
        std::fs::write(workspace.join("readonly.txt"),&marker).map_err(|_| "Cannot write MXC preflight readonly marker".to_string())?;
        std::fs::write(outside.join("outside.txt"),&marker).map_err(|_| "Cannot write MXC preflight outside marker".to_string())?;
        let network=TcpListener::bind("127.0.0.1:0").map_err(|_| "Cannot prepare local MXC network control".to_string())?;
        let control=TcpStream::connect_timeout(&network.local_addr().map_err(|_| "Cannot inspect MXC network control")?,std::time::Duration::from_secs(1)).map_err(|_| "MXC network control is unavailable")?;
        let _=network.accept().map_err(|_| "Cannot accept MXC network control")?;drop(control);
        network.set_nonblocking(true).map_err(|_| "Cannot bound MXC network check")?;
        Ok(Self{_root:root,workspace,scratch,outside,profile:format!("lattice_mxc_{}",&marker),marker,network})
    }
    pub(super) fn config_override(&self) -> String { super::permission_profile_override(&self.profile,&self.workspace,&self.scratch) }
    pub(super) fn environment_key(&self) -> String { format!("LATTICE_MXC_SECRET_{}",self.marker) }
    pub(super) fn environment_value(&self) -> &str { &self.marker }
    pub(super) fn script(&self) -> String {
        let q=|path:&Path|format!("'{}'",path.to_string_lossy().replace('\'',"''"));
        let read=q(&self.workspace.join("read.txt"));let readonly=q(&self.workspace.join("readonly.txt"));let written=q(&self.scratch.join("written.txt"));let outside=q(&self.outside.join("outside.txt"));
        let port=self.network.local_addr().map(|address|address.port()).unwrap_or_default();
        // All paths/nonce originate in this owned synthetic directory. No
        // original workspace file is read or modified during capability checks.
        format!("$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; if ((Get-Content -Raw -LiteralPath {read}) -ne '{marker}') {{ exit 40 }}; Set-Content -NoNewline -LiteralPath {written} -Value '{marker}'; try {{ $null=Get-Content -Raw -LiteralPath {outside}; exit 41 }} catch {{ }}; try {{ Set-Content -NoNewline -LiteralPath {readonly} -Value 'UNEXPECTED'; exit 42 }} catch {{ }}; if (Test-Path Env:\\{env_key}) {{ exit 43 }}; & $env:SystemRoot\\System32\\curl.exe --version > $null; if ($LASTEXITCODE -ne 0) {{ exit 44 }}; & $env:SystemRoot\\System32\\curl.exe --silent --connect-timeout 1 --max-time 1 http://127.0.0.1:{port}/synthetic > $null; if ($LASTEXITCODE -notin 7,28) {{ exit 45 }}; Write-Output 'LATTICE_MXC_{marker}'",marker=self.marker,env_key=self.environment_key())
    }
    pub(super) fn validates(&self,response:&Value) -> bool {
        let correct=|path:PathBuf|std::fs::read_to_string(path).is_ok_and(|text|text==self.marker);
        response["exitCode"].as_i64()==Some(0)
            && response["stdout"].as_str().is_some_and(|text|text.trim()==format!("LATTICE_MXC_{}",self.marker))
            && correct(self.workspace.join("read.txt")) && correct(self.workspace.join("readonly.txt"))
            && correct(self.outside.join("outside.txt")) && correct(self.scratch.join("written.txt"))
            && matches!(self.network.accept(),Err(error) if error.kind()==std::io::ErrorKind::WouldBlock)
    }
}
pub(super) fn config_is_mxc(response:&Value) -> bool { response["config"]["windows"]["sandbox"].as_str()==Some("mxc") }
pub(super) fn model_tools_enabled(response:&Value) -> bool {
    ["shell_tool","apply_patch_freeform"].iter().all(|name|response["config"]["features"][name].as_bool()==Some(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn command_environment_requires_exact_allowlist_and_disabled_profile_and_login() {
        let valid=json!({"config":{"allow_login_shell":false,"shell_environment_policy":{"experimental_use_profile":false,"ignore_default_excludes":false,"include_only":COMMAND_ENVIRONMENT}}});
        assert!(command_environment_isolated(&valid));
        for pointer in ["/config/allow_login_shell","/config/shell_environment_policy/experimental_use_profile","/config/shell_environment_policy/ignore_default_excludes"] {
            let mut changed=valid.clone();*changed.pointer_mut(pointer).unwrap()=json!(true);
            assert!(!command_environment_isolated(&changed),"{pointer}");
        }
        let mut wildcard=valid.clone();wildcard["config"]["shell_environment_policy"]["include_only"]=json!(["*"]);
        assert!(!command_environment_isolated(&wildcard));
        let mut mixed=valid.clone();mixed["config"]["shell_environment_policy"]["filters"]=json!({"*":true});
        assert!(!command_environment_isolated(&mixed));
        assert!(!command_environment_isolated(&json!({})));
    }
    #[test]
    fn mxc_requires_explicit_backend_confirmation() {
        assert!(config_is_mxc(&json!({"config":{"windows":{"sandbox":"mxc"}}})));
        for config in [json!({}),json!({"config":{"windows":{"sandbox":"elevated"}}}),json!({"config":{"features":{"prefer_mxc":true}}})] { assert!(!config_is_mxc(&config)); }
    }
    #[test]
    fn runner_availability_alone_does_not_enable_model_tools() {
        assert!(!model_tools_enabled(&json!({"config":{"windows":{"sandbox":"mxc"}}})));
        assert!(!model_tools_enabled(&json!({"config":{"features":{"shell_tool":true,"apply_patch_freeform":false}}})));
        assert!(model_tools_enabled(&json!({"config":{"features":{"shell_tool":true,"apply_patch_freeform":true}}})));
    }
    #[test]
    fn successful_probe_requires_real_scratch_artifact_and_unchanged_readonly_marker() {
        let parent=tempfile::tempdir().unwrap();let probe=ScopeProbe::new(parent.path()).unwrap();
        let success=json!({"exitCode":0,"stdout":format!("LATTICE_MXC_{}\r\n",probe.marker),"stderr":""});
        assert!(!probe.validates(&success),"an echoed nonce alone must not enable native tools");
        std::fs::write(probe.scratch.join("written.txt"),&probe.marker).unwrap();
        assert!(probe.validates(&success));
        std::fs::write(probe.workspace.join("readonly.txt"),"changed").unwrap();
        assert!(!probe.validates(&success),"readonly mutation must fail closed");
    }
    #[test]
    fn probe_rejects_failure_missing_fields_and_extra_output() {
        let parent=tempfile::tempdir().unwrap();let probe=ScopeProbe::new(parent.path()).unwrap();
        std::fs::write(probe.scratch.join("written.txt"),&probe.marker).unwrap();
        for response in [json!({}),json!({"exitCode":1,"stdout":format!("LATTICE_MXC_{}",probe.marker)}),json!({"exitCode":0,"stdout":format!("LATTICE_MXC_{}\nextra",probe.marker)})] { assert!(!probe.validates(&response)); }
    }
    #[test]
    fn probe_profile_does_not_grant_its_outside_directory() {
        let parent=tempfile::tempdir().unwrap();let probe=ScopeProbe::new(parent.path()).unwrap();
        let config=probe.config_override();
        assert!(!config.contains(&serde_json::to_string(&probe.outside.to_string_lossy()).unwrap()));
        assert!(config.contains("\":root\" = \"deny\""));
        assert!(config.contains("enabled = false"));
    }
    #[test]
    fn successful_output_cannot_hide_an_actual_network_connection() {
        let parent=tempfile::tempdir().unwrap();let probe=ScopeProbe::new(parent.path()).unwrap();
        std::fs::write(probe.scratch.join("written.txt"),&probe.marker).unwrap();
        let _connection=TcpStream::connect(probe.network.local_addr().unwrap()).unwrap();
        assert!(!probe.validates(&json!({"exitCode":0,"stdout":format!("LATTICE_MXC_{}",probe.marker)})));
    }
}
