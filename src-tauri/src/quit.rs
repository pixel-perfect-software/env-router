//! Quitting with edits the window hasn't saved. The window says whenever it holds some
//! (`set_unsaved_edits`); a quit then waits for the window to ask the user, who either quits
//! (`quit_app`) or keeps editing. Quit from the menu bar, ⌘Q, and closing the window off macOS
//! all come through here. A window that holds nothing never hears about a quit, and asking
//! twice without an answer quits anyway, so a window that stopped responding can never keep
//! EnvRouter running.
//!
//! On macOS the app menu's own Quit can't be asked: the event loop handles only
//! `applicationWillTerminate`, so `terminate:` ends the process with no `ExitRequested`. The
//! app menu's Quit is EnvRouter's own item instead (`menu::app_menu`), which quits as the menu
//! bar's does. The Dock's Quit still terminates without asking.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::tray;

/// Sent to the window when a quit waits on its answer.
pub const QUIT_REQUESTED_EVENT: &str = "quit-requested";

/// The app menu's Quit, on macOS.
pub const APP_QUIT_ID: &str = "app-quit";

static GATE: Gate = Gate::new();

/// Whether a quit may go ahead now. If not, the window is shown and asked.
pub fn may_quit(app: &AppHandle) -> bool {
    if GATE.may_quit() {
        return true;
    }
    tray::show_window(app);
    let _ = app.emit(QUIT_REQUESTED_EVENT, ());
    false
}

/// The window's edits, saved or not. Also its answer "keep editing" to a quit, which a later
/// quit asks about again.
pub fn set_unsaved_edits(unsaved: bool) {
    GATE.set_unsaved(unsaved);
}

/// The user chose to quit without saving.
pub fn quit_app(app: &AppHandle) {
    GATE.set_unsaved(false);
    app.exit(0);
}

struct Gate {
    /// The window holds edits it hasn't saved.
    unsaved: AtomicBool,
    /// A quit is waiting for the window's answer.
    asked: AtomicBool,
}

impl Gate {
    const fn new() -> Self {
        Self {
            unsaved: AtomicBool::new(false),
            asked: AtomicBool::new(false),
        }
    }

    /// `true`: quit now. `false`: ask the window first, and quit on the next request if it
    /// hasn't answered by then.
    fn may_quit(&self) -> bool {
        !self.unsaved.load(Ordering::SeqCst) || self.asked.swap(true, Ordering::SeqCst)
    }

    fn set_unsaved(&self, unsaved: bool) {
        self.unsaved.store(unsaved, Ordering::SeqCst);
        self.asked.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::Gate;

    #[test]
    fn quits_at_once_with_nothing_unsaved() {
        let gate = Gate::new();
        assert!(gate.may_quit());
        gate.set_unsaved(true);
        gate.set_unsaved(false);
        assert!(gate.may_quit());
    }

    /// Quit from the menu bar, ⌘Q and closing the window off macOS used to end the app with
    /// unsaved edits and no question.
    #[test]
    fn asks_once_with_unsaved_edits_and_again_after_keep_editing() {
        let gate = Gate::new();
        gate.set_unsaved(true);
        assert!(!gate.may_quit());
        // The user kept editing: the window says so, and the next quit asks again.
        gate.set_unsaved(true);
        assert!(!gate.may_quit());
    }

    /// A window that never answers can't keep the app running: the second quit goes ahead.
    #[test]
    fn quits_on_a_second_request_the_window_never_answered() {
        let gate = Gate::new();
        gate.set_unsaved(true);
        assert!(!gate.may_quit());
        assert!(gate.may_quit());
    }
}
