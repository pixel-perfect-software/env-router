//! The menu bar on macOS: Tauri's default menu (App, File, Edit, View, Window, Help) with three
//! changes. The app menu's Quit is EnvRouter's own, so a quit can ask about unsaved edits (see
//! `quit`). It gains Settings… (⌘,) after About, as the Human Interface Guidelines place it;
//! there's no Preferences window (PRODUCT.md, principle 1), so it opens the Shells popover. And
//! the Help menu lists the `help::Link`s, which open in the browser without the window (a failure
//! shows in its banner, as the menu bar's reveals do). Linux has no menu bar at all: the window
//! follows the system's own title bar, and the same links are in the Shells popover.

/// The app menu's Settings…, on macOS.
pub const SETTINGS_ID: &str = "app-settings";

/// Sent to the window when Settings… is chosen: it opens the Shells popover. The key itself
/// reaches the window too off macOS, where there's no menu to take it (`useShortcuts`).
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";

#[cfg(target_os = "macos")]
pub fn app_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, HELP_SUBMENU_ID};

    use crate::help::Link;
    use crate::quit::APP_QUIT_ID;

    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() {
        // About, a separator, then Settings… and its own separator.
        app_submenu.insert(
            &MenuItem::with_id(app, SETTINGS_ID, "Settings…", true, Some("CmdOrCtrl+,"))?,
            2,
        )?;
        app_submenu.insert(&PredefinedMenuItem::separator(app)?, 3)?;
        if let Some(quit @ MenuItemKind::Predefined(_)) = app_submenu.items()?.pop() {
            app_submenu.remove(&quit)?;
            let name = &app.package_info().name;
            app_submenu.append(&MenuItem::with_id(
                app,
                APP_QUIT_ID,
                format!("Quit {name}"),
                true,
                Some("CmdOrCtrl+Q"),
            )?)?;
        }
    }
    if let Some(MenuItemKind::Submenu(help)) = menu.get(HELP_SUBMENU_ID) {
        for link in Link::ALL {
            help.append(&MenuItem::with_id(
                app,
                link.menu_id(),
                link.label(),
                true,
                None::<&str>,
            )?)?;
        }
    }
    Ok(menu)
}
