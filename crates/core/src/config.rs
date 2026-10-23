//! The persisted profile model and `~/.envrouter/config.json` I/O.
//!
//! These structs mirror the frontend's TypeScript types; serde renames fields to camelCase.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{self, ErrorKind, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub const CONFIG_FILE: &str = "config.json";

/// Bump when the file's shape changes, and migrate older versions in [`load`].
///
/// 2 added the MCP server library (`mcpServers`), each profile's selection from it, and the
/// agents' MCP descriptors (`agents`). Every new field defaults to empty, so a version 1 file
/// reads as a version 2 one with no servers.
///
/// 3 added each agent's editor hook (`agents.*.ide`), so the CLI can route an editor extension
/// without the window. It defaults to none, so a version 2 file reads as is.
///
/// 4 added the subcommands that take no injected MCP options (`agents.*.mcp.skipSubcommands`).
/// It defaults to empty, so a version 3 file reads as is.
pub const CONFIG_VERSION: u32 = 4;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfig {
    pub env_var: String,
    pub path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub trigger_paths: Vec<String>,
    /// Keyed by the command the shim stands in for, e.g. `claude`.
    #[serde(default)]
    pub tools: BTreeMap<String, ToolConfig>,
    /// The library servers this profile's folders get, keyed by server name. They go to every
    /// agent with an MCP descriptor, whether or not the profile sets that agent's folder.
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpUse>,
}

/// How a profile uses one library server.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpUse {
    /// Tools the agent is told not to use. A deny list, so tools a server adds later are on.
    #[serde(default)]
    pub disabled_tools: Vec<String>,
}

/// One MCP server in the library, in no particular agent's format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "transport", rename_all = "camelCase")]
pub enum McpServer {
    #[serde(rename_all = "camelCase")]
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<McpValue>,
        #[serde(default)]
        env: BTreeMap<String, McpValue>,
    },
    /// Streamable HTTP.
    #[serde(rename_all = "camelCase")]
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, McpValue>,
    },
    #[serde(rename_all = "camelCase")]
    Sse {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, McpValue>,
    },
}

impl McpServer {
    /// Every value that can hold a secret: args, env values and headers.
    pub fn values(&self) -> Box<dyn Iterator<Item = &McpValue> + '_> {
        match self {
            McpServer::Stdio { args, env, .. } => Box::new(args.iter().chain(env.values())),
            McpServer::Http { headers, .. } | McpServer::Sse { headers, .. } => {
                Box::new(headers.values())
            }
        }
    }

    /// The ids of the Keychain secrets this server needs.
    pub fn secret_ids(&self) -> BTreeSet<&str> {
        self.values()
            .filter_map(|value| match value {
                McpValue::Secret { secret } => Some(secret.as_str()),
                McpValue::Plain(_) => None,
            })
            .collect()
    }
}

/// A plain string, or a reference to a secret kept in the Keychain. The secret's value never
/// appears in `config.json`, in a rendered file or on a command line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum McpValue {
    Plain(String),
    Secret { secret: String },
}

/// What EnvRouter knows about an agent beyond its variable. The window writes these from its
/// registry (`src/lib/agents.json`) on every save, and the CLI fills them from the same file
/// ([`crate::agents`]), so Rust never needs an agent's name.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDef {
    /// How to hand the agent MCP servers at launch. `None`: it gets none.
    #[serde(default)]
    pub mcp: Option<McpInjection>,
    /// Where the agent keeps MCP servers of its own, so the window can offer to import them.
    #[serde(default)]
    pub mcp_files: Option<McpFiles>,
    /// How the agent's editor extension can be told to run through the shim. Added in version
    /// 3; older configs have none until the window or the CLI saves.
    #[serde(default)]
    pub ide: Option<IdeHook>,
}

/// An editor extension that runs its own copy of the agent but takes a process-wrapper
/// setting: the editor then runs `<wrapper> <its binary> <args>`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeHook {
    /// The extension's process-wrapper setting, e.g. `claudeCode.claudeProcessWrapper`.
    pub setting: String,
    /// The extension's id, e.g. `anthropic.claude-code`. Installed copies are folders named
    /// `<id>-<version>[-<platform>]`.
    pub extension: String,
}

impl IdeHook {
    /// Whether a folder named `name` is an installed copy of the extension. The version after
    /// the id keeps `anthropic.claude-code` from matching an `anthropic.claude-code-nightly`.
    pub fn is_installed_copy(&self, name: &str) -> bool {
        name.strip_prefix(self.extension.as_str())
            .and_then(|rest| rest.strip_prefix('-'))
            .is_some_and(|version| version.starts_with(|c: char| c.is_ascii_digit()))
    }
}

