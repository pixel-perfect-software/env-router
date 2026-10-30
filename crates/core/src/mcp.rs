//! Handing a profile's MCP servers to an agent when it starts.
//!
//! On every save the app renders, for each profile that uses servers and each agent with an
//! MCP descriptor, a launch manifest listing the arguments that load them, and in a file
//! dialect (Claude, Copilot) one config file per server for those arguments to name. Codex's
//! dialect is the argument itself, one inline TOML table per server, so it has no such file. The
//! shim reads only the manifest, so it never needs an agent's format. Secret values are nowhere
//! on disk, and a secret reaches only the process that uses it:
//!
//! - A stdio server that needs one is rendered as the secrets helper's `exec` entry, with a
//!   [`StdioSpec`] beside it holding the real command and its secrets as references. The helper
//!   reads the store when the agent starts the server and `exec`s the command with the values,
//!   so they are in that server's environment or arguments and in no other process.
//! - A remote server's file refers to `${ENVROUTER_SECRET_<ID>}` in its headers, which the agent
//!   expands from its own environment, so the shim reads the store and sets it on the agent.
//!   Codex expands nothing, but reads a header's value from a variable it names
//!   (`env_http_headers`), so its table names `ENVROUTER_SECRET_<ID>` and the shim sets the same
//!   variable.

#[cfg(unix)]
use std::collections::HashSet;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::config::{
    self, ConfigState, LeadingOptions, McpDialect, McpServer, McpUse, McpValue, Profile,
};
use crate::error::{Error, Result};
use crate::paths;
use crate::secrets;

/// What a secret's variable begins with. The launcher removes every variable with it from a
/// server's environment, so a server never sees the secrets of the agent's remote servers.
pub const SECRET_VAR_PREFIX: &str = "ENVROUTER_SECRET_";

/// The first argument of `envrouter-keychain` that starts a stdio server from its [`StdioSpec`].
pub const LAUNCH_SUBCOMMAND: &str = "exec";

/// The spec format `exec` reads, which the helper prints for `--launcher-version`
/// ([`paths::KEYCHAIN_LAUNCHER_VERSION_ARG`]). A renderer writes specs only for a helper that
/// reads this version or a newer one. 2: `exec` fills in the variables a plain value names, which
/// a renderer of 2 counts on (a 1 helper passed `${NAME}` to the server as text), so a CLI save
/// replaces a 1 helper.
pub const LAUNCHER_VERSION: u32 = 2;

/// How long Codex waits for a server that starts through the launcher: the store's own read limit
/// ([`secrets::READ_TIMEOUT`]) plus Codex's default for a server's start (30 s in 0.164.0), so a
/// slow store doesn't eat the server's share.
const LAUNCHER_STARTUP_TIMEOUT_SECS: u64 = secrets::READ_TIMEOUT.as_secs() + 30;

/// The manifest at [`paths::mcp_launch`]: what to add to one agent's command line in one
/// profile's folders.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Launch {
    /// Any of these among the user's own arguments turns injection off for that run.
    #[serde(default)]
    pub skip_any_args: Vec<String>,
    /// A run whose subcommand is one of these gets no injection. Where the subcommand sits is
    /// `options_before_subcommand`'s to say.
    #[serde(default)]
    pub skip_subcommands: Vec<String>,
    /// `None`: the agent reads a subcommand only as its first argument (Claude reads
    /// `claude --debug daemon` as a prompt). `Some`: it reads one past the options ahead of it
    /// (`codex -C ~/proj queue`), and these name the options that take a value. A manifest
    /// without the key (one rendered by 0.10) reads as `None`.
    #[serde(default)]
    pub options_before_subcommand: Option<LeadingOptions>,
    /// While any of these files exists, no run gets injection: the agent refuses servers given
    /// at launch then.
    #[serde(default)]
    pub skip_if_present: Vec<String>,
    #[serde(default)]
    pub servers: Vec<LaunchServer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchServer {
    pub name: String,
    /// Each a single `--flag=value` argument, added before the user's own: the one that loads
    /// the server (a file to load, or the whole server, per the dialect) and its deny arguments.
    pub args: Vec<String>,
    /// The Keychain secrets the agent's environment must carry for the server's file: a remote
    /// server's header secrets. Without all of them it's left out. A stdio server that needs
    /// secrets starts through the launcher, which reads them itself, so it lists none.
    #[serde(default)]
    pub secrets: Vec<String>,
}

/// What the shim adds to one run.
#[derive(Debug, Default, PartialEq)]
pub struct Injection {
    pub servers: Vec<String>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    /// Servers left out because a secret they need couldn't be read.
    pub dropped: Vec<String>,
}

impl Launch {
    /// Whether to inject into a run with these arguments: not when its subcommand is one of
    /// [`Launch::skip_subcommands`], and not when any of [`Launch::skip_any_args`] is among them.
    pub fn applies_to(&self, user_args: &[OsString]) -> bool {
        !self.skips_subcommand(user_args)
            && !user_args
                .iter()
                .any(|arg| self.skip_any_args.iter().any(|skip| arg == skip.as_str()))
    }

    /// Whether the run's subcommand is a skipped one: its first argument, or, when
    /// [`Launch::options_before_subcommand`] is set, the first word past the options ahead of it.
    fn skips_subcommand(&self, user_args: &[OsString]) -> bool {
        if self.skip_subcommands.is_empty() {
            return false;
        }
        let word = match &self.options_before_subcommand {
            None => user_args.first().map(OsString::as_os_str),
            Some(options) => subcommand(user_args, options),
        };
        word.is_some_and(|word| {
            self.skip_subcommands
                .iter()
                .any(|skip| word == skip.as_str())
        })
    }

    /// The first of [`Launch::skip_if_present`] that exists. Checked on every run, since a
    /// machine can come under management after the last save.
    pub fn managed_by(&self) -> Option<&str> {
        self.skip_if_present
            .iter()
            .map(String::as_str)
            .find(|path| Path::new(path).exists())
    }

    pub fn secret_ids(&self) -> BTreeSet<&str> {
        self.servers
            .iter()
            .flat_map(|server| &server.secrets)
            .map(String::as_str)
            .collect()
    }

    /// The servers whose secrets are all in `secrets`, keyed by id, and what loads them.
    pub fn inject(&self, secrets: &HashMap<String, String>) -> Injection {
        let mut injection = Injection::default();
        let mut env = BTreeMap::new();
        for server in &self.servers {
            if !server.secrets.iter().all(|id| secrets.contains_key(id)) {
                injection.dropped.push(server.name.clone());
                continue;
            }
            for id in &server.secrets {
                env.insert(secret_var(id), secrets[id].clone());
            }
            injection.servers.push(server.name.clone());
            injection.args.extend(server.args.iter().cloned());
        }
        injection.env = env.into_iter().collect();
        injection
    }
}

/// The option [`subcommand`] has just stepped over, and so what the next word is.
enum Open {
    /// None: a word that isn't dashed is the subcommand (or a prompt).
    Nothing,
    /// One that takes a single value: the next word is that value.
    One,
    /// One that takes several (`-i a.png b.png`): words are values until a dashed one.
    Many,
}

/// The word an agent reads as its subcommand past the leading options in `options`: the first
/// word that is neither an option nor an option's value. It is a subcommand only if the agent
/// knows it, and a prompt is as good a first word, so the scan stops there. `None` when `--`
/// (every later word is a positional) or the end of the arguments comes first. One pass over the
/// bytes, no allocation.
///
/// A lone `-` and `""` are words, as clap's `is_stdio` treats `-`. A dashed word that no entry
/// equals, an attached value (`--cd=dir`, `-Cdir`) among them, takes no value. A dashed word
/// while an option is open ends it, as clap parses it as an option before the open one's value.
fn subcommand<'a>(args: &'a [OsString], options: &LeadingOptions) -> Option<&'a OsStr> {
    let mut open = Open::Nothing;
    for arg in args {
        let word = arg.as_encoded_bytes();
        if !matches!(word, [b'-', _, ..]) {
            match open {
                Open::Nothing => return Some(arg.as_os_str()),
                Open::One => open = Open::Nothing,
                Open::Many => {}
            }
        } else if word == b"--" {
            return None;
        } else if options.take_one.iter().any(|entry| arg == entry.as_str()) {
            open = Open::One;
        } else if options.take_many.iter().any(|entry| arg == entry.as_str()) {
            open = Open::Many;
        } else {
            open = Open::Nothing;
        }
    }
    None
}

