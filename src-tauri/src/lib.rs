mod help;
mod menu;
mod quit;
#[cfg(target_os = "macos")]
mod traffic_lights;
mod tray;

use std::collections::{BTreeMap, HashMap};
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use envrouter_core::config::{self, ConfigState, IdeHook, McpServer};
use envrouter_core::{paths, Error, Result};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use envrouter_ops::commands::{self, ConfigFault, Located, Place, SaveOutcome, SetupStatus};
use envrouter_ops::editors::{Editor, EditorStatus};
use envrouter_ops::shell::{self, FolderCheck, Preview, Shell, ShellStatus};
use envrouter_ops::uninstall::{Caller, UninstallReport};
use envrouter_ops::{mcp_import, mcp_probe, shims};

// Each command is a wrapper over `envrouter_ops::commands`, which the CLI's `rpc` mode calls by
// the same names. Only the window's own concerns live here: the tray and the async runtime.

/// Why nothing may touch the home folder once an uninstall has begun, and why a command can't
/// slip past it. A command asks [`home`] first, which counts it in until it finishes (the
/// [`Lease`] it returns travels with the home folder, so it lives as long as the command's
/// work). A real uninstall raises `uninstalled`, which turns every later command away, then
/// waits for the commands already counted in to finish before it deletes anything. So nothing
/// that began before it (a slow MCP check writing its tool list, a save queued on
/// `config.lock`, a shell toggle installing the helper) can recreate the folder afterwards,
/// and nothing that begins after it can either. A stopped uninstall lowers the flag, since the
/// setup is still there to use; a finished one leaves it up for good. The launch (`run`) and
/// the tray's refresh, which only reads, don't need it: a process starts with it down, and
/// relaunching the app after an uninstall is how someone sets EnvRouter up again.
struct Gate {
    state: Mutex<GateState>,
    idle: Condvar,
}

struct GateState {
    uninstalled: bool,
    /// Commands that have asked for the home folder and haven't finished.
    running: usize,
}

static GATE: Gate = Gate::new();

/// How long an uninstall waits for the commands already running. A check of an MCP server can
/// run longer; it is asked to wait for it rather than cut it off.
const DRAIN: Duration = Duration::from_secs(5);

fn uninstalled() -> Error {
    Error::Invalid("EnvRouter is uninstalled. Quit it to finish.".into())
}