/// Where an agent keeps its own MCP config, in its `mcp` dialect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpFiles {
    /// In the agent's config folder: the one a profile points it at, or `default_dir`.
    pub user_file: String,
    /// Where the agent looks without its variable, e.g. `~` for Claude's `~/.claude.json`.
    pub default_dir: String,
    /// In a project folder, e.g. `.mcp.json`.
    #[serde(default)]
    pub project_file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInjection {
    /// The config file format the agent reads.
    pub dialect: McpDialect,
    /// One argument is this followed by a rendered file's path, e.g. `--mcp-config=`. It must
    /// hold an `=`: Claude's flags take several values, so `--mcp-config <file>` as two
    /// arguments would swallow whatever the user typed next, a subcommand or a prompt.
    pub config_arg: String,
    /// Followed by the tools to turn off, in the dialect's form, e.g. `--disallowedTools=`.
    /// `None`: the agent can't turn tools off by flag.
    #[serde(default)]
    pub deny_arg: Option<String>,
    /// Any of these among the user's own arguments turns injection off for that run.
    #[serde(default)]
    pub skip_any_args: Vec<String>,
    /// A run whose first argument is one of these subcommands gets no injection: some refuse
    /// any option ahead of them (`claude plugin test`). Added in version 4.
    #[serde(default)]
    pub skip_subcommands: Vec<String>,
}

/// An MCP config file format, named after the agent that defined it. Several agents can share
/// one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum McpDialect {
    /// `{"mcpServers": {...}}` as Claude Code's `--mcp-config` reads it.
    Claude,
    /// Copilot CLI's `--additional-mcp-config`: Claude's shape plus a required `tools` list.
    Copilot,
}

impl Profile {
    /// The tool's settings, if this profile routes it. An empty path means "not configured",
    /// so a half-filled form can still be saved.
    pub fn tool(&self, name: &str) -> Option<&ToolConfig> {
        self.tools
            .get(name)
            .filter(|tool| !tool.path.trim().is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConfigState {
    /// A file without one predates versioning, so it's version 1, not the current version.
    #[serde(default = "first_version")]
    pub version: u32,
    pub profiles: Vec<Profile>,
    /// The server library, keyed by the name agents see.
    pub mcp_servers: BTreeMap<String, McpServer>,
    /// Keyed by command, like `Profile::tools`.
    pub agents: BTreeMap<String, AgentDef>,
}

fn first_version() -> u32 {
    1
}

impl Default for ConfigState {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            profiles: Vec::new(),
            mcp_servers: BTreeMap::new(),
            agents: BTreeMap::new(),
        }
    }
}

/// Reads `config.json` from `dir`, or `None` if there isn't one yet.
pub fn load(dir: &Path) -> Result<Option<ConfigState>> {
    let path = dir.join(CONFIG_FILE);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(Error::Io { path, source }),
    };
    let config: ConfigState = serde_json::from_str(&text).map_err(|source| Error::Json {
        path: path.clone(),
        source,
    })?;
    if config.version > CONFIG_VERSION {
        return Err(Error::Invalid(format!(
            "{} is from a newer version of EnvRouter. Update EnvRouter to use it.",
            path.display()
        )));
    }
    Ok(Some(config))
}

/// Like [`load`], but creates the directory and an empty config if they're missing. A
/// malformed file is an error, never silently replaced.
pub fn load_or_init(dir: &Path) -> Result<ConfigState> {
    if let Some(config) = load(dir)? {
        return Ok(config);
    }
    let config = ConfigState::default();
    save(dir, &config)?;
    Ok(config)
}

pub fn save(dir: &Path, config: &ConfigState) -> Result<()> {
    let json =
        serde_json::to_string_pretty(&as_saved(config)).expect("ConfigState always serializes");
    write_atomic(&dir.join(CONFIG_FILE), format!("{json}\n"))
}

/// `config` as [`save`] writes it: at the current version.
pub fn as_saved(config: &ConfigState) -> ConfigState {
    ConfigState {
        version: CONFIG_VERSION,
        ..config.clone()
    }
}

/// Holds `dir`'s save lock until the returned file is dropped, so the window and the CLI never
/// read, compare and write the config at the same time. Advisory: a hand edit doesn't take it.
pub fn lock(dir: &Path) -> Result<File> {
    let path = dir.join("config.lock");
    let io_err = |source| Error::Io {
        path: path.clone(),
        source,
    };
    fs::create_dir_all(dir).map_err(io_err)?;
    let file = File::options()
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(io_err)?;
    file.lock().map_err(io_err)?;
    Ok(file)
}

/// Writes through a sibling temp file and a rename, so a reader never sees a half-written
/// file. The contents are flushed to disk before the rename, so a crash can't leave the file
/// (which may be someone's `.zshrc`) empty. An existing file keeps its permissions.
pub fn write_atomic(path: &Path, contents: impl AsRef<[u8]>) -> Result<()> {
    write_through_temp(path, contents.as_ref(), None)
}

/// Like [`write_atomic`], but the file is readable by its owner only, from the moment it
/// exists.
#[cfg(unix)]
pub fn write_private(path: &Path, contents: impl AsRef<[u8]>) -> Result<()> {
    write_through_temp(path, contents.as_ref(), Some(0o600))
}

