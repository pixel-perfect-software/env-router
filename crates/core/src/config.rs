//! The persisted profile model and `~/.envrouter/config.json` I/O.
//!
//! These structs mirror the frontend's TypeScript types; serde renames fields to camelCase.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const CONFIG_FILE: &str = "config.json";

/// Bump when the file's shape changes, and migrate older versions in [`load`].
pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfig {
    pub env_var: String,
    pub path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub trigger_paths: Vec<String>,
    /// Keyed by the command the shim stands in for, e.g. `claude`.
    #[serde(default)]
    pub tools: BTreeMap<String, ToolConfig>,
}

impl Profile {
    /// The tool's settings, if this profile routes it. An empty path means "not configured",
    /// so a half-filled form can still be saved.
    pub fn tool(&self, name: &str) -> Option<&ToolConfig> {
        self.tools
            .get(name)
            .filter(|tool| !tool.path.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ConfigState {
    /// A file without one predates versioning, so it's version 1, not the current version.
    #[serde(default = "first_version")]
    pub version: u32,
    pub profiles: Vec<Profile>,
}

fn first_version() -> u32 {
    1
}

impl Default for ConfigState {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            profiles: Vec::new(),
        }
    }
}

/// Reads `config.json` from `dir`, or `None` if there isn't one yet.
pub fn load(dir: &Path) -> Result<Option<ConfigState>> {
    let path = dir.join(CONFIG_FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(Error::Io { path, source }),
    };
    let config: ConfigState = serde_json::from_str(&text).map_err(|source| Error::Json {
        path: path.clone(),
        source,
    })?;
    if config.version > CONFIG_VERSION {
        return Err(Error::Invalid(format!(
            "{} is from a newer version of EnvRouter. Update EnvRouter to use it.",
            path.display()
        )));
    }
    Ok(Some(config))
}

/// Like [`load`], but creates the directory and an empty config if they're missing. A
/// malformed file is an error, never silently replaced.
pub fn load_or_init(dir: &Path) -> Result<ConfigState> {
    if let Some(config) = load(dir)? {
        return Ok(config);
    }
    let config = ConfigState::default();
    save(dir, &config)?;
    Ok(config)
}

pub fn save(dir: &Path, config: &ConfigState) -> Result<()> {
    let current = ConfigState {
        version: CONFIG_VERSION,
        profiles: config.profiles.clone(),
    };
    let json = serde_json::to_string_pretty(&current).expect("ConfigState always serializes");
    write_atomic(&dir.join(CONFIG_FILE), format!("{json}\n"))
}

/// Writes through a sibling temp file and a rename, so a reader never sees a half-written
/// file. The contents are flushed to disk before the rename, so a crash can't leave the file
/// (which may be someone's `.zshrc`) empty. An existing file keeps its permissions.
pub fn write_atomic(path: &Path, contents: impl AsRef<[u8]>) -> Result<()> {
    let io_err = |source| Error::Io {
        path: path.to_path_buf(),
        source,
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io_err)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".envrouter-tmp");
    let mut file = File::create(&tmp).map_err(io_err)?;
    file.write_all(contents.as_ref()).map_err(io_err)?;
    file.sync_all().map_err(io_err)?;
    drop(file);
    if let Ok(meta) = fs::metadata(path) {
        fs::set_permissions(&tmp, meta.permissions()).map_err(io_err)?;
    }
    fs::rename(&tmp, path).map_err(io_err)
}

/// Every command at least one profile routes. Each gets a shim.
pub fn tool_names(config: &ConfigState) -> BTreeSet<&str> {
    config
        .profiles
        .iter()
        .flat_map(|profile| {
            profile
                .tools
                .keys()
                .filter(|name| profile.tool(name).is_some())
        })
        .map(String::as_str)
        .collect()
}

/// The folders configured tools are pointed at, with `~` expanded. Some tools (Codex) refuse
/// a config folder that doesn't exist, so the app creates any that are missing.
pub fn tool_dirs(config: &ConfigState, home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = config
        .profiles
        .iter()
        .flat_map(|profile| {
            profile
                .tools
                .keys()
                .filter_map(|name| profile.tool(name))
                .filter_map(|tool| tool_dir(&tool.path, home))
        })
        .collect();
    dirs.sort();
    dirs.dedup();
    dirs
}

/// The folder a tool's variable is set to, with `~` expanded, or `None` if it isn't one the
/// shim may apply. It must be absolute: a relative value would resolve against whatever
/// folder the tool happens to run in, and the tool would write its config there.
pub fn tool_dir(raw: &str, home: &Path) -> Option<PathBuf> {
    let dir = expand_home(raw.trim(), home);
    (dir.is_absolute() && !dir.components().any(|c| c == Component::ParentDir)).then_some(dir)
}

/// Expands a leading `~` to `home`, dropping repeated and trailing slashes after it.
pub fn expand_home(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => rest
            .split('/')
            .filter(|part| !part.is_empty())
            .fold(home.to_path_buf(), |acc, part| acc.join(part)),
        _ => PathBuf::from(path),
    }
}

