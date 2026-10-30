//! What each of the window's commands does, as plain functions of the home folder. The desktop
//! app wraps them in Tauri commands; `envrouter rpc` (the CLI) calls the same ones by name, so a
//! window managing another machine, such as a WSL distro, gets identical answers.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use envrouter_core::config::{self, ConfigState, IdeHook, McpServer};
use envrouter_core::platform::{self, Platform, XdgHomes};
use envrouter_core::watcher::Watcher;
use envrouter_core::{agents, mcp, paths, Error, ErrorKind, Result};
use serde::{Deserialize, Serialize};

use crate::editors::{self, Editor, EditorStatus};
use crate::shell::{self, FolderCheck, Preview, Shell, ShellStatus};
use crate::uninstall::{self, AppData, Caller, UninstallReport};
use crate::{checked_once, installed, mcp_clash, mcp_import, mcp_probe, npm, shims};

pub fn get_config(home: &Path) -> Result<ConfigState> {
    config::load_or_init(&paths::root(home))
}

/// `get_config` as the window reads it: a failure comes back as the `ConfigFault` that names the file.
pub fn read_config(home: &Path) -> std::result::Result<ConfigState, ConfigFault> {
    get_config(home).map_err(|err| ConfigFault::in_home(err, home))
}

/// Why config.json couldn't be read, as the window's first read rejects with it: the message to
/// show, and the kind, so the window offers Start Over only for a file that won't parse. `path`
/// is the file, so the window can open it without building the path itself, or waiting for the
/// setup status (which the same load asks for); `None` when no home folder could be named, or the
/// session is over (an uninstall finished). Over `envrouter rpc` it travels as `errorPath`.
#[derive(Debug, PartialEq, Serialize)]
pub struct ConfigFault {
    pub kind: ErrorKind,
    pub message: String,
    pub path: Option<String>,
}

impl From<Error> for ConfigFault {
    fn from(err: Error) -> Self {
        Self {
            kind: err.kind(),
            message: err.to_string(),
            path: None,
        }
    }
}

impl ConfigFault {
    /// The failure to read the config in `home`.
    pub fn in_home(err: Error, home: &Path) -> Self {
        Self {
            path: Some(paths::config_file(home).display().to_string()),
            ..Self::from(err)
        }
    }
}

/// What a save did. A save that names the config it was edited from (`base`) is refused when
/// config.json no longer holds that config, because the CLI or a hand edit changed it since:
/// the answer then carries the file as it is, so the window can fold its edit into it and save
/// again, or says the file is gone. A refused save changes nothing, the secret store included.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    /// `config` is what config.json holds now: the payload at the current version. `warning`:
    /// something to know after the config was written, worded to show as it is: the secret store
    /// wouldn't drop a secret nothing uses any more, or Codex won't start in some folders
    /// ([`mcp_clash::save_warning`]). The save still counts.
    Saved {
        config: ConfigState,
        warning: Option<String>,
    },
    /// Nothing was saved. `config` is what config.json holds now.
    Changed { config: ConfigState },
    /// Nothing was saved: config.json is gone since the edit started (reading it creates it).
    /// Folding the edit into an empty config would read as every profile and server deleted,
    /// so the window asks, then saves its own version without a base.
    Missing,
}

/// Validates and saves the config, then renders each profile's MCP files and updates the shims
/// to match. `secrets` holds values typed since the last save, keyed by the ids the config
/// refers to them by; they go to the secret store before the config names them. `base`, when
/// given, is the config the edit started from (see [`SaveOutcome`]). The window's save: it
/// installs the shim and helper it ships with.
pub fn save_config(
    home: &Path,
    payload: &ConfigState,
    secrets: &HashMap<String, String>,
    base: Option<&ConfigState>,
) -> Result<SaveOutcome> {
    save(home, payload, secrets, base, true, &Keychain)
}

/// [`save_config`] for the CLI: `edit` makes the config to save from config.json as it is, and
/// the save names what it read as its base. When the window or a hand edit saved in between,
/// the edit is made again over the file as it is now instead of overwriting it (`edit` may run
/// more than once). Answers the config as saved, whether it took more than one try, and the
/// save's warning, if any. It installs its own shim and helper only where the installed ones
/// can't do what this save needs (see `cli_installs`): where the app is in use, its builds
/// stay; `envrouter install` replaces them on purpose.
pub fn save_from_cli(
    home: &Path,
    secrets: &HashMap<String, String>,
    edit: impl FnMut(ConfigState) -> Result<ConfigState>,
) -> Result<CliSave> {
    edit_and_save(home, secrets, cli_installs(home), &Keychain, edit)
}

/// Whether a CLI save installs its own shim and helper: where none is, where the installed shim
/// doesn't read the version this save writes, or where the installed helper doesn't start
/// servers from the specs this save renders. After `brew upgrade envrouter-cli` the old shim
/// stays in ~/.envrouter/bin, and it would run every agent without a profile; the old helper
/// would fail every server that needs a secret with its usage line.
fn cli_installs(home: &Path) -> bool {
    shims::installed_config_version(home).is_none_or(|version| version < config::CONFIG_VERSION)
        || shims::installed_launcher_version(home)
            .is_none_or(|version| version < mcp::LAUNCHER_VERSION)
}

/// Renders the MCP files of the config.json as it is now, as a save would, without saving
/// anything. For an install that has just put a new shim and helper in place, so the files the
/// servers start from match them. The agents get the registry's rules in memory
/// ([`agents::with_agents`]), as `envrouter install` gives the shims, so a rule this release
/// adds (`optionsBeforeSubcommand`, a skip rule) applies without a save. It takes the save lock,
/// so a save in progress is rendered whole. A home with no config.json has nothing to render and
/// is left as it is: the lock would make `~/.envrouter` and `config.lock`.
pub fn render_saved(home: &Path) -> Result<()> {
    let root = paths::root(home);
    if !paths::config_file(home).exists() {
        return Ok(());
    }
    let _lock = config::lock(&root)?;
    match config::load(&root)? {
        Some(config) => mcp::sync(&agents::with_agents(config), home),
        None => Ok(()),
    }
}

/// What a CLI save did: see [`save_from_cli`].
#[derive(Debug)]
pub struct CliSave {
    pub config: ConfigState,
    pub retried: bool,
    pub warning: Option<String>,
}

fn edit_and_save(
    home: &Path,
    secrets: &HashMap<String, String>,
    install: bool,
    store: &impl SecretStore,
    mut edit: impl FnMut(ConfigState) -> Result<ConfigState>,
) -> Result<CliSave> {
    // A file that keeps changing under the save gets a few tries, not a loop.
    for tries in 0..3 {
        let base = get_config(home)?;
        let payload = edit(base.clone())?;
        match save(home, &payload, secrets, Some(&base), install, store)? {
            SaveOutcome::Saved { config, warning } => {
                return Ok(CliSave {
                    config,
                    retried: tries > 0,
                    warning,
                })
            }
            // Read again: a missing file is created empty, as the window's read does.
            SaveOutcome::Changed { .. } | SaveOutcome::Missing => {}
        }
    }
    Err(Error::Invalid(
        "config.json kept changing while saving. Run the command again.".into(),
    ))
}

/// Where a save keeps secret values: the platform's store, or a stand-in in tests, which
/// mustn't touch the login Keychain.
trait SecretStore {
    /// Adds `new` and drops every secret not in `keep`.
    fn update(
        &self,
        home: &Path,
        new: &HashMap<String, String>,
        keep: &BTreeSet<&str>,
    ) -> Result<()>;
    /// Drops every secret not in `keep`.
    fn prune(&self, home: &Path, keep: &BTreeSet<&str>) -> Result<()>;
}

struct Keychain;

impl SecretStore for Keychain {
    fn update(
        &self,
        home: &Path,
        new: &HashMap<String, String>,
        keep: &BTreeSet<&str>,
    ) -> Result<()> {
        envrouter_keychain::update(home, new, keep)
    }

    fn prune(&self, home: &Path, keep: &BTreeSet<&str>) -> Result<()> {
        envrouter_keychain::prune(home, keep)
    }
}