fn write_through_temp(path: &Path, contents: &[u8], mode: Option<u32>) -> Result<()> {
    let io_err = |source| Error::Io {
        path: path.to_path_buf(),
        source,
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(io_err)?;
    }
    let (tmp, mut file) = create_temp(path, mode).map_err(io_err)?;
    let written = (|| {
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        match (mode, fs::metadata(path)) {
            // The process umask applies at creation, so set the mode exactly.
            #[cfg(unix)]
            (Some(mode), _) => {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&tmp, fs::Permissions::from_mode(mode))?;
            }
            (_, Ok(meta)) => fs::set_permissions(&tmp, meta.permissions())?,
            _ => {}
        }
        fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    written.map_err(io_err)
}

/// A new file beside `path` that no other writer can have open. With one fixed temp name, the
/// CLI's `install` and the app's could share a file: the second `O_TRUNC` cut the first's
/// half-written shim, and a truncated shim breaks every agent launch.
fn create_temp(
    path: &Path,
    #[cfg_attr(
        not(unix),
        expect(unused_variables, reason = "a file mode is Unix's; Windows has ACLs")
    )]
    mode: Option<u32>,
) -> io::Result<(PathBuf, File)> {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    loop {
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(format!(
            ".envrouter-tmp.{}.{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let mut options = File::options();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if let Some(mode) = mode {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(mode);
        }
        match options.open(&tmp) {
            Ok(file) => return Ok((tmp.into(), file)),
            // Left by a crash of a process that had this id.
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {}
            Err(err) => return Err(err),
        }
    }
}

/// The ids of every Keychain secret the server library refers to.
pub fn secret_ids(config: &ConfigState) -> BTreeSet<&str> {
    secret_users(config).into_keys().collect()
}

/// Each secret the server library refers to, with the names of the servers that use it.
pub fn secret_users(config: &ConfigState) -> BTreeMap<&str, Vec<&str>> {
    let mut users: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (name, server) in &config.mcp_servers {
        for id in server.secret_ids() {
            users.entry(id).or_default().push(name);
        }
    }
    users
}

/// Every command at least one profile routes, by its variable or by handing it MCP servers.
/// Each gets a shim.
pub fn tool_names(config: &ConfigState) -> BTreeSet<&str> {
    let by_var = config.profiles.iter().flat_map(|profile| {
        profile
            .tools
            .keys()
            .filter(|name| profile.tool(name).is_some())
    });
    let any_servers = config.profiles.iter().any(|p| !p.mcp_servers.is_empty());
    let by_mcp = config
        .agents
        .iter()
        .filter(move |(_, agent)| any_servers && agent.mcp.is_some())
        .map(|(name, _)| name);
    by_var.chain(by_mcp).map(String::as_str).collect()
}

/// The folders configured tools are pointed at, with `~` expanded. The app creates any that
/// are missing, so a new profile's folder is there to sign in to, reveal and import from, and
/// an agent that refuses a missing config folder still starts.
pub fn tool_dirs(config: &ConfigState, home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = config
        .profiles
        .iter()
        .flat_map(|profile| {
            profile
                .tools
                .keys()
                .filter_map(|name| profile.tool(name))
                .filter_map(|tool| tool_dir(&tool.path, home))
        })
        .collect();
    dirs.sort();
    dirs.dedup();
    dirs
}

/// The folder a tool's variable is set to, with `~` expanded, or `None` if it isn't one the
/// shim may apply. It must be absolute: a relative value would resolve against whatever
/// folder the tool happens to run in, and the tool would write its config there.
pub fn tool_dir(raw: &str, home: &Path) -> Option<PathBuf> {
    let dir = expand_home(raw.trim(), home);
    (dir.is_absolute() && !dir.components().any(|c| c == Component::ParentDir)).then_some(dir)
}

/// Expands a leading `~` to `home`, dropping repeated and trailing slashes after it.
pub fn expand_home(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => rest
            .split('/')
            .filter(|part| !part.is_empty())
            .fold(home.to_path_buf(), |acc, part| acc.join(part)),
        _ => PathBuf::from(path),
    }
}

/// The directory a trigger path matches, at and below. A trigger always covers its whole
/// subtree, so a trailing `/*` or `/**` is accepted and dropped. Any other `*` is rejected
/// rather than silently matched as a literal character.
pub fn trigger_base(raw: &str, home: &Path) -> Result<PathBuf> {
    let trimmed = raw.trim();
    let without_glob = ["/**", "/*"]
        .iter()
        .find_map(|suffix| trimmed.strip_suffix(suffix))
        .unwrap_or(trimmed);
    if without_glob.contains('*') {
        return Err(Error::Invalid(format!(
            "Trigger path \"{raw}\" has a wildcard EnvRouter can't match. Only a trailing /* is supported."
        )));
    }
    let base = expand_home(without_glob, home);
    if !base.is_absolute() {
        return Err(Error::Invalid(format!(
            "Trigger path \"{raw}\" must be absolute or start with ~."
        )));
    }
    // A working directory never contains `..`, so a trigger with one could never match.
    if base.components().any(|c| c == Component::ParentDir) {
        return Err(Error::Invalid(format!(
            "Trigger path \"{raw}\" can't contain \"..\"."
        )));
    }
    // Collecting components drops trailing separators and `.` segments.
    Ok(base.components().collect())
}

