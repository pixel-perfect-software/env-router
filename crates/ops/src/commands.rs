//! What each of the window's commands does, as plain functions of the home folder. The desktop
//! app wraps them in Tauri commands; `envrouter rpc` (the CLI) calls the same ones by name, so a
//! window managing another machine, such as a WSL distro, gets identical answers.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState, IdeHook, McpServer};
use envrouter_core::platform::{self, Platform};
use envrouter_core::{agents, mcp, paths, Error, Result};
use serde::Serialize;

use crate::editors::{self, Editor, EditorStatus};
use crate::shell::{self, FolderCheck, Preview, Shell, ShellStatus};
use crate::{mcp_import, mcp_probe, npm, shims};

pub fn get_config(home: &Path) -> Result<ConfigState> {
    config::load_or_init(&paths::root(home))
}

/// What a save did. A save that names the config it was edited from (`base`) is refused when
/// config.json no longer holds that config, because the CLI or a hand edit changed it since:
/// the answer then carries the file as it is, so the window can fold its edit into it and save
/// again. A refused save changes nothing, the secret store included.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    /// `config` is what config.json holds now: the payload at the current version.
    Saved { config: ConfigState },
    /// Nothing was saved. `config` is what config.json holds now.
    Changed { config: ConfigState },
}

/// Validates and saves the config, then renders each profile's MCP files and updates the shims
/// to match. `secrets` holds values typed since the last save, keyed by the ids the config
/// refers to them by; they go to the secret store before the config names them. `base`, when
/// given, is the config the edit started from (see [`SaveOutcome`]). The window's save: it
/// installs the shim and helper it ships with.
pub fn save_config(
    home: &Path,
    payload: &ConfigState,
    secrets: &HashMap<String, String>,
    base: Option<&ConfigState>,
) -> Result<SaveOutcome> {
    save(home, payload, secrets, base, true)
}

/// [`save_config`] for the CLI: the same save, but it installs its own shim and helper only
/// where none is installed. Where the app is in use, its builds stay; `envrouter install`
/// replaces them on purpose.
pub fn save_config_from_cli(
    home: &Path,
    payload: &ConfigState,
    secrets: &HashMap<String, String>,
) -> Result<()> {
    let install = !paths::shim_binary(home).is_file();
    save(home, payload, secrets, None, install).map(|_| ())
}

fn save(
    home: &Path,
    payload: &ConfigState,
    secrets: &HashMap<String, String>,
    base: Option<&ConfigState>,
    install: bool,
) -> Result<SaveOutcome> {
    let root = paths::root(home);
    let _lock = config::lock(&root)?;
    let previous = match (config::load(&root), base) {
        // A file that can't be read now was readable when the edit started: someone is editing
        // it. Saving over that would throw their edit away.
        (Err(err), Some(_)) => return Err(err),
        (loaded, _) => loaded.ok().flatten(),
    };
    if let Some(base) = base {
        if previous.as_ref() != Some(base) {
            return Ok(SaveOutcome::Changed {
                config: previous.unwrap_or_default(),
            });
        }
    }
    config::validate(payload, home)?;
    let referenced = config::secret_ids(payload);
    if secrets.keys().any(|id| !referenced.contains(id.as_str())) {
        return Err(Error::Invalid(
            "A new secret isn't used by any server. Save the server again.".into(),
        ));
    }
    let fresh_shim = install && shims::install_bundled(home)?;
    // Only inside home: a typo'd absolute path shouldn't create folders elsewhere.
    for dir in config::tool_dirs(payload, home) {
        if dir.starts_with(home) && !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|source| Error::Io { path: dir, source })?;
        }
    }
    // The store is read only when this save adds a secret or stops using one.
    let dropped = previous.is_some_and(|previous| {
        config::secret_ids(&previous)
            .iter()
            .any(|id| !referenced.contains(id))
    });
    if !secrets.is_empty() || dropped {
        envrouter_keychain::update(home, secrets, &referenced)?;
    }
    config::save(&root, payload)?;
    mcp::sync(payload, home)?;
    shims::sync(home, payload)?;
    if fresh_shim && !referenced.is_empty() {
        shims::ask_keychain_access(home);
    }
    Ok(SaveOutcome::Saved {
        config: config::as_saved(payload),
    })
}

/// A secret the server library refers to: who uses it and whether the store has it, never
/// its value.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretUse {
    pub id: String,
    /// The servers that refer to it, by name.
    pub servers: Vec<String>,
    /// `None` when the store couldn't be read.
    pub stored: Option<bool>,
}

