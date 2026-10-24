mod quit;
mod tray;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState, IdeHook, McpServer};
use envrouter_core::{paths, Error, Result};
use tauri::{AppHandle, Manager, WindowEvent};

use envrouter_ops::commands::{self, ConfigFault, SaveOutcome, SetupStatus};
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

/// Rejects with the kind of failure as well as its message (`ConfigFault`), unlike the other
/// commands, because the window offers Start Over only for a file that won't parse.
#[tauri::command]
async fn get_config(app: AppHandle) -> std::result::Result<ConfigState, ConfigFault> {
    let home = home(&app)?;
    Ok(blocking(move || commands::get_config(&home)).await?)
}

#[tauri::command]
async fn save_config(
    app: AppHandle,
    payload: ConfigState,
    secrets: HashMap<String, String>,
    base: Option<ConfigState>,
) -> Result<SaveOutcome> {
    let home = home(&app)?;
    blocking(move || {
        let outcome = commands::save_config(&home, &payload, &secrets, base.as_ref())?;
        tray::refresh(&app);
        Ok(outcome)
    })
    .await
}

#[tauri::command]
async fn reset_unreadable_config(app: AppHandle) -> Result<PathBuf> {
    let home = home(&app)?;
    blocking(move || {
        let backup = commands::reset_unreadable_config(&home)?;
        tray::refresh(&app);
        Ok(backup)
    })
    .await
}

#[tauri::command]
async fn get_setup_status(app: AppHandle) -> Result<SetupStatus> {
    let home = home(&app)?;
    // The window reads this whenever it gains focus; the menu bar catches up from the same answer.
    blocking(move || {
        let status = commands::setup_status(&home)?;
        tray::refresh_from(&app, &status);
        Ok(status)
    })
    .await
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
async fn npm_dist_tags(
    app: AppHandle,
    command: String,
    package: String,
) -> Result<BTreeMap<String, String>> {
    let home = home(&app)?;
    let path = {
        let home = home.clone();
        blocking(move || shell::login_path(&home)).await?
    };
    commands::npm_dist_tags(&home, &path, &command, &package).await
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
fn parse_mcp_json(text: &str) -> Result<mcp_import::Pasted> {
    commands::parse_mcp_json(text)
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
    blocking(move || {
        Ok(commands::preview_folder(
            &home,
            &payload,
            Path::new(&folder),
            &tool,
        ))
    })
    .await
}

/// Whether the window holds edits it hasn't saved, so quitting asks first. See `quit`.
#[tauri::command]
fn set_unsaved_edits(unsaved: bool) {
    quit::set_unsaved_edits(unsaved);
}

/// Quits without saving, once the user has said so.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri hands a command its arguments by value"
)]
fn quit_app(app: AppHandle) {
    quit::quit_app(&app);
}

/// Lists the window's commands once, for Tauri's handler and for the test that holds
/// `envrouter rpc` to the same set.
macro_rules! window_commands {
    ($($command:ident),* $(,)?) => {
        #[cfg(test)]
        const WINDOW_COMMANDS: &[&str] = &[$(stringify!($command)),*];

        fn invoke_handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
            tauri::generate_handler![$($command),*]
        }
    };
}

window_commands![
    get_config,
    set_unsaved_edits,
    quit_app,
    save_config,
    reset_unreadable_config,
    get_setup_status,
    set_shell_integration,
    get_editor_status,
    set_editor_integration,
    check_folder,
    preview_folder,
    open_in_editor,
    check_mcp_server,
    npm_dist_tags,
    get_mcp_tools,
    import_candidates,
    parse_mcp_json,
];

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.menu(quit::app_menu);
    let app = builder
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
        // ⌘Q quits through `AppHandle::exit`, so it asks first with unsaved edits (see `quit`).
        .on_menu_event(|app, event| {
            if event.id() == quit::APP_QUIT_ID {
                app.exit(0);
            }
        })
        // On macOS, closing the window keeps EnvRouter in the menu bar; Quit lives in its menu.
        // Elsewhere closing quits: a Linux desktop may show no tray icon (GNOME has none by
        // default), and a hidden window would leave no way back. So there it asks first, as
        // quitting does, when the window holds unsaved edits.
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } if cfg!(target_os = "macos") => {
                api.prevent_close();
                tray::hide_window(window.app_handle());
            }
            // The guard has a side effect: with unsaved edits, it shows the window and asks.
            WindowEvent::CloseRequested { api, .. } if !quit::may_quit(window.app_handle()) => {
                api.prevent_close();
            }
            _ => {}
        })
        .invoke_handler(invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| match event {
        // ⌘Q, Quit from the menu bar (`AppHandle::exit`), or the last window closing. The guard
        // has a side effect: with unsaved edits, it shows the window and asks.
        tauri::RunEvent::ExitRequested { api, .. } if !quit::may_quit(app) => api.prevent_exit(),
        // Clicking the Dock icon while the window is hidden.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => tray::show_window(app),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A remote window (a WSL distro's, over `envrouter rpc`) must be able to make every call
    /// the local one makes, except opening a file, which would open it on the other machine,
    /// and quitting this app, which isn't the other machine's business.
    #[test]
    fn rpc_serves_every_window_command_but_the_local_ones() {
        const LOCAL: &[&str] = &["open_in_editor", "set_unsaved_edits", "quit_app"];
        let mut window: Vec<&str> = WINDOW_COMMANDS
            .iter()
            .copied()
            .filter(|command| !LOCAL.contains(command))
            .collect();
        let mut served = envrouter_ops::rpc::COMMANDS.to_vec();
        window.sort_unstable();
        served.sort_unstable();
        assert_eq!(window, served);
    }
}
