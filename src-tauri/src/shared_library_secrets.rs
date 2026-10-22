//! OS-protected shared-library session values. No account credentials are
//! inspected by diagnostics; tests use synthetic values only.

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_VALUE_BYTES: usize = 128 * 1024;
const SCHEME: &str = "windows-dpapi-user";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u8,
    protection: String,
    ciphertext: Vec<u8>,
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 1024 || key.chars().any(char::is_control) {
        return Err("Invalid shared-library secure storage key".into());
    }
    Ok(())
}

pub fn protect(key: &str, value: &str) -> Result<Value, String> {
    validate_key(key)?;
    if value.len() > MAX_VALUE_BYTES {
        return Err("Shared-library secure value exceeds its storage limit".into());
    }
    let ciphertext = platform::transform(key, value.as_bytes(), true)?;
    serde_json::to_value(Envelope { version: 1, protection: SCHEME.into(), ciphertext })
        .map_err(|_| "Could not encode protected shared-library value".into())
}

pub fn unprotect(key: &str, value: Value) -> Result<String, String> {
    validate_key(key)?;
    let envelope: Envelope = serde_json::from_value(value)
        .map_err(|_| "Invalid protected shared-library value".to_string())?;
    if envelope.version != 1 || envelope.protection != SCHEME
        || envelope.ciphertext.is_empty() || envelope.ciphertext.len() > MAX_VALUE_BYTES + 4096 {
        return Err("Unsupported or damaged protected shared-library value".into());
    }
    let plaintext = platform::transform(key, &envelope.ciphertext, false)?;
    String::from_utf8(plaintext).map_err(|_| "Protected shared-library value is not UTF-8".into())
}

#[cfg(windows)]
mod platform {
    use std::{ffi::c_void, ptr};

    #[repr(C)]
    struct DataBlob { len: u32, data: *mut u8 }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(input: *mut DataBlob, description: *const u16,
            entropy: *mut DataBlob, reserved: *mut c_void, prompt: *mut c_void,
            flags: u32, output: *mut DataBlob) -> i32;
        fn CryptUnprotectData(input: *mut DataBlob, description: *mut *mut u16,
            entropy: *mut DataBlob, reserved: *mut c_void, prompt: *mut c_void,
            flags: u32, output: *mut DataBlob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" { fn LocalFree(allocation: *mut c_void) -> *mut c_void; }

    struct OwnedBlob(DataBlob);
    impl Drop for OwnedBlob {
        fn drop(&mut self) {
            if !self.0.data.is_null() {
                // DPAPI allocates the output with LocalAlloc. Clear the native
                // plaintext/cipher buffer before releasing its ownership.
                unsafe {
                    ptr::write_bytes(self.0.data, 0, self.0.len as usize);
                    LocalFree(self.0.data.cast());
                }
            }
        }
    }

    pub fn transform(key: &str, bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        let mut input = DataBlob { len: bytes.len() as u32, data: bytes.as_ptr().cast_mut() };
        let entropy_bytes = format!("Lattice.shared-library.v1:{key}").into_bytes();
        let mut entropy = DataBlob { len: entropy_bytes.len() as u32, data: entropy_bytes.as_ptr().cast_mut() };
        let mut output = OwnedBlob(DataBlob { len: 0, data: ptr::null_mut() });
        // Null prompt + UI_FORBIDDEN keeps calls noninteractive. No
        // LOCAL_MACHINE flag: ciphertext stays tied to this Windows user.
        let ok = unsafe {
            if encrypt {
                CryptProtectData(&mut input, ptr::null(), &mut entropy, ptr::null_mut(), ptr::null_mut(), 1, &mut output.0)
            } else {
                CryptUnprotectData(&mut input, ptr::null_mut(), &mut entropy, ptr::null_mut(), ptr::null_mut(), 1, &mut output.0)
            }
        };
        if ok == 0 { return Err("Windows could not protect or decrypt the shared-library session".into()); }
        if output.0.data.is_null() { return Ok(Vec::new()); }
        // The successful native API owns an output buffer of exactly len bytes;
        // copy it before OwnedBlob clears/releases the allocation.
        Ok(unsafe { std::slice::from_raw_parts(output.0.data, output.0.len as usize) }.to_vec())
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn transform(_key: &str, _bytes: &[u8], _encrypt: bool) -> Result<Vec<u8>, String> {
        Err("Protected shared-library desktop sessions currently require Windows DPAPI".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn protected_session_roundtrips_without_plaintext_serialization() {
        let plaintext = "synthetic-session-云端-token";
        let envelope = protect("session:synthetic-library", plaintext).unwrap();
        assert!(envelope.is_object());
        assert!(!envelope.to_string().contains(plaintext));
        assert_eq!(unprotect("session:synthetic-library", envelope).unwrap(), plaintext);
    }

    #[test]
    fn different_session_key_cannot_decrypt_the_value() {
        let envelope = protect("session:account-a", "synthetic-token").unwrap();
        assert!(unprotect("session:account-b", envelope).is_err());
    }

    #[test]
    fn unknown_or_corrupt_envelopes_are_not_treated_as_tokens() {
        assert!(unprotect("session:a", serde_json::json!({"version":2,"protection":"windows-dpapi-user","ciphertext":[1,2]})).is_err());
        assert!(unprotect("session:a", serde_json::json!({"version":1,"protection":"windows-dpapi-user","ciphertext":[1,2]})).is_err());
        assert!(unprotect("session:a", serde_json::json!("unmigrated-plaintext")).is_err());
    }

    #[test]
    fn invalid_keys_and_oversized_values_fail_before_storage() {
        assert!(protect("", "fixture").is_err());
        assert!(protect("session\nspoof", "fixture").is_err());
        assert!(protect("session:a", &"x".repeat(128 * 1024 + 1)).is_err());
    }
}