fn save(
    home: &Path,
    payload: &ConfigState,
    secrets: &HashMap<String, String>,
    base: Option<&ConfigState>,
    install: bool,
    store: &impl SecretStore,
) -> Result<SaveOutcome> {
    let root = paths::root(home);
    let _lock = config::lock(&root)?;
    let previous = match (config::load(&root), base) {
        // A file that can't be read now was readable when the edit started: someone is editing
        // it. Saving over that would throw their edit away.
        (Err(err), Some(_)) => return Err(err),
        (Ok(None), Some(_)) => return Ok(SaveOutcome::Missing),
        (loaded, _) => loaded.ok().flatten(),
    };
    if let (Some(base), Some(previous)) = (base, &previous) {
        if previous != base {
            return Ok(SaveOutcome::Changed {
                config: previous.clone(),
            });
        }
    }
    config::validate(payload, home)?;
    let referenced = config::secret_ids(payload);
    if secrets.keys().any(|id| !referenced.contains(id.as_str())) {
        return Err(Error::Invalid(
            "A new secret isn't used by any server. Save the server again.".into(),
        ));
    }
    // Found after writing, a shim in the way would leave a saved config whose tools have none.
    shims::check(home, payload)?;
    let fresh_shim = install && shims::install_bundled(home)?;
    // Only inside home: a typo'd absolute path shouldn't create folders elsewhere.
    for dir in config::tool_dirs(payload, home) {
        if dir.starts_with(home) && !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|source| Error::Io { path: dir, source })?;
        }
    }
    // The store is read only when this save adds a secret or stops using one. New values go
    // in first, and every secret either config names stays until this one is written, so a
    // failure from here on never leaves config.json naming a secret that's gone. A secret
    // Start Over's backup names stays too: restoring the backup would otherwise bring its
    // servers back with no secrets.
    let before = previous
        .as_ref()
        .map(config::secret_ids)
        .unwrap_or_default();
    let backed_up = config::backed_up_secret_ids(&root);
    let kept: BTreeSet<&str> = referenced
        .iter()
        .copied()
        .chain(backed_up.iter().map(String::as_str))
        .collect();
    if !secrets.is_empty() {
        let keep = kept.union(&before).copied().collect();
        store.update(home, secrets, &keep)?;
    }
    config::save(&root, payload)?;
    mcp::sync(payload, home)?;
    shims::sync(home, payload)?;
    // A cache: `known_tools` already ignores servers the library dropped, so a failed prune only
    // leaves their lists on disk, and the save it follows has gone through.
    let _ = mcp_probe::prune(home, payload);
    // The config is written and rendered by now, so a store that won't let go of a secret
    // (none to ask, locked) is a warning, not a failed save: the window would keep the old base
    // for a file that's already new. The next save that reaches the store drops it.
    let dropped = if before.iter().any(|id| !kept.contains(id)) {
        store.prune(home, &kept).err().map(|err| err.to_string())
    } else {
        None
    };
    // A same-name server of the agent's own with the other transport: Codex won't start with it.
    // Told after the fact like the store's, since the config is valid and the agent's file is
    // the user's to edit.
    let warning = [dropped, mcp_clash::save_warning(payload, home)]
        .into_iter()
        .flatten()
        .reduce(|first, second| format!("{first} {second}"));
    if fresh_shim && !referenced.is_empty() {
        // Not waited for: the answer to its prompt is the user's to give, whenever.
        drop(shims::ask_keychain_access(home));
    }
    Ok(SaveOutcome::Saved {
        config: config::as_saved(payload),
        warning,
    })
}

/// Starts over from a config.json that isn't valid JSON: copies its bytes to the first free
/// `config.json.bak`, `config.json.bak-2`, ... beside it in `~/.envrouter`, then writes an empty
/// config in its place (through a symlink, as a save does), and answers the backup's path. Under
/// the save lock, so a save in flight can't interleave. It acts only on a parse error: a file
/// from a newer EnvRouter, one that can't be read, or one that reads fine by now is refused
/// and left alone, and an earlier backup is never overwritten. The secret store, the rendered
/// MCP files and the shims stay as they are.
pub fn reset_unreadable_config(home: &Path) -> Result<PathBuf> {
    let root = paths::root(home);
    let _lock = config::lock(&root)?;
    let file = paths::config_file(home);
    // Read once: what is judged unparseable is what gets backed up, even if someone saves
    // while this runs (the lock keeps the app's and the CLI's saves out, not an editor's).
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(Error::Invalid(
                "config.json is gone, so nothing was changed.".into(),
            ))
        }
        Err(source) => return Err(Error::Io { path: file, source }),
    };
    match config::parse(&file, &bytes) {
        Err(Error::Json { .. }) => {}
        Err(err) => return Err(err),
        Ok(_) => {
            return Err(Error::Invalid(
                "config.json can be read now, so nothing was changed.".into(),
            ))
        }
    }
    let backup = write_new_backup(&file, &bytes)?;
    config::save(&root, &ConfigState::default())?;
    Ok(backup)
}

/// Writes `bytes` to the first of `<file>.bak`, `<file>.bak-2`, ... that doesn't exist, which
/// `create_new` decides atomically, so a backup is never replaced. A write that fails leaves no
/// partial backup behind.
fn write_new_backup(file: &Path, bytes: &[u8]) -> Result<PathBuf> {
    use std::io::{ErrorKind, Write};

    for n in 1..=1000 {
        let backup = file.with_file_name(config::backup_file_name(n));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        // The config may hold values the user typed in plain.
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut out = match options.open(&backup) {
            Ok(out) => out,
            Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
            Err(source) => {
                return Err(Error::Io {
                    path: backup,
                    source,
                })
            }
        };
        if let Err(source) = out.write_all(bytes).and_then(|()| out.sync_all()) {
            drop(out);
            let _ = std::fs::remove_file(&backup);
            return Err(Error::Io {
                path: backup,
                source,
            });
        }
        return Ok(backup);
    }
    Err(Error::Invalid(format!(
        "{} has 1000 backups already. Remove some, then try again.",
        file.display()
    )))
}

/// A secret the server library refers to: who uses it and whether the store has it, never
/// its value.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretUse {
    pub id: String,
    /// The servers that refer to it, by name.
    pub servers: Vec<String>,
    /// `None` when the store couldn't be read.
    pub stored: Option<bool>,
}

/// Each secret the saved config refers to, and why the store couldn't say which it holds, if it
/// couldn't. For `envrouter secret list`, an explicit request, so it may read the store; the
/// window never reads it just to look. An unreadable store still lists the ids, since they're
/// what `envrouter secret set` takes.
pub fn secrets(home: &Path) -> Result<(Vec<SecretUse>, Option<String>)> {
    let config = get_config(home)?;
    let users = config::secret_users(&config);
    let (stored, problem) = if users.is_empty() {
        (Some(HashMap::new()), None)
    } else {
        match envrouter_keychain::read(home) {
            Ok(stored) => (Some(stored), None),
            Err(err) => (None, Some(err.to_string())),
        }
    };
    let secrets = users
        .into_iter()
        .map(|(id, servers)| SecretUse {
            id: id.to_string(),
            servers: servers.into_iter().map(str::to_string).collect(),
            stored: stored.as_ref().map(|stored| stored.contains_key(id)),
        })
        .collect();
    Ok((secrets, problem))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    /// Which system this is, so the window can use its conventions (shortcuts, words).
    pub platform: Platform,
    /// What the store MCP secrets go to is called here: "Keychain", "keyring".
    pub secret_store: &'static str,
    /// What a value kept there reads as in its field: "In Keychain", "In the keyring".
    pub sealed_label: &'static str,
    /// Why that store can't keep secrets right now (no Secret Service running, no Windows
    /// helper in WSL), in its own words; `None` when it can. Asking never reads a secret or
    /// prompts.
    pub secret_store_problem: Option<String>,
    /// What the file manager is called and the verb for showing a file in it ("Reveal" in
    /// "Finder", "Show" in "Files"), so the window words a reveal as the menu bar does.
    pub file_manager: &'static str,
    pub reveal_verb: &'static str,
    pub shim_installed: bool,
    pub shims_dir: String,
    /// The installed shim, which the window names when it is missing or out of date.
    pub shim_path: String,
    pub shells: Vec<ShellStatus>,
    /// The commands of the offered agents (`claude`, `copilot`, and any the config names) that a
    /// new terminal doesn't find on its PATH ([`installed::missing`]), so the window can mark them;
    /// `None` when the terminal's PATH couldn't be asked, or hasn't been yet: nothing is marked
    /// then, since an agent not known to be missing isn't. An agent that an editor's extension
    /// carries, or that a terminal runs an alias or a function for, isn't listed: this is the one
    /// answer for the window, the CLI and rpc.
    pub missing_agents: Option<Vec<String>>,
    /// A folder check came back routed at some time (`checked_once`), which first-run's last step
    /// waits for.
    pub checked_before: bool,
}