/// Rejects anything the shim can't apply safely: names that aren't valid command or
/// environment variable names, tool folders that aren't absolute, bad trigger paths, and a
/// folder claimed by two profiles.
pub fn validate(config: &ConfigState, home: &Path) -> Result<()> {
    let mut owners: HashMap<PathBuf, &Profile> = HashMap::new();
    for profile in &config.profiles {
        for (name, tool) in &profile.tools {
            if !is_command_name(name) {
                return Err(Error::Invalid(format!(
                    "\"{name}\" in profile \"{}\" isn't a valid command name.",
                    profile.name
                )));
            }
            if profile.tool(name).is_none() {
                continue;
            }
            if !is_env_var_name(&tool.env_var) {
                return Err(Error::Invalid(format!(
                    "\"{}\" in profile \"{}\" isn't a valid environment variable name.",
                    tool.env_var, profile.name
                )));
            }
            if tool_dir(&tool.path, home).is_none() {
                return Err(Error::Invalid(format!(
                    "The {name} folder \"{}\" in profile \"{}\" must be an absolute path or start with ~, without \"..\".",
                    tool.path.trim(),
                    profile.name
                )));
            }
        }
        validate_profile_mcp(config, profile)?;
        for raw in &profile.trigger_paths {
            let base = trigger_base(raw, home)?;
            // Compared as `resolve` compares them: through symlinks and letter case, two
            // spellings of one folder are still one folder.
            let folder = fs::canonicalize(&base).unwrap_or(base);
            if let Some(other) = owners.insert(folder.clone(), profile) {
                if other.id != profile.id {
                    return Err(Error::Invalid(format!(
                        "{} is a trigger path in both \"{}\" and \"{}\". A folder can belong to only one profile.",
                        folder.display(),
                        other.name,
                        profile.name
                    )));
                }
            }
        }
    }
    for (name, server) in &config.mcp_servers {
        validate_server(name, server)?;
    }
    for (name, agent) in &config.agents {
        validate_agent(name, agent)?;
    }
    Ok(())
}

fn validate_profile_mcp(config: &ConfigState, profile: &Profile) -> Result<()> {
    if profile.mcp_servers.is_empty() {
        return Ok(());
    }
    // The id names the folder its rendered MCP files go in.
    if !is_file_name(&profile.id) {
        return Err(Error::Invalid(format!(
            "Profile \"{}\" has the id \"{}\", which can't name a folder. Use letters, digits, - and _.",
            profile.name, profile.id
        )));
    }
    for (server, using) in &profile.mcp_servers {
        if !config.mcp_servers.contains_key(server) {
            return Err(Error::Invalid(format!(
                "Profile \"{}\" uses the MCP server \"{server}\", which isn't in the server list.",
                profile.name
            )));
        }
        if let Some(tool) = using.disabled_tools.iter().find(|t| !is_mcp_tool_name(t)) {
            return Err(Error::Invalid(format!(
                "\"{tool}\" in profile \"{}\" isn't a valid MCP tool name.",
                profile.name
            )));
        }
    }
    Ok(())
}

fn validate_server(name: &str, server: &McpServer) -> Result<()> {
    let invalid = |problem: String| Err(Error::Invalid(format!("MCP server \"{name}\" {problem}")));
    if !is_file_name(name) {
        return invalid("needs a name made of letters, digits, - and _.".into());
    }
    match server {
        McpServer::Stdio { command, env, .. } => {
            if command.trim().is_empty() {
                return invalid("needs a command to run.".into());
            }
            if let Some(key) = env.keys().find(|key| !is_env_var_name(key)) {
                return invalid(format!(
                    "sets \"{key}\", which isn't a valid environment variable name."
                ));
            }
        }
        McpServer::Http { url, headers } | McpServer::Sse { url, headers } => {
            let rest = url
                .strip_prefix("https://")
                .or_else(|| url.strip_prefix("http://"));
            if rest.is_none_or(|rest| rest.trim().is_empty()) {
                return invalid(format!(
                    "has the URL \"{url}\". It must start with https:// or http://."
                ));
            }
            if let Some(key) = headers.keys().find(|key| !is_header_name(key)) {
                return invalid(format!("has a header named \"{key}\", which isn't valid."));
            }
        }
    }
    for value in server.values() {
        if let McpValue::Secret { secret } = value {
            if !is_secret_id(secret) {
                return invalid(format!(
                    "refers to a secret with a malformed id, \"{secret}\"."
                ));
            }
        }
    }
    Ok(())
}