/// The directory a trigger path matches, at and below. A trigger always covers its whole
/// subtree, so a trailing `/*` or `/**` is accepted and dropped. Any other `*` is rejected
/// rather than silently matched as a literal character.
pub fn trigger_base(raw: &str, home: &Path) -> Result<PathBuf> {
    let trimmed = raw.trim();
    let without_glob = ["/**", "/*"]
        .iter()
        .find_map(|suffix| trimmed.strip_suffix(suffix))
        .unwrap_or(trimmed);
    if without_glob.contains('*') {
        return Err(Error::Invalid(format!(
            "Trigger path \"{raw}\" has a wildcard EnvRouter can't match. Only a trailing /* is supported."
        )));
    }
    let base = expand_home(without_glob, home);
    if !base.is_absolute() {
        return Err(Error::Invalid(format!(
            "Trigger path \"{raw}\" must be absolute or start with ~."
        )));
    }
    // A working directory never contains `..`, so a trigger with one could never match.
    if base.components().any(|c| c == Component::ParentDir) {
        return Err(Error::Invalid(format!(
            "Trigger path \"{raw}\" can't contain \"..\"."
        )));
    }
    // Collecting components drops trailing separators and `.` segments.
    Ok(base.components().collect())
}

/// Rejects anything the shim can't apply safely: names that aren't valid command or
/// environment variable names, tool folders that aren't absolute, bad trigger paths, and a
/// folder claimed by two profiles.
pub fn validate(config: &ConfigState, home: &Path) -> Result<()> {
    let mut owners: HashMap<PathBuf, &Profile> = HashMap::new();
    for profile in &config.profiles {
        for (name, tool) in &profile.tools {
            if !is_command_name(name) {
                return Err(Error::Invalid(format!(
                    "\"{name}\" in profile \"{}\" isn't a valid command name.",
                    profile.name
                )));
            }
            if profile.tool(name).is_none() {
                continue;
            }
            if !is_env_var_name(&tool.env_var) {
                return Err(Error::Invalid(format!(
                    "\"{}\" in profile \"{}\" isn't a valid environment variable name.",
                    tool.env_var, profile.name
                )));
            }
            if tool_dir(&tool.path, home).is_none() {
                return Err(Error::Invalid(format!(
                    "The {name} folder \"{}\" in profile \"{}\" must be an absolute path or start with ~, without \"..\".",
                    tool.path.trim(),
                    profile.name
                )));
            }
        }
        for raw in &profile.trigger_paths {
            let base = trigger_base(raw, home)?;
            // Compared as `resolve` compares them: through symlinks and letter case, two
            // spellings of one folder are still one folder.
            let folder = fs::canonicalize(&base).unwrap_or(base);
            if let Some(other) = owners.insert(folder.clone(), profile) {
                if other.id != profile.id {
                    return Err(Error::Invalid(format!(
                        "{} is a trigger path in both \"{}\" and \"{}\". A folder can belong to only one profile.",
                        folder.display(),
                        other.name,
                        profile.name
                    )));
                }
            }
        }
    }
    Ok(())
}

