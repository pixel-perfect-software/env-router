//! Leaves the machine as if EnvRouter had never been installed, except for the app and the CLI,
//! which can't remove themselves: it names the commands that do.
//!
//! The order is the point. Undo the reversible things first and do the irreversible ones only
//! when everything before them worked:
//! 1. Turn off every shell block.
//! 2. Turn off every editor wrapper, in user settings and in remote servers' machine settings.
//! 3. Delete the secret store item, with all its parts.
//! 4. Delete `~/.envrouter`.
//! 5. Delete the folders the app's webview and the system keep for it (`platform::app_data_dirs`),
//!    unless the app is the one uninstalling: its webview still holds them and writes them until
//!    it quits, so it deletes them itself as it exits ([`remove_app_data`]).
//!
//! Step 5 is housekeeping after the setup is gone, so a folder it can't delete never undoes the
//! run: the report is still [`finished`](UninstallReport::finished) and says what is left in
//! `app_data_left`.
//!
//! A problem in 1 or 2 stops the run before 3, so no wrapper is ever left pointing at a deleted
//! shim and no secret is lost while the setup still works. A store that can't be reached at all
//! doesn't stop it, but one that is reachable and won't delete does. Every step is idempotent,
//! so running it again after a stop finishes the job. Nothing here reads the config through
//! `get_config` or `load_or_init`, which would create the folder this removes.

use std::fs::{self, File, TryLockError};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use envrouter_core::platform::{self, AppFound, Platform, XdgHomes};
use envrouter_core::{agents, config, paths, Error, Result};
use serde::Serialize;

use crate::editors::{self, Editor};
use crate::shell;
use crate::shims;

/// What an uninstall did, or with `dry_run` would do. Mirrored by `UninstallReport` in
/// `src/lib/types.ts`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallReport {
    pub dry_run: bool,
    /// The startup files that held EnvRouter's block.
    pub shell_files: Vec<String>,
    /// The settings that named the shim.
    pub editor_files: Vec<EditorFile>,
    pub secrets: SecretsStep,
    pub folder: FolderStep,
    /// The app's webview folders it deleted (or would), the ones that were there.
    pub app_data: Vec<String>,
    /// The app's webview folders it couldn't delete or wouldn't touch, one sentence each, worded
    /// like `problems`. They don't stop the run: the setup is gone either way.
    pub app_data_left: Vec<String>,
    /// Links it deleted whose targets it left alone, such as where a linked `~/.envrouter` points.
    pub left: Vec<Left>,
    /// Why it stopped, one sentence each, worded to show as it is, with the paths and setting names in
    /// backticks (the window sets those in mono; the CLI prints them as they are). Empty when it went through.
    pub problems: Vec<String>,
    pub remove_next: Vec<RemoveNext>,
}

impl UninstallReport {
    /// A real run that did everything: nothing is left but the app and the CLI.
    pub fn finished(&self) -> bool {
        !self.dry_run
            && self.problems.is_empty()
            && matches!(self.folder, FolderStep::Deleted | FolderStep::Absent)
    }
}