/// Longest the window's (and rpc's) status waits for the agents: the answer is a few `stat`s while the terminal's
/// PATH is kept, and a login shell when it isn't.
pub const AGENTS_WAIT: Duration = Duration::from_secs(1);

/// How long a caller that has nobody to ask again later (the CLI's `status --agents`) waits for
/// the agents: the login shell's own limit, with a moment over.
pub const SHELL_WAIT: Duration = Duration::from_secs(16);

/// How long a probe's answer is handed to whoever asks again without asking afresh: long enough
/// for the window's own second ask, after a late answer, to get it; short enough that a refocus
/// a moment later still looks along PATH again.
const AGENTS_FRESH: Duration = Duration::from_secs(5);

/// The agent probe, one at a time and never waited on for long (see [`Watcher`]).
static AGENTS: Watcher<PathBuf, Option<Vec<String>>> = Watcher::new();

/// The window asks this whenever it gains focus. Where the secret store check can block, it and
/// the agents are asked side by side, each at most `wait` (the store's own wait aside), so one
/// slow answer is never added to the other. If the agents hadn't answered by then they are
/// unknown, and `late` runs when they have, so the caller can ask again.
pub fn setup_status_within(
    home: &Path,
    wait: Duration,
    late: impl FnOnce() + Send + 'static,
) -> Result<SetupStatus> {
    setup_status_using(home, wait, late, probe_agents)
}

/// [`setup_status_within`] with the probe given, so a test never runs a login shell.
pub(crate) fn setup_status_using(
    home: &Path,
    wait: Duration,
    late: impl FnOnce() + Send + 'static,
    probe: fn(&Path) -> Option<Vec<String>>,
) -> Result<SetupStatus> {
    let ask = move || {
        AGENTS
            .ask(
                &home.to_path_buf(),
                wait,
                AGENTS_FRESH,
                move |home| probe(home),
                late,
            )
            .flatten()
    };
    let (problem, missing) = if Platform::current().store_check_can_block() {
        std::thread::scope(|scope| {
            let store = scope.spawn(|| envrouter_keychain::problem(home));
            let missing = ask();
            (store_problem(store.join()), missing)
        })
    } else {
        let problem = envrouter_keychain::problem(home);
        (problem, ask())
    };
    status_of(home, problem, missing)
}

/// [`installed::probe`], saying on stderr why when it fails, once for each period a failure is
/// believed (`shell::LOGIN_REPORT_FAILURE_TTL`): the window just marks nothing then, and each
/// focus asks again.
pub(crate) fn probe_agents(home: &Path) -> Option<Vec<String>> {
    static LOGGED: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    match installed::probe(home) {
        Ok(missing) => Some(missing),
        Err(err) => {
            let message = err.to_string();
            let mut logged = LOGGED
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if first_in_period(
                &mut logged,
                &message,
                Instant::now(),
                shell::LOGIN_REPORT_FAILURE_TTL,
            ) {
                eprintln!("envrouter: couldn't find which agents are installed: {message}");
            }
            None
        }
    }
}

/// Whether `message` at `now` is news: not the one told in the last `period`. Notes it if so.
fn first_in_period(
    last: &mut Option<(String, Instant)>,
    message: &str,
    now: Instant,
    period: Duration,
) -> bool {
    match last {
        Some((told, at)) if told == message && now.duration_since(*at) < period => false,
        _ => {
            *last = Some((message.to_string(), now));
            true
        }
    }
}

/// What the secret store check found, or, if the check itself panicked, that it couldn't be made:
/// never "no problem", which would turn the lock on over a store nobody has looked at.
fn store_problem(checked: std::thread::Result<Option<String>>) -> Option<String> {
    checked.unwrap_or_else(|_| {
        Some(format!(
            "Couldn't check the {}: the check stopped unexpectedly.",
            Platform::current().secret_store_name()
        ))
    })
}

/// The status without asking which agents are installed, for a caller that won't show it.
pub fn setup_status_without_agents(home: &Path) -> Result<SetupStatus> {
    status_of(home, envrouter_keychain::problem(home), None)
}

fn status_of(
    home: &Path,
    secret_store_problem: Option<String>,
    missing_agents: Option<Vec<String>>,
) -> Result<SetupStatus> {
    let platform = Platform::current();
    Ok(SetupStatus {
        platform,
        secret_store: platform.secret_store_name(),
        sealed_label: platform.sealed_label(),
        secret_store_problem,
        file_manager: platform.file_manager(),
        reveal_verb: platform.reveal_verb(),
        shim_installed: shims::is_installed(home, &shims::bundled()?, &shims::bundled_keychain()?),
        shims_dir: paths::shims(home).display().to_string(),
        shim_path: paths::shim_binary(home).display().to_string(),
        shells: Shell::ALL.iter().map(|&s| shell::status(s, home)).collect(),
        missing_agents,
        checked_before: checked_once::is_recorded(home),
    })
}

pub fn set_shell_integration(home: &Path, shell: Shell, enabled: bool) -> Result<ShellStatus> {
    if enabled {
        shims::install_bundled(home)?;
    }
    shell::set_integration(shell, home, enabled)
}

/// Each editor's state for each agent hook, keyed by the agent's command.
pub fn editor_status(home: &Path, hooks: &BTreeMap<String, IdeHook>) -> Vec<EditorStatus> {
    Editor::ALL
        .iter()
        .flat_map(|&editor| {
            hooks
                .iter()
                .map(move |(command, hook)| editors::status(editor, home, command, hook))
        })
        .collect()
}

/// The editor hooks of the saved config's agents, with the registry's filled in as the
/// window's next save would, for callers without the window.
pub fn saved_hooks(home: &Path) -> Result<BTreeMap<String, IdeHook>> {
    Ok(agents::ide_hooks(&agents::with_agents(get_config(home)?)))
}

/// Points an agent's editor extension at the shim, or stops it, in the editor's settings.
pub fn set_editor_integration(
    home: &Path,
    editor: Editor,
    command: &str,
    hook: &IdeHook,
    enabled: bool,
) -> Result<EditorStatus> {
    if enabled {
        shims::install_bundled(home)?;
    }
    editors::set_integration(editor, home, command, hook, enabled)
}

/// Turns routing off everywhere, deletes the stored MCP secrets, `~/.envrouter` and the app's
/// webview folders, and names the commands that remove the app and the CLI (see [`uninstall`]);
/// the window's own run leaves those folders for a command it names, since its webview is
/// still using them. With `dry_run` it only reports what it would do. A stop comes back as a report with `problems`, not an error;
/// a real run for the CLI while the window is open is refused before it changes anything.
pub fn uninstall(home: &Path, dry_run: bool, caller: &Caller) -> Result<UninstallReport> {
    uninstall_with(
        home,
        dry_run,
        caller,
        &uninstall::Keychain,
        &XdgHomes::from_env(),
    )
}

/// [`uninstall`] against any secret store, so a test never reaches the machine's real one, and
/// with the XDG folders the caller read.
pub(crate) fn uninstall_with(
    home: &Path,
    dry_run: bool,
    caller: &Caller,
    store: &dyn uninstall::Store,
    xdg: &XdgHomes,
) -> Result<UninstallReport> {
    if !dry_run {
        uninstall::refuse_while_app_runs(home, caller)?;
    }
    // The window can't delete what its own webview is using: it does that as it exits.
    let app_data = AppData::of(Platform::current(), home, xdg);
    let app_data = match caller {
        Caller::App { .. } => app_data.named_only(),
        Caller::Cli { .. } => app_data,
    };
    let mut report = uninstall::run(home, dry_run, store, &app_data)?;
    report.remove_next = uninstall::remove_next(Platform::current(), home, caller);
    Ok(report)
}

/// Opens `shell` the way a new terminal window would, in `folder`, and reports what running
/// `tool` there would do. Never runs the tool itself.
/// A check that finds the tool routed, and starting, is also noted as done ([`checked_once`]),
/// for first-run. It carries the same-name servers an agent's own files define with the other
/// transport ([`mcp_clash`]) that the shim adds, which the shim can't see; the agent won't
/// start with them, so such a check isn't done.
pub fn check_folder(home: &Path, shell: Shell, folder: &Path, tool: &str) -> Result<FolderCheck> {
    let mut check = shell::check_folder(shell, home, folder, tool)?;
    if let FolderCheck::Routed {
        profile_id: Some(id),
        value,
        mcp,
        mcp_clashes,
        ..
    } = &mut check
    {
        // The saved config is what the shim routed from. One that can't be read now has no
        // clashes to report: the check already answered what it was asked.
        if let Ok(Some(config)) = config::load(&paths::root(home)) {
            *mcp_clashes =
                mcp_clash::in_folder(&config, home, folder, tool, id, value.as_deref(), mcp);
        }
    }
    note_if_routed(home, &check);
    Ok(check)
}

