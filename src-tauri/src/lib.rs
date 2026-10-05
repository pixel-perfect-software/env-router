mod shell;
mod shims;

use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::{paths, Error, Result};
use serde::Serialize;
use tauri::{AppHandle, Manager};

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

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
        config::save(&paths::root(&home), &payload)?;
        shims::sync(&home, &payload)
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
        shell::set_integration(shell, &home, enabled)
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
    tauri::Builder::default()
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_config,
            save_config,
            get_setup_status,
            set_shell_integration,
            check_folder,
            preview_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
