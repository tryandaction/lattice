$ErrorActionPreference = "Stop"
$harnessWorkspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "../../../../../")).Path
$harnessDeps = Join-Path $harnessWorkspace "src-tauri/target/debug/deps"
$harnessOutput = Join-Path $harnessWorkspace ".lattice-build/agent-harness-native-tests"
New-Item -ItemType Directory -Force -Path $harnessOutput | Out-Null
$env:CARGO_MANIFEST_DIR = Join-Path $harnessWorkspace "src-tauri"
$env:CARGO_PKG_NAME = "lattice"
$harnessFingerprintRoot = Join-Path $harnessWorkspace "src-tauri/target/debug/.fingerprint"
$harnessBuildMetadataPath = Get-ChildItem -Path "$harnessFingerprintRoot/lattice-*/test-bin-lattice.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$harnessBuildMetadataPath) { throw "Build the existing native project once before running this no-install focused runner." }
$harnessBuildMetadata = Get-Content -LiteralPath $harnessBuildMetadataPath.FullName -Raw | ConvertFrom-Json
$harnessSource = (Join-Path $harnessWorkspace "src-tauri/src/agent_harness.rs").Replace("\", "/")
$harnessWrapper = Join-Path $harnessOutput "entry.rs"
Set-Content -LiteralPath $harnessWrapper -Value "#![allow(dead_code)]`n#[path = `"$harnessSource`"] mod agent_harness;" -Encoding utf8
$harnessRustArgs = @("--edition=2021", "--test", $harnessWrapper, "-L", "dependency=$harnessDeps", "-o", (Join-Path $harnessOutput "harness-tests.exe"))
# Reuse native linker paths emitted by the existing Cargo build (no dependency install).
Get-ChildItem -Path "$harnessWorkspace/src-tauri/target/debug/build/*/output" | ForEach-Object {
  Get-Content -LiteralPath $_.FullName | ForEach-Object {
    if ($_ -match '^cargo::?rustc-link-search=(.+)$') { $harnessRustArgs += @("-L", $Matches[1]) }
  }
}
foreach ($harnessCrate in @("tauri", "tokio", "serde", "serde_json", "uuid", "tempfile")) {
  $harnessDependency = $harnessBuildMetadata.deps | Where-Object { $_[1] -eq $harnessCrate } | Select-Object -First 1
  $harnessHash = ([BitConverter]::ToString([BitConverter]::GetBytes([UInt64]$harnessDependency[3]))).Replace("-", "").ToLowerInvariant()
  $harnessCrateFingerprint = Get-ChildItem -LiteralPath $harnessFingerprintRoot -Filter "$harnessCrate-*" -Directory | Where-Object {
    $harnessMarker = Join-Path $_.FullName "lib-$harnessCrate"
    (Test-Path -LiteralPath $harnessMarker) -and (Get-Content -LiteralPath $harnessMarker -Raw).Trim() -eq $harnessHash
  } | Select-Object -First 1
  $harnessRlib = Get-Item -LiteralPath (Join-Path $harnessDeps "lib$($harnessCrateFingerprint.Name).rlib") -ErrorAction SilentlyContinue
  if (!$harnessRlib) { throw "Existing dependency missing: $harnessCrate. Run the project native build first; this runner does not install dependencies." }
  $harnessRustArgs += @("--extern", "$harnessCrate=$($harnessRlib.FullName)")
}
& rustc @harnessRustArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $harnessOutput "harness-tests.exe") --test-threads=1 --nocapture
exit $LASTEXITCODE