/// A convenience, like the last folder: a failure to keep it is told, not raised.
fn note_if_routed(home: &Path, check: &FolderCheck) {
    if matches!(check, FolderCheck::Routed { mcp_clashes, .. } if mcp_clashes.is_empty()) {
        if let Err(err) = checked_once::record(home) {
            eprintln!("envrouter: couldn't note that a folder was checked: {err}");
        }
    }
}

/// What the given, possibly unsaved, config would route for `tool` in `folder`.
pub fn preview_folder(home: &Path, payload: &ConfigState, folder: &Path, tool: &str) -> Preview {
    shell::preview(payload, home, folder, tool)
}

/// Starts `server` (or connects to it) and lists its tools. `path` is the PATH a new terminal
/// gets ([`shell::login_path_recent`], which blocks, so the caller runs it where blocking is fine).
/// `secrets` holds values typed since the last save; the store supplies the rest. A good list
/// is remembered for the profile editor's tool filter.
pub async fn check_mcp_server(
    home: &Path,
    path: &str,
    name: &str,
    server: &McpServer,
    secrets: &HashMap<String, String>,
) -> Result<mcp_probe::ServerCheck> {
    let check = mcp_probe::check(server, secrets, home, path).await;
    if check.status == mcp_probe::CheckStatus::Ok && config::is_file_name(name) {
        mcp_probe::remember(home, name, server, &check.tools)?;
    }
    Ok(check)
}

/// The dist-tags of the npm package an `npx` server runs (`latest` and the like), so the window
/// can pin it to one version. `path` is the PATH a new terminal gets, as for a check.
pub async fn npm_dist_tags(
    home: &Path,
    path: &str,
    command: &str,
    package: &str,
) -> Result<BTreeMap<String, String>> {
    npm::dist_tags(home, path, command, package).await
}

/// Each library server's tools from its last check that worked, if its definition hasn't
/// changed since.
pub fn mcp_tools(home: &Path) -> Result<BTreeMap<String, Vec<mcp_probe::ToolInfo>>> {
    Ok(mcp_probe::known_tools(&get_config(home)?, home))
}

/// MCP servers the agents already define in their own files. Only reads them.
pub fn import_candidates(home: &Path, payload: &ConfigState) -> Vec<mcp_import::ImportCandidate> {
    mcp_import::candidates(payload, home)
}

/// MCP servers in text the user pasted, such as a README's snippet.
pub fn parse_mcp_json(text: &str) -> Result<mcp_import::Pasted> {
    mcp_import::parse_pasted(text).map_err(Error::Invalid)
}

/// Opens a file in the user's default text editor, e.g. the startup file that defines an alias
/// shadowing the shim. Limited to existing files inside the home folder.
pub fn open_in_editor(home: &Path, path: &str) -> Result<()> {
    let file = openable_file(home, Path::new(path))?;
    let (program, args) = platform::open_text_file_command(Platform::current());
    let status = std::process::Command::new(program)
        .args(args)
        .arg(&file)
        .status()
        .map_err(|err| Error::Command(format!("couldn't run {program}: {err}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Command(format!("couldn't open {}", file.display())))
    }
}

/// The real path of `path` if it's an existing file inside the home folder, which is all
/// [`open_in_editor`] opens.
pub(crate) fn openable_file(home: &Path, path: &Path) -> Result<PathBuf> {
    let file = std::fs::canonicalize(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let home = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    if !file.is_file() || !file.starts_with(&home) {
        return Err(Error::Invalid(format!(
            "{} isn't a file in your home folder.",
            path.display()
        )));
    }
    Ok(file)
}

/// One of EnvRouter's own places that the window or the menu bar can show in the file manager.
/// Not a path: the webview says which place and this side says where it is, so a compromised
/// page can't ask for any other file (`Place` in `src/lib/types.ts`).
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Place {
    /// `~/.envrouter/config.json`.
    Config,
    /// `~/.envrouter`.
    Root,
    /// The folder a profile's MCP files are rendered into.
    McpFiles { profile_id: String },
    /// A trigger folder of a saved profile, or a folder inside one (a checked folder's slip files
    /// under its trigger). Not any path: [`locate`] refuses what config.json doesn't cover.
    Trigger { folder: String },
}

/// Where a [`Place`] is, and how to show it: `File` is revealed (selected in its folder, which
/// never runs it, so a trigger folder is revealed as well), `Folder` is opened.
#[derive(Debug, PartialEq)]
pub enum Located {
    File(PathBuf),
    Folder(PathBuf),
}

/// Whether anything is at `path`, a link counting even when what it points to is gone (showing
/// it then fails with the file manager's own reason). Only a plain "not found" is absence: a
/// failure to ask, such as a folder that can't be searched, is passed on as it is.
fn exists(path: &Path) -> Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(Error::Io {
            path: path.to_path_buf(),
            source,
        }),
    }
}

/// `path` as a folder to open, or why it isn't one. Opening hands the path to the system, which
/// *runs* a file it is given (an app, a `.command` script), so only a real folder qualifies. A
/// link to a folder does (a `~/.envrouter` kept in a dotfiles repo is one); a link to anything
/// else, or a link to nothing, does not. `absent` is what to say when nothing is there, and
/// `not_a_folder` when something else is.
fn folder(path: &Path, absent: &str, not_a_folder: &str) -> Result<PathBuf> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_dir() => Ok(path.to_path_buf()),
        Ok(_) => Err(Error::Invalid(not_a_folder.into())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(Error::Invalid(absent.into()))
        }
        Err(source) => Err(Error::Io {
            path: path.to_path_buf(),
            source,
        }),
    }
}

/// Whether `folder` is a trigger folder of a saved profile, or inside one. Triggers that can't be
/// read as folders (a wildcard in the middle) cover nothing.
fn in_a_trigger(home: &Path, folder: &Path) -> Result<bool> {
    let Some(config) = config::load(&paths::root(home))? else {
        return Ok(false);
    };
    Ok(config
        .profiles
        .iter()
        .flat_map(|profile| &profile.trigger_paths)
        .filter_map(|raw| config::trigger_base(raw, home).ok())
        .any(|base| folder.starts_with(base)))
}