/// A link that was deleted without its target.
#[derive(Debug, PartialEq, Serialize)]
pub struct Left {
    pub link: String,
    pub target: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFile {
    pub editor: Editor,
    pub settings_file: String,
    pub setting: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SecretsStep {
    Deleted,
    WouldDelete,
    /// An earlier step stopped the run.
    NotReached,
    /// The store can't be used from here (no Secret Service, WSL without interop), so any secrets
    /// EnvRouter kept there are still in it.
    Unreachable {
        reason: String,
    },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderStep {
    Deleted,
    WouldDelete,
    Absent,
    NotReached,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct RemoveNext {
    pub what: Removable,
    pub command: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Removable {
    App,
    Cli,
}

/// What the secret store item is called in the platform's own tools, for a sentence that sends
/// someone there.
pub const SECRETS_ITEM: &str = envrouter_keychain::SERVICE;

/// Who is uninstalling, which decides what it can't remove from where it runs.
pub enum Caller {
    /// The desktop app: its executable, and the AppImage it runs from, if it does (`APPIMAGE`,
    /// read where the app starts, not here).
    App {
        exe: PathBuf,
        appimage: Option<PathBuf>,
    },
    /// `envrouter` itself, or `envrouter rpc` for a window on another machine.
    Cli { exe: PathBuf },
}

/// The secret store, or a stand-in in tests, which mustn't touch the real one.
pub(crate) trait Store {
    /// Gets the store ready for a real run.
    fn prepare(&self, home: &Path);
    /// Whether [`prepare`](Store::prepare) would make a store that can't be used now usable, so
    /// a plan, which prepares nothing, can say what the real run will find.
    fn prepare_would_help(&self, home: &Path) -> bool;
    /// Why the store can't be used, or `None`.
    fn problem(&self, home: &Path) -> Option<String>;
    fn delete(&self, home: &Path) -> Result<()>;
    /// Asks the system to forget the preferences `domain` (macOS's `cfprefsd` caches them, and
    /// can write a deleted plist back). Best effort: the plist is deleted too.
    fn forget_preferences(&self, domain: &str);
}

pub(crate) struct Keychain;

impl Store for Keychain {
    /// In WSL the store is the Windows Credential Manager, reached through the helper in
    /// `~/.envrouter/bin`. It's installed from the bundle if it's gone, before the folder that
    /// holds it is. Without one the delete fails with its own reason, so the error is no loss.
    fn prepare(&self, home: &Path) {
        if helper_missing(home) {
            let _ = shims::install_bundled(home);
        }
    }

    fn prepare_would_help(&self, home: &Path) -> bool {
        helper_missing(home)
            && shims::bundled_windows_keychain().is_ok_and(|helper| helper.is_file())
    }

    fn problem(&self, home: &Path) -> Option<String> {
        envrouter_keychain::problem(home)
    }

    fn delete(&self, home: &Path) -> Result<()> {
        envrouter_keychain::delete(home)
    }

    /// `defaults delete`, which says "does not exist" for a domain nothing wrote: that is as good
    /// as forgotten, like any other failure, since the plist file is deleted next.
    fn forget_preferences(&self, domain: &str) {
        let _ = std::process::Command::new("/usr/bin/defaults")
            .args(["delete", domain])
            .output();
    }
}

/// Whether the store is reached through a helper in `~/.envrouter/bin` that isn't there.
fn helper_missing(home: &Path) -> bool {
    Platform::current().secret_store_runs_installed_helper()
        && !paths::windows_keychain_helper(home).exists()
}

/// The window's hold on `app.lock`. Dropping it unlocks rather than leaving that to the close:
/// a process forked meanwhile shares the open file until it execs, and the lock with it, so a
/// close alone can leave the lock held for a moment after the window let go.
#[derive(Debug)]
pub struct AppLock(File);

impl Drop for AppLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

/// Holds the lock that tells `envrouter uninstall` the window is open, until the returned lock
/// is dropped or the process ends (the system releases it, so a crash leaves nothing stale).
/// `None` when another window already holds it. The desktop app calls this at launch; its own
/// uninstall doesn't check it, which is why only [`Caller::Cli`] is refused.
///
/// Deleting `~/.envrouter` while it is held is fine: the lock belongs to the open file.
pub fn hold_app_lock(home: &Path) -> Result<Option<AppLock>> {
    let path = paths::app_lock(home);
    let io_err = |source| Error::Io {
        path: path.clone(),
        source,
    };
    fs::create_dir_all(paths::root(home)).map_err(io_err)?;
    let file = File::options()
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(io_err)?;
    match file.try_lock() {
        Ok(()) => Ok(Some(AppLock(file))),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(source)) => Err(io_err(source)),
    }
}

/// Whether a window holds [`hold_app_lock`] on this home. Never creates the file. A window on
/// another machine (WSL's, once Windows has one) holds its own home's, not this distro's, so it
/// is never mistaken for one here.
fn app_is_running(home: &Path) -> bool {
    File::open(paths::app_lock(home))
        .is_ok_and(|file| matches!(file.try_lock_shared(), Err(TryLockError::WouldBlock)))
}

/// A real uninstall from the CLI (or over rpc) while the window is open would be undone by the
/// window's next refocus, which reads the config and so creates `~/.envrouter` again. So it
/// stops before changing anything. The window's own uninstall holds the lock itself, and
/// guards the folder in `home()` instead.
pub fn refuse_while_app_runs(home: &Path, caller: &Caller) -> Result<()> {
    if matches!(caller, Caller::Cli { .. }) && app_is_running(home) {
        let how = match Platform::current() {
            Platform::MacOs => "choose Quit in its menu bar icon's menu",
            _ => "close its window",
        };
        return Err(Error::Invalid(format!(
            "Quit EnvRouter first ({how}), then run envrouter uninstall again."
        )));
    }
    Ok(())
}

/// Runs the steps, or with `dry_run` reports what they would do, changing nothing. `app_data`
/// is what step 5 deletes: nothing when the app is the caller. `remove_next` is left for the
/// caller to fill.
pub(crate) fn run(
    home: &Path,
    dry_run: bool,
    store: &dyn Store,
    app_data: &AppData,
) -> Result<UninstallReport> {
    let root = paths::root(home);
    // The lock creates its file, and the folder if it's missing: a plan changes nothing, so it
    // takes none, and a real run locks only a folder that's there.
    let _lock = (!dry_run && root.exists())
        .then(|| config::lock(&root))
        .transpose()?;

    let (shell_files, mut problems) = shell::remove_every_block(home, dry_run);
    let (editor_files, editor_problems) = remove_every_wrapper(home, dry_run);
    for problem in editor_problems {
        if !problems.contains(&problem) {
            problems.push(problem);
        }
    }
    let mut report = UninstallReport {
        dry_run,
        shell_files: shell_files
            .iter()
            .map(|file| file.display().to_string())
            .collect(),
        editor_files,
        secrets: SecretsStep::NotReached,
        folder: FolderStep::NotReached,
        app_data: Vec::new(),
        app_data_left: Vec::new(),
        left: Vec::new(),
        problems,
        remove_next: Vec::new(),
    };
    // A wrapper that might stay behind must stay valid, so nothing irreversible happens.
    if !report.problems.is_empty() {
        return Ok(report);
    }

    match secrets_step(home, dry_run, store) {
        Ok(step) => report.secrets = step,
        Err(problem) => {
            report.problems.push(problem);
            return Ok(report);
        }
    }
    match folder_step(home, dry_run, &mut report.left) {
        Ok(step) => report.folder = step,
        Err(problem) => {
            report.problems.push(problem);
            return Ok(report);
        }
    }
    (report.app_data, report.app_data_left) =
        app_data_step(app_data, dry_run, store, &mut report.left);
    Ok(report)
}

/// What step 5 is asked to do.
#[derive(Debug, Default)]
pub struct AppData {
    /// The folders and files to delete.
    pub delete: Vec<PathBuf>,
    /// Folders that would be the app's if they exist but lie outside the home folder, which an
    /// environment variable pointed at: named, never deleted.
    pub outside: Vec<PathBuf>,
    /// The preferences domain the system caches (see [`Store::forget_preferences`]).
    pub preferences: Option<&'static str>,
}

impl AppData {
    /// What `platform` keeps for the app under `home`. `xdg` is what the caller read of
    /// `$XDG_DATA_HOME` and `$XDG_CONFIG_HOME`, which the platform code only trusts inside `home`.
    pub fn of(platform: Platform, home: &Path, xdg: &XdgHomes) -> Self {
        Self {
            delete: platform::app_data_dirs(platform, home),
            outside: platform::app_dirs_outside_home(platform, home, xdg),
            preferences: platform::preferences_domain(platform),
        }
    }

    /// The same, for a caller that can't delete these itself: it still says which are outside.
    pub fn named_only(self) -> Self {
        Self {
            delete: Vec::new(),
            preferences: None,
            ..self
        }
    }
}

/// What the app deletes of its own as it exits after a finished uninstall, when its webview
/// has let go. Returns a sentence for each folder it couldn't delete.
pub fn remove_app_data(home: &Path, xdg: &XdgHomes) -> Vec<String> {
    let mut app_data = AppData::of(Platform::current(), home, xdg);
    // The uninstall's report already named these.
    app_data.outside.clear();
    app_data_step(&app_data, false, &Keychain, &mut Vec::new()).1
}

/// Every editor, for every setting an agent's hook names: the registry's, and those of a saved
/// config that still loads, which may name one the registry has dropped.
fn remove_every_wrapper(home: &Path, dry_run: bool) -> (Vec<EditorFile>, Vec<String>) {
    let mut settings: Vec<String> = Vec::new();
    let saved = config::load(&paths::root(home)).ok().flatten();
    let hooks = agents::known()
        .into_iter()
        .filter_map(|agent| agent.def.ide)
        .chain(
            saved
                .into_iter()
                .flat_map(|config| config.agents.into_values())
                .filter_map(|agent| agent.ide),
        );
    for hook in hooks {
        if !settings.contains(&hook.setting) {
            settings.push(hook.setting);
        }
    }

    let mut cleared = Vec::new();
    let mut problems = Vec::new();
    for editor in Editor::ALL {
        for setting in &settings {
            match editors::clear_ours(editor, home, setting, dry_run) {
                Ok(false) => {}
                Ok(true) => cleared.push(EditorFile {
                    editor,
                    settings_file: editor.settings_file(home).display().to_string(),
                    setting: setting.clone(),
                }),
                Err(err) => {
                    let problem = match err {
                        Error::Invalid(sentence) => sentence,
                        other => format!(
                            "Couldn't clear `{setting}` in `{}`: {}. Fix that, then uninstall again.",
                            editor.settings_file(home).display(),
                            reason(&other)
                        ),
                    };
                    if !problems.contains(&problem) {
                        problems.push(problem);
                    }
                }
            }
        }
    }
    (cleared, problems)
}

/// Step 3. `Err` is the problem that stops the run.
fn secrets_step(
    home: &Path,
    dry_run: bool,
    store: &dyn Store,
) -> std::result::Result<SecretsStep, String> {
    if dry_run {
        // A real run prepares the store first; a plan changes nothing, so it counts on that.
        if store.prepare_would_help(home) {
            return Ok(SecretsStep::WouldDelete);
        }
    } else {
        store.prepare(home);
    }
    if let Some(reason) = store.problem(home) {
        return Ok(SecretsStep::Unreachable { reason });
    }
    if dry_run {
        return Ok(SecretsStep::WouldDelete);
    }
    // No read first: the store may ask for access, and once is enough.
    match store.delete(home) {
        Ok(()) => Ok(SecretsStep::Deleted),
        Err(err) => Err(format!(
            "{err} `~/.envrouter` is still there: remove `{}` from the {} yourself if this keeps failing, then run uninstall again.",
            SECRETS_ITEM,
            Platform::current().secret_store_name()
        )),
    }
}

/// Step 4.
fn folder_step(
    home: &Path,
    dry_run: bool,
    left: &mut Vec<Left>,
) -> std::result::Result<FolderStep, String> {
    let root = paths::root(home);
    match remove_entry(&root, dry_run, left) {
        Ok(Entry::Absent) => Ok(FolderStep::Absent),
        Ok(Entry::Found) if dry_run => Ok(FolderStep::WouldDelete),
        Ok(Entry::Found) => Ok(FolderStep::Deleted),
        Err(why) => Err(cant_delete(&root, &why)),
    }
}

/// Step 5. Every folder is tried; what couldn't be deleted is a sentence in the second list, not
/// a problem. Returns the folders that were there. The preferences are forgotten before their
/// plist is looked at, so the plist counts as there even if the system removed it meanwhile.
fn app_data_step(
    app_data: &AppData,
    dry_run: bool,
    store: &dyn Store,
    left: &mut Vec<Left>,
) -> (Vec<String>, Vec<String>) {
    let mut found = Vec::new();
    let mut sentences = Vec::new();
    let plist = app_data.preferences.map(|domain| format!("{domain}.plist"));
    for folder in &app_data.delete {
        let is_plist = plist
            .as_deref()
            .is_some_and(|name| folder.file_name().is_some_and(|file| file == name));
        let was_there = is_plist && fs::symlink_metadata(folder).is_ok();
        if let Some(domain) = app_data.preferences.filter(|_| is_plist && !dry_run) {
            store.forget_preferences(domain);
        }
        match remove_entry(folder, dry_run, left) {
            Ok(Entry::Found) => found.push(folder.display().to_string()),
            Ok(Entry::Absent) if was_there => found.push(folder.display().to_string()),
            Ok(Entry::Absent) => {}
            Err(why) => sentences.push(format!(
                "Couldn't delete `{}`: {why}. Delete it yourself.",
                folder.display()
            )),
        }
    }
    for folder in &app_data.outside {
        if fs::symlink_metadata(folder).is_ok() {
            sentences.push(format!(
                "Didn't delete `{}`: it's outside your home folder. Delete it yourself.",
                folder.display()
            ));
        }
    }
    (found, sentences)
}

/// What [`remove_entry`] found.
enum Entry {
    Absent,
    /// There, and gone unless it was a dry run.
    Found,
}

/// Deletes `path`, a folder with everything in it, a file, or a link on its own (its target is
/// recorded in `left` and stays). Missing is fine. `Err` is why it couldn't be, worded to follow
/// "Couldn't delete `path`:".
fn remove_entry(
    path: &Path,
    dry_run: bool,
    left: &mut Vec<Left>,
) -> std::result::Result<Entry, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(Entry::Absent),
        Err(err) => return Err(err.to_string()),
    };
    if meta.is_symlink() {
        if let Ok(target) = fs::canonicalize(path) {
            left.push(Left {
                link: path.display().to_string(),
                target: target.display().to_string(),
            });
        }
    }
    if dry_run {
        return Ok(Entry::Found);
    }
    let removed = if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match removed {
        Err(err) if err.kind() != ErrorKind::NotFound => Err(err.to_string()),
        _ => Ok(Entry::Found),
    }
}

fn cant_delete(root: &Path, why: &str) -> String {
    format!(
        "Couldn't delete `{}`: {why}. Fix that, then uninstall again.",
        root.display()
    )
}

/// The sentence for a startup file that couldn't be cleaned.
pub(crate) fn cant_remove_lines(file: &Path, why: &str) -> String {
    format!(
        "Couldn't remove EnvRouter's lines from `{}`: {why}. Fix that, then uninstall again.",
        file.display()
    )
}

/// What went wrong without the path an I/O error already names, for a sentence that names it.
pub(crate) fn reason(err: &Error) -> String {
    match err {
        Error::Io { source, .. } => source.to_string(),
        other => other.to_string(),
    }
}

/// The commands that remove what EnvRouter can't remove from itself: the caller's own install
/// and, as far as it can tell, the other one's. Looks only outside `~/.envrouter`, which is gone.
pub fn remove_next(platform: Platform, home: &Path, caller: &Caller) -> Vec<RemoveNext> {
    match caller {
        Caller::App { exe, appimage } => {
            let exe = canonical(exe);
            let bundle = exe
                .ancestors()
                .find(|dir| dir.extension().is_some_and(|ext| ext == "app"));
            let app = AppFound {
                bundle,
                cask: bundle.is_some() && cask_installed(),
                appimage: appimage.as_deref(),
                deb: exe == Path::new(platform::DEB_BINARY),
            };
            let cli = if homebrew_cli_installed() {
                Cli::Keg
            } else {
                Cli::Gone
            };
            removal(platform, &app, &cli)
        }
        Caller::Cli { exe } => {
            let roots = [paths::root(home), paths::root(&canonical(home))];
            let bundle = [
                PathBuf::from("/Applications/EnvRouter.app"),
                home.join("Applications/EnvRouter.app"),
            ]
            .into_iter()
            .find(|bundle| bundle.is_dir());
            let app = AppFound {
                bundle: bundle.as_deref(),
                cask: cask_installed(),
                appimage: None,
                deb: Path::new(platform::DEB_BINARY).is_file(),
            };
            removal(platform, &app, &cli_found(&canonical(exe), &roots))
        }
    }
}

/// How the CLI that is running was installed.
#[derive(Debug, PartialEq)]
enum Cli {
    /// Not installed anywhere that outlives the uninstall: nothing to name.
    Gone,
    /// In a Homebrew keg.
    Keg,
    /// Unpacked from a release archive: these files, the CLI and the helpers beside it.
    Files(Vec<PathBuf>),
}

fn cli_found(exe: &Path, roots: &[PathBuf]) -> Cli {
    match cli_kind(exe, roots) {
        CliKind::Keg => Cli::Keg,
        CliKind::Gone => Cli::Gone,
        CliKind::Archive => {
            let mut files = vec![exe.to_path_buf()];
            files.extend(
                [
                    paths::SHIM_NAME.to_string(),
                    paths::KEYCHAIN_NAME.to_string(),
                    format!("{}.exe", paths::KEYCHAIN_NAME),
                ]
                .into_iter()
                .map(|name| exe.with_file_name(name))
                .filter(|file| file.is_file()),
            );
            Cli::Files(files)
        }
    }
}

#[derive(Debug, PartialEq)]
enum CliKind {
    Keg,
    /// Inside `~/.envrouter` (already deleted), or a cargo build (nobody installs those).
    Gone,
    Archive,
}

fn cli_kind(exe: &Path, roots: &[PathBuf]) -> CliKind {
    let in_keg = exe.to_string_lossy().contains("/Cellar/envrouter-cli/");
    let cargo_build = exe.components().any(|c| c.as_os_str() == "target")
        && exe.parent().and_then(Path::file_name).is_some_and(|dir| {
            ["debug", "release", "helpers"]
                .iter()
                .any(|name| dir == *name)
        });
    if in_keg {
        CliKind::Keg
    } else if cargo_build || roots.iter().any(|root| exe.starts_with(root)) {
        CliKind::Gone
    } else {
        CliKind::Archive
    }
}

fn canonical(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn cask_installed() -> bool {
    platform::homebrew_prefixes()
        .iter()
        .any(|prefix| Path::new(prefix).join("Caskroom/envrouter").is_dir())
}

fn homebrew_cli_installed() -> bool {
    platform::homebrew_prefixes()
        .iter()
        .any(|prefix| Path::new(prefix).join("Cellar/envrouter-cli").is_dir())
}

/// The pure part of [`remove_next`]: what was found, as the commands that remove it, app first.
fn removal(platform: Platform, app: &AppFound, cli: &Cli) -> Vec<RemoveNext> {
    let app = platform::app_removal(platform, app).map(|command| RemoveNext {
        what: Removable::App,
        command,
    });
    let cli = match cli {
        Cli::Gone => None,
        Cli::Keg => Some("brew uninstall envrouter-cli".to_string()),
        Cli::Files(files) => Some(format!(
            "rm {}",
            files
                .iter()
                .map(|file| platform::shell_quote(&file.to_string_lossy()))
                .collect::<Vec<_>>()
                .join(" ")
        )),
    }
    .map(|command| RemoveNext {
        what: Removable::Cli,
        command,
    });
    app.into_iter().chain(cli).collect()
}

/// A stand-in for the secret store that remembers what was asked of it, for tests that must
/// not touch the machine's real one.
#[cfg(test)]
pub(crate) mod fake {
    use std::cell::{Cell, RefCell};
    use std::path::Path;

    use envrouter_core::{Error, Result};

    use super::Store;

    #[derive(Default)]
    pub(crate) struct FakeStore {
        pub(crate) unreachable: Option<String>,
        /// WSL's case: unreachable until `prepare` installs the bundled helper.
        pub(crate) helper_missing: Cell<bool>,
        pub(crate) refuses: bool,
        pub(crate) deletes: Cell<u32>,
        pub(crate) prepared: RefCell<u32>,
        /// The preferences domains it was asked to forget.
        pub(crate) forgotten: RefCell<Vec<String>>,
    }

    impl Store for FakeStore {
        fn prepare(&self, _: &Path) {
            *self.prepared.borrow_mut() += 1;
            self.helper_missing.set(false);
        }

        fn prepare_would_help(&self, _: &Path) -> bool {
            self.helper_missing.get()
        }

        fn problem(&self, _: &Path) -> Option<String> {
            if self.helper_missing.get() {
                return Some("the helper isn't installed".into());
            }
            self.unreachable.clone()
        }

        fn delete(&self, _: &Path) -> Result<()> {
            self.deletes.set(self.deletes.get() + 1);
            if self.refuses {
                return Err(Error::SecretStore(
                    "Couldn't delete the stored MCP secrets: the keyring is locked.".into(),
                ));
            }
            Ok(())
        }

        fn forget_preferences(&self, domain: &str) {
            self.forgotten.borrow_mut().push(domain.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::os::unix::fs::symlink;

    use super::fake::FakeStore;
    use super::*;

    const BLOCK: &str =
        "# >>> envrouter >>>\nPATH=\"$HOME/.envrouter/shims:$PATH\"\n# <<< envrouter <<<\n";
    const KEY: &str = "claudeCode.claudeProcessWrapper";

    /// A scratch home with EnvRouter set up the way a user would have: a block in `.zshrc`, the
    /// shim named in VS Code's settings, a config and a shim to lose.
    fn set_up() -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        fs::write(h.join(".zshrc"), format!("export A=1\n\n{BLOCK}")).unwrap();
        let settings = Editor::Code.settings_file(h);
        fs::create_dir_all(settings.parent().unwrap()).unwrap();
        let shim = paths::shim_binary(h);
        fs::write(
            &settings,
            format!("{{\n  // mine\n  \"{KEY}\": \"{}\"\n}}\n", shim.display()),
        )
        .unwrap();
        fs::create_dir_all(shim.parent().unwrap()).unwrap();
        fs::write(&shim, "shim").unwrap();
        fs::write(paths::root(h).join("config.json"), "{}").unwrap();
        home
    }

    #[test]
    fn a_problem_in_the_editors_stops_before_the_store_and_the_folder() {
        let home = set_up();
        let h = home.path();
        // Cursor's settings are fine and get cleared; VS Code's name the shim but won't parse.
        let cursor = Editor::Cursor.settings_file(h);
        fs::create_dir_all(cursor.parent().unwrap()).unwrap();
        fs::write(
            &cursor,
            format!("{{\"{KEY}\": \"{}\"}}", paths::shim_binary(h).display()),
        )
        .unwrap();
        let code = Editor::Code.settings_file(h);
        let broken = format!("{{ \"{KEY}\": \"{}\" ", paths::shim_binary(h).display());
        fs::write(&code, &broken).unwrap();
        let store = FakeStore::default();

        let stopped = run(h, false, &store, &AppData::default()).unwrap();

        assert_eq!(stopped.problems.len(), 1, "{:?}", stopped.problems);
        assert!(stopped.problems[0].contains("VS Code"), "{stopped:?}");
        assert!(!stopped.finished());
        assert_eq!(stopped.secrets, SecretsStep::NotReached);
        assert_eq!(stopped.folder, FolderStep::NotReached);
        assert_eq!(store.deletes.get(), 0);
        assert!(paths::root(h).is_dir());
        // The rest were still attempted.
        assert!(!fs::read_to_string(h.join(".zshrc"))
            .unwrap()
            .contains("envrouter"));
        assert!(!fs::read_to_string(&cursor).unwrap().contains("envrouter"));
        assert_eq!(fs::read_to_string(&code).unwrap(), broken);

        // Fixed, the same command finishes the job.
        fs::write(&code, "{}").unwrap();
        let done = run(h, false, &store, &AppData::default()).unwrap();
        assert!(done.finished(), "{done:?}");
        assert_eq!(done.secrets, SecretsStep::Deleted);
        assert!(!paths::root(h).exists());
        assert_eq!(store.deletes.get(), 1);
    }

    #[test]
    fn a_store_that_cant_be_reached_doesnt_stop_but_one_that_wont_delete_does() {
        let home = set_up();
        let h = home.path();
        let gone = FakeStore {
            unreachable: Some("there's no Secret Service".into()),
            ..FakeStore::default()
        };
        let report = run(h, false, &gone, &AppData::default()).unwrap();
        assert!(report.finished(), "{report:?}");
        assert_eq!(
            report.secrets,
            SecretsStep::Unreachable {
                reason: "there's no Secret Service".into()
            }
        );
        assert_eq!(gone.deletes.get(), 0);
        assert!(!paths::root(h).exists());

        let home = set_up();
        let h = home.path();
        let locked = FakeStore {
            refuses: true,
            ..FakeStore::default()
        };
        let report = run(h, false, &locked, &AppData::default()).unwrap();
        assert!(!report.finished());
        assert_eq!(report.folder, FolderStep::NotReached);
        assert!(
            report.problems[0].contains("the keyring is locked"),
            "{report:?}"
        );
        assert!(
            report.problems[0].contains("run uninstall again"),
            "{report:?}"
        );
        assert!(paths::shim_binary(h).is_file());
    }

    #[test]
    fn a_dry_run_changes_nothing_and_never_asks_the_store_to_delete() {
        let home = set_up();
        let h = home.path();
        let before = snapshot(h);
        let store = FakeStore::default();

        let plan = run(h, true, &store, &AppData::default()).unwrap();

        assert_eq!(snapshot(h), before);
        assert_eq!(store.deletes.get(), 0);
        assert_eq!(*store.prepared.borrow(), 0);
        assert!(!plan.finished());
        assert_eq!(plan.secrets, SecretsStep::WouldDelete);
        assert_eq!(plan.folder, FolderStep::WouldDelete);
        assert_eq!(plan.shell_files, [h.join(".zshrc").display().to_string()]);
        assert_eq!(plan.editor_files.len(), 1);
        assert_eq!(plan.editor_files[0].editor, Editor::Code);
        assert_eq!(plan.editor_files[0].setting, KEY);
    }

    /// On WSL with the helper gone, the plan says what the run will find once it has installed
    /// the helper, without installing anything.
    #[test]
    fn a_plan_counts_on_the_helper_a_real_run_installs() {
        let home = set_up();
        let h = home.path();
        let store = FakeStore {
            helper_missing: Cell::new(true),
            ..FakeStore::default()
        };

        let plan = run(h, true, &store, &AppData::default()).unwrap();

        assert_eq!(plan.secrets, SecretsStep::WouldDelete);
        assert_eq!(*store.prepared.borrow(), 0);
        let done = run(h, false, &store, &AppData::default()).unwrap();
        assert_eq!(done.secrets, SecretsStep::Deleted);
        assert_eq!(store.deletes.get(), 1);
    }

    /// A real run from the CLI waits for the window to close, because its next refocus would
    /// make the folder again; the window's own run, which holds the lock, isn't refused, and
    /// the check never creates the lock file.
    #[test]
    fn the_cli_is_refused_while_the_window_holds_its_lock() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let cli = Caller::Cli {
            exe: PathBuf::from("/x/envrouter"),
        };
        let app = Caller::App {
            exe: PathBuf::from("/x/app"),
            appimage: None,
        };
        refuse_while_app_runs(h, &cli).unwrap();
        assert!(!paths::app_lock(h).exists());

        let window = hold_app_lock(h).unwrap().expect("the first window gets it");
        assert!(
            hold_app_lock(h).unwrap().is_none(),
            "a second window doesn't"
        );
        let refused = refuse_while_app_runs(h, &cli).unwrap_err().to_string();
        assert!(refused.starts_with("Quit EnvRouter first ("), "{refused}");
        assert!(
            refused.ends_with("then run envrouter uninstall again."),
            "{refused}"
        );
        refuse_while_app_runs(h, &app).unwrap();
        // A real run is refused before it touches anything.
        fs::write(h.join(".zshrc"), BLOCK).unwrap();
        let store = FakeStore::default();
        crate::commands::uninstall_with(h, false, &cli, &store, &XdgHomes::default()).unwrap_err();
        assert_eq!(fs::read_to_string(h.join(".zshrc")).unwrap(), BLOCK);
        assert_eq!(store.deletes.get(), 0);

        drop(window);
        refuse_while_app_runs(h, &cli).unwrap();
    }

    /// Every path under `dir` with its bytes.
    fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut found = Vec::new();
        let mut pending = vec![dir.to_path_buf()];
        while let Some(path) = pending.pop() {
            if path.is_dir() {
                pending.extend(fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
            } else {
                found.push((path.clone(), fs::read(&path).unwrap()));
            }
        }
        found.sort();
        found
    }

    #[test]
    fn a_missing_folder_stays_missing_and_is_absent() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();

        let report = run(h, false, &FakeStore::default(), &AppData::default()).unwrap();

        assert_eq!(report.folder, FolderStep::Absent);
        assert!(report.finished(), "{report:?}");
        assert!(!paths::root(h).exists());
        assert!(fs::read_dir(h).unwrap().next().is_none());
    }

    #[test]
    fn a_linked_folder_goes_alone_and_its_target_is_reported() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let target = h.join("dotfiles/envrouter");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("config.json"), "{}").unwrap();
        symlink(&target, paths::root(h)).unwrap();

        let report = run(h, false, &FakeStore::default(), &AppData::default()).unwrap();

        assert_eq!(report.folder, FolderStep::Deleted);
        assert!(fs::symlink_metadata(paths::root(h)).is_err());
        assert!(target.join("config.json").is_file());
        assert_eq!(
            report.left,
            [Left {
                link: paths::root(h).display().to_string(),
                target: fs::canonicalize(&target).unwrap().display().to_string()
            }]
        );
    }

    /// The one of `app_data`'s folders that sits directly in `~/Library/<library>`.
    fn in_library(app_data: &AppData, library: &str) -> PathBuf {
        app_data
            .delete
            .iter()
            .find(|folder| {
                folder
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name == library)
            })
            .unwrap_or_else(|| panic!("no folder in {library}"))
            .clone()
    }