/// Each secret the saved config refers to, and why the store couldn't say which it holds, if it
/// couldn't. For `envrouter secret list`, an explicit request, so it may read the store; the
/// window never reads it just to look. An unreadable store still lists the ids, since they're
/// what `envrouter secret set` takes.
pub fn secrets(home: &Path) -> Result<(Vec<SecretUse>, Option<String>)> {
    let config = get_config(home)?;
    let users = config::secret_users(&config);
    let (stored, problem) = if users.is_empty() {
        (Some(HashMap::new()), None)
    } else {
        match envrouter_keychain::read(home) {
            Ok(stored) => (Some(stored), None),
            Err(err) => (None, Some(err.to_string())),
        }
    };
    let secrets = users
        .into_iter()
        .map(|(id, servers)| SecretUse {
            id: id.to_string(),
            servers: servers.into_iter().map(str::to_string).collect(),
            stored: stored.as_ref().map(|stored| stored.contains_key(id)),
        })
        .collect();
    Ok((secrets, problem))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    /// Which system this is, so the window can use its conventions (shortcuts, words).
    pub platform: Platform,
    /// What the store MCP secrets go to is called here: "Keychain", "keyring".
    pub secret_store: &'static str,
    pub shim_installed: bool,
    pub shims_dir: String,
    pub shells: Vec<ShellStatus>,
}

pub fn setup_status(home: &Path) -> Result<SetupStatus> {
    let platform = Platform::current();
    Ok(SetupStatus {
        platform,
        secret_store: platform.secret_store_name(),
        shim_installed: shims::is_installed(home, &shims::bundled()?, &shims::bundled_keychain()?),
        shims_dir: paths::shims(home).display().to_string(),
        shells: Shell::ALL.iter().map(|&s| shell::status(s, home)).collect(),
    })
}

pub fn set_shell_integration(home: &Path, shell: Shell, enabled: bool) -> Result<ShellStatus> {
    if enabled {
        shims::install_bundled(home)?;
    }
    shell::set_integration(shell, home, enabled)
}

/// Each editor's state for each agent hook, keyed by the agent's command.
pub fn editor_status(home: &Path, hooks: &BTreeMap<String, IdeHook>) -> Vec<EditorStatus> {
    Editor::ALL
        .iter()
        .flat_map(|&editor| {
            hooks
                .iter()
                .map(move |(command, hook)| editors::status(editor, home, command, hook))
        })
        .collect()
}

/// The editor hooks of the saved config's agents, with the registry's filled in as the
/// window's next save would, for callers without the window.
pub fn saved_hooks(home: &Path) -> Result<BTreeMap<String, IdeHook>> {
    Ok(agents::with_agents(get_config(home)?)
        .agents
        .into_iter()
        .filter_map(|(command, agent)| agent.ide.map(|hook| (command, hook)))
        .collect())
}

/// Points an agent's editor extension at the shim, or stops it, in the editor's settings.
pub fn set_editor_integration(
    home: &Path,
    editor: Editor,
    command: &str,
    hook: &IdeHook,
    enabled: bool,
) -> Result<EditorStatus> {
    if enabled {
        shims::install_bundled(home)?;
    }
    editors::set_integration(editor, home, command, hook, enabled)
}

/// Opens `shell` the way a new terminal window would, in `folder`, and reports what running
/// `tool` there would do. Never runs the tool itself.
pub fn check_folder(home: &Path, shell: Shell, folder: &Path, tool: &str) -> Result<FolderCheck> {
    shell::check_folder(shell, home, folder, tool)
}

/// What the given, possibly unsaved, config would route for `tool` in `folder`.
pub fn preview_folder(home: &Path, payload: &ConfigState, folder: &Path, tool: &str) -> Preview {
    shell::preview(payload, home, folder, tool)
}

/// Starts `server` (or connects to it) and lists its tools. `path` is the PATH a new terminal
/// gets ([`shell::login_path`], which blocks, so the caller runs it where blocking is fine).
/// `secrets` holds values typed since the last save; the store supplies the rest. A good list
/// is remembered for the profile editor's tool filter.
pub async fn check_mcp_server(
    home: &Path,
    path: &str,
    name: &str,
    server: &McpServer,
    secrets: &HashMap<String, String>,
) -> Result<mcp_probe::ServerCheck> {
    let check = mcp_probe::check(server, secrets, home, path).await;
    if check.status == mcp_probe::CheckStatus::Ok && config::is_file_name(name) {
        mcp_probe::remember(home, name, server, &check.tools)?;
    }
    Ok(check)
}

/// The dist-tags of the npm package an `npx` server runs (`latest` and the like), so the window
/// can pin it to one version. `path` is the PATH a new terminal gets, as for a check.
pub async fn npm_dist_tags(
    home: &Path,
    path: &str,
    command: &str,
    package: &str,
) -> Result<BTreeMap<String, String>> {
    npm::dist_tags(home, path, command, package).await
}