/// Finds `place` under `home`, or says why it isn't there yet (or can't be shown). Only a
/// trigger folder reads config.json (to hold the window to the folders it names); the others
/// answer while the file is unreadable, which is when someone wants to see it.
pub fn locate(home: &Path, place: &Place) -> Result<Located> {
    let root = paths::root(home);
    match place {
        Place::Config => {
            let file = paths::config_file(home);
            if exists(&file)? {
                Ok(Located::File(file))
            } else {
                Err(Error::Invalid(
                    "There's no config.json yet. EnvRouter writes it the next time the window reads its settings."
                        .into(),
                ))
            }
        }
        Place::Root => folder(
            &root,
            "There's no ~/.envrouter yet. EnvRouter makes it the next time the window reads its settings.",
            "~/.envrouter isn't a folder, so EnvRouter won't open it.",
        )
        .map(Located::Folder),
        Place::McpFiles { profile_id } => {
            if !config::is_file_name(profile_id) {
                return Err(Error::Invalid("That isn't a profile.".into()));
            }
            folder(
                &paths::mcp(home).join(profile_id),
                "This profile has no MCP files yet. EnvRouter writes them when the profile is saved with an MCP server.",
                "This profile's MCP files aren't in a folder, so EnvRouter won't open them.",
            )
            .map(Located::Folder)
        }
        Place::Trigger { folder } => {
            let path = Path::new(folder);
            // `..` would climb out of the trigger it starts in; a relative path is no trigger's folder.
            let plain = path.is_absolute() && !path.components().any(|c| c == Component::ParentDir);
            if !plain {
                return Err(Error::Invalid("That isn't a valid trigger folder.".into()));
            }
            // The window shows what it read earlier, so say which of the ways this can fail it was.
            match in_a_trigger(home, path) {
                Ok(true) => {}
                Ok(false) => {
                    return Err(Error::Invalid(format!(
                        "`{folder}` isn't a trigger folder any more: config.json changed since the window showed it."
                    )));
                }
                Err(err) => {
                    return Err(Error::Invalid(format!(
                        "Couldn't check `{folder}` against config.json: {err}"
                    )));
                }
            }
            // `metadata` follows a link, so one that points at nothing reads as gone, which it is
            // as far as the file manager can tell (it would fail with the system's own words).
            match std::fs::metadata(path) {
                Ok(_) => Ok(Located::File(path.to_path_buf())),
                // The window sets a backticked path as a value, and tildifies it.
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    Err(Error::Invalid(format!(
                        "There's no `{folder}` any more. It may have been moved or deleted."
                    )))
                }
                Err(source) => Err(Error::Io {
                    path: path.to_path_buf(),
                    source,
                }),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp_clash::McpClash;
    use envrouter_core::config::Profile;

    fn profile(id: &str, name: &str) -> Profile {
        Profile {
            id: id.into(),
            name: name.into(),
            ..Profile::default()
        }
    }

    /// The window's save, minus installing the bundled shim, which a test binary has none of,
    /// and with a store that holds nothing.
    fn save_config(
        home: &Path,
        payload: &ConfigState,
        secrets: &HashMap<String, String>,
        base: Option<&ConfigState>,
    ) -> Result<SaveOutcome> {
        save(home, payload, secrets, base, false, &FakeStore::default())
    }

    /// The secret store in memory, as the platform's would hold it.
    #[derive(Default)]
    struct FakeStore {
        secrets: std::cell::RefCell<HashMap<String, String>>,
        /// Drops nothing and says so, as a store that's gone or locked does.
        wont_drop: std::cell::Cell<bool>,
    }

    impl SecretStore for FakeStore {
        fn update(
            &self,
            _: &Path,
            new: &HashMap<String, String>,
            keep: &BTreeSet<&str>,
        ) -> Result<()> {
            let mut secrets = self.secrets.borrow_mut();
            secrets.retain(|id, _| keep.contains(id.as_str()));
            secrets.extend(new.clone());
            Ok(())
        }

        fn prune(&self, home: &Path, keep: &BTreeSet<&str>) -> Result<()> {
            if self.wont_drop.get() {
                return Err(Error::SecretStore("the keyring is locked".into()));
            }
            self.update(home, &HashMap::new(), keep)
        }
    }

    /// A profile using a library server whose env names the secret `id`.
    fn with_secret_server(config: &ConfigState, server: &str, id: &str) -> ConfigState {
        let mut config = with_profile(config, "p1", "Work");
        config.mcp_servers.insert(
            server.into(),
            McpServer::Stdio {
                command: "npx".into(),
                args: Vec::new(),
                env: BTreeMap::from([(
                    "TOKEN".into(),
                    config::McpValue::Secret { secret: id.into() },
                )]),
            },
        );
        config.profiles[0]
            .mcp_servers
            .insert(server.into(), config::McpUse::default());
        config
    }

    /// A server deleted from the library leaves the tool-list cache with the save that deletes it.
    #[test]
    fn a_save_prunes_the_tool_lists_of_deleted_servers() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let empty = get_config(home).unwrap();
        let config = with_secret_server(&empty, "github", "7F3A");
        let server = config.mcp_servers["github"].clone();
        let tools = [mcp_probe::ToolInfo {
            name: "t".into(),
            description: None,
        }];
        mcp_probe::remember(home, "github", &server, &tools).unwrap();
        mcp_probe::remember(home, "gone", &server, &tools).unwrap();
        save_config(home, &config, &HashMap::new(), None).unwrap();
        let cache = std::fs::read_to_string(paths::root(home).join("mcp-tools.json")).unwrap();
        assert!(cache.contains("\"github\""));
        assert!(!cache.contains("\"gone\""), "{cache}");
    }

    /// The save that replaces a server: the old one's secret is pruned only once the config
    /// and the files rendered from it no longer name it. A failure before that (here, rendering
    /// the MCP files) used to leave the old `launch.json` naming a secret already gone, so its
    /// server was dropped on every launch.
    #[test]
    fn keeps_a_dropped_secret_until_the_config_without_it_is_written() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let store = FakeStore::default();
        let empty = get_config(home).unwrap();
        let old = with_secret_server(&empty, "github", "7F3A");
        let new_value = HashMap::from([("7F3A".to_string(), "ghp_old".to_string())]);
        save(home, &old, &new_value, None, false, &store).unwrap();

        let new = with_secret_server(&empty, "linear", "9B2C");
        let new_value = HashMap::from([("9B2C".to_string(), "lin_new".to_string())]);
        // Rendering MCP files fails after config.json is written: a file where the folder goes.
        std::fs::write(paths::mcp(home), "").unwrap();
        assert!(save(home, &new, &new_value, Some(&old), false, &store).is_err());
        assert_eq!(
            store.secrets.borrow().get("7F3A").map(String::as_str),
            Some("ghp_old")
        );
        assert_eq!(
            store.secrets.borrow().get("9B2C").map(String::as_str),
            Some("lin_new")
        );

        // Once a save gets through, the secret nothing names is gone.
        std::fs::remove_file(paths::mcp(home)).unwrap();
        save(home, &new, &HashMap::new(), None, false, &store).unwrap();
        assert_eq!(get_config(home).unwrap(), new);
        // The previous save wrote `new`, so this one drops nothing; the next drop prunes.
        save(home, &empty, &HashMap::new(), None, false, &store).unwrap();
        assert!(store.secrets.borrow().is_empty());
    }

    /// A store that won't drop a secret after the config is written (none to ask, locked) used to
    /// fail the save: the window showed an error and kept its old base for a file that was
    /// already new. Now the save counts and carries the store's reason.
    #[test]
    fn a_store_that_wont_drop_a_secret_warns_after_the_config_is_written() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let store = FakeStore::default();
        let empty = get_config(home).unwrap();
        let old = with_secret_server(&empty, "github", "7F3A");
        let value = HashMap::from([("7F3A".to_string(), "ghp_old".to_string())]);
        save(home, &old, &value, None, false, &store).unwrap();

        store.wont_drop.set(true);
        let SaveOutcome::Saved { config, warning } =
            save(home, &empty, &HashMap::new(), Some(&old), false, &store).unwrap()
        else {
            panic!("the save should count");
        };
        assert_eq!(config, empty);
        assert_eq!(get_config(home).unwrap(), empty);
        assert!(warning.unwrap().contains("keyring is locked"));
    }

    /// Codex merges a server it is handed with a same-name one in its own `config.toml`, and
    /// refuses to start when that makes a server of two transports. The save goes through, since
    /// the file is the user's, and says which server, which file and whose folders.
    #[test]
    fn a_save_warns_of_a_codex_server_with_the_other_transport() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let mut config = with_secret_server(
            &envrouter_core::agents::with_agents(get_config(home).unwrap()),
            "github",
            "7F3A",
        );
        config.profiles[0].tools.insert(
            "codex".into(),
            config::ToolConfig {
                env_var: "CODEX_HOME".into(),
                path: "~/.codex-work".into(),
            },
        );
        let theirs = home.join(".codex-work/config.toml");
        std::fs::create_dir_all(theirs.parent().unwrap()).unwrap();
        std::fs::write(&theirs, "[mcp_servers.github]\nurl = \"https://x/mcp\"\n").unwrap();

        let SaveOutcome::Saved { warning, .. } =
            save_config(home, &config, &HashMap::new(), None).unwrap()
        else {
            panic!("the save should count");
        };
        let warning = warning.expect("a warning");
        for part in ["codex", "Work", "github", "~/.codex-work/config.toml"] {
            assert!(warning.contains(part), "{part} missing from: {warning}");
        }
        assert_eq!(get_config(home).unwrap(), config);
        assert!(paths::mcp_launch(home, "p1", "codex").exists());
    }

    /// Start Over leaves the store as it is and the broken file as a backup. A save after it used
    /// to drop every secret the new config didn't name, so putting the backup back brought its
    /// servers back without their secrets. A secret a backup names stays until the backup goes.
    #[test]
    fn a_secret_a_start_over_backup_names_outlives_the_saves_after_it() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let store = FakeStore::default();
        let empty = get_config(home).unwrap();
        let old = with_secret_server(&empty, "github", "7F3A");
        let value = HashMap::from([("7F3A".to_string(), "ghp_old".to_string())]);
        save(home, &old, &value, None, false, &store).unwrap();

        let file = paths::config_file(home);
        let text = std::fs::read_to_string(&file).unwrap();
        std::fs::write(&file, format!("{text}{{ half-typed")).unwrap();
        let backup = reset_unreadable_config(home).unwrap();

        let new = with_secret_server(&empty, "linear", "9B2C");
        let value = HashMap::from([("9B2C".to_string(), "lin_new".to_string())]);
        save(home, &new, &value, None, false, &store).unwrap();
        save(home, &empty, &HashMap::new(), None, false, &store).unwrap();
        let mut stored: Vec<_> = store.secrets.borrow().keys().cloned().collect();
        stored.sort();
        assert_eq!(stored, ["7F3A"], "the backup still names it");

        std::fs::remove_file(backup).unwrap();
        save(home, &new, &HashMap::new(), None, false, &store).unwrap();
        save(home, &empty, &HashMap::new(), None, false, &store).unwrap();
        assert!(store.secrets.borrow().is_empty());
    }

    /// `envrouter apply` and `secret set` read config.json, then save. A window save in
    /// between used to be overwritten; now the CLI's edit is made again over it.
    #[test]
    fn a_cli_save_makes_its_edit_again_over_a_save_made_meanwhile() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let mut calls = 0;
        let CliSave {
            config: saved,
            retried,
            ..
        } = edit_and_save(
            home,
            &HashMap::new(),
            false,
            &FakeStore::default(),
            |config| {
                calls += 1;
                if calls == 1 {
                    // The window saves while the CLI is between its read and its write.
                    let window = with_profile(&config, "p2", "Personal");
                    save_config(home, &window, &HashMap::new(), Some(&config)).unwrap();
                }
                Ok(with_profile(&config, "p1", "Work"))
            },
        )
        .unwrap();
        assert_eq!(calls, 2);
        assert!(retried);
        let names: Vec<_> = saved.profiles.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Personal", "Work"]);
        assert_eq!(get_config(home).unwrap(), saved);
    }

    #[test]
    fn a_cli_save_gives_up_on_a_file_that_keeps_changing() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let mut n = 0;
        let err = edit_and_save(
            home,
            &HashMap::new(),
            false,
            &FakeStore::default(),
            |config| {
                n += 1;
                let other = with_profile(&config, &format!("w{n}"), "Window");
                save_config(home, &other, &HashMap::new(), Some(&config)).unwrap();
                Ok(with_profile(&config, "p1", "Work"))
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("kept changing"), "{err}");
        assert!(get_config(home)
            .unwrap()
            .profiles
            .iter()
            .all(|p| p.id != "p1"));
    }

    /// After `brew upgrade envrouter-cli`, ~/.envrouter/bin still held the old shim, and a CLI
    /// save installed its own only where none was. A save writing a config version the old
    /// shim refuses then left every agent running without a profile until `envrouter install`.
    #[test]
    fn a_cli_save_replaces_a_shim_that_cant_read_the_config_it_writes() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        assert!(cli_installs(home), "no shim yet");
        let shim = paths::shim_binary(home);
        std::fs::create_dir_all(shim.parent().unwrap()).unwrap();
        // Installed the way the app installs one, by a child `dd`: this process never holds a
        // shim open for writing, so a thread of this test run that forks meanwhile can't make
        // running it fail with "Text file busy" on Linux.
        let install = |source: &Path| {
            crate::shims::install_file_with(&shim, source, false).unwrap();
        };
        let install_script = |script: &str| crate::shims::write_executable(&shim, script);
        // A helper that starts servers, so only the shim decides below.
        crate::shims::install_file_with(
            &paths::keychain_helper(home),
            Path::new(env!("ENVROUTER_STAGED_KEYCHAIN")),
            false,
        )
        .unwrap();
        // A shim from 0.7.0 or earlier doesn't know the question: it exits 2, as 0.6.0's does.
        // One that answers an older version is older too.
        for old in [
            "#!/bin/sh\nexit 2\n".to_string(),
            format!("#!/bin/sh\necho {}\n", config::CONFIG_VERSION - 1),
        ] {
            install_script(&old);
            assert!(cli_installs(home), "{old}");
        }
        // A shim that reads this version or a newer one stays: where the app is in use, it's
        // the app's build.
        install_script(&format!("#!/bin/sh\necho {}\n", config::CONFIG_VERSION + 1));
        assert!(!cli_installs(home));
        install(Path::new(env!("ENVROUTER_STAGED_SHIM")));
        assert!(!cli_installs(home));
    }

    /// A save renders a server that needs a secret as the helper's `exec` of a spec. After
    /// `brew upgrade envrouter-cli` the helper in ~/.envrouter/bin is still the old one, which
    /// answers that with its usage line, so every such server would fail when an agent started it.
    #[test]
    fn a_cli_save_replaces_a_helper_that_cant_start_stdio_servers() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let shim = Path::new(env!("ENVROUTER_STAGED_SHIM"));
        let keychain = Path::new(env!("ENVROUTER_STAGED_KEYCHAIN"));
        // A shim that reads this version, so only the helper decides below.
        crate::shims::install_file_with(&paths::shim_binary(home), shim, false).unwrap();
        let helper = paths::keychain_helper(home);
        assert!(cli_installs(home), "no helper yet");
        // A helper from before the launcher prints its usage and exits 2. One that answers an
        // older spec version is older too.
        for old in [
            "#!/bin/sh\nexit 2\n".to_string(),
            format!("#!/bin/sh\necho {}\n", mcp::LAUNCHER_VERSION - 1),
        ] {
            crate::shims::write_executable(&helper, &old);
            assert!(cli_installs(home), "{old}");
        }
        crate::shims::write_executable(
            &helper,
            &format!("#!/bin/sh\necho {}\n", mcp::LAUNCHER_VERSION + 1),
        );
        assert!(!cli_installs(home));
        crate::shims::install_file_with(&helper, keychain, false).unwrap();
        assert!(!cli_installs(home));
    }

    /// An install puts a new helper in place, and the files that name it have to follow: it
    /// renders config.json with the registry's agent rules, as a save would, but doesn't write
    /// it, and a home with no config.json is left without even the folder the save lock would
    /// make.
    #[test]
    fn render_saved_renders_config_json_with_the_registry_and_creates_nothing_without_one() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        render_saved(home).unwrap();
        assert!(!paths::root(home).exists());

        let mut config = with_secret_server(&ConfigState::default(), "github", "7F3A");
        config.agents = agents::with_agents(ConfigState::default()).agents;
        let registry = config.agents["codex"].mcp.clone().unwrap();
        // Codex as a version 6 file names it, before the release that added this rule.
        let codex = config.agents.get_mut("codex").unwrap();
        codex.mcp.as_mut().unwrap().options_before_subcommand = None;
        std::fs::create_dir_all(paths::root(home)).unwrap();
        // Compact, which a save would not write: a rewrite shows.
        let written = serde_json::to_vec(&config).unwrap();
        std::fs::write(paths::config_file(home), &written).unwrap();

        render_saved(home).unwrap();
        let launch = paths::mcp_launch(home, "p1", "claude");
        assert!(launch.exists());
        assert!(launch.with_file_name("stdio/github.json").exists());
        let codex: mcp::Launch =
            serde_json::from_slice(&std::fs::read(paths::mcp_launch(home, "p1", "codex")).unwrap())
                .unwrap();
        assert_eq!(
            codex.options_before_subcommand,
            registry.options_before_subcommand
        );
        assert_eq!(std::fs::read(paths::config_file(home)).unwrap(), written);
    }

    /// The store isn't touched and config.json isn't written when a shim can't be made.
    #[test]
    fn refuses_a_save_whose_shim_is_in_the_way_before_writing_anything() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let store = FakeStore::default();
        let empty = get_config(home).unwrap();
        let shims = paths::shims(home);
        std::fs::create_dir_all(&shims).unwrap();
        std::fs::write(shims.join("claude"), "#!/bin/sh\n").unwrap();
        let mut config = with_secret_server(&empty, "github", "7F3A");
        config.agents = envrouter_core::agents::with_agents(ConfigState::default()).agents;
        let value = HashMap::from([("7F3A".to_string(), "ghp_x".to_string())]);

        let err = save(home, &config, &value, Some(&empty), false, &store).unwrap_err();
        assert!(
            err.to_string().contains("wasn't made by EnvRouter"),
            "{err}"
        );
        assert!(store.secrets.borrow().is_empty());
        assert_eq!(get_config(home).unwrap(), empty);
    }

    fn with_profile(config: &ConfigState, id: &str, name: &str) -> ConfigState {
        let mut config = config.clone();
        config.profiles.push(profile(id, name));
        config
    }

    #[test]
    fn saves_an_edit_of_the_config_on_disk() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let base = get_config(home).unwrap();
        let edited = with_profile(&base, "p1", "Work");
        let outcome = save_config(home, &edited, &HashMap::new(), Some(&base)).unwrap();
        assert_eq!(
            outcome,
            SaveOutcome::Saved {
                config: edited.clone(),
                warning: None,
            }
        );
        assert_eq!(get_config(home).unwrap(), edited);
    }

    /// The CLI (or a hand edit) saved after the window read the config: the window's save is
    /// refused with the file as it is now, and nothing changes.
    #[test]
    fn refuses_an_edit_of_a_config_changed_since() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let base = get_config(home).unwrap();
        let elsewhere = with_profile(&base, "p2", "Personal");
        config::save(&paths::root(home), &elsewhere).unwrap();

        let edited = with_profile(&base, "p1", "Work");
        let outcome = save_config(home, &edited, &HashMap::new(), Some(&base)).unwrap();
        assert_eq!(
            outcome,
            SaveOutcome::Changed {
                config: elsewhere.clone()
            }
        );
        assert_eq!(get_config(home).unwrap(), elsewhere);
        // Without a base, the save goes ahead as before.
        save_config(home, &edited, &HashMap::new(), None).unwrap();
        assert_eq!(get_config(home).unwrap(), edited);
    }

    /// config.json was deleted after the window read it. Merging into an empty config would drop
    /// every profile the edit didn't touch, so the save is refused and writes nothing.
    #[test]
    fn refuses_an_edit_after_the_file_is_deleted() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let base = with_profile(&get_config(home).unwrap(), "p1", "Work");
        save_config(home, &base, &HashMap::new(), None).unwrap();
        let file = paths::config_file(home);
        std::fs::remove_file(&file).unwrap();

        let edited = with_profile(&base, "p2", "Personal");
        let outcome = save_config(home, &edited, &HashMap::new(), Some(&base)).unwrap();
        assert_eq!(outcome, SaveOutcome::Missing);
        assert!(!file.exists());
        // Without a base, as the window saves once the user chooses to write its version back.
        save_config(home, &edited, &HashMap::new(), None).unwrap();
        assert_eq!(get_config(home).unwrap(), edited);
    }

    #[test]
    fn refuses_an_edit_while_the_file_is_broken() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let base = get_config(home).unwrap();
        let file = paths::config_file(home);
        std::fs::write(&file, "{ half-typed").unwrap();
        let edited = with_profile(&base, "p1", "Work");
        assert!(save_config(home, &edited, &HashMap::new(), Some(&base)).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{ half-typed");
    }

    /// Starting over keeps the broken bytes: a file linked in from a dotfiles repository is
    /// copied as it is, the link stays, its target becomes the empty config, and a second reset
    /// takes the next free backup name instead of replacing the first.
    #[cfg(unix)]
    #[test]
    fn starting_over_backs_up_the_broken_file_and_keeps_earlier_backups() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let root = paths::root(home);
        std::fs::create_dir_all(&root).unwrap();
        let target = home.join("dotfiles-config.json");
        let link = paths::config_file(home);
        std::os::unix::fs::symlink(&target, &link).unwrap();

        std::fs::write(&target, "{ half-typed").unwrap();
        let first = reset_unreadable_config(home).unwrap();
        assert_eq!(first, root.join("config.json.bak"));
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "{ half-typed");
        assert!(std::fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(get_config(home).unwrap(), ConfigState::default());

        std::fs::write(&target, "{ again").unwrap();
        let second = reset_unreadable_config(home).unwrap();
        assert_eq!(second, root.join("config.json.bak-2"));
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "{ again");
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "{ half-typed");
    }

    /// Only a parse error is reset: a config that reads, or one from a newer EnvRouter, is
    /// refused with nothing written.
    #[test]
    fn starting_over_refuses_a_config_that_isnt_a_parse_error() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let root = paths::root(home);
        let file = paths::config_file(home);
        let backup = root.join("config.json.bak");

        get_config(home).unwrap();
        let readable = std::fs::read_to_string(&file).unwrap();
        assert!(reset_unreadable_config(home).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), readable);

        let newer = r#"{ "version": 99 }"#;
        std::fs::write(&file, newer).unwrap();
        assert!(reset_unreadable_config(home).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), newer);
        assert!(!backup.exists());
    }

    /// Config.json is revealed, so it's a file; the root and a profile's rendered MCP files are
    /// opened, so they're folders. `Place` in `src/lib/types.ts`.
    #[test]
    fn locates_what_the_window_shows() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        get_config(home).unwrap();
        let rendered = paths::mcp(home).join("p");
        std::fs::create_dir_all(&rendered).unwrap();
        let mcp = Place::McpFiles {
            profile_id: "p".into(),
        };
        assert_eq!(
            locate(home, &Place::Config).unwrap(),
            Located::File(paths::root(home).join("config.json"))
        );
        assert_eq!(
            locate(home, &Place::Root).unwrap(),
            Located::Folder(paths::root(home))
        );
        assert_eq!(locate(home, &mcp).unwrap(), Located::Folder(rendered));
    }

    /// A profile that was never rendered has no folder to show, and an id that climbs out of
    /// the MCP folder isn't a profile at all.
    #[test]
    fn refuses_an_mcp_folder_that_is_missing_or_not_a_profile() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        get_config(home).unwrap();
        let place = |id: &str| Place::McpFiles {
            profile_id: id.into(),
        };
        // The words `src/dev/mockTauri.ts` repeats.
        assert_eq!(
            locate(home, &place("p")).unwrap_err().to_string(),
            "This profile has no MCP files yet. EnvRouter writes them when the profile is saved with an MCP server."
        );
        assert_eq!(
            locate(home, &place("../x")).unwrap_err().to_string(),
            "That isn't a profile."
        );
    }

    /// Opening hands the path to the system, which runs a file it is given, so a folder to open
    /// has to be one: a regular file, or a link to one, is refused; a link to a folder is fine.
    #[cfg(unix)]
    #[test]
    fn opens_only_a_folder_and_not_a_file_or_a_link_to_one() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let program = home.join("program");
        std::fs::write(&program, "").unwrap();
        let mcp = |id: &str| Place::McpFiles {
            profile_id: id.into(),
        };

        std::fs::write(paths::root(home), "").unwrap();
        assert_eq!(
            locate(home, &Place::Root).unwrap_err().to_string(),
            "~/.envrouter isn't a folder, so EnvRouter won't open it."
        );

        std::fs::remove_file(paths::root(home)).unwrap();
        std::fs::create_dir_all(paths::mcp(home)).unwrap();
        std::os::unix::fs::symlink(&program, paths::mcp(home).join("to-file")).unwrap();
        assert_eq!(
            locate(home, &mcp("to-file")).unwrap_err().to_string(),
            "This profile's MCP files aren't in a folder, so EnvRouter won't open them."
        );

        let target = home.join("elsewhere");
        std::fs::create_dir(&target).unwrap();
        std::os::unix::fs::symlink(&target, paths::mcp(home).join("to-folder")).unwrap();
        assert_eq!(
            locate(home, &mcp("to-folder")).unwrap(),
            Located::Folder(paths::mcp(home).join("to-folder"))
        );
    }

    /// Not finding a place is told apart from not being able to look: with `~/.envrouter` a file,
    /// config.json can't be searched for, and that says so instead of "no config.json yet".
    #[test]
    fn passes_on_a_failure_to_look_instead_of_calling_it_absence() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        std::fs::write(paths::root(home), "").unwrap();
        assert!(matches!(
            locate(home, &Place::Config),
            Err(Error::Io { .. })
        ));
    }

    /// A trigger folder, and what is inside one (a checked folder files under its trigger), can be
    /// shown; nothing else can, so the window still can't ask for an arbitrary path.
    #[test]
    fn shows_only_what_a_trigger_folder_covers() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let mut config = ConfigState::default();
        config.profiles.push(Profile {
            trigger_paths: vec!["~/dev/*".into(), "~/a*b".into()],
            ..profile("p", "Work")
        });
        envrouter_core::config::save(&paths::root(home), &config).unwrap();
        let trigger = |folder: &Path| Place::Trigger {
            folder: folder.display().to_string(),
        };
        let dev = home.join("dev");
        let inside = dev.join("api");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::create_dir(home.join("other")).unwrap();

        assert_eq!(
            locate(home, &trigger(&dev)).unwrap(),
            Located::File(dev.clone())
        );
        assert_eq!(
            locate(home, &trigger(&inside)).unwrap(),
            Located::File(inside)
        );
        for folder in [home.join("other"), home.to_path_buf()] {
            assert_eq!(
                locate(home, &trigger(&folder)).unwrap_err().to_string(),
                format!(
                    "`{}` isn't a trigger folder any more: config.json changed since the window showed it.",
                    folder.display()
                )
            );
        }
        for folder in [dev.join("..").join("other"), PathBuf::from("dev")] {
            assert_eq!(
                locate(home, &trigger(&folder)).unwrap_err().to_string(),
                "That isn't a valid trigger folder.",
                "{folder:?}"
            );
        }
    }

    /// A trigger folder that was moved or deleted is told in a sentence, not the system's
    /// "No such file or directory (os error 2)", which the opener also gives when it can't reach
    /// the file manager. The window sets the backticked path as a value.
    #[test]
    fn says_a_trigger_folder_is_gone() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let mut config = ConfigState::default();
        config.profiles.push(Profile {
            trigger_paths: vec!["~/dev".into()],
            ..profile("p", "Work")
        });
        envrouter_core::config::save(&paths::root(home), &config).unwrap();
        let gone = Place::Trigger {
            folder: home.join("dev").display().to_string(),
        };
        assert_eq!(
            locate(home, &gone).unwrap_err().to_string(),
            format!(
                "There's no `{}` any more. It may have been moved or deleted.",
                home.join("dev").display()
            )
        );
    }

    /// With config.json unreadable the check can't be made, and that is what the refusal says, not
    /// that the folder is no trigger.
    #[test]
    fn says_when_a_trigger_folder_cannot_be_checked_against_an_unreadable_config() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        std::fs::create_dir_all(paths::root(home)).unwrap();
        std::fs::write(paths::root(home).join("config.json"), "{ not json").unwrap();
        let folder = home.join("dev");
        let message = locate(
            home,
            &Place::Trigger {
                folder: folder.display().to_string(),
            },
        )
        .unwrap_err()
        .to_string();
        assert!(
            message.starts_with(&format!(
                "Couldn't check `{}` against config.json: ",
                folder.display()
            )),
            "{message}"
        );
    }

    /// A trigger that is a link to nothing reads as gone, in the sentence, not as present and then
    /// refused by the file manager in its own words.
    #[cfg(unix)]
    #[test]
    fn reads_a_dangling_link_as_a_trigger_folder_that_is_gone() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let mut config = ConfigState::default();
        config.profiles.push(Profile {
            trigger_paths: vec!["~/link".into()],
            ..profile("p", "Work")
        });
        envrouter_core::config::save(&paths::root(home), &config).unwrap();
        let link = home.join("link");
        std::os::unix::fs::symlink(home.join("nowhere"), &link).unwrap();
        assert_eq!(
            locate(
                home,
                &Place::Trigger {
                    folder: link.display().to_string()
                }
            )
            .unwrap_err()
            .to_string(),
            format!(
                "There's no `{}` any more. It may have been moved or deleted.",
                link.display()
            )
        );
    }

    /// `SaveOutcome` in `src/lib/types.ts`.
    #[test]
    fn wire_format_matches_the_typescript_types() {
        let config = ConfigState::default();
        let saved = serde_json::to_value(SaveOutcome::Saved {
            config: config.clone(),
            warning: Some("w".into()),
        })
        .unwrap();
        assert_eq!(saved["status"], "saved");
        assert_eq!(saved["warning"], "w");
        assert_eq!(saved["config"], serde_json::to_value(&config).unwrap());
        let changed = serde_json::to_value(SaveOutcome::Changed { config }).unwrap();
        assert_eq!(changed["status"], "changed");
        assert!(changed["config"]["profiles"].is_array());
        let missing = serde_json::to_value(SaveOutcome::Missing).unwrap();
        assert_eq!(missing, serde_json::json!({ "status": "missing" }));
        // `Place` in src/lib/types.ts, the four kinds the window sends and the tray emits.
        let places = [
            (Place::Config, serde_json::json!({ "kind": "config" })),
            (Place::Root, serde_json::json!({ "kind": "root" })),
            (
                Place::McpFiles {
                    profile_id: "p".into(),
                },
                serde_json::json!({ "kind": "mcpFiles", "profileId": "p" }),
            ),
            (
                Place::Trigger {
                    folder: "/h/dev".into(),
                },
                serde_json::json!({ "kind": "trigger", "folder": "/h/dev" }),
            ),
        ];
        for (place, json) in places {
            assert_eq!(serde_json::to_value(&place).unwrap(), json);
            assert_eq!(serde_json::from_value::<Place>(json).unwrap(), place);
        }
        // `ConfigFault` in src/lib/types.ts: the one rejection that carries a kind.
        let fault = ConfigFault::from(Error::Invalid("m".into()));
        assert_eq!(
            serde_json::to_value(fault).unwrap(),
            serde_json::json!({ "kind": "other", "message": "m", "path": null })
        );
        let fault = ConfigFault::in_home(Error::Invalid("m".into()), Path::new("/h"));
        assert_eq!(
            serde_json::to_value(fault).unwrap()["path"],
            "/h/.envrouter/config.json"
        );
        // `SetupStatus`: the words come from `Platform`, the paths from `paths`.
        let setup = SetupStatus {
            platform: Platform::MacOs,
            secret_store: "Keychain",
            sealed_label: "In Keychain",
            secret_store_problem: None,
            file_manager: Platform::MacOs.file_manager(),
            reveal_verb: Platform::MacOs.reveal_verb(),
            shim_installed: true,
            shims_dir: "/h/.envrouter/shims".into(),
            shim_path: paths::shim_binary(Path::new("/h")).display().to_string(),
            shells: Vec::new(),
            missing_agents: Some(vec!["copilot".into()]),
            checked_before: true,
        };
        assert_eq!(
            serde_json::to_string(&setup).unwrap(),
            r#"{"platform":"macos","secretStore":"Keychain","sealedLabel":"In Keychain","secretStoreProblem":null,"fileManager":"Finder","revealVerb":"Reveal","shimInstalled":true,"shimsDir":"/h/.envrouter/shims","shimPath":"/h/.envrouter/bin/envrouter-shim","shells":[],"missingAgents":["copilot"],"checkedBefore":true}"#
        );
    }

    /// Only a check that finds the tool routed, and able to start, counts for first-run's last step.
    #[test]
    fn only_a_routed_check_is_noted_as_done() {
        let home = tempfile::tempdir().unwrap();
        let routed = |mcp_clashes| FolderCheck::Routed {
            profile: None,
            profile_id: None,
            env_var: None,
            value: None,
            mcp: Vec::new(),
            mcp_managed_by: None,
            mcp_clashes,
            via_alias: None,
            real: "/bin/t".into(),
        };
        let clash = McpClash {
            server: "x".into(),
            file: "/h/.codex/config.toml".into(),
            openable: true,
        };
        note_if_routed(home.path(), &FolderCheck::NotFound);
        note_if_routed(home.path(), &routed(vec![clash]));
        assert!(!checked_once::is_recorded(home.path()));

        note_if_routed(home.path(), &routed(Vec::new()));
        assert!(checked_once::is_recorded(home.path()));
    }

    /// A secret store check that panics is a problem told, not the absence of one.
    #[test]
    fn a_panicking_store_check_is_reported_as_a_problem() {
        let checked = std::thread::spawn(|| -> Option<String> { panic!("the check broke") }).join();
        let problem = store_problem(checked).expect("a problem is reported");
        assert!(problem.starts_with("Couldn't check the "), "{problem}");
        assert_eq!(store_problem(Ok(None)), None);
    }

    /// A failure to find the agents is told once for each period it's believed, not on every
    /// focus; a different one, or the same after the period, is news again.
    #[test]
    fn a_probe_failure_is_told_once_per_period() {
        let start = Instant::now();
        let period = Duration::from_secs(60);
        let mut last = None;
        assert!(first_in_period(&mut last, "zsh hung", start, period));
        assert!(!first_in_period(
            &mut last,
            "zsh hung",
            start + Duration::from_secs(5),
            period
        ));
        assert!(first_in_period(
            &mut last,
            "no zsh",
            start + Duration::from_secs(6),
            period
        ));
        assert!(first_in_period(
            &mut last,
            "no zsh",
            start + Duration::from_secs(70),
            period
        ));
    }
}