/// A command in flight: counted by [`Gate::enter`], uncounted when dropped.
struct Lease(&'static Gate);

impl Drop for Lease {
    fn drop(&mut self) {
        self.0.lock().running -= 1;
        self.0.idle.notify_all();
    }
}

impl Gate {
    const fn new() -> Self {
        Self {
            state: Mutex::new(GateState {
                uninstalled: false,
                running: 0,
            }),
            idle: Condvar::new(),
        }
    }

    /// The state stays usable if a command panicked while holding the lock.
    fn lock(&self) -> MutexGuard<'_, GateState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether an uninstall is running or has finished: the window is saying so itself, and drops
    /// whatever else the menu bar would tell it.
    fn raised(&self) -> bool {
        self.lock().uninstalled
    }

    /// Counts a command in, or turns it away once an uninstall has begun.
    fn enter(&'static self) -> Result<Lease> {
        let mut state = self.lock();
        if state.uninstalled {
            return Err(uninstalled());
        }
        state.running += 1;
        Ok(Lease(self))
    }

    /// Runs `uninstall`, which holds a [`Lease`] itself. A plan only reads, so it runs as it is.
    /// A real run raises the flag, then waits up to `wait` for every other command to finish;
    /// if one doesn't, it lowers the flag again and says so without running. Afterwards the
    /// flag stays up only when the run finished. A second real run while it is up is refused.
    fn uninstall(
        &'static self,
        dry_run: bool,
        wait: Duration,
        uninstall: impl FnOnce() -> Result<UninstallReport>,
    ) -> Result<UninstallReport> {
        if dry_run {
            return uninstall();
        }
        let mut state = self.lock();
        if state.uninstalled {
            return Err(uninstalled());
        }
        state.uninstalled = true;
        let (mut state, timeout) = self
            .idle
            .wait_timeout_while(state, wait, |state| state.running > 1)
            .unwrap_or_else(PoisonError::into_inner);
        if timeout.timed_out() {
            state.uninstalled = false;
            return Err(Error::Invalid(
                "EnvRouter is still busy with something else, such as checking an MCP server. Wait for it to finish, then uninstall again."
                    .into(),
            ));
        }
        drop(state);
        let report = uninstall();
        if !report.as_ref().is_ok_and(UninstallReport::finished) {
            self.lock().uninstalled = false;
        }
        report
    }
}

/// The home folder, with the command that asked for it counted in until this is dropped.
struct Home {
    path: PathBuf,
    _lease: Lease,
}

impl Deref for Home {
    type Target = PathBuf;

    fn deref(&self) -> &PathBuf {
        &self.path
    }
}

/// What every command that touches the home folder asks first.
fn home(app: &AppHandle) -> Result<Home> {
    let lease = GATE.enter()?;
    let path = app.path().home_dir().map_err(|_| Error::NoHome)?;
    Ok(Home {
        path,
        _lease: lease,
    })
}

/// An uninstall has finished, so the app deletes its webview's folders as it exits ([`finish_uninstall`]).
static UNINSTALL_FINISHED: AtomicBool = AtomicBool::new(false);

/// Held for as long as the app runs, so `envrouter uninstall` can tell the window is open.
static APP_LOCK: OnceLock<envrouter_ops::uninstall::AppLock> = OnceLock::new();

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
    tauri::async_runtime::spawn_blocking(move || commands::read_config(&home))
        .await
        .map_err(|err| ConfigFault::from(Error::Command(err.to_string())))?
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
        let dir = home.to_path_buf();
        blocking(move || shell::login_path(&dir)).await?
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
        let dir = home.to_path_buf();
        blocking(move || shell::login_path(&dir)).await?
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

/// Shows what `commands::locate` found in the file manager: a file selected in its folder, a
/// folder opened. The opener's Rust API, not its plugin commands, so the window needs no
/// capability for it (see `capabilities/default.json`); and `locate` is why the window can't
/// ask for any other path. It takes no home folder, so no [`Lease`] is held while it waits: a
/// file manager that doesn't answer for a while mustn't make an uninstall refuse.
fn show_located(located: Located) -> Result<()> {
    let (path, shown) = match located {
        Located::File(path) => {
            let shown = tauri_plugin_opener::reveal_item_in_dir(&path);
            (path, shown)
        }
        Located::Folder(path) => {
            let shown = tauri_plugin_opener::open_path(&path, None::<&str>);
            (path, shown)
        }
    };
    shown.map_err(|err| Error::Command(format!("Couldn't show `{}`: {err}", path.display())))
}

/// Opens one of the help links in the browser. The window names it ([`help::Link`]) and never
/// gives an address, so it needs no permission from `capabilities/default.json`. Acts on the
/// machine the window runs on, so `envrouter rpc` doesn't serve it.
#[tauri::command]
async fn open_help(link: help::Link) -> Result<()> {
    blocking(move || help::open(link)).await
}

/// Acts on the machine the window runs on, so `envrouter rpc` doesn't serve it.
#[tauri::command]
async fn reveal_place(app: AppHandle, place: Place) -> Result<()> {
    let home = home(&app)?;
    // The home folder (and its lease) goes with the lookup; showing the place comes after.
    let located = blocking(move || commands::locate(&home, &place)).await?;
    blocking(move || show_located(located)).await
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

/// Turns routing off everywhere, deletes the stored MCP secrets and `~/.envrouter`, and names
/// the commands that remove the app and the CLI. The window quits after a finished run
/// ([`GATE`] keeps every other command from recreating the folder until then); a stop is a
/// report with problems, and running it again finishes the job.
#[tauri::command]
async fn uninstall(app: AppHandle, dry_run: bool) -> Result<UninstallReport> {
    let home = home(&app)?;
    let caller = Caller::App {
        exe: shims::current_exe()?,
        appimage: std::env::var_os("APPIMAGE")
            .filter(|path| !path.is_empty())
            .map(PathBuf::from),
    };
    blocking(move || {
        let report = GATE.uninstall(dry_run, DRAIN, || {
            commands::uninstall(&home, dry_run, &caller)
        })?;
        if !dry_run && report.finished() {
            UNINSTALL_FINISHED.store(true, Ordering::SeqCst);
        }
        tray::refresh(&app);
        Ok(report)
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
    reveal_place,
    open_help,
    check_mcp_server,
    npm_dist_tags,
    get_mcp_tools,
    import_candidates,
    parse_mcp_json,
    uninstall,
];

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::app_menu);
    let app = builder
        .setup(|app| {
            // Refresh the installed shim after an app update. A failure here isn't fatal:
            // get_setup_status reports it and saving retries it.
            if let Ok(home) = home(app.handle()) {
                match envrouter_ops::uninstall::hold_app_lock(&home) {
                    Ok(Some(lock)) => {
                        let _ = APP_LOCK.set(lock);
                    }
                    // Another window holds it, which says the same.
                    Ok(None) => {}
                    Err(err) => eprintln!("envrouter: couldn't mark the app as running: {err}"),
                }
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
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                traffic_lights::centre(&window.as_ref().window());
            }
            Ok(())
        })
        // ⌘Q quits through `AppHandle::exit`, so it asks first with unsaved edits (see `quit`).
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == quit::APP_QUIT_ID {
                app.exit(0);
            } else if id == menu::SETTINGS_ID {
                tray::show_window(app);
                let _ = app.emit(menu::OPEN_SETTINGS_EVENT, ());
            } else if let Some(link) = help::Link::from_menu_id(id) {
                tray::help_in_background(app, link);
            }
        })
        // On macOS, closing the window keeps EnvRouter in the menu bar; Quit lives in its menu.
        // Elsewhere closing quits: a Linux desktop may show no tray icon (GNOME has none by
        // default), and a hidden window would leave no way back. So there it asks first, as
        // quitting does, when the window holds unsaved edits.
        .on_window_event(|window, event| match event {
            // The events after which AppKit may lay the titlebar out again and put the buttons back
            // where it likes: a resize (leaving full screen is one), the window coming forward or
            // going back, a change of appearance, and a move, which may be to another display. The
            // app never sets the window's title, which is the other thing that does it.
            #[cfg(target_os = "macos")]
            WindowEvent::Resized(_)
            | WindowEvent::Moved(_)
            | WindowEvent::Focused(_)
            | WindowEvent::ThemeChanged(_)
            | WindowEvent::ScaleFactorChanged { .. } => {
                traffic_lights::centre(window);
            }
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
        tauri::RunEvent::Exit => finish_uninstall(app),
        _ => {}
    });
}