    /// The app's folders as they are on macOS, made in a scratch home so that nothing real is
    /// named: the webview's with files in it, the preferences, which are a file, and the others
    /// not there.
    fn app_data(home: &Path) -> AppData {
        let app_data = AppData::of(Platform::MacOs, home, &XdgHomes::default());
        let webkit = in_library(&app_data, "WebKit");
        fs::create_dir_all(webkit.join("WebsiteData")).unwrap();
        fs::write(webkit.join("WebsiteData/db"), "x").unwrap();
        let plist = in_library(&app_data, "Preferences");
        fs::create_dir_all(plist.parent().unwrap()).unwrap();
        fs::write(&plist, "plist").unwrap();
        app_data
    }

    #[test]
    fn the_webviews_folders_go_with_the_rest_and_a_missing_one_is_fine() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let app_data = app_data(h);
        let folders = &app_data.delete;
        let (webkit, caches, plist) = (
            in_library(&app_data, "WebKit"),
            in_library(&app_data, "Caches"),
            in_library(&app_data, "Preferences"),
        );
        // A link goes alone, and its target is reported like a linked `~/.envrouter`'s.
        let moved = h.join("elsewhere");
        fs::create_dir_all(&moved).unwrap();
        fs::write(moved.join("kept"), "x").unwrap();
        fs::create_dir_all(caches.parent().unwrap()).unwrap();
        symlink(&moved, &caches).unwrap();
        let store = FakeStore::default();

