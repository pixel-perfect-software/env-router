//! The menu bar icon and menu. The window is opened occasionally; the menu bar is where
//! EnvRouter stays visible, so its first line always says whether routing is on.

use envrouter_core::{config, paths};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{ActivationPolicy, AppHandle, Emitter, Manager, Wry};

use crate::shell::{self, Shell};

const TRAY_ID: &str = "main";

/// Emitted to the window when the menu's "Check Folder…" is chosen.
pub const CHECK_FOLDER_EVENT: &str = "check-folder";

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("EnvRouter")
        .menu(&menu(app, ("EnvRouter".into(), None))?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_window(app),
            "check" => {
                show_window(app);
                let _ = app.emit(CHECK_FOLDER_EVENT, ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    // The status lines ask zsh where its startup files live. That happens off the main
    // thread, so a slow `.zshenv` can't hold up launch.
    let handle = app.clone();
    std::thread::spawn(move || refresh(&handle));
    Ok(())
}

/// Rebuilds the menu after anything its status lines depend on changes.
pub fn refresh(app: &AppHandle) {
    let summary = summary(app);
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), menu(app, summary)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Brings the window back and puts the app in the Dock while it's open.
pub fn show_window(app: &AppHandle) {
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hides the window instead of closing it, and leaves only the menu bar icon.
pub fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let _ = app.set_activation_policy(ActivationPolicy::Accessory);
}

fn menu(app: &AppHandle, (status, profiles): (String, Option<String>)) -> tauri::Result<Menu<Wry>> {
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<Wry>>> = vec![Box::new(MenuItem::with_id(
        app,
        "status",
        status,
        false,
        None::<&str>,
    )?)];
    if let Some(profiles) = profiles {
        items.push(Box::new(MenuItem::with_id(
            app,
            "profiles",
            profiles,
            false,
            None::<&str>,
        )?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "check",
        "Check Folder…",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "open",
        "Open EnvRouter",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "quit",
        "Quit EnvRouter",
        true,
        Some("CmdOrCtrl+Q"),
    )?));
    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// The status line and, once there are profiles, how many.
fn summary(app: &AppHandle) -> (String, Option<String>) {
    let Ok(home) = app.path().home_dir() else {
        return ("EnvRouter".into(), None);
    };
    let count = match config::load(&paths::root(&home)) {
        Ok(config) => config.map_or(0, |config| config.profiles.len()),
        Err(_) => return ("Can't read config.json".into(), None),
    };
    if count == 0 {
        return ("Not set up yet".into(), None);
    }
    let on: Vec<&str> = Shell::ALL
        .iter()
        .filter(|&&shell| shell::status(shell, &home).installed)
        .map(|shell| shell.name())
        .collect();
    let status = if on.is_empty() {
        "Routing is off".to_string()
    } else {
        format!("Routing on in {}", on.join(", "))
    };
    let profiles = if count == 1 {
        "1 profile".to_string()
    } else {
        format!("{count} profiles")
    };
    (status, Some(profiles))
}