fn validate_agent(name: &str, agent: &AgentDef) -> Result<()> {
    if !is_command_name(name) {
        return Err(Error::Invalid(format!(
            "\"{name}\" in the agent list isn't a valid command name."
        )));
    }
    if let Some(files) = &agent.mcp_files {
        // Plain file names, joined onto folders; never a path that climbs out of one.
        let plain =
            |name: &str| !name.is_empty() && !name.contains('/') && name != "." && name != "..";
        if !plain(&files.user_file)
            || files.project_file.as_deref().is_some_and(|f| !plain(f))
            || tool_dir(&files.default_dir, Path::new("/")).is_none()
        {
            return Err(Error::Invalid(format!(
                "The MCP file locations for {name} aren't plain file names in an absolute or ~ folder."
            )));
        }
    }
    let Some(mcp) = &agent.mcp else {
        return Ok(());
    };
    // One argument in the `--flag=` form, never a flag waiting for the next argument.
    let is_prefix = |arg: &str| {
        arg.starts_with('-')
            && arg.find('=').is_some_and(|eq| eq > 1)
            && !arg.contains(char::is_whitespace)
    };
    if !is_prefix(&mcp.config_arg) || mcp.deny_arg.as_deref().is_some_and(|a| !is_prefix(a)) {
        return Err(Error::Invalid(format!(
            "The MCP arguments for {name} must each be one option of the form --flag=."
        )));
    }
    Ok(())
}

