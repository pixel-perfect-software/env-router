//! The menu bar icon and menu. The window is opened occasionally; the menu bar is where
//! EnvRouter stays visible, so its first line always says whether routing is on.

use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::OnceLock;

use envrouter_core::{config, paths};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri::{AppHandle, Emitter, Manager, Wry};

use envrouter_ops::commands::SetupStatus;
use envrouter_ops::shell::{self, Shell};

const TRAY_ID: &str = "main";

/// Emitted to the window when the menu's "Check Folder…" is chosen.
pub const CHECK_FOLDER_EVENT: &str = "check-folder";

/// Decoded at compile time, so the app needs no PNG decoder at runtime.
const ICON: Image<'static> = tauri::include_image!("icons/tray.png");
// `include_image!` embeds a decoded copy from `OUT_DIR`, so Cargo wouldn't notice the PNG
// itself change; this makes it a dependency of the crate, at no cost to the binary.
const _: &[u8] = include_bytes!("../icons/tray.png");

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(ICON)
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
        // The pointer reaching the icon is the warning a click is coming, so the menu catches
        // up with changes made outside the window (the CLI, a hand edit) before it opens.
        // macOS and Windows report it; a Linux tray doesn't, so there the window's focus does.
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Enter { .. } = event {
                refresh_in_background(tray.app_handle());
            }
        })
        .build(app)?;
    refresh_in_background(app);
    Ok(())
}

/// The one thread that refreshes in the background, fed by a channel of one: an ask while it
/// runs queues a single refresh after it, and any more are dropped, so hovering the icon never
/// piles up probes or lets an older answer land last.
static REFRESHER: OnceLock<SyncSender<()>> = OnceLock::new();

/// [`refresh`] off the main thread: the status lines ask zsh where its startup files live, and
/// a slow `.zshenv` mustn't hold up launch or the menu bar.
pub fn refresh_in_background(app: &AppHandle) {
    let refresher = REFRESHER.get_or_init(|| {
        let (asks, asked) = sync_channel::<()>(1);
        let handle = app.clone();
        std::thread::spawn(move || {
            while asked.recv().is_ok() {
                refresh(&handle);
            }
        });
        asks
    });
    let _ = refresher.try_send(());
}

/// Rebuilds the menu after anything its status lines depend on changes.
pub fn refresh(app: &AppHandle) {
    let home = app.path().home_dir().ok();
    let on = Shell::ALL.into_iter().filter(move |&shell| {
        home.as_deref()
            .is_some_and(|home| shell::status(shell, home).installed)
    });
    set_menu(app, summary(app, on));
}

/// [`refresh`] from a status the window just read, so its focus doesn't probe the shells twice.
pub fn refresh_from(app: &AppHandle, status: &SetupStatus) {
    let on = status
        .shells
        .iter()
        .filter(|s| s.installed)
        .map(|s| s.shell);
    set_menu(app, summary(app, on));
}

fn set_menu(app: &AppHandle, summary: (String, Option<String>)) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), menu(app, summary)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Brings the window back, and on macOS puts the app in the Dock while it's open.
pub fn show_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hides the window instead of closing it, and on macOS leaves only the menu bar icon.
pub fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
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
        items.iter().map(std::convert::AsRef::as_ref).collect();
    Menu::with_items(app, &refs)
}

/// The status line and, once there are profiles, how many.
/// The status lines, given the shells routing is on in (asked lazily: not when nothing's set up).
fn summary(app: &AppHandle, on: impl Iterator<Item = Shell>) -> (String, Option<String>) {
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
    let on: Vec<&str> = on.map(Shell::name).collect();
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
