mod shell;
mod shims;
mod tray;

use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::{paths, Error, Result};
use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

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

/// Validates and saves the config, then updates the shims to match. Changes apply to the
/// next run of each tool in every terminal; nothing needs reloading.
#[tauri::command]
async fn save_config(app: AppHandle, payload: ConfigState) -> Result<()> {
    let home = home(&app)?;
    blocking(move || {
        config::validate(&payload, &home)?;
        shims::install_binary(&home, &shims::bundled()?)?;
        // Only inside home: a typo'd absolute path shouldn't create folders elsewhere.
        for dir in config::tool_dirs(&payload, &home) {
            if dir.starts_with(&home) && !dir.exists() {
                std::fs::create_dir_all(&dir).map_err(|source| Error::Io { path: dir, source })?;
            }
        }
        config::save(&paths::root(&home), &payload)?;
        shims::sync(&home, &payload)?;
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
            shim_installed: shims::is_installed(&home, &shims::bundled()?),
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
            shims::install_binary(&home, &shims::bundled()?)?;
        }
        let status = shell::set_integration(shell, &home, enabled)?;
        tray::refresh(&app);
        Ok(status)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Refresh the installed shim after an app update. A failure here isn't fatal:
            // get_setup_status reports it and saving retries it.
            if let Ok(home) = home(app.handle()) {
                if let Err(err) =
                    shims::bundled().and_then(|bundled| shims::install_binary(&home, &bundled))
                {
                    eprintln!("envrouter: couldn't install the shim: {err}");
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
            check_folder,
            preview_folder,
            open_in_editor
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