/// ASCII letters, digits and `_`, not starting with a digit.
pub fn is_env_var_name(s: &str) -> bool {
    let mut chars = s.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Like an env var name, but `-` is allowed after the first character. This becomes a file
/// name in the shims directory and is interpolated into shell checks, so it stays strict.
pub fn is_command_name(s: &str) -> bool {
    let mut chars = s.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/home/me")
    }

    fn profile(id: &str, triggers: &[&str], tool: Option<(&str, &str, &str)>) -> Profile {
        Profile {
            id: id.into(),
            name: id.into(),
            trigger_paths: triggers.iter().map(|t| t.to_string()).collect(),
            tools: tool
                .into_iter()
                .map(|(name, env_var, path)| {
                    (
                        name.into(),
                        ToolConfig {
                            env_var: env_var.into(),
                            path: path.into(),
                        },
                    )
                })
                .collect(),
        }
    }

    fn config(profiles: Vec<Profile>) -> ConfigState {
        ConfigState {
            profiles,
            ..Default::default()
        }
    }

    #[test]
    fn trigger_base_expands_home_and_drops_trailing_glob() {
        for raw in [
            "~/dev/work",
            "~/dev/work/",
            "~/dev/work/*",
            "~/dev/work/**",
            " ~/dev/work ",
        ] {
            assert_eq!(
                trigger_base(raw, &home()).unwrap(),
                PathBuf::from("/home/me/dev/work"),
                "{raw}"
            );
        }
        assert_eq!(trigger_base("~", &home()).unwrap(), home());
        assert_eq!(trigger_base("/", &home()).unwrap(), PathBuf::from("/"));
    }

    #[test]
    fn trigger_base_rejects_what_cannot_match() {
        for raw in [
            "~/dev/*/work",
            "~/dev/work*",
            "dev/work",
            "~user/dev",
            "/home/me/../x",
            "",
        ] {
            assert!(trigger_base(raw, &home()).is_err(), "{raw}");
        }
    }

    #[test]
    fn trigger_base_keeps_glob_characters_other_than_star_literal() {
        assert_eq!(
            trigger_base("~/[archive]/v?", &home()).unwrap(),
            PathBuf::from("/home/me/[archive]/v?")
        );
        // A backslash is an ordinary file name character here, not a separator.
        assert_eq!(
            trigger_base("~/a\\b", &home()).unwrap(),
            PathBuf::from("/home/me/a\\b")
        );
    }

    #[test]
    fn validate_rejects_a_folder_in_two_profiles_after_normalizing() {
        let config = config(vec![
            profile("a", &["~/dev"], None),
            profile("b", &["/home/me/dev/*"], None),
        ]);
        let err = validate(&config, &home()).unwrap_err().to_string();
        assert!(err.contains("\"a\" and \"b\""), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn validate_rejects_one_folder_spelled_two_ways() {
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        fs::create_dir_all(home.join("dev/work")).unwrap();
        std::os::unix::fs::symlink(home.join("dev/work"), home.join("work")).unwrap();
        let config = config(vec![
            profile("a", &["~/dev/work"], None),
            profile("b", &["~/work"], None),
        ]);
        let err = validate(&config, &home).unwrap_err().to_string();
        assert!(err.contains("\"a\" and \"b\""), "{err}");
    }

    #[test]
    fn validate_allows_a_repeated_trigger_within_one_profile() {
        let config = config(vec![profile("a", &["~/dev", "~/dev/"], None)]);
        validate(&config, &home()).unwrap();
    }

    #[test]
    fn validate_checks_names_only_for_configured_tools() {
        let bad_var = config(vec![profile("a", &[], Some(("claude", "1BAD", "~/.c")))]);
        assert!(validate(&bad_var, &home()).is_err());

        let unconfigured = config(vec![profile("a", &[], Some(("claude", "", "")))]);
        validate(&unconfigured, &home()).unwrap();

        let bad_tool = config(vec![profile("a", &[], Some(("../claude", "X", "")))]);
        assert!(validate(&bad_tool, &home()).is_err());
    }

    #[test]
    fn validate_rejects_a_tool_folder_that_is_not_absolute() {
        for path in ["relative/dir", "./here", "~user/.c", "~/../elsewhere"] {
            let bad = config(vec![profile("a", &[], Some(("claude", "X", path)))]);
            let err = validate(&bad, &home()).unwrap_err().to_string();
            assert!(err.contains(path), "{path}: {err}");
        }
        for path in ["~/.c", "~", "/opt/claude", " ~/.c "] {
            let good = config(vec![profile("a", &[], Some(("claude", "X", path)))]);
            validate(&good, &home()).unwrap();
        }
    }

    #[test]
    fn tool_names_skips_unconfigured_tools() {
        let config = config(vec![
            profile("a", &[], Some(("claude", "CLAUDE_CONFIG_DIR", "~/.c"))),
            profile("b", &[], Some(("aider", "X", " "))),
        ]);
        assert_eq!(tool_names(&config), BTreeSet::from(["claude"]));
    }

    #[test]
    fn tool_dirs_expands_and_skips_unconfigured_tools() {
        let config = config(vec![
            profile("a", &[], Some(("codex", "CODEX_HOME", "~/.codex-a"))),
            profile("b", &[], Some(("claude", "CLAUDE_CONFIG_DIR", " "))),
            profile("c", &[], Some(("codex", "CODEX_HOME", "~/.codex-a"))),
        ]);
        assert_eq!(
            tool_dirs(&config, &home()),
            vec![PathBuf::from("/home/me/.codex-a")]
        );
    }

    #[test]
    fn load_or_init_creates_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let envrouter = dir.path().join(".envrouter");
        assert_eq!(load_or_init(&envrouter).unwrap(), ConfigState::default());
        assert!(envrouter.join(CONFIG_FILE).exists());

        let config = config(vec![profile(
            "a",
            &["~/dev"],
            Some(("claude", "CLAUDE_CONFIG_DIR", "~/.c")),
        )]);
        save(&envrouter, &config).unwrap();
        assert_eq!(load_or_init(&envrouter).unwrap(), config);
    }

    #[test]
    fn load_reads_a_file_without_a_version_as_version_1() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE), r#"{ "profiles": [] }"#).unwrap();
        assert_eq!(load(dir.path()).unwrap().unwrap().version, 1);
    }

    #[test]
    fn load_refuses_a_newer_version() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(CONFIG_FILE),
            r#"{ "version": 99, "profiles": [] }"#,
        )
        .unwrap();
        assert!(matches!(load(dir.path()), Err(Error::Invalid(_))));
    }

    #[test]
    fn load_or_init_refuses_to_overwrite_a_malformed_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE), "{ not json").unwrap();
        assert!(matches!(load_or_init(dir.path()), Err(Error::Json { .. })));
        assert_eq!(
            fs::read_to_string(dir.path().join(CONFIG_FILE)).unwrap(),
            "{ not json"
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_keeps_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rc");
        fs::write(&file, "old").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&file, "new").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