/// What `envrouter-keychain exec` starts for one stdio server that needs a secret: the server's
/// command with its values still references to the store, never the secrets themselves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StdioSpec {
    /// The server's name, for the launcher's messages.
    pub server: String,
    /// The home the helper and the secret store belong to. Rendered, not read from `HOME`,
    /// which some agents (Copilot) don't pass to a server.
    pub home: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<McpValue>,
    #[serde(default)]
    pub env: BTreeMap<String, McpValue>,
}

/// Why a [`StdioSpec`] couldn't become a command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unresolved {
    /// A secret the store doesn't hold, by id.
    Secret(String),
    /// A variable a plain value names that isn't set and has no default.
    Variable(String),
}

/// A [`StdioSpec`] with its secrets filled in: what the launcher runs.
#[derive(Debug, Clone, PartialEq)]
pub struct StdioCommand {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

impl StdioSpec {
    /// The ids of the secrets the command refers to.
    pub fn secret_ids(&self) -> BTreeSet<&str> {
        self.args
            .iter()
            .chain(self.env.values())
            .filter_map(McpValue::secret_id)
            .collect()
    }

    /// The variables its plain values name (`${NAME}`, `${NAME:-default}`), which the launcher
    /// needs in the environment the agent starts it with. A remote server's secret is never one.
    pub fn variables(&self) -> BTreeSet<&str> {
        let plain = self
            .args
            .iter()
            .chain(self.env.values())
            .filter_map(|value| match value {
                McpValue::Plain(text) => Some(text.as_str()),
                McpValue::Secret { .. } => None,
            });
        std::iter::once(self.command.as_str())
            .chain(plain)
            .flat_map(references)
            .map(|(_, name, _)| name)
            .filter(|name| !name.starts_with(SECRET_VAR_PREFIX))
            .collect()
    }

    /// Every secret filled in from `secrets`, and every variable a plain value names from `var`,
    /// as the agent filled them in before the launcher started servers in its place (Claude Code
    /// expands `${NAME}` and `${NAME:-default}` in a server's command, args and env). A remote
    /// server's secret, which the shim sets on the agent, is never a variable a value can name.
    pub fn resolve(
        &self,
        secrets: &HashMap<String, String>,
        var: impl Fn(&str) -> Option<String>,
    ) -> std::result::Result<StdioCommand, Unresolved> {
        let var = |name: &str| {
            if name.starts_with(SECRET_VAR_PREFIX) {
                None
            } else {
                var(name)
            }
        };
        let expand = |text: &str| expand_vars(text, var).map_err(Unresolved::Variable);
        let fill = |value: &McpValue| -> std::result::Result<String, Unresolved> {
            match value {
                McpValue::Plain(text) => expand(text),
                McpValue::Secret { secret } => secrets
                    .get(secret)
                    .cloned()
                    .ok_or_else(|| Unresolved::Secret(secret.clone())),
            }
        };
        let args = self
            .args
            .iter()
            .map(fill)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut env = Vec::with_capacity(self.env.len());
        for (name, value) in &self.env {
            env.push((name.clone(), fill(value)?));
        }
        Ok(StdioCommand {
            program: expand(&self.command)?,
            args,
            env,
        })
    }
}

/// Each `${NAME}` or `${NAME:-default}` in `text`: where it is, the name, and the default.
/// Anything else with a `$` (`$NAME`, `${NAME-x}`, `${not a name}`) isn't one.
fn references(text: &str) -> impl Iterator<Item = (std::ops::Range<usize>, &str, Option<&str>)> {
    let mut from = 0;
    std::iter::from_fn(move || {
        while let Some(start) = text[from..].find("${").map(|at| from + at) {
            let body = start + 2;
            let end = body + text[body..].find('}')?;
            let (name, default) = match text[body..end].split_once(":-") {
                Some((name, default)) => (name, Some(default)),
                None => (&text[body..end], None),
            };
            if config::is_env_var_name(name) {
                from = end + 1;
                return Some((start..from, name, default));
            }
            from = body;
        }
        None
    })
}

/// `text` with its references filled in from `var`. An unset or empty variable takes its default
/// (a shell's `:-`); an unset one with none is the error, by name, as Claude Code refuses a server
/// config naming one. A value that is the reference itself counts as unset: an agent told to pass
/// `"NAME": "${NAME}"` on (Copilot) may hand it over as typed when `NAME` isn't set.
fn expand_vars(
    text: &str,
    var: impl Fn(&str) -> Option<String>,
) -> std::result::Result<String, String> {
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    for (at, name, default) in references(text) {
        out.push_str(&text[copied..at.start]);
        let value = var(name).filter(|value| *value != format!("${{{name}}}"));
        match (value, default) {
            (Some(value), Some(default)) if value.is_empty() => out.push_str(default),
            (Some(value), _) => out.push_str(&value),
            (None, Some(default)) => out.push_str(default),
            (None, None) => return Err(name.to_owned()),
        }
        copied = at.end;
    }
    out.push_str(&text[copied..]);
    Ok(out)
}

/// Reads a spec the launcher was given. One a save stopped rendering is removed after
/// `RETIRED_GRACE`, so a missing spec is an `Error::Io` of kind `NotFound`; a file that isn't a
/// spec is an `Error::Json`.
pub fn load_stdio_spec(path: &Path) -> Result<StdioSpec> {
    let text = fs::read_to_string(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| Error::Json {
        path: path.to_path_buf(),
        source,
    })
}

/// The variable a rendered file reads a secret from.
pub fn secret_var(id: &str) -> String {
    format!("{SECRET_VAR_PREFIX}{id}")
}

/// Reads the manifest, or `None` if there isn't one: the profile gives this agent no servers.
pub fn load_launch(home: &Path, profile_id: &str, command: &str) -> Result<Option<Launch>> {
    // Only a hand-edited config has an id that isn't a plain name, and it never got files.
    if !config::is_file_name(profile_id) {
        return Ok(None);
    }
    let path = paths::mcp_launch(home, profile_id, command);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(Error::Io { path, source }),
    };
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|source| Error::Json { path, source })
}

/// The servers `profile` hands `tool`, from the config alone: what a run would get once the
/// files are rendered and every secret is readable.
pub fn servers_for(config: &ConfigState, profile: &Profile, tool: &str) -> Vec<String> {
    let Some(injection) = config.agents.get(tool).and_then(|agent| agent.mcp.as_ref()) else {
        return Vec::new();
    };
    profile
        .mcp_servers
        .keys()
        .filter(|name| {
            config
                .mcp_servers
                .get(*name)
                .is_some_and(|server| injection.dialect.takes(server))
        })
        .cloned()
        .collect()
}

