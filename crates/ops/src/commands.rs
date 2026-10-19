//! What each of the window's commands does, as plain functions of the home folder. The desktop
//! app wraps them in Tauri commands; `envrouter rpc` (the CLI) calls the same ones by name, so a
//! window managing another machine, such as a WSL distro, gets identical answers.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState, IdeHook, McpServer};
use envrouter_core::platform::{self, Platform};
use envrouter_core::{mcp, paths, Error, Result};
use serde::Serialize;

use crate::editors::{self, Editor, EditorStatus};
use crate::shell::{self, FolderCheck, Preview, Shell, ShellStatus};
use crate::{mcp_import, mcp_probe, shims};

pub fn get_config(home: &Path) -> Result<ConfigState> {
    config::load_or_init(&paths::root(home))
}

/// Validates and saves the config, then renders each profile's MCP files and updates the shims
/// to match. `secrets` holds values typed since the last save, keyed by the ids the config
/// refers to them by; they go to the secret store before the config names them.
pub fn save_config(
    home: &Path,
    payload: &ConfigState,
    secrets: &HashMap<String, String>,
) -> Result<()> {
    config::validate(payload, home)?;
    let referenced = config::secret_ids(payload);
    if secrets.keys().any(|id| !referenced.contains(id.as_str())) {
        return Err(Error::Invalid(
            "A new secret isn't used by any server. Save the server again.".into(),
        ));
    }
    let fresh_shim = shims::install_bundled(home)?;
    // Only inside home: a typo'd absolute path shouldn't create folders elsewhere.
    for dir in config::tool_dirs(payload, home) {
        if dir.starts_with(home) && !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|source| Error::Io { path: dir, source })?;
        }
    }
    // The store is read only when this save adds a secret or stops using one.
    let root = paths::root(home);
    let dropped = config::load(&root).ok().flatten().is_some_and(|previous| {
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
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub shim_installed: bool,
    pub shims_dir: String,
    pub shells: Vec<ShellStatus>,
}

pub fn setup_status(home: &Path) -> Result<SetupStatus> {
    Ok(SetupStatus {
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

/// The editor hooks the saved config names, for callers without the window's registry.
pub fn saved_hooks(home: &Path) -> Result<BTreeMap<String, IdeHook>> {
    Ok(get_config(home)?
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

/// Each library server's tools from its last check that worked, if its definition hasn't
/// changed since.
pub fn mcp_tools(home: &Path) -> Result<BTreeMap<String, Vec<mcp_probe::ToolInfo>>> {
    Ok(mcp_probe::known_tools(&get_config(home)?, home))
}

/// MCP servers the agents already define in their own files. Only reads them.
pub fn import_candidates(home: &Path, payload: &ConfigState) -> Vec<mcp_import::ImportCandidate> {
    mcp_import::candidates(payload, home)
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
