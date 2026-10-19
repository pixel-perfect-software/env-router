mod tray;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState, IdeHook, McpServer};
use envrouter_core::{paths, Error, Result};
use tauri::{AppHandle, Manager, WindowEvent};

use envrouter_ops::commands::{self, SetupStatus};
use envrouter_ops::editors::{Editor, EditorStatus};
use envrouter_ops::shell::{self, FolderCheck, Preview, Shell, ShellStatus};
use envrouter_ops::{mcp_import, mcp_probe, shims};

// Each command is a wrapper over `envrouter_ops::commands`, which the CLI's `rpc` mode calls by
// the same names. Only the window's own concerns live here: the tray and the async runtime.

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
    blocking(move || commands::get_config(&home)).await
}

#[tauri::command]
async fn save_config(
    app: AppHandle,
    payload: ConfigState,
    secrets: HashMap<String, String>,
) -> Result<()> {
    let home = home(&app)?;
    blocking(move || {
        commands::save_config(&home, &payload, &secrets)?;
        tray::refresh(&app);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn get_setup_status(app: AppHandle) -> Result<SetupStatus> {
    let home = home(&app)?;
    blocking(move || commands::setup_status(&home)).await
}

#[tauri::command]
async fn set_shell_integration(app: AppHandle, shell: Shell, enabled: bool) -> Result<ShellStatus> {
    let home = home(&app)?;
    blocking(move || {
        let status = commands::set_shell_integration(&home, shell, enabled)?;
        tray::refresh(&app);
        Ok(status)
    })
    .await
}

/// The hooks come from `tools.ts`, so the window shows them before the config has them.
#[tauri::command]
async fn get_editor_status(
    app: AppHandle,
    hooks: BTreeMap<String, IdeHook>,
) -> Result<Vec<EditorStatus>> {
    let home = home(&app)?;
    blocking(move || Ok(commands::editor_status(&home, &hooks))).await
}

#[tauri::command]
async fn set_editor_integration(
    app: AppHandle,
    editor: Editor,
    command: String,
    hook: IdeHook,
    enabled: bool,
) -> Result<EditorStatus> {
    let home = home(&app)?;
    blocking(move || commands::set_editor_integration(&home, editor, &command, &hook, enabled))
        .await
}

#[tauri::command]
async fn check_folder(
    app: AppHandle,
    shell: Shell,
    folder: String,
    tool: String,
) -> Result<FolderCheck> {
    let home = home(&app)?;
    blocking(move || commands::check_folder(&home, shell, Path::new(&folder), &tool)).await
}

/// Runs only when the user asks: it runs the server's own command.
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
    commands::check_mcp_server(&home, &path, &name, &server, &secrets).await
}

#[tauri::command]
async fn get_mcp_tools(app: AppHandle) -> Result<BTreeMap<String, Vec<mcp_probe::ToolInfo>>> {
    let home = home(&app)?;
    blocking(move || commands::mcp_tools(&home)).await
}

#[tauri::command]
async fn import_candidates(
    app: AppHandle,
    payload: ConfigState,
) -> Result<Vec<mcp_import::ImportCandidate>> {
    let home = home(&app)?;
    blocking(move || Ok(commands::import_candidates(&home, &payload))).await
}

#[tauri::command]
async fn open_in_editor(app: AppHandle, path: String) -> Result<()> {
    let home = home(&app)?;
    blocking(move || commands::open_in_editor(&home, &path)).await
}

#[tauri::command]
async fn preview_folder(
    app: AppHandle,
    payload: ConfigState,
    folder: String,
    tool: String,
) -> Result<Preview> {
    let home = home(&app)?;
    Ok(commands::preview_folder(
        &home,
        &payload,
        Path::new(&folder),
        &tool,
    ))
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
        // On macOS, closing the window keeps EnvRouter in the menu bar; Quit lives in its menu.
        // Elsewhere closing quits: a Linux desktop may show no tray icon (GNOME has none by
        // default), and a hidden window would leave no way back.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(target_os = "macos") {
                    api.prevent_close();
                    tray::hide_window(window.app_handle());
                }
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

    app.run(|_app, _event| {
        // Clicking the Dock icon while the window is hidden.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            tray::show_window(_app);
        }
    });
}