/// Every file under [`paths::mcp`] for `config`, with its contents.
pub fn render(config: &ConfigState, home: &Path) -> Vec<(PathBuf, String)> {
    let mut files = Vec::new();
    for profile in config.profiles.iter().filter(|p| !p.mcp_servers.is_empty()) {
        for (command, injection) in &config.agents {
            let Some(injection) = &injection.mcp else {
                continue;
            };
            let launch_path = paths::mcp_launch(home, &profile.id, command);
            let dir = launch_path
                .parent()
                .expect("the manifest is inside a folder");
            let mut launch = Launch {
                skip_any_args: injection.skip_any_args.clone(),
                skip_subcommands: injection.skip_subcommands.clone(),
                options_before_subcommand: injection.options_before_subcommand.clone(),
                skip_if_present: injection.skip_if_present.clone(),
                servers: Vec::new(),
            };
            for (name, using) in &profile.mcp_servers {
                let Some(server) = config.mcp_servers.get(name) else {
                    continue;
                };
                if !injection.dialect.takes(server) {
                    continue;
                }
                // In their own folders, so a server named `launch` can't collide.
                let spec_file = dir.join("stdio").join(format!("{name}.json"));
                let (load, spec) = match injection.dialect {
                    McpDialect::Codex => {
                        let (table, spec) = codex_table(name, server, using, home, &spec_file);
                        (format!("mcp_servers.{name}={table}"), spec)
                    }
                    McpDialect::Claude | McpDialect::Copilot => {
                        let file = dir.join("servers").join(format!("{name}.json"));
                        let (contents, spec) =
                            server_file(injection.dialect, name, server, home, &spec_file);
                        files.push((file.clone(), pretty(&contents)));
                        (file.display().to_string(), spec)
                    }
                };
                if let Some(spec) = spec {
                    files.push((spec_file, pretty(&spec)));
                }
                let mut args = vec![format!("{}{load}", injection.config_arg)];
                if let Some(deny_arg) = &injection.deny_arg {
                    args.extend(deny_args(injection.dialect, deny_arg, name, using));
                }
                launch.servers.push(LaunchServer {
                    name: name.clone(),
                    args,
                    secrets: agent_secret_ids(server),
                });
            }
            files.push((launch_path, pretty(&launch)));
        }
    }
    files
}

/// How long a server file, or a stdio spec, outlives the save that stopped naming it. A shim that
/// read the old manifest just before the save hands the agent that file, and the agent opens it
/// as it starts. A spec is read again at every reconnect, since an agent runs the launcher each
/// time it starts the server: a session that began before the save finds a server removed more
/// than this long ago gone (the launcher says to restart the agent).
#[cfg(unix)]
const RETIRED_GRACE: Duration = Duration::from_secs(600);

/// Writes what [`render`] gives, then removes the rest of [`paths::mcp`]. New files land before
/// old ones go, so a tool starting mid-save never finds a manifest missing. A manifest that's no
/// longer rendered goes at once, so no new run gets servers the config dropped; a server file or
/// a spec goes only once it's been unnamed for [`RETIRED_GRACE`], at a later save, since a run
/// that read the old manifest may still open it.
#[cfg(unix)]
pub fn sync(config: &ConfigState, home: &Path) -> Result<()> {
    sync_at(config, home, SystemTime::now())
}

#[cfg(unix)]
fn sync_at(config: &ConfigState, home: &Path, now: SystemTime) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let root = paths::mcp(home);
    let files = render(config, home);
    if files.is_empty() && !root.exists() {
        return Ok(());
    }
    let io_err = |path: &Path| {
        let path = path.to_path_buf();
        move |source| Error::Io { path, source }
    };
    fs::create_dir_all(&root).map_err(io_err(&root))?;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).map_err(io_err(&root))?;
    for (path, contents) in &files {
        config::write_private(path, contents)?;
    }
    let keep: HashSet<&Path> = files.iter().map(|(path, _)| path.as_path()).collect();
    let now = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let mut retired = Retired {
        // Unreadable means every stale file counts as retired now: it's kept longer, never lost.
        since: fs::read_to_string(paths::mcp_retired(home))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default(),
        now,
        seen: HashSet::new(),
    };
    remove_stale(&root, 0, &keep, &mut retired)?;
    let since: BTreeMap<_, _> = retired
        .since
        .into_iter()
        .filter(|(path, _)| retired.seen.contains(path))
        .collect();
    let record = paths::mcp_retired(home);
    if since.is_empty() {
        match fs::remove_file(&record) {
            Err(err) if err.kind() != ErrorKind::NotFound => Err(io_err(&record)(err)),
            _ => Ok(()),
        }
    } else {
        config::write_private(&record, pretty(&since))
    }
}

/// The stale server files [`sync`] is keeping, by path, with the time each went stale.
#[cfg(unix)]
struct Retired {
    since: BTreeMap<PathBuf, u64>,
    now: u64,
    /// The ones still on disk, so a file removed by hand drops out of the record.
    seen: HashSet<PathBuf>,
}

/// Removes what in `dir` isn't in `keep`: a manifest at once, a server file or a spec once it's
/// been retired for [`RETIRED_GRACE`], and folders left empty. Links are removed, never followed.
/// `depth` counts folders below [`paths::mcp`]: a manifest is the `launch.json` in
/// `<profile>/<agent>/`, so a server named `launch` keeps its grace like any other.
/// Only [`sync`] uses it, which is Unix-only until Windows gets its own.
#[cfg(unix)]
fn remove_stale(
    dir: &Path,
    depth: usize,
    keep: &HashSet<&Path>,
    retired: &mut Retired,
) -> Result<()> {
    let io_err = |path: &Path| {
        let path = path.to_path_buf();
        move |source| Error::Io { path, source }
    };
    for entry in fs::read_dir(dir).map_err(io_err(dir))? {
        let path = entry.map_err(io_err(dir))?.path();
        let meta = fs::symlink_metadata(&path).map_err(io_err(&path))?;
        if meta.is_dir() {
            remove_stale(&path, depth + 1, keep, retired)?;
            if fs::read_dir(&path).map_err(io_err(&path))?.next().is_none() {
                fs::remove_dir(&path).map_err(io_err(&path))?;
            }
            continue;
        }
        if keep.contains(path.as_path()) {
            continue;
        }
        let since = *retired.since.entry(path.clone()).or_insert(retired.now);
        let manifest = depth == 2
            && path
                .file_name()
                .is_some_and(|name| name == paths::MCP_LAUNCH_FILE);
        if manifest || retired.now.saturating_sub(since) >= RETIRED_GRACE.as_secs() {
            fs::remove_file(&path).map_err(io_err(&path))?;
        } else {
            retired.seen.insert(path);
        }
    }
    Ok(())
}

fn pretty(value: &impl Serialize) -> String {
    let json = serde_json::to_string_pretty(value).expect("rendered files always serialize");
    format!("{json}\n")
}

/// The arguments a stdio server runs with. `npx` gets `--prefix=<home>` first: agents start
/// servers in the project folder, and npm refuses to run (`EBADDEVENGINES`) in a project whose
/// `package.json` pins another package manager under `devEngines`. The prefix only moves where
/// npm looks for a project; the server still runs in the project folder. A `--prefix` of the
/// user's own, among npx's options before the package, stays. The cost: npx no longer sees the
/// project's own `node_modules/.bin` or its `.npmrc`, so a server installed only in the project,
/// or from a registry only the project's `.npmrc` configures, needs its own `--prefix`.
fn launch_args(command: &str, mut args: Vec<McpValue>, home: &Path) -> Vec<McpValue> {
    let npx = Path::new(command)
        .file_name()
        .is_some_and(|name| name == "npx");
    // A locked value can't be an option of the user's own.
    let own_prefix = args
        .iter()
        .map_while(|arg| match arg {
            McpValue::Plain(text) if text.starts_with('-') => Some(text),
            _ => None,
        })
        .any(|arg| arg.starts_with("--prefix"));
    if npx && !own_prefix {
        args.insert(0, McpValue::Plain(format!("--prefix={}", home.display())));
    }
    args
}

/// The text a rendered file holds for a value that is read from the agent's environment.
fn text(value: &McpValue) -> String {
    match value {
        McpValue::Plain(text) => text.clone(),
        McpValue::Secret { secret } => format!("${{{}}}", secret_var(secret)),
    }
}

fn text_map(values: &BTreeMap<String, McpValue>) -> Map<String, Value> {
    values
        .iter()
        .map(|(key, value)| (key.clone(), Value::String(text(value))))
        .collect()
}

/// The secrets the agent's own environment has to carry for `server`: a remote server's header
/// secrets, which the agent expands. A stdio server's are the launcher's, read when it starts.
fn agent_secret_ids(server: &McpServer) -> Vec<String> {
    match server {
        McpServer::Stdio { .. } => Vec::new(),
        McpServer::Http { .. } | McpServer::Sse { .. } => {
            server.secret_ids().into_iter().map(str::to_owned).collect()
        }
    }
}

/// How an agent starts one stdio server: the server's own command, or the helper's `exec` when it
/// needs a secret.
struct StdioRun {
    command: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    /// For the helper's `exec`: the variables the spec's plain values name, which an agent that
    /// hands a server only some of its environment (Copilot, Codex) must be told to pass on.
    passed: Vec<String>,
}

