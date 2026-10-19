mod editors;
mod mcp_import;
mod mcp_probe;
mod shell;
mod shims;
mod tray;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState, McpServer};
use envrouter_core::{mcp, paths, Error, Result};
use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

use editors::{Editor, EditorStatus, IdeHook};
use shell::{FolderCheck, Preview, Shell, ShellStatus};

fn home(app: &AppHandle) -> Result<PathBuf> {
    app.path().home_dir().map_err(|_| Error::NoHome)
}

/// Runs blocking work (file I/O, spawning shells) off the async runtime's worker threads.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| Error::Command(err.to_string()))?
}

#[tauri::command]
async fn get_config(app: AppHandle) -> Result<ConfigState> {
    let home = home(&app)?;
    blocking(move || config::load_or_init(&paths::root(&home))).await
}

/// Validates and saves the config, then renders each profile's MCP files and updates the
/// shims to match. `secrets` holds values typed since the last save, keyed by the ids the
/// config refers to them by; they go to the Keychain before the config names them.
#[tauri::command]
async fn save_config(
    app: AppHandle,
    payload: ConfigState,
    secrets: HashMap<String, String>,
) -> Result<()> {
    let home = home(&app)?;
    blocking(move || {
        config::validate(&payload, &home)?;
        let referenced = config::secret_ids(&payload);
        if secrets.keys().any(|id| !referenced.contains(id.as_str())) {
            return Err(Error::Invalid(
                "A new secret isn't used by any server. Save the server again.".into(),
            ));
        }
        let fresh_shim = shims::install_bundled(&home)?;
        // Only inside home: a typo'd absolute path shouldn't create folders elsewhere.
        for dir in config::tool_dirs(&payload, &home) {
            if dir.starts_with(&home) && !dir.exists() {
                std::fs::create_dir_all(&dir).map_err(|source| Error::Io { path: dir, source })?;
            }
        }
        // The Keychain is read only when this save adds a secret or stops using one.
        let root = paths::root(&home);
        let dropped = config::load(&root).ok().flatten().is_some_and(|previous| {
            config::secret_ids(&previous)
                .iter()
                .any(|id| !referenced.contains(id))
        });
        if !secrets.is_empty() || dropped {
            envrouter_keychain::update(&home, &secrets, &referenced)?;
        }
        config::save(&root, &payload)?;
        mcp::sync(&payload, &home)?;
        shims::sync(&home, &payload)?;
        if fresh_shim && !referenced.is_empty() {
            shims::ask_keychain_access(&home);
        }
        tray::refresh(&app);
        Ok(())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupStatus {
    shim_installed: bool,
    shims_dir: String,
    shells: Vec<ShellStatus>,
}

#[tauri::command]
async fn get_setup_status(app: AppHandle) -> Result<SetupStatus> {
    let home = home(&app)?;
    blocking(move || {
        Ok(SetupStatus {
            shim_installed: shims::is_installed(
                &home,
                &shims::bundled()?,
                &shims::bundled_keychain()?,
            ),
            shims_dir: paths::shims(&home).display().to_string(),
            shells: Shell::ALL
                .iter()
                .map(|&s| shell::status(s, &home))
                .collect(),
        })
    })
    .await
}

#[tauri::command]
async fn set_shell_integration(app: AppHandle, shell: Shell, enabled: bool) -> Result<ShellStatus> {
    let home = home(&app)?;
    blocking(move || {
        if enabled {
            shims::install_bundled(&home)?;
        }
        let status = shell::set_integration(shell, &home, enabled)?;
        tray::refresh(&app);
        Ok(status)
    })
    .await
}

/// Each editor's state for each agent hook, keyed by the agent's command. The hooks come from
/// `tools.ts`, so nothing here knows an agent's settings.
#[tauri::command]
async fn get_editor_status(
    app: AppHandle,
    hooks: std::collections::BTreeMap<String, IdeHook>,
) -> Result<Vec<EditorStatus>> {
    let home = home(&app)?;
    blocking(move || {
        Ok(Editor::ALL
            .iter()
            .flat_map(|&editor| {
                hooks
                    .iter()
                    .map(move |(command, hook)| (editor, command, hook))
            })
            .map(|(editor, command, hook)| editors::status(editor, &home, command, hook))
            .collect())
    })
    .await
}

/// Points an agent's editor extension at the shim, or stops it, in the editor's user settings.
#[tauri::command]
async fn set_editor_integration(
    app: AppHandle,
    editor: Editor,
    command: String,
    hook: IdeHook,
    enabled: bool,
) -> Result<EditorStatus> {
    let home = home(&app)?;
    blocking(move || {
        if enabled {
            shims::install_bundled(&home)?;
        }
        editors::set_integration(editor, &home, &command, &hook, enabled)
    })
    .await
}

/// Opens `shell` the way a new Terminal window would, in `folder`, and reports what
/// running `tool` there would do. Never runs the tool itself.
#[tauri::command]
async fn check_folder(
    app: AppHandle,
    shell: Shell,
    folder: String,
    tool: String,
) -> Result<FolderCheck> {
    let home = home(&app)?;
    blocking(move || shell::check_folder(shell, &home, Path::new(&folder), &tool)).await
}

/// Starts `server` (or connects to it) and lists its tools. `secrets` holds values typed since
/// the last save; the Keychain supplies the rest. Runs only when the user asks: it runs the
/// server's own command.
#[tauri::command]
async fn check_mcp_server(
    app: AppHandle,
    name: String,
    server: McpServer,
    secrets: HashMap<String, String>,
) -> Result<mcp_probe::ServerCheck> {
    let home = home(&app)?;
    let path = {
        let home = home.clone();
        blocking(move || shell::login_path(&home)).await?
    };
    let check = mcp_probe::check(&server, &secrets, &home, &path).await;
    if check.status == mcp_probe::CheckStatus::Ok && config::is_file_name(&name) {
        blocking(move || mcp_probe::remember(&home, &name, &server, &check.tools).map(|_| check))
            .await
    } else {
        Ok(check)
    }
}

/// The tools of each library server from its last check that worked, if its definition hasn't
/// changed since. The profile editor offers them for turning off.
#[tauri::command]
async fn get_mcp_tools(
    app: AppHandle,
) -> Result<std::collections::BTreeMap<String, Vec<mcp_probe::ToolInfo>>> {
    let home = home(&app)?;
    blocking(move || {
        let config = config::load_or_init(&paths::root(&home))?;
        Ok(mcp_probe::known_tools(&config, &home))
    })
    .await
}

/// MCP servers the agents already define in their own files, for the library to import. Only
/// reads them.
#[tauri::command]
async fn import_candidates(
    app: AppHandle,
    payload: ConfigState,
) -> Result<Vec<mcp_import::ImportCandidate>> {
    let home = home(&app)?;
    blocking(move || Ok(mcp_import::candidates(&payload, &home))).await
}

/// Opens a file in the user's default text editor, e.g. the startup file that defines an alias
/// shadowing the shim. Limited to existing files inside the home folder.
#[tauri::command]
async fn open_in_editor(app: AppHandle, path: String) -> Result<()> {
    let home = home(&app)?;
    blocking(move || {
        let file = std::fs::canonicalize(&path).map_err(|source| Error::Io {
            path: PathBuf::from(&path),
            source,
        })?;
        let home = std::fs::canonicalize(&home).unwrap_or(home);
        if !file.is_file() || !file.starts_with(&home) {
            return Err(Error::Invalid(format!(
                "{path} isn't a file in your home folder."
            )));
        }
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-t")
            .arg(&file)
            .status()
            .map_err(|err| Error::Command(format!("couldn't run open: {err}")))?;
        if status.success() {
            Ok(())
        } else {
            Err(Error::Command(format!("couldn't open {}", file.display())))
        }
    })
    .await
}

/// What the given, possibly unsaved, config would route for `tool` in `folder`.
#[tauri::command]
async fn preview_folder(
    app: AppHandle,
    payload: ConfigState,
    folder: String,
    tool: String,
) -> Result<Preview> {
    let home = home(&app)?;
    Ok(shell::preview(&payload, &home, Path::new(&folder), &tool))
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Refresh the installed shim after an app update. A failure here isn't fatal:
            // get_setup_status reports it and saving retries it.
            if let Ok(home) = home(app.handle()) {
                match shims::install_bundled(&home) {
                    // A new helper needs macOS's go-ahead before it can read the secrets.
                    Ok(true) => {
                        let uses_secrets = config::load(&paths::root(&home))
                            .ok()
                            .flatten()
                            .is_some_and(|config| !config::secret_ids(&config).is_empty());
                        if uses_secrets {
                            shims::ask_keychain_access(&home);
                        }
                    }
                    Ok(false) => {}
                    Err(err) => eprintln!("envrouter: couldn't install the shim: {err}"),
                }
            }
            tray::create(app.handle())?;
            Ok(())
        })
        // Closing the window keeps EnvRouter in the menu bar; Quit lives in its menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                tray::hide_window(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_setup_status,
            set_shell_integration,
            get_editor_status,
            set_editor_integration,
            check_folder,
            preview_folder,
            open_in_editor,
            check_mcp_server,
            get_mcp_tools,
            import_candidates
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // Clicking the Dock icon while the window is hidden.
        if let RunEvent::Reopen { .. } = event {
            tray::show_window(app);
        }
    });
}