        let report = run(h, false, &store, &app_data).unwrap();

        assert!(report.finished(), "{report:?}");
        let went = |folder: &PathBuf| folder.display().to_string();
        assert_eq!(
            report.app_data,
            [went(&webkit), went(&caches), went(&plist)]
        );
        assert!(folders
            .iter()
            .all(|folder| fs::symlink_metadata(folder).is_err()));
        assert!(moved.join("kept").is_file());
        assert_eq!(
            report.left,
            [Left {
                link: went(&caches),
                target: fs::canonicalize(&moved).unwrap().display().to_string()
            }]
        );
        // The system's copy of the preferences is told to forget them, not just the plist deleted.
        assert_eq!(*store.forgotten.borrow(), [platform::APP_IDENTIFIER]);

        // Run again: nothing left to find, and nothing wrong with that.
        let again = run(h, false, &FakeStore::default(), &app_data).unwrap();
        assert!(again.finished(), "{again:?}");
        assert!(again.app_data.is_empty() && again.app_data_left.is_empty());
    }

    /// The preferences plist counts as there if the system removed it when it was asked to forget
    /// the domain, so the report doesn't lose it.
    #[test]
    fn a_plist_the_system_removes_itself_is_still_reported() {
        struct Removes(PathBuf);
        impl Store for Removes {
            fn prepare(&self, _: &Path) {}
            fn prepare_would_help(&self, _: &Path) -> bool {
                false
            }
            fn problem(&self, _: &Path) -> Option<String> {
                None
            }
            fn delete(&self, _: &Path) -> Result<()> {
                Ok(())
            }
            fn forget_preferences(&self, _: &str) {
                fs::remove_file(&self.0).unwrap();
            }
        }
        let home = tempfile::tempdir().unwrap();
        let app_data = app_data(home.path());
        let plist = in_library(&app_data, "Preferences");

        let report = run(home.path(), false, &Removes(plist.clone()), &app_data).unwrap();

        assert!(
            report.app_data.contains(&plist.display().to_string()),
            "{report:?}"
        );
    }

    #[test]
    fn a_plan_lists_the_webviews_folders_and_deletes_none() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let app_data = app_data(h);
        let before = snapshot(h);
        let store = FakeStore::default();

        let plan = run(h, true, &store, &app_data).unwrap();

        assert_eq!(snapshot(h), before);
        assert_eq!(plan.app_data.len(), 2, "{plan:?}");
        assert!(in_library(&app_data, "WebKit").is_dir());
        assert!(store.forgotten.borrow().is_empty());
    }

    /// One that can't be reached is told in `app_data_left`, not a problem: the setup is gone, so
    /// the run is finished and nothing else is held back. The rest are still deleted.
    #[test]
    fn a_webview_folder_that_cant_be_deleted_is_told_without_failing_the_run() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let mut app_data = app_data(h);
        // Its parent is a file, so it can neither be found nor told apart from a folder that's gone.
        fs::write(h.join("blocker"), "x").unwrap();
        let blocked = h.join("blocker/data");
        let first = in_library(&app_data, "WebKit");
        app_data.delete = vec![blocked.clone(), first.clone()];

        let report = run(h, false, &FakeStore::default(), &app_data).unwrap();

        assert!(report.finished(), "{report:?}");
        assert!(report.problems.is_empty());
        assert_eq!(report.app_data_left.len(), 1, "{report:?}");
        assert!(
            report.app_data_left[0].contains(&blocked.display().to_string()),
            "{report:?}"
        );
        assert!(!first.exists());
        assert_eq!(report.folder, FolderStep::Absent);
    }

    /// An `$XDG_DATA_HOME` or `$XDG_CONFIG_HOME` outside the home folder is never deleted, but it
    /// is named when it holds the app's folder (the webview's data, the window's state), whoever
    /// runs the uninstall.
    #[test]
    fn outside_xdg_folders_are_named_and_left() {
        let home = tempfile::tempdir().unwrap();
        let (data, config) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let theirs = [data.path(), config.path()].map(|dir| dir.join(platform::APP_IDENTIFIER));
        for folder in &theirs {
            fs::create_dir_all(folder).unwrap();
        }
        let xdg = XdgHomes {
            data: Some(data.path().to_path_buf()),
            config: Some(config.path().to_path_buf()),
        };
        let named = AppData::of(Platform::Linux, home.path(), &xdg);
        assert_eq!(named.outside, theirs);

        for app_data in [
            named,
            AppData::of(Platform::Linux, home.path(), &xdg).named_only(),
        ] {
            let report = run(home.path(), false, &FakeStore::default(), &app_data).unwrap();
            assert!(report.finished(), "{report:?}");
            assert_eq!(report.app_data_left.len(), 2, "{report:?}");
            for folder in &theirs {
                assert!(
                    report
                        .app_data_left
                        .iter()
                        .any(|left| left.contains(&folder.display().to_string())),
                    "{report:?}"
                );
                assert!(folder.is_dir());
            }
        }
    }

    /// The app can't delete what its own webview is using, so it only names what is outside; the
    /// CLI, which only runs while the window is closed, deletes the rest.
    #[test]
    fn the_app_leaves_the_webviews_folders_and_the_cli_deletes_them() {
        let platform = Platform::current();
        let app = Caller::App {
            exe: PathBuf::from("/x/app"),
            appimage: None,
        };
        let cli = Caller::Cli {
            exe: PathBuf::from("/x/envrouter"),
        };
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let folders = platform::app_data_dirs(platform, h);
        for folder in &folders {
            fs::create_dir_all(folder).unwrap();
        }
        let uninstall = |caller| {
            crate::commands::uninstall_with(
                h,
                false,
                caller,
                &FakeStore::default(),
                &XdgHomes::default(),
            )
            .unwrap()
        };

        let left = uninstall(&app);
        assert!(left.finished() && left.app_data.is_empty(), "{left:?}");
        assert!(folders.iter().all(|folder| folder.is_dir()));

        let gone = uninstall(&cli);
        assert!(gone.finished(), "{gone:?}");
        assert_eq!(gone.app_data.len(), folders.len());
        assert!(folders.iter().all(|folder| !folder.exists()));
    }

    #[test]
    fn names_the_command_that_removes_each_install() {
        let quoted = |path: &str| platform::shell_quote(path);
        let app =
            |bundle: Option<&'static str>, cask, appimage: Option<&'static str>, deb| AppFound {
                bundle: bundle.map(Path::new),
                cask,
                appimage: appimage.map(Path::new),
                deb,
            };
        let cases = vec![
            (
                Platform::MacOs,
                app(Some("/Applications/EnvRouter.app"), true, None, false),
                Cli::Keg,
                vec![
                    (
                        Removable::App,
                        "brew uninstall --zap --cask envrouter".into(),
                    ),
                    (Removable::Cli, "brew uninstall envrouter-cli".into()),
                ],
            ),
            (
                Platform::MacOs,
                app(Some("/Applications/EnvRouter.app"), false, None, false),
                Cli::Gone,
                vec![(
                    Removable::App,
                    format!("mv {} ~/.Trash/", quoted("/Applications/EnvRouter.app")),
                )],
            ),
            (
                Platform::Linux,
                app(None, false, None, true),
                Cli::Files(vec![
                    "/opt/er/envrouter".into(),
                    "/opt/er/envrouter-shim".into(),
                ]),
                vec![
                    (Removable::App, "sudo apt remove env-router".into()),
                    (
                        Removable::Cli,
                        format!(
                            "rm {} {}",
                            quoted("/opt/er/envrouter"),
                            quoted("/opt/er/envrouter-shim")
                        ),
                    ),
                ],
            ),
            (
                Platform::Wsl,
                app(None, false, Some("/home/me/EnvRouter.AppImage"), true),
                Cli::Gone,
                vec![(
                    Removable::App,
                    format!("rm {}", quoted("/home/me/EnvRouter.AppImage")),
                )],
            ),
            // A cargo build of the app has nothing to name.
            (Platform::MacOs, AppFound::default(), Cli::Gone, vec![]),
        ];
        for (platform, found, cli, expected) in cases {
            let got: Vec<(Removable, String)> = removal(platform, &found, &cli)
                .into_iter()
                .map(|next| (next.what, next.command))
                .collect();
            assert_eq!(got, expected, "{platform:?} {found:?}");
        }

        let roots = [PathBuf::from("/home/me/.envrouter")];
        for (exe, kind) in [
            (
                "/opt/homebrew/Cellar/envrouter-cli/0.9.0/bin/envrouter",
                CliKind::Keg,
            ),
            ("/home/me/.envrouter/bin/envrouter", CliKind::Gone),
            (
                "/home/me/dev/env-router/target/debug/envrouter",
                CliKind::Gone,
            ),
            (
                "/home/me/Downloads/envrouter-0.9.0/envrouter",
                CliKind::Archive,
            ),
        ] {
            assert_eq!(cli_kind(Path::new(exe), &roots), kind, "{exe}");
        }
    }

    /// Pins the JSON of `UninstallReport`, which `src/lib/types.ts` mirrors, and the item's name,
    /// which `src/lib/confirm.ts` repeats. Update both together.
    #[test]
    fn wire_format_matches_the_typescript_types() {
        let report = UninstallReport {
            dry_run: false,
            shell_files: vec!["/h/.zshrc".into()],
            editor_files: vec![EditorFile {
                editor: Editor::CodeInsiders,
                settings_file: "/s.json".into(),
                setting: KEY.into(),
            }],
            secrets: SecretsStep::Unreachable {
                reason: "no keyring".into(),
            },
            folder: FolderStep::WouldDelete,
            app_data: vec!["/h/.local/share/com.tylerrobertson.envrouter".into()],
            app_data_left: vec!["Couldn't delete `/h/x`: busy. Delete it yourself.".into()],
            left: vec![Left {
                link: "/h/.envrouter".into(),
                target: "/dotfiles".into(),
            }],
            problems: vec!["Stopped.".into()],
            remove_next: vec![RemoveNext {
                what: Removable::Cli,
                command: "brew uninstall envrouter-cli".into(),
            }],
        };
        assert_eq!(SECRETS_ITEM, "EnvRouter MCP secrets");
        assert_eq!(
            serde_json::to_string(&report).unwrap(),
            r#"{"dryRun":false,"shellFiles":["/h/.zshrc"],"editorFiles":[{"editor":"codeInsiders","settingsFile":"/s.json","setting":"claudeCode.claudeProcessWrapper"}],"secrets":{"status":"unreachable","reason":"no keyring"},"folder":"wouldDelete","appData":["/h/.local/share/com.tylerrobertson.envrouter"],"appDataLeft":["Couldn't delete `/h/x`: busy. Delete it yourself."],"left":[{"link":"/h/.envrouter","target":"/dotfiles"}],"problems":["Stopped."],"removeNext":[{"what":"cli","command":"brew uninstall envrouter-cli"}]}"#
        );
        for (step, json) in [
            (SecretsStep::Deleted, r#"{"status":"deleted"}"#),
            (SecretsStep::WouldDelete, r#"{"status":"wouldDelete"}"#),
            (SecretsStep::NotReached, r#"{"status":"notReached"}"#),
        ] {
            assert_eq!(serde_json::to_string(&step).unwrap(), json);
        }
        for (step, json) in [
            (FolderStep::Deleted, r#""deleted""#),
            (FolderStep::Absent, r#""absent""#),
            (FolderStep::NotReached, r#""notReached""#),
        ] {
            assert_eq!(serde_json::to_string(&step).unwrap(), json);
        }
    }
}