/// What an agent runs for a stdio server, and the [`StdioSpec`] the helper reads when that is
/// the helper's `exec` of `spec_file`. A server that needs no secret keeps its real command, so an
/// allowlist that names it still matches.
fn stdio_run(
    name: &str,
    command: &str,
    args: &[McpValue],
    env: &BTreeMap<String, McpValue>,
    home: &Path,
    spec_file: &Path,
) -> (StdioRun, Option<StdioSpec>) {
    let args = launch_args(command, args.to_vec(), home);
    let needs_secret = args
        .iter()
        .chain(env.values())
        .any(|v| v.secret_id().is_some());
    if needs_secret {
        let spec = StdioSpec {
            server: name.to_owned(),
            home: home.display().to_string(),
            command: command.to_owned(),
            args,
            env: env.clone(),
        };
        let run = StdioRun {
            command: paths::keychain_helper(home).display().to_string(),
            args: vec![
                LAUNCH_SUBCOMMAND.to_owned(),
                spec_file.display().to_string(),
            ],
            env: BTreeMap::new(),
            passed: spec.variables().into_iter().map(str::to_owned).collect(),
        };
        (run, Some(spec))
    } else {
        let run = StdioRun {
            command: command.to_owned(),
            args: args.iter().map(text).collect(),
            env: env.iter().map(|(k, v)| (k.clone(), text(v))).collect(),
            passed: Vec::new(),
        };
        (run, None)
    }
}

/// One server as a config file in a file dialect (Claude, Copilot), with the stdio spec it needs.
fn server_file(
    dialect: McpDialect,
    name: &str,
    server: &McpServer,
    home: &Path,
    spec_file: &Path,
) -> (Value, Option<StdioSpec>) {
    let (mut entry, spec) = match server {
        McpServer::Stdio { command, args, env } => {
            let (mut run, spec) = stdio_run(name, command, args, env, home, spec_file);
            // Copilot hands a server only `PATH`, and fills in `${VAR}` in its env; Claude hands
            // over its whole environment.
            if dialect == McpDialect::Copilot {
                run.env.extend(
                    run.passed
                        .iter()
                        .map(|var| (var.clone(), format!("${{{var}}}"))),
                );
            }
            (stdio_entry(dialect, &run), spec)
        }
        McpServer::Http { url, headers } => (remote_entry("http", url, headers), None),
        McpServer::Sse { url, headers } => (remote_entry("sse", url, headers), None),
    };
    if dialect == McpDialect::Copilot {
        // Required. Tools are turned off by flag (`deny_args`), so the list stays open.
        entry["tools"] = json!(["*"]);
    }
    (json!({ "mcpServers": { name: entry } }), spec)
}

/// A stdio server as an entry of `dialect`.
fn stdio_entry(dialect: McpDialect, run: &StdioRun) -> Value {
    json!({
        "type": match dialect {
            // Codex has no server files, so this arm is never asked.
            McpDialect::Claude | McpDialect::Codex => "stdio",
            McpDialect::Copilot => "local",
        },
        "command": run.command,
        "args": run.args,
        "env": run.env,
    })
}

/// A remote server as an entry, whose header secrets the agent expands from its environment.
fn remote_entry(kind: &str, url: &str, headers: &BTreeMap<String, McpValue>) -> Value {
    json!({ "type": kind, "url": url, "headers": text_map(headers) })
}

/// One server as Codex's inline table, what follows `--config=mcp_servers.<name>=`, with the stdio
/// spec it needs. Field names are bare and every map key is quoted. Codex parses the argument as
/// `_x_ = <table>` and, if that fails, takes the text as a string, which fails its config load on
/// every run, so the strings are exact TOML 1.0 basic strings. Only fields Codex 0.164.0 knows are
/// written, so `--strict-config` accepts them. A remote server's secret headers are
/// `env_http_headers`: Codex reads each value from the variable the shim sets. Its disabled tools
/// go inside the table, so there are no deny arguments.
fn codex_table(
    name: &str,
    server: &McpServer,
    using: &McpUse,
    home: &Path,
    spec_file: &Path,
) -> (String, Option<StdioSpec>) {
    let mut fields: Vec<(&str, String)> = Vec::new();
    let mut spec = None;
    match server {
        McpServer::Stdio { command, args, env } => {
            let (run, stdio_spec) = stdio_run(name, command, args, env, home, spec_file);
            spec = stdio_spec;
            fields.push(("command", toml_str(&run.command)));
            if !run.args.is_empty() {
                fields.push(("args", toml_list(&run.args)));
            }
            // Codex expands no `${VAR}`; it passes a variable of its own under the same name.
            let (passed, literal): (Vec<_>, Vec<_>) = run
                .env
                .iter()
                .partition(|(key, value)| whole_var(value) == Some(key.as_str()));
            if !literal.is_empty() {
                fields.push((
                    "env",
                    toml_table(literal.into_iter().map(|(k, v)| (k.as_str(), toml_str(v)))),
                ));
            }
            // For the helper's `exec`, whose own env is empty, the variables its spec names.
            let names: Vec<String> = if spec.is_some() {
                run.passed.clone()
            } else {
                passed.into_iter().map(|(k, _)| k.clone()).collect()
            };
            if !names.is_empty() {
                fields.push(("env_vars", toml_list(&names)));
            }
            if spec.is_some() {
                fields.push((
                    "startup_timeout_sec",
                    LAUNCHER_STARTUP_TIMEOUT_SECS.to_string(),
                ));
            }
        }
        McpServer::Http { url, headers } | McpServer::Sse { url, headers } => {
            fields.push(("url", toml_str(url)));
            let mut plain = Vec::new();
            let mut named = Vec::new();
            for (header, value) in headers {
                match value {
                    McpValue::Secret { secret } => {
                        named.push((header.as_str(), toml_str(&secret_var(secret))));
                    }
                    // Codex expands no `${VAR}`, so a header that is one variable, or a bearer
                    // token that is, names it for Codex to read.
                    McpValue::Plain(value) => match whole_var(value) {
                        Some(var) => named.push((header.as_str(), toml_str(var))),
                        None => match value
                            .strip_prefix("Bearer ")
                            .and_then(whole_var)
                            .filter(|_| header.eq_ignore_ascii_case("authorization"))
                        {
                            Some(var) => fields.push(("bearer_token_env_var", toml_str(var))),
                            None => plain.push((header.as_str(), toml_str(value))),
                        },
                    },
                }
            }
            for (field, entries) in [("http_headers", plain), ("env_http_headers", named)] {
                if !entries.is_empty() {
                    fields.push((field, toml_table(entries)));
                }
            }
        }
    }
    if !using.disabled_tools.is_empty() {
        fields.push(("disabled_tools", toml_list(&using.disabled_tools)));
    }
    let body: Vec<String> = fields
        .into_iter()
        .map(|(field, value)| format!("{field} = {value}"))
        .collect();
    (format!("{{{}}}", body.join(", ")), spec)
}

/// The variable `value` is, when it is exactly `${NAME}`: what Claude and Copilot expand, and
/// Codex can only be told to read. A default (`${NAME:-x}`) or text around it isn't one.
fn whole_var(value: &str) -> Option<&str> {
    let mut found = references(value);
    match (found.next(), found.next()) {
        (Some((at, name, None)), None) if at == (0..value.len()) => Some(name),
        _ => None,
    }
}

/// A TOML 1.0 basic string. Codex's parser is 1.0, so a control character is a `\uXXXX` escape,
/// never 1.1's `\xHH` or `\e`; everything else stays UTF-8.
fn toml_str(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            '\0'..='\u{1f}' | '\u{7f}' => out.push_str(&format!("\\u{:04X}", u32::from(c))),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn toml_list(items: &[String]) -> String {
    let items: Vec<String> = items.iter().map(|item| toml_str(item)).collect();
    format!("[{}]", items.join(", "))
}

/// An inline table with every key quoted, from keys and values already in TOML.
fn toml_table<'a>(entries: impl IntoIterator<Item = (&'a str, String)>) -> String {
    let entries: Vec<String> = entries
        .into_iter()
        .map(|(key, value)| format!("{} = {value}", toml_str(key)))
        .collect();
    format!("{{{}}}", entries.join(", "))
}