/// Each library server's tools from its last check that worked, if its definition hasn't
/// changed since.
pub fn mcp_tools(home: &Path) -> Result<BTreeMap<String, Vec<mcp_probe::ToolInfo>>> {
    Ok(mcp_probe::known_tools(&get_config(home)?, home))
}

/// MCP servers the agents already define in their own files. Only reads them.
pub fn import_candidates(home: &Path, payload: &ConfigState) -> Vec<mcp_import::ImportCandidate> {
    mcp_import::candidates(payload, home)
}

/// MCP servers in text the user pasted, such as a README's snippet.
pub fn parse_mcp_json(text: &str) -> Result<mcp_import::Pasted> {
    mcp_import::parse_pasted(text).map_err(Error::Invalid)
}

/// Opens a file in the user's default text editor, e.g. the startup file that defines an alias
/// shadowing the shim. Limited to existing files inside the home folder.
pub fn open_in_editor(home: &Path, path: &str) -> Result<()> {
    let file = std::fs::canonicalize(path).map_err(|source| Error::Io {
        path: PathBuf::from(path),
        source,
    })?;
    let home = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    if !file.is_file() || !file.starts_with(&home) {
        return Err(Error::Invalid(format!(
            "{path} isn't a file in your home folder."
        )));
    }
    let (program, args) = platform::open_text_file_command(Platform::current());
    let status = std::process::Command::new(program)
        .args(args)
        .arg(&file)
        .status()
        .map_err(|err| Error::Command(format!("couldn't run {program}: {err}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Command(format!("couldn't open {}", file.display())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use envrouter_core::config::Profile;

    fn profile(id: &str, name: &str) -> Profile {
        Profile {
            id: id.into(),
            name: name.into(),
            ..Profile::default()
        }
    }

    /// The window's save, minus installing the bundled shim, which a test binary has none of.
    fn save_config(
        home: &Path,
        payload: &ConfigState,
        secrets: &HashMap<String, String>,
        base: Option<&ConfigState>,
    ) -> Result<SaveOutcome> {
        save(home, payload, secrets, base, false)
    }

    fn with_profile(config: &ConfigState, id: &str, name: &str) -> ConfigState {
        let mut config = config.clone();
        config.profiles.push(profile(id, name));
        config
    }

    #[test]
    fn saves_an_edit_of_the_config_on_disk() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let base = get_config(home).unwrap();
        let edited = with_profile(&base, "p1", "Work");
        let outcome = save_config(home, &edited, &HashMap::new(), Some(&base)).unwrap();
        assert_eq!(
            outcome,
            SaveOutcome::Saved {
                config: edited.clone()
            }
        );
        assert_eq!(get_config(home).unwrap(), edited);
    }

    /// The CLI (or a hand edit) saved after the window read the config: the window's save is
    /// refused with the file as it is now, and nothing changes.
    #[test]
    fn refuses_an_edit_of_a_config_changed_since() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let base = get_config(home).unwrap();
        let elsewhere = with_profile(&base, "p2", "Personal");
        config::save(&paths::root(home), &elsewhere).unwrap();

        let edited = with_profile(&base, "p1", "Work");
        let outcome = save_config(home, &edited, &HashMap::new(), Some(&base)).unwrap();
        assert_eq!(
            outcome,
            SaveOutcome::Changed {
                config: elsewhere.clone()
            }
        );
        assert_eq!(get_config(home).unwrap(), elsewhere);
        // Without a base, the save goes ahead as before.
        save_config(home, &edited, &HashMap::new(), None).unwrap();
        assert_eq!(get_config(home).unwrap(), edited);
    }

    #[test]
    fn refuses_an_edit_while_the_file_is_broken() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let base = get_config(home).unwrap();
        let file = paths::root(home).join(config::CONFIG_FILE);
        std::fs::write(&file, "{ half-typed").unwrap();
        let edited = with_profile(&base, "p1", "Work");
        assert!(save_config(home, &edited, &HashMap::new(), Some(&base)).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ half-typed");
    }

    /// `SaveOutcome` in `src/lib/types.ts`.
    #[test]
    fn wire_format_matches_the_typescript_types() {
        let config = ConfigState::default();
        let saved = serde_json::to_value(SaveOutcome::Saved {
            config: config.clone(),
        })
        .unwrap();
        assert_eq!(saved["status"], "saved");
        assert_eq!(saved["config"], serde_json::to_value(&config).unwrap());
        let changed = serde_json::to_value(SaveOutcome::Changed { config }).unwrap();
        assert_eq!(changed["status"], "changed");
        assert!(changed["config"]["profiles"].is_array());
    }
}