/// After a finished uninstall, deletes the webview's own folders as the app exits: until it quits
/// the webview holds them and writes them, so the uninstall itself leaves them. Nobody is left
/// to tell about a folder it can't delete, so that goes to stderr.
fn finish_uninstall(app: &AppHandle) {
    if !UNINSTALL_FINISHED.load(Ordering::SeqCst) {
        return;
    }
    let Ok(home) = app.path().home_dir() else {
        return;
    };
    let xdg_data_home = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from);
    for sentence in envrouter_ops::uninstall::remove_app_data(&home, xdg_data_home.as_deref()) {
        eprintln!("envrouter: {sentence}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A remote window (a WSL distro's, over `envrouter rpc`) must be able to make every call
    /// the local one makes, except opening or showing a file or a link, which would happen on the other
    /// machine, and quitting this app, which isn't the other machine's business.
    #[test]
    fn rpc_serves_every_window_command_but_the_local_ones() {
        const LOCAL: &[&str] = &[
            "open_in_editor",
            "reveal_place",
            "open_help",
            "set_unsaved_edits",
            "quit_app",
        ];
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

    fn report(problems: &[&str]) -> UninstallReport {
        use envrouter_ops::uninstall::{FolderStep, SecretsStep};
        UninstallReport {
            dry_run: false,
            shell_files: Vec::new(),
            editor_files: Vec::new(),
            secrets: SecretsStep::Deleted,
            folder: if problems.is_empty() {
                FolderStep::Deleted
            } else {
                FolderStep::NotReached
            },
            app_data: Vec::new(),
            app_data_left: Vec::new(),
            left: Vec::new(),
            problems: problems.iter().map(|p| (*p).to_string()).collect(),
            remove_next: Vec::new(),
        }
    }

    /// A gate of its own, so tests don't meet each other's flag.
    fn gate() -> &'static Gate {
        Box::leak(Box::new(Gate::new()))
    }

    /// A command that began before the uninstall can still write the folder, so the uninstall
    /// waits for it, and for no longer than it is willing to: past that it doesn't run at all.
    #[test]
    fn an_uninstall_waits_for_the_commands_already_running_and_otherwise_doesnt_run() {
        let gate = gate();
        let _mine = gate.enter().unwrap();
        let slow = gate.enter().unwrap();

        let busy = gate.uninstall(false, Duration::from_millis(50), || {
            panic!("it must not run beside a command in flight")
        });
        assert!(busy.unwrap_err().to_string().contains("still busy"));
        // Not finished, so it hands the window back.
        drop(gate.enter().unwrap());

        let finishing = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            drop(slow);
        });
        let done = gate.uninstall(false, Duration::from_secs(30), || {
            assert!(
                gate.enter().is_err(),
                "a command can't begin during the run"
            );
            Ok(report(&[]))
        });
        finishing.join().unwrap();
        assert!(done.unwrap().finished());
    }

    /// After a finished uninstall every command is refused, so a refocus can't recreate the
    /// folder; the flag is already up while it runs, and a stop gives the window back.
    #[test]
    fn the_flag_is_up_while_uninstalling_and_stays_up_only_once_finished() {
        let gate = gate();
        let _mine = gate.enter().unwrap();
        let wait = Duration::from_secs(30);
        assert!(gate.enter().is_ok());

        assert!(!gate.raised());
        let stopped = gate.uninstall(false, wait, || {
            assert!(gate.enter().is_err());
            assert!(gate.raised());
            Ok(report(&["Stopped."]))
        });
        assert!(!stopped.unwrap().finished());
        assert!(gate.enter().is_ok());
        assert!(!gate.raised());

        gate.uninstall(false, wait, || Err(Error::NoHome))
            .unwrap_err();
        assert!(gate.enter().is_ok());

        gate.uninstall(true, wait, || Ok(report(&[]))).unwrap();
        assert!(gate.enter().is_ok());

        assert!(gate
            .uninstall(false, wait, || Ok(report(&[])))
            .unwrap()
            .finished());
        assert!(gate.raised());
        let again = gate.uninstall(false, wait, || panic!("a second run must not start"));
        // The words `src/dev/mockTauri.ts` repeats.
        for refused in [again.unwrap_err(), gate.enter().err().unwrap()] {
            assert_eq!(
                refused.to_string(),
                "EnvRouter is uninstalled. Quit it to finish."
            );
        }
    }
}