/// The arguments that turn off a server's disabled tools, each in the `--flag=value` form:
/// Claude takes one comma-separated list of `mcp__<server>__<tool>`, Copilot one
/// `<server>(<tool>)` pattern per argument. Codex takes none: its tools go in the server's table.
fn deny_args(dialect: McpDialect, deny_arg: &str, server: &str, using: &McpUse) -> Vec<String> {
    let tools = &using.disabled_tools;
    if tools.is_empty() {
        return Vec::new();
    }
    match dialect {
        McpDialect::Claude => {
            let names: Vec<String> = tools
                .iter()
                .map(|tool| format!("mcp__{server}__{tool}"))
                .collect();
            vec![format!("{deny_arg}{}", names.join(","))]
        }
        McpDialect::Copilot => tools
            .iter()
            .map(|tool| format!("{deny_arg}{server}({tool})"))
            .collect(),
        McpDialect::Codex => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AgentDef, McpInjection};

    fn home() -> PathBuf {
        PathBuf::from("/home/me")
    }

    fn claude() -> AgentDef {
        AgentDef {
            mcp: Some(McpInjection {
                dialect: McpDialect::Claude,
                config_arg: "--mcp-config=".into(),
                deny_arg: Some("--disallowedTools=".into()),
                skip_any_args: vec!["--strict-mcp-config".into()],
                skip_subcommands: vec!["plugin".into()],
                options_before_subcommand: None,
                skip_if_present: vec!["/etc/claude-code/managed-mcp.json".into()],
            }),
            ..Default::default()
        }
    }

    fn copilot() -> AgentDef {
        AgentDef {
            mcp: Some(McpInjection {
                dialect: McpDialect::Copilot,
                config_arg: "--additional-mcp-config=@".into(),
                deny_arg: Some("--deny-tool=".into()),
                skip_any_args: Vec::new(),
                skip_subcommands: Vec::new(),
                options_before_subcommand: None,
                skip_if_present: Vec::new(),
            }),
            ..Default::default()
        }
    }

    fn codex() -> AgentDef {
        AgentDef {
            mcp: Some(McpInjection {
                dialect: McpDialect::Codex,
                config_arg: "--config=".into(),
                deny_arg: None,
                skip_any_args: Vec::new(),
                skip_subcommands: vec!["queue".into()],
                options_before_subcommand: Some(LeadingOptions {
                    take_one: vec!["-C".into()],
                    take_many: Vec::new(),
                }),
                skip_if_present: Vec::new(),
            }),
            ..Default::default()
        }
    }

    fn secret(id: &str) -> McpValue {
        McpValue::Secret { secret: id.into() }
    }

    /// Profile `work` uses `github` (a stdio server with a token from the Keychain, `delete_repo`
    /// off) and `linear` (remote, with a key from the Keychain in its `Authorization` header).
    /// Profile `home` uses nothing.
    fn config() -> ConfigState {
        let using = |tools: &[&str]| McpUse {
            disabled_tools: tools.iter().copied().map(String::from).collect(),
        };
        ConfigState {
            profiles: vec![
                Profile {
                    id: "work".into(),
                    name: "Work".into(),
                    mcp_servers: BTreeMap::from([
                        ("github".into(), using(&["delete_repo", "fork"])),
                        ("linear".into(), using(&[])),
                    ]),
                    ..Default::default()
                },
                Profile {
                    id: "home".into(),
                    name: "Home".into(),
                    ..Default::default()
                },
            ],
            mcp_servers: BTreeMap::from([
                (
                    "github".into(),
                    McpServer::Stdio {
                        command: "npx".into(),
                        args: vec![McpValue::Plain("-y".into()), McpValue::Plain("gh".into())],
                        env: BTreeMap::from([("GITHUB_TOKEN".into(), secret("7F3A"))]),
                    },
                ),
                (
                    "linear".into(),
                    McpServer::Http {
                        url: "https://mcp.linear.app/mcp".into(),
                        headers: BTreeMap::from([("Authorization".into(), secret("9B2C"))]),
                    },
                ),
            ]),
            agents: BTreeMap::from([
                ("claude".into(), claude()),
                ("aider".into(), AgentDef::default()),
            ]),
            ..Default::default()
        }
    }

    fn rendered(config: &ConfigState) -> BTreeMap<String, String> {
        render(config, &home())
            .into_iter()
            .map(|(path, contents)| {
                let path = path.strip_prefix(paths::mcp(&home())).unwrap().to_owned();
                (path.display().to_string(), contents)
            })
            .collect()
    }

    #[test]
    fn render_starts_only_stdio_servers_with_a_secret_through_the_launcher() {
        let mut config = config();
        // A stdio server with nothing secret keeps its real command, so an allowlist naming it
        // still matches, and gets no spec.
        config.mcp_servers.insert(
            "fs".into(),
            McpServer::Stdio {
                command: "npx".into(),
                args: vec![McpValue::Plain("-y".into()), McpValue::Plain("fs".into())],
                env: BTreeMap::new(),
            },
        );
        config.profiles[0]
            .mcp_servers
            .insert("fs".into(), McpUse::default());
        let files = rendered(&config);
        assert_eq!(
            files.keys().collect::<Vec<_>>(),
            [
                "work/claude/launch.json",
                "work/claude/servers/fs.json",
                "work/claude/servers/github.json",
                "work/claude/servers/linear.json",
                "work/claude/stdio/github.json",
            ]
        );
        let entry = |file: &str, name: &str| -> Value {
            let file: Value = serde_json::from_str(&files[file]).unwrap();
            file["mcpServers"][name].clone()
        };
        assert_eq!(
            entry("work/claude/servers/fs.json", "fs"),
            json!({
                "type": "stdio",
                "command": "npx",
                "args": ["--prefix=/home/me", "-y", "fs"],
                "env": {},
            })
        );
        assert_eq!(
            entry("work/claude/servers/github.json", "github"),
            json!({
                "type": "stdio",
                "command": "/home/me/.envrouter/bin/envrouter-keychain",
                "args": ["exec", "/home/me/.envrouter/mcp/work/claude/stdio/github.json"],
                "env": {},
            })
        );
        // References to the store, never values; the prefix is already in the arguments.
        let spec: Value = serde_json::from_str(&files["work/claude/stdio/github.json"]).unwrap();
        assert_eq!(
            spec,
            json!({
                "server": "github",
                "home": "/home/me",
                "command": "npx",
                "args": ["--prefix=/home/me", "-y", "gh"],
                "env": { "GITHUB_TOKEN": { "secret": "7F3A" } },
            })
        );
        // A remote server's header is expanded by the agent, from the shim's environment.
        assert_eq!(
            entry("work/claude/servers/linear.json", "linear"),
            json!({
                "type": "http",
                "url": "https://mcp.linear.app/mcp",
                "headers": { "Authorization": "${ENVROUTER_SECRET_9B2C}" },
            })
        );
    }

    #[test]
    fn only_npx_gets_the_home_prefix_and_only_once() {
        let home = home();
        let args = |list: &[&str]| {
            list.iter()
                .map(|&a| McpValue::Plain(a.to_owned()))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            launch_args("/opt/homebrew/bin/npx", args(&["-y", "pkg"]), &home),
            args(&["--prefix=/home/me", "-y", "pkg"])
        );
        assert_eq!(
            launch_args("npx", args(&["--prefix=/srv", "pkg"]), &home),
            args(&["--prefix=/srv", "pkg"])
        );
        // The server's own --prefix, after the package, isn't npx's.
        assert_eq!(
            launch_args("npx", args(&["pkg", "--prefix=/data"]), &home),
            args(&["--prefix=/home/me", "pkg", "--prefix=/data"])
        );
        // A locked value is the package or an argument, never an option of npx's.
        assert_eq!(
            launch_args(
                "npx",
                vec![secret("A1"), McpValue::Plain("--prefix=/data".into())],
                &home
            )[0],
            McpValue::Plain("--prefix=/home/me".into())
        );
        for command in ["uvx", "docker", "npx-wrapper"] {
            assert_eq!(launch_args(command, args(&["pkg"]), &home), args(&["pkg"]));
        }
    }

    #[test]
    fn the_manifest_loads_each_server_with_one_equals_form_argument() {
        let files = rendered(&config());
        let launch: Launch = serde_json::from_str(&files["work/claude/launch.json"]).unwrap();
        let dir = paths::mcp(&home()).join("work/claude/servers");
        assert_eq!(
            launch,
            Launch {
                skip_any_args: vec!["--strict-mcp-config".into()],
                skip_subcommands: vec!["plugin".into()],
                options_before_subcommand: None,
                skip_if_present: vec!["/etc/claude-code/managed-mcp.json".into()],
                servers: vec![
                    LaunchServer {
                        name: "github".into(),
                        args: vec![
                            format!("--mcp-config={}", dir.join("github.json").display()),
                            "--disallowedTools=mcp__github__delete_repo,mcp__github__fork".into(),
                        ],
                        // The launcher reads this one's token itself.
                        secrets: Vec::new(),
                    },
                    LaunchServer {
                        name: "linear".into(),
                        args: vec![format!(
                            "--mcp-config={}",
                            dir.join("linear.json").display()
                        )],
                        secrets: vec!["9B2C".into()],
                    },
                ],
            }
        );
    }

    #[test]
    fn copilot_files_name_stdio_local_and_deny_tools_one_by_one() {
        let mut config = config();
        config.agents = BTreeMap::from([("copilot".into(), copilot())]);
        let files = rendered(&config);
        let github: Value =
            serde_json::from_str(&files["work/copilot/servers/github.json"]).unwrap();
        // The launcher entry, in Copilot's dialect.
        assert_eq!(
            github["mcpServers"]["github"],
            json!({
                "type": "local",
                "command": "/home/me/.envrouter/bin/envrouter-keychain",
                "args": ["exec", "/home/me/.envrouter/mcp/work/copilot/stdio/github.json"],
                "env": {},
                "tools": ["*"],
            })
        );
        let launch: Launch = serde_json::from_str(&files["work/copilot/launch.json"]).unwrap();
        let args = &launch.servers[0].args;
        assert!(args[0].starts_with("--additional-mcp-config=@/"));
        assert_eq!(
            args[1..],
            [
                "--deny-tool=github(delete_repo)",
                "--deny-tool=github(fork)"
            ]
        );
    }

    /// The helper's `exec` fills in the variables its spec names from the environment the agent
    /// starts it with. Claude hands a server its whole environment; Copilot and Codex hand over
    /// only some, so each is told which ones to pass on, in its own dialect.
    #[test]
    fn a_launcher_entry_passes_on_the_variables_its_spec_names() {
        let mut config = config();
        config.agents = BTreeMap::from([
            ("claude".into(), claude()),
            ("copilot".into(), copilot()),
            ("codex".into(), codex()),
        ]);
        let McpServer::Stdio { args, env, .. } = config.mcp_servers.get_mut("github").unwrap()
        else {
            unreachable!("github is a command");
        };
        args.push(McpValue::Plain("--log=${LOG_LEVEL:-info}".into()));
        env.insert("HOST".into(), McpValue::Plain("${GITHUB_HOST}".into()));
        let files = rendered(&config);
        let entry = |agent: &str| -> Value {
            let file: Value =
                serde_json::from_str(&files[&format!("work/{agent}/servers/github.json")]).unwrap();
            file["mcpServers"]["github"]["env"].clone()
        };
        assert_eq!(entry("claude"), json!({}));
        assert_eq!(
            entry("copilot"),
            json!({ "GITHUB_HOST": "${GITHUB_HOST}", "LOG_LEVEL": "${LOG_LEVEL}" })
        );
        let launch: Launch = serde_json::from_str(&files["work/codex/launch.json"]).unwrap();
        let github = launch.servers.iter().find(|s| s.name == "github").unwrap();
        assert!(
            github.args[0].contains(r#"env_vars = ["GITHUB_HOST", "LOG_LEVEL"]"#),
            "{}",
            github.args[0]
        );
    }

    /// `config()` for Codex alone, with `fs` (a stdio server with an env value, `write_file` off)
    /// and a plain `X-Team` header beside `linear`'s secret one.
    fn codex_config() -> ConfigState {
        let mut config = config();
        config.agents = BTreeMap::from([("codex".into(), codex())]);
        config.mcp_servers.insert(
            "fs".into(),
            McpServer::Stdio {
                command: "npx".into(),
                args: vec![McpValue::Plain("-y".into()), McpValue::Plain("fs".into())],
                env: BTreeMap::from([("LOG".into(), McpValue::Plain("debug".into()))]),
            },
        );
        config.profiles[0].mcp_servers.insert(
            "fs".into(),
            McpUse {
                disabled_tools: vec!["write_file".into()],
            },
        );
        let McpServer::Http { headers, .. } = config.mcp_servers.get_mut("linear").unwrap() else {
            unreachable!("linear is remote");
        };
        headers.insert("X-Team".into(), McpValue::Plain("eng".into()));
        config
    }

    #[test]
    fn codex_gets_each_server_as_one_config_argument() {
        let files = rendered(&codex_config());
        // No `servers/` files: the argument is the server.
        assert_eq!(
            files.keys().collect::<Vec<_>>(),
            ["work/codex/launch.json", "work/codex/stdio/github.json"]
        );
        let launch: Launch = serde_json::from_str(&files["work/codex/launch.json"]).unwrap();
        // The shim reads these from the manifest alone.
        assert_eq!(
            launch.options_before_subcommand,
            codex().mcp.unwrap().options_before_subcommand
        );
        let by_name = |name: &str| launch.servers.iter().find(|s| s.name == name).unwrap();
        assert_eq!(
            by_name("fs").args,
            [
                r#"--config=mcp_servers.fs={command = "npx", args = ["--prefix=/home/me", "-y", "fs"], env = {"LOG" = "debug"}, disabled_tools = ["write_file"]}"#
            ]
        );
        // Through the launcher, with the timeout that leaves the server Codex's own 30 s.
        assert_eq!(
            by_name("github").args,
            [
                r#"--config=mcp_servers.github={command = "/home/me/.envrouter/bin/envrouter-keychain", args = ["exec", "/home/me/.envrouter/mcp/work/codex/stdio/github.json"], startup_timeout_sec = 50, disabled_tools = ["delete_repo", "fork"]}"#
            ]
        );
        // Only the variable's name, never a value; a plain header stays a value.
        assert_eq!(
            by_name("linear").args,
            [
                r#"--config=mcp_servers.linear={url = "https://mcp.linear.app/mcp", http_headers = {"X-Team" = "eng"}, env_http_headers = {"Authorization" = "ENVROUTER_SECRET_9B2C"}}"#
            ]
        );
        assert_eq!(by_name("fs").secrets, Vec::<String>::new());
        assert_eq!(by_name("github").secrets, Vec::<String>::new());
        assert_eq!(by_name("linear").secrets, ["9B2C"]);
    }

    /// Claude and Copilot expand a `${VAR}` value from their environment; Codex expands nothing,
    /// so it would send the text itself. A whole value that is one variable is named for Codex to
    /// read; anything else stays as typed.
    #[test]
    fn codex_reads_a_variable_a_whole_value_names() {
        let plain = |text: &str| McpValue::Plain(text.into());
        let mut config = codex_config();
        config.mcp_servers.insert(
            "fs".into(),
            McpServer::Stdio {
                command: "srv".into(),
                args: Vec::new(),
                env: BTreeMap::from([
                    ("TOKEN".into(), plain("${TOKEN}")),
                    ("OTHER".into(), plain("${TOKEN}")),
                ]),
            },
        );
        config.mcp_servers.insert(
            "linear".into(),
            McpServer::Http {
                url: "https://example.com/mcp".into(),
                headers: BTreeMap::from([
                    ("Authorization".into(), plain("Bearer ${LINEAR_TOKEN}")),
                    ("X-Key".into(), plain("${KEY}")),
                    ("X-Default".into(), plain("${KEY:-none}")),
                ]),
            },
        );
        let files = rendered(&config);
        let launch: Launch = serde_json::from_str(&files["work/codex/launch.json"]).unwrap();
        let args = |name: &str| &launch.servers.iter().find(|s| s.name == name).unwrap().args;
        // Codex passes a variable only under its own name, so `OTHER` can't be one.
        assert_eq!(
            args("fs")[0],
            r#"--config=mcp_servers.fs={command = "srv", env = {"OTHER" = "${TOKEN}"}, env_vars = ["TOKEN"], disabled_tools = ["write_file"]}"#
        );
        assert_eq!(
            args("linear")[0],
            r#"--config=mcp_servers.linear={url = "https://example.com/mcp", bearer_token_env_var = "LINEAR_TOKEN", http_headers = {"X-Default" = "${KEY:-none}"}, env_http_headers = {"X-Key" = "KEY"}}"#
        );
    }

    /// Codex parses `-c key=value` by wrapping the value as `_x_ = <value>`, and a value that
    /// fails to parse silently becomes a string, which then fails its config load on every run.
    #[test]
    fn codex_arguments_parse_as_codex_parses_them() {
        let hostile = "a\"b\\c\nd\te\u{7f}\u{1b}é=#}] ";
        let plain = |text: &str| McpValue::Plain(text.into());
        let mut config = codex_config();
        config.mcp_servers.insert(
            "fs".into(),
            McpServer::Stdio {
                command: "srv".into(),
                args: vec![plain(hostile), plain("--flag=1")],
                env: BTreeMap::from([("KEY".into(), plain(hostile))]),
            },
        );
        config.mcp_servers.insert(
            "linear".into(),
            McpServer::Http {
                url: "https://example.com/mcp?a=1&b=#x".into(),
                headers: BTreeMap::from([
                    ("Authorization".into(), secret("9B2C")),
                    ("X-Hostile".into(), plain(hostile)),
                ]),
            },
        );
        config.profiles[0].mcp_servers.insert(
            "fs".into(),
            McpUse {
                disabled_tools: vec!["a.b".into()],
            },
        );
        let files = rendered(&config);
        let launch: Launch = serde_json::from_str(&files["work/codex/launch.json"]).unwrap();
        let parsed = |name: &str| -> toml::Table {
            let arg = &launch.servers.iter().find(|s| s.name == name).unwrap().args[0];
            assert!(
                !arg.chars().any(|c| c < ' ' || c == '\u{7f}'),
                "a raw control character in {arg:?}"
            );
            // As `config_override.rs` splits it: at the first `=`, both halves trimmed.
            let (key, value) = arg
                .strip_prefix("--config=")
                .unwrap()
                .split_once('=')
                .unwrap();
            assert_eq!(key.trim(), format!("mcp_servers.{name}"));
            let wrapped = format!("_x_ = {}", value.trim());
            let mut table: toml::Table = toml::from_str(&wrapped).unwrap();
            let toml::Value::Table(server) = table.remove("_x_").unwrap() else {
                panic!("not a table: {wrapped}");
            };
            server
        };
        assert_eq!(
            parsed("fs"),
            toml::toml! {
                command = "srv"
                args = [hostile, "--flag=1"]
                env = { KEY = hostile }
                disabled_tools = ["a.b"]
            }
        );
        assert_eq!(
            parsed("linear"),
            toml::toml! {
                url = "https://example.com/mcp?a=1&b=#x"
                http_headers = { "X-Hostile" = hostile }
                env_http_headers = { "Authorization" = "ENVROUTER_SECRET_9B2C" }
            }
        );
    }

    #[test]
    fn codex_leaves_out_sse_servers() {
        let mut config = config();
        config.agents.insert("codex".into(), codex());
        config.mcp_servers.insert(
            "events".into(),
            McpServer::Sse {
                url: "https://example.com/sse".into(),
                headers: BTreeMap::new(),
            },
        );
        config.profiles[0]
            .mcp_servers
            .insert("events".into(), McpUse::default());
        let files = rendered(&config);
        let names = |agent: &str| -> Vec<String> {
            let launch: Launch =
                serde_json::from_str(&files[&format!("work/{agent}/launch.json")]).unwrap();
            launch.servers.into_iter().map(|s| s.name).collect()
        };
        assert_eq!(names("claude"), ["events", "github", "linear"]);
        assert_eq!(names("codex"), ["github", "linear"]);
        // What the preview and explain mode list agrees with what is rendered.
        let work = &config.profiles[0];
        assert_eq!(servers_for(&config, work, "claude"), names("claude"));
        assert_eq!(servers_for(&config, work, "codex"), names("codex"));
    }

    #[test]
    fn inject_leaves_out_servers_whose_secrets_are_missing() {
        let files = rendered(&config());
        let launch: Launch = serde_json::from_str(&files["work/claude/launch.json"]).unwrap();
        // Only the remote server's header: the stdio server's token isn't the agent's to carry.
        assert_eq!(launch.secret_ids(), BTreeSet::from(["9B2C"]));

        let without = launch.inject(&HashMap::new());
        assert_eq!(without.servers, ["github"]);
        assert_eq!(without.dropped, ["linear"]);
        assert_eq!(without.args.len(), 2);
        assert!(without.env.is_empty());

        let with = launch.inject(&HashMap::from([("9B2C".into(), "lin_x".into())]));
        assert_eq!(with.servers, ["github", "linear"]);
        assert_eq!(with.args.len(), 3);
        assert_eq!(
            with.env,
            [("ENVROUTER_SECRET_9B2C".to_string(), "lin_x".to_string())]
        );
    }

    #[test]
    fn resolve_fills_secrets_in_args_and_env_and_names_a_missing_one() {
        let spec = StdioSpec {
            server: "github".into(),
            home: "/home/me".into(),
            command: "npx".into(),
            args: vec![McpValue::Plain("-y".into()), secret("A1")],
            env: BTreeMap::from([
                ("GITHUB_TOKEN".into(), secret("7F3A")),
                ("LOG".into(), McpValue::Plain("debug".into())),
            ]),
        };
        assert_eq!(spec.secret_ids(), BTreeSet::from(["7F3A", "A1"]));

        let stored = HashMap::from([
            ("7F3A".to_string(), "ghp_x".to_string()),
            ("A1".to_string(), "arg".to_string()),
        ]);
        assert_eq!(
            spec.resolve(&stored, |_| None),
            Ok(StdioCommand {
                program: "npx".into(),
                args: vec!["-y".into(), "arg".into()],
                env: vec![
                    ("GITHUB_TOKEN".into(), "ghp_x".into()),
                    ("LOG".into(), "debug".into()),
                ],
            })
        );

        let without_the_token = HashMap::from([("A1".to_string(), "arg".to_string())]);
        assert_eq!(
            spec.resolve(&without_the_token, |_| None),
            Err(Unresolved::Secret("7F3A".into()))
        );
        assert_eq!(
            spec.resolve(&HashMap::new(), |_| None),
            Err(Unresolved::Secret("A1".into()))
        );
    }

    #[test]
    fn applies_to_skips_runs_that_ask_for_their_own_servers_only() {
        let launch = Launch {
            skip_any_args: vec!["--strict-mcp-config".into()],
            ..Default::default()
        };
        assert!(launch.applies_to(&["-p".into(), "hi".into()]));
        assert!(!launch.applies_to(&["--strict-mcp-config".into()]));
    }

    #[test]
    fn managed_by_names_the_first_skip_file_that_exists() {
        let dir = tempfile::tempdir().unwrap();
        let managed = dir.path().join("managed-mcp.json");
        let launch = Launch {
            skip_if_present: vec![
                dir.path().join("absent.json").display().to_string(),
                managed.display().to_string(),
            ],
            ..Default::default()
        };
        assert_eq!(launch.managed_by(), None);
        fs::write(&managed, "{}").unwrap();
        assert_eq!(launch.managed_by(), Some(managed.to_str().unwrap()));
    }

    #[test]
    fn applies_to_reads_a_subcommand_only_as_the_first_argument_by_default() {
        let launch = Launch {
            skip_subcommands: vec!["plugin".into()],
            ..Default::default()
        };
        assert!(!launch.applies_to(&["plugin".into(), "test".into(), ".".into()]));
        // Past an option the word is a prompt to Claude, so the agent doesn't step.
        assert!(launch.applies_to(&["-p".into(), "plugin".into()]));
        assert!(launch.applies_to(&["--debug".into(), "plugin".into()]));
        assert!(launch.applies_to(&[]));
    }

    #[test]
    fn applies_to_finds_the_subcommand_past_the_options_ahead_of_it() {
        let launch = Launch {
            skip_subcommands: vec!["archive".into(), "queue".into()],
            options_before_subcommand: Some(LeadingOptions {
                take_one: ["-C", "--cd", "-p", "--profile", "-m"]
                    .map(String::from)
                    .to_vec(),
                take_many: ["-i", "--image"].map(String::from).to_vec(),
            }),
            ..Default::default()
        };
        let cases: [(&[&str], bool); 10] = [
            // The issue's evidence: an option and its value ahead of the subcommand.
            (&["-C", "~/proj", "queue", "m"], false),
            (&["--profile", "work", "archive", "id"], false),
            // An attached value is one word, whatever the option.
            (&["--cd=~/proj", "queue"], false),
            (&["-C~/proj", "queue"], false),
            // An option no entry names takes no value.
            (&["--search", "queue"], false),
            // `-i` takes `queue` as a second image, up to the next dashed word.
            (&["-i", "a.png", "queue"], true),
            (&["-i", "a.png", "-C", "~/proj", "queue"], false),
            // After `--` every word is a positional.
            (&["--", "queue"], true),
            // The first other word is the subcommand or the prompt, nothing later.
            (&["-m", "o3", "fix", "archive"], true),
            // A lone `-` is a word, not an option.
            (&["-", "queue"], true),
        ];
        for (args, injected) in cases {
            let args: Vec<OsString> = args.iter().map(OsString::from).collect();
            assert_eq!(launch.applies_to(&args), injected, "{args:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn sync_writes_private_files_and_removes_stale_ones() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let mut config = config();
        // Rendered with the real home, unlike `rendered`.
        sync(&config, home).unwrap();
        let launch = paths::mcp_launch(home, "work", "claude");
        assert!(launch.exists());
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&launch), 0o600);
        assert_eq!(mode(&launch.with_file_name("stdio/github.json")), 0o600);
        assert_eq!(mode(&paths::mcp(home)), 0o700);
        assert_eq!(
            load_launch(home, "work", "claude")
                .unwrap()
                .unwrap()
                .servers
                .len(),
            2
        );

        // A stale server file outlives its save (see the test below); one save past the grace
        // period removes it.
        let later = SystemTime::now() + RETIRED_GRACE;
        config.profiles[0].mcp_servers.remove("linear");
        sync(&config, home).unwrap();
        sync_at(&config, home, later).unwrap();
        let servers = launch.parent().unwrap().join("servers");
        assert!(servers.join("github.json").exists());
        assert!(!servers.join("linear.json").exists());

        // A manifest goes with the save that stops rendering it, so no new run gets the servers.
        config.profiles[0].mcp_servers.clear();
        sync(&config, home).unwrap();
        assert_eq!(load_launch(home, "work", "claude").unwrap(), None);
        sync_at(&config, home, later + RETIRED_GRACE).unwrap();
        assert_eq!(fs::read_dir(paths::mcp(home)).unwrap().count(), 0);
        assert!(!paths::mcp_retired(home).exists(), "nothing left to retire");
    }

    /// A shim that read the manifest just before a save starts the agent with the file it named;
    /// the agent opens it a moment later. The save used to delete it at once, handing that agent
    /// `--mcp-config=<deleted file>`. A stdio spec is kept the same way: the agent runs the
    /// launcher on it again at every reconnect.
    #[cfg(unix)]
    #[test]
    fn a_save_keeps_the_files_the_last_manifest_named_for_a_while() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let mut config = config();
        sync(&config, home).unwrap();
        // What a shim read just before the save.
        let launched = load_launch(home, "work", "claude").unwrap().unwrap();
        let linear = launched
            .servers
            .iter()
            .find(|s| s.name == "linear")
            .unwrap();
        let file = PathBuf::from(linear.args[0].split_once('=').unwrap().1);

        config.profiles[0].mcp_servers.remove("linear");
        let saved = SystemTime::now();
        sync_at(&config, home, saved).unwrap();
        assert!(file.exists(), "deleted while an agent may be opening it");
        let current = load_launch(home, "work", "claude").unwrap().unwrap();
        assert!(current.servers.iter().all(|s| s.name != "linear"));

        // Saves inside the grace period keep it, counting from when it went stale.
        sync_at(
            &config,
            home,
            saved + RETIRED_GRACE - Duration::from_secs(1),
        )
        .unwrap();
        assert!(file.exists());
        sync_at(&config, home, saved + RETIRED_GRACE).unwrap();
        assert!(!file.exists());
        assert!(!paths::mcp_retired(home).exists());

        let spec = paths::mcp_launch(home, "work", "claude").with_file_name("stdio/github.json");
        assert!(spec.exists());
        config.profiles[0].mcp_servers.remove("github");
        let dropped = saved + RETIRED_GRACE;
        sync_at(&config, home, dropped).unwrap();
        assert!(
            spec.exists(),
            "a reconnecting agent runs the launcher on it"
        );
        sync_at(
            &config,
            home,
            dropped + RETIRED_GRACE - Duration::from_secs(1),
        )
        .unwrap();
        assert!(spec.exists());
        sync_at(&config, home, dropped + RETIRED_GRACE).unwrap();
        assert!(!spec.exists());
    }

    /// Only the manifest beside an agent's `servers/` goes at once: a server named `launch`
    /// has a `servers/launch.json` and a `stdio/launch.json` that a run may still open.
    #[cfg(unix)]
    #[test]
    fn a_server_named_launch_is_kept_like_any_other() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let mut config = config();
        let github = config.mcp_servers.remove("github").unwrap();
        config.mcp_servers.insert("launch".into(), github);
        let using = config.profiles[0].mcp_servers.remove("github").unwrap();
        config.profiles[0]
            .mcp_servers
            .insert("launch".into(), using);
        sync(&config, home).unwrap();

        config.profiles[0].mcp_servers.remove("launch");
        sync(&config, home).unwrap();
        let agent = paths::mcp_launch(home, "work", "claude").with_file_name("");
        assert!(agent.join("servers/launch.json").exists());
        assert!(agent.join("stdio/launch.json").exists());
    }

    /// A server that's added back before its file is removed is current again, and its
    /// countdown is forgotten, so a later removal starts a fresh one.
    #[cfg(unix)]
    #[test]
    fn a_server_added_back_is_no_longer_retired() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let full = config();
        let mut without = full.clone();
        without.profiles[0].mcp_servers.remove("linear");
        let file = paths::mcp_launch(home, "work", "claude")
            .with_file_name("servers")
            .join("linear.json");
        let start = SystemTime::now();

        sync_at(&full, home, start).unwrap();
        sync_at(&without, home, start).unwrap();
        sync_at(&full, home, start + RETIRED_GRACE).unwrap();
        assert!(!paths::mcp_retired(home).exists());
        sync_at(&without, home, start + RETIRED_GRACE).unwrap();
        assert!(file.exists(), "retired again just now, not 10 minutes ago");
    }

    #[test]
    fn servers_for_lists_a_profiles_servers_for_agents_that_take_them() {
        let config = config();
        assert_eq!(
            servers_for(&config, &config.profiles[0], "claude"),
            ["github", "linear"]
        );
        assert!(servers_for(&config, &config.profiles[0], "aider").is_empty());
        assert!(servers_for(&config, &config.profiles[1], "claude").is_empty());
    }

    #[test]
    fn load_launch_ignores_ids_that_are_not_plain_names() {
        assert_eq!(load_launch(&home(), "../x", "claude").unwrap(), None);
    }
}
