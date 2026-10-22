/// Produce an isolated Tauri identifier without accepting filesystem components.
pub fn diagnostics_identifier(base: &str, profile: Option<&str>) -> Result<String, String> {
    let Some(profile) = profile else {
        return Ok(base.to_string());
    };
    if profile.is_empty()
        || profile.len() > 48
        || !profile
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || !profile.as_bytes()[0].is_ascii_alphanumeric()
        || !profile.as_bytes()[profile.len() - 1].is_ascii_alphanumeric()
    {
        return Err("LATTICE_DIAGNOSTICS_PROFILE must contain 1–48 ASCII letters, digits or hyphens, starting and ending with a letter or digit".to_string());
    }
    Ok(format!("{base}.diagnostics-{profile}"))
}

#[cfg(test)]
mod tests {
    use super::diagnostics_identifier;

    #[test]
    fn diagnostics_profile_preserves_normal_identifier() {
        assert_eq!(
            diagnostics_identifier("com.lattice.editor", None).unwrap(),
            "com.lattice.editor"
        );
    }

    #[test]
    fn diagnostics_profile_is_a_distinct_identifier() {
        assert_eq!(
            diagnostics_identifier("com.lattice.editor", Some("v3-smoke-123")).unwrap(),
            "com.lattice.editor.diagnostics-v3-smoke-123"
        );
    }

    #[test]
    fn diagnostics_profile_rejects_path_and_identifier_injection() {
        for value in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            "C:foo",
            "foo.bar",
            "hello world",
            "测试",
            "-foo",
            "foo-",
            "a\n",
        ] {
            assert!(
                diagnostics_identifier("com.lattice.editor", Some(value)).is_err(),
                "{value:?}"
            );
        }
        assert!(diagnostics_identifier("com.lattice.editor", Some(&"x".repeat(49))).is_err());
        assert!(diagnostics_identifier("com.lattice.editor", Some(&"x".repeat(48))).is_ok());
    }
}