/// Letters, digits, `-` and `_`: safe as a file or folder name, and in Claude's
/// `mcp__<server>__<tool>` tool names.
pub fn is_file_name(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The characters MCP allows in a tool name.
pub fn is_mcp_tool_name(s: &str) -> bool {
    (1..=128).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Uppercase hex: it's part of the `ENVROUTER_SECRET_<ID>` variable name.
pub fn is_secret_id(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s.chars()
            .all(|c| c.is_ascii_digit() || matches!(c, 'A'..='F'))
}

fn is_header_name(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// ASCII letters, digits and `_`, not starting with a digit.
pub fn is_env_var_name(s: &str) -> bool {
    let mut chars = s.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Like an env var name, but `-` is allowed after the first character. This becomes a file
/// name in the shims directory and is interpolated into shell checks, so it stays strict.
pub fn is_command_name(s: &str) -> bool {
    let mut chars = s.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/home/me")
    }

    fn profile(id: &str, triggers: &[&str], tool: Option<(&str, &str, &str)>) -> Profile {
        Profile {
            id: id.into(),
            name: id.into(),
            trigger_paths: triggers.iter().copied().map(String::from).collect(),
            tools: tool
                .into_iter()
                .map(|(name, env_var, path)| {
                    (
                        name.into(),
                        ToolConfig {
                            env_var: env_var.into(),
                            path: path.into(),
                        },
                    )
                })
                .collect(),
            ..Default::default()
        }
    }

    fn stdio(command: &str) -> McpServer {
        McpServer::Stdio {
            command: command.into(),
            args: Vec::new(),
            env: BTreeMap::new(),
        }
    }

    fn claude_agent() -> AgentDef {
        AgentDef {
            mcp: Some(McpInjection {
                dialect: McpDialect::Claude,
                config_arg: "--mcp-config=".into(),
                deny_arg: Some("--disallowedTools=".into()),
                skip_any_args: vec!["--strict-mcp-config".into()],
                skip_subcommands: vec!["plugin".into()],
            }),
            ..Default::default()
        }
    }

    /// A config with one server, `github`, used by profile `a`.
    fn with_server(server: McpServer, disabled: &[&str]) -> ConfigState {
        let mut a = profile("a", &["~/dev"], None);
        a.mcp_servers.insert(
            "github".into(),
            McpUse {
                disabled_tools: disabled.iter().copied().map(String::from).collect(),
            },
        );
        ConfigState {
            profiles: vec![a],
            mcp_servers: BTreeMap::from([("github".into(), server)]),
            agents: BTreeMap::from([("claude".into(), claude_agent())]),
            ..Default::default()
        }
    }

    #[test]
    fn mcp_fields_have_the_wire_shape_the_window_uses() {
        let mut config = with_server(
            McpServer::Stdio {
                command: "npx".into(),
                args: vec![McpValue::Plain("-y".into())],
                env: BTreeMap::from([(
                    "GITHUB_TOKEN".into(),
                    McpValue::Secret {
                        secret: "7F3A".into(),
                    },
                )]),
            },
            &["delete_repo"],
        );
        config.mcp_servers.insert(
            "linear".into(),
            McpServer::Http {
                url: "https://mcp.linear.app/mcp".into(),
                headers: BTreeMap::new(),
            },
        );
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(
            json["mcpServers"]["github"],
            serde_json::json!({
                "transport": "stdio",
                "command": "npx",
                "args": ["-y"],
                "env": { "GITHUB_TOKEN": { "secret": "7F3A" } },
            })
        );
        assert_eq!(json["mcpServers"]["linear"]["transport"], "http");
        assert_eq!(
            json["profiles"][0]["mcpServers"]["github"],
            serde_json::json!({ "disabledTools": ["delete_repo"] })
        );
        assert_eq!(
            json["agents"]["claude"]["mcp"],
            serde_json::json!({
                "dialect": "claude",
                "configArg": "--mcp-config=",
                "denyArg": "--disallowedTools=",
                "skipAnyArgs": ["--strict-mcp-config"],
                "skipSubcommands": ["plugin"],
            })
        );
        assert_eq!(serde_json::from_value::<ConfigState>(json).unwrap(), config);
    }

    #[test]
    fn save_keeps_every_field() {
        let dir = tempfile::tempdir().unwrap();
        let config = with_server(stdio("npx"), &[]);
        save(dir.path(), &config).unwrap();
        assert_eq!(load(dir.path()).unwrap().unwrap(), config);
    }

    #[test]
    fn load_reads_a_version_1_file_as_one_without_servers() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(CONFIG_FILE),
            r#"{ "version": 1, "profiles": [{ "id": "a", "name": "A", "triggerPaths": ["~/dev"], "tools": {} }] }"#,
        )
        .unwrap();
        let config = load(dir.path()).unwrap().unwrap();
        assert!(config.mcp_servers.is_empty() && config.agents.is_empty());
        assert!(config.profiles[0].mcp_servers.is_empty());
        save(dir.path(), &config).unwrap();
        assert_eq!(load(dir.path()).unwrap().unwrap().version, CONFIG_VERSION);
    }

    #[test]
    fn load_reads_a_version_2_file_as_one_without_editor_hooks() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(CONFIG_FILE),
            r#"{ "version": 2, "profiles": [], "agents": { "claude": { "mcp": null } } }"#,
        )
        .unwrap();
        let config = load(dir.path()).unwrap().unwrap();
        assert_eq!(config.agents["claude"].ide, None);
        let hook = IdeHook {
            setting: "claudeCode.claudeProcessWrapper".into(),
            extension: "anthropic.claude-code".into(),
        };
        let json = serde_json::to_value(&hook).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "setting": "claudeCode.claudeProcessWrapper", "extension": "anthropic.claude-code" })
        );
    }

    #[test]
    fn an_installed_copy_is_the_extension_id_then_a_version() {
        let hook = IdeHook {
            setting: "claudeCode.claudeProcessWrapper".into(),
            extension: "anthropic.claude-code".into(),
        };
        for name in [
            "anthropic.claude-code-2.1.89",
            "anthropic.claude-code-2.1.301-darwin-arm64",
        ] {
            assert!(hook.is_installed_copy(name), "{name}");
        }
        for name in [
            "anthropic.claude-code",
            "anthropic.claude-code-nightly-1.0.0",
            "anthropic.claude-code2-1.0.0",
            "other.anthropic.claude-code-1.0.0",
        ] {
            assert!(!hook.is_installed_copy(name), "{name}");
        }
    }

    #[test]
    fn load_reads_a_version_3_file_as_one_without_skipped_subcommands() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(CONFIG_FILE),
            r#"{ "version": 3, "profiles": [], "agents": { "claude": { "mcp": { "dialect": "claude", "configArg": "--mcp-config=", "skipAnyArgs": ["--strict-mcp-config"] } } } }"#,
        )
        .unwrap();
        let config = load(dir.path()).unwrap().unwrap();
        let mcp = config.agents["claude"].mcp.as_ref().unwrap();
        assert!(mcp.skip_subcommands.is_empty());
        assert_eq!(mcp.skip_any_args, ["--strict-mcp-config"]);
    }

    #[test]
    fn validate_accepts_a_well_formed_library() {
        validate(&with_server(stdio("npx"), &["delete_repo"]), &home()).unwrap();
        let sse = McpServer::Sse {
            url: "http://localhost:3000/sse".into(),
            headers: BTreeMap::from([(
                "Authorization".into(),
                McpValue::Secret {
                    secret: "00FF".into(),
                },
            )]),
        };
        validate(&with_server(sse, &[]), &home()).unwrap();
    }

    #[test]
    fn validate_rejects_bad_servers() {
        let remote = |url: &str, header: &str| McpServer::Http {
            url: url.into(),
            headers: BTreeMap::from([(header.into(), McpValue::Plain("x".into()))]),
        };
        let bad = [
            stdio(" "),
            McpServer::Stdio {
                command: "npx".into(),
                args: Vec::new(),
                env: BTreeMap::from([("1BAD".into(), McpValue::Plain("x".into()))]),
            },
            McpServer::Stdio {
                command: "npx".into(),
                args: vec![McpValue::Secret {
                    secret: "not-hex".into(),
                }],
                env: BTreeMap::new(),
            },
            remote("ftp://example.com", "X-Ok"),
            remote("https://", "X-Ok"),
            remote("https://example.com", "Bad Header"),
        ];
        for server in bad {
            assert!(
                validate(&with_server(server.clone(), &[]), &home()).is_err(),
                "{server:?}"
            );
        }
    }

    #[test]
    fn validate_rejects_bad_names_and_selections() {
        let mut bad_name = with_server(stdio("npx"), &[]);
        let server = bad_name.mcp_servers.remove("github").unwrap();
        bad_name.mcp_servers.insert("git hub".into(), server);
        bad_name.profiles[0].mcp_servers.clear();
        assert!(validate(&bad_name, &home()).is_err());

        let mut missing = with_server(stdio("npx"), &[]);
        missing.mcp_servers.clear();
        let err = validate(&missing, &home()).unwrap_err().to_string();
        assert!(err.contains("isn't in the server list"), "{err}");

        let bad_tool = with_server(stdio("npx"), &["delete repo"]);
        assert!(validate(&bad_tool, &home()).is_err());

        let mut bad_id = with_server(stdio("npx"), &[]);
        bad_id.profiles[0].id = "../a".into();
        assert!(validate(&bad_id, &home()).is_err());
        // The id only names a folder once the profile uses a server.
        bad_id.profiles[0].mcp_servers.clear();
        validate(&bad_id, &home()).unwrap();
    }

    #[test]
    fn validate_rejects_bad_agent_flags() {
        for flag in ["--mcp-config", "mcp-config=", "-=", "--mcp config="] {
            let mut config = with_server(stdio("npx"), &[]);
            let agent = config.agents.get_mut("claude").unwrap();
            agent.mcp.as_mut().unwrap().config_arg = flag.into();
            assert!(validate(&config, &home()).is_err(), "{flag}");
        }
    }

    #[test]
    fn secret_ids_gathers_every_reference_in_the_library() {
        let mut config = with_server(
            McpServer::Stdio {
                command: "npx".into(),
                args: vec![McpValue::Secret {
                    secret: "AA".into(),
                }],
                env: BTreeMap::from([(
                    "TOKEN".into(),
                    McpValue::Secret {
                        secret: "BB".into(),
                    },
                )]),
            },
            &[],
        );
        config.mcp_servers.insert("plain".into(), stdio("npx"));
        assert_eq!(secret_ids(&config), BTreeSet::from(["AA", "BB"]));
    }

    #[test]
    fn tool_names_adds_mcp_agents_once_a_profile_uses_a_server() {
        let mut config = with_server(stdio("npx"), &[]);
        config.agents.insert("aider".into(), AgentDef::default());
        assert_eq!(tool_names(&config), BTreeSet::from(["claude"]));
        config.profiles[0].mcp_servers.clear();
        assert!(tool_names(&config).is_empty());
    }

    fn config(profiles: Vec<Profile>) -> ConfigState {
        ConfigState {
            profiles,
            ..Default::default()
        }
    }

    #[test]
    fn trigger_base_expands_home_and_drops_trailing_glob() {
        for raw in [
            "~/dev/work",
            "~/dev/work/",
            "~/dev/work/*",
            "~/dev/work/**",
            " ~/dev/work ",
        ] {
            assert_eq!(
                trigger_base(raw, &home()).unwrap(),
                PathBuf::from("/home/me/dev/work"),
                "{raw}"
            );
        }
        assert_eq!(trigger_base("~", &home()).unwrap(), home());
        assert_eq!(trigger_base("/", &home()).unwrap(), PathBuf::from("/"));
    }

    #[test]
    fn trigger_base_rejects_what_cannot_match() {
        for raw in [
            "~/dev/*/work",
            "~/dev/work*",
            "dev/work",
            "~user/dev",
            "/home/me/../x",
            "",
        ] {
            assert!(trigger_base(raw, &home()).is_err(), "{raw}");
        }
    }

    #[test]
    fn trigger_base_keeps_glob_characters_other_than_star_literal() {
        assert_eq!(
            trigger_base("~/[archive]/v?", &home()).unwrap(),
            PathBuf::from("/home/me/[archive]/v?")
        );
        // A backslash is an ordinary file name character here, not a separator.
        assert_eq!(
            trigger_base("~/a\\b", &home()).unwrap(),
            PathBuf::from("/home/me/a\\b")
        );
    }

    #[test]
    fn validate_rejects_a_folder_in_two_profiles_after_normalizing() {
        let config = config(vec![
            profile("a", &["~/dev"], None),
            profile("b", &["/home/me/dev/*"], None),
        ]);
        let err = validate(&config, &home()).unwrap_err().to_string();
        assert!(err.contains("\"a\" and \"b\""), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn validate_rejects_one_folder_spelled_two_ways() {
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        fs::create_dir_all(home.join("dev/work")).unwrap();
        std::os::unix::fs::symlink(home.join("dev/work"), home.join("work")).unwrap();
        let config = config(vec![
            profile("a", &["~/dev/work"], None),
            profile("b", &["~/work"], None),
        ]);
        let err = validate(&config, &home).unwrap_err().to_string();
        assert!(err.contains("\"a\" and \"b\""), "{err}");
    }

    #[test]
    fn validate_allows_a_repeated_trigger_within_one_profile() {
        let config = config(vec![profile("a", &["~/dev", "~/dev/"], None)]);
        validate(&config, &home()).unwrap();
    }

    #[test]
    fn validate_checks_names_only_for_configured_tools() {
        let bad_var = config(vec![profile("a", &[], Some(("claude", "1BAD", "~/.c")))]);
        assert!(validate(&bad_var, &home()).is_err());

        let unconfigured = config(vec![profile("a", &[], Some(("claude", "", "")))]);
        validate(&unconfigured, &home()).unwrap();

        let bad_tool = config(vec![profile("a", &[], Some(("../claude", "X", "")))]);
        assert!(validate(&bad_tool, &home()).is_err());
    }

    #[test]
    fn validate_rejects_a_tool_folder_that_is_not_absolute() {
        for path in ["relative/dir", "./here", "~user/.c", "~/../elsewhere"] {
            let bad = config(vec![profile("a", &[], Some(("claude", "X", path)))]);
            let err = validate(&bad, &home()).unwrap_err().to_string();
            assert!(err.contains(path), "{path}: {err}");
        }
        for path in ["~/.c", "~", "/opt/claude", " ~/.c "] {
            let good = config(vec![profile("a", &[], Some(("claude", "X", path)))]);
            validate(&good, &home()).unwrap();
        }
    }

    #[test]
    fn tool_names_skips_unconfigured_tools() {
        let config = config(vec![
            profile("a", &[], Some(("claude", "CLAUDE_CONFIG_DIR", "~/.c"))),
            profile("b", &[], Some(("aider", "X", " "))),
        ]);
        assert_eq!(tool_names(&config), BTreeSet::from(["claude"]));
    }

    #[test]
    fn tool_dirs_expands_and_skips_unconfigured_tools() {
        let config = config(vec![
            profile("a", &[], Some(("copilot", "COPILOT_HOME", "~/.copilot-a"))),
            profile("b", &[], Some(("claude", "CLAUDE_CONFIG_DIR", " "))),
            profile("c", &[], Some(("copilot", "COPILOT_HOME", "~/.copilot-a"))),
        ]);
        assert_eq!(
            tool_dirs(&config, &home()),
            vec![PathBuf::from("/home/me/.copilot-a")]
        );
    }

    #[test]
    fn load_or_init_creates_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let envrouter = dir.path().join(".envrouter");
        assert_eq!(load_or_init(&envrouter).unwrap(), ConfigState::default());
        assert!(envrouter.join(CONFIG_FILE).exists());

        let config = config(vec![profile(
            "a",
            &["~/dev"],
            Some(("claude", "CLAUDE_CONFIG_DIR", "~/.c")),
        )]);
        save(&envrouter, &config).unwrap();
        assert_eq!(load_or_init(&envrouter).unwrap(), config);
    }

    #[test]
    fn load_reads_a_file_without_a_version_as_version_1() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE), r#"{ "profiles": [] }"#).unwrap();
        assert_eq!(load(dir.path()).unwrap().unwrap().version, 1);
    }

    #[test]
    fn load_refuses_a_newer_version() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(CONFIG_FILE),
            r#"{ "version": 99, "profiles": [] }"#,
        )
        .unwrap();
        assert!(matches!(load(dir.path()), Err(Error::Invalid(_))));
    }

    #[test]
    fn load_or_init_refuses_to_overwrite_a_malformed_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE), "{ not json").unwrap();
        assert!(matches!(load_or_init(dir.path()), Err(Error::Json { .. })));
        assert_eq!(
            fs::read_to_string(dir.path().join(CONFIG_FILE)).unwrap(),
            "{ not json"
        );
    }

    /// Writers racing on one file (the CLI's `install` and the app's both writing the shim)
    /// each leave a whole file. With one shared temp name, a second writer's truncation cut the
    /// first's contents, and the rename installed what was left.
    #[test]
    fn write_atomic_from_racing_writers_leaves_one_whole_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("envrouter-shim");
        let writers: Vec<_> = (0..8u8)
            .map(|n| {
                let file = file.clone();
                std::thread::spawn(move || {
                    let contents = vec![b'a' + n; 1 << 20];
                    for _ in 0..20 {
                        write_atomic(&file, &contents).unwrap();
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        let written = fs::read(&file).unwrap();
        assert_eq!(written.len(), 1 << 20);
        assert!(written.iter().all(|&b| b == written[0]));
        // No temp file is left behind.
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["envrouter-shim"]);
    }

    #[test]
    fn write_atomic_removes_its_temp_file_when_the_rename_fails() {
        let dir = tempfile::tempdir().unwrap();
        // A folder where the file should go: the rename fails.
        let target = dir.path().join("taken");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("inside"), "").unwrap();
        assert!(write_atomic(&target, "new").is_err());
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["taken"]);
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_keeps_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("rc");
        fs::write(&file, "old").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&file, "new").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
