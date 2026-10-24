//! Handing a profile's MCP servers to an agent when it starts.
//!
//! On every save the app renders, for each profile that uses servers and each agent with an
//! MCP descriptor, one config file per server in the agent's dialect, plus a launch manifest
//! listing the arguments that load them. The shim reads only the manifest, so it never needs
//! an agent's file format. Secret values are nowhere on disk: a rendered file refers to
//! `${ENVROUTER_SECRET_<ID>}`, which the shim sets on the agent's process from the Keychain.

#[cfg(unix)]
use std::collections::HashSet;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::config::{self, ConfigState, McpDialect, McpServer, McpUse, McpValue, Profile};
use crate::error::{Error, Result};
use crate::paths;

const SECRET_VAR_PREFIX: &str = "ENVROUTER_SECRET_";

/// The manifest at [`paths::mcp_launch`]: what to add to one agent's command line in one
/// profile's folders.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Launch {
    /// Any of these among the user's own arguments turns injection off for that run.
    #[serde(default)]
    pub skip_any_args: Vec<String>,
    /// A run whose first argument is one of these subcommands gets no injection.
    #[serde(default)]
    pub skip_subcommands: Vec<String>,
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
    /// Each a single `--flag=value` argument, added before the user's own.
    pub args: Vec<String>,
    /// The Keychain secrets the server's file refers to. Without all of them it's left out.
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
    /// Whether to inject into a run with these arguments.
    pub fn applies_to(&self, user_args: &[OsString]) -> bool {
        let skipped_subcommand = user_args.first().is_some_and(|first| {
            self.skip_subcommands
                .iter()
                .any(|skip| first == skip.as_str())
        });
        !skipped_subcommand
            && !user_args
                .iter()
                .any(|arg| self.skip_any_args.iter().any(|skip| arg == skip.as_str()))
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
    let injects = config
        .agents
        .get(tool)
        .is_some_and(|agent| agent.mcp.is_some());
    profile
        .mcp_servers
        .keys()
        .filter(|name| injects && config.mcp_servers.contains_key(*name))
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
                skip_if_present: injection.skip_if_present.clone(),
                servers: Vec::new(),
            };
            for (name, using) in &profile.mcp_servers {
                let Some(server) = config.mcp_servers.get(name) else {
                    continue;
                };
                // In their own folder, so a server named `launch` can't collide.
                let file = dir.join("servers").join(format!("{name}.json"));
                let contents = server_file(injection.dialect, name, server, home);
                files.push((file.clone(), pretty(&contents)));
                let mut args = vec![format!("{}{}", injection.config_arg, file.display())];
                if let Some(deny_arg) = &injection.deny_arg {
                    args.extend(deny_args(injection.dialect, deny_arg, name, using));
                }
                launch.servers.push(LaunchServer {
                    name: name.clone(),
                    args,
                    secrets: server.secret_ids().into_iter().map(str::to_owned).collect(),
                });
            }
            files.push((launch_path, pretty(&launch)));
        }
    }
    files
}

/// How long a server file outlives the save that stopped naming it. A shim that read the old
/// manifest just before the save hands the agent that file, and the agent opens it as it starts.
#[cfg(unix)]
const RETIRED_GRACE: Duration = Duration::from_secs(600);

/// Writes what [`render`] gives, then removes the rest of [`paths::mcp`]. New files land before
/// old ones go, so a tool starting mid-save never finds a manifest missing. A manifest that's no
/// longer rendered goes at once, so no new run gets servers the config dropped; a server file goes
/// only once it's been unnamed for [`RETIRED_GRACE`], at a later save, since a run that read the
/// old manifest may still open it.
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
    remove_stale(&root, &keep, &mut retired)?;
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

/// Removes what in `dir` isn't in `keep`: a manifest at once, a server file once it's been
/// retired for [`RETIRED_GRACE`], and folders left empty. Links are removed, never followed.
/// Only [`sync`] uses it, which is Unix-only until Windows gets its own.
#[cfg(unix)]
fn remove_stale(dir: &Path, keep: &HashSet<&Path>, retired: &mut Retired) -> Result<()> {
    let io_err = |path: &Path| {
        let path = path.to_path_buf();
        move |source| Error::Io { path, source }
    };
    for entry in fs::read_dir(dir).map_err(io_err(dir))? {
        let path = entry.map_err(io_err(dir))?.path();
        let meta = fs::symlink_metadata(&path).map_err(io_err(&path))?;
        if meta.is_dir() {
            remove_stale(&path, keep, retired)?;
            if fs::read_dir(&path).map_err(io_err(&path))?.next().is_none() {
                fs::remove_dir(&path).map_err(io_err(&path))?;
            }
            continue;
        }
        if keep.contains(path.as_path()) {
            continue;
        }
        let since = *retired.since.entry(path.clone()).or_insert(retired.now);
        let manifest = path
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
fn launch_args(command: &str, mut args: Vec<String>, home: &Path) -> Vec<String> {
    let npx = Path::new(command)
        .file_name()
        .is_some_and(|name| name == "npx");
    let own_prefix = args
        .iter()
        .take_while(|arg| arg.starts_with('-'))
        .any(|arg| arg.starts_with("--prefix"));
    if npx && !own_prefix {
        args.insert(0, format!("--prefix={}", home.display()));
    }
    args
}

/// One server as an agent's config file in `dialect`.
fn server_file(dialect: McpDialect, name: &str, server: &McpServer, home: &Path) -> Value {
    let text = |value: &McpValue| match value {
        McpValue::Plain(text) => text.clone(),
        McpValue::Secret { secret } => format!("${{{}}}", secret_var(secret)),
    };
    let map = |values: &BTreeMap<String, McpValue>| {
        values
            .iter()
            .map(|(key, value)| (key.clone(), Value::String(text(value))))
            .collect::<Map<_, _>>()
    };
    let mut entry = match server {
        McpServer::Stdio { command, args, env } => json!({
            "type": match dialect {
                McpDialect::Claude => "stdio",
                McpDialect::Copilot => "local",
            },
            "command": command,
            "args": launch_args(command, args.iter().map(text).collect(), home),
            "env": map(env),
        }),
        McpServer::Http { url, headers } => {
            json!({ "type": "http", "url": url, "headers": map(headers) })
        }
        McpServer::Sse { url, headers } => {
            json!({ "type": "sse", "url": url, "headers": map(headers) })
        }
    };
    if dialect == McpDialect::Copilot {
        // Required. Tools are turned off by flag (`deny_args`), so the list stays open.
        entry["tools"] = json!(["*"]);
    }
    json!({ "mcpServers": { name: entry } })
}

/// The arguments that turn off a server's disabled tools, each in the `--flag=value` form:
/// Claude takes one comma-separated list of `mcp__<server>__<tool>`, Copilot one
/// `<server>(<tool>)` pattern per argument.
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
                skip_if_present: Vec::new(),
            }),
            ..Default::default()
        }
    }

    fn secret(id: &str) -> McpValue {
        McpValue::Secret { secret: id.into() }
    }

    /// Profile `work` uses `github` (a token from the Keychain, `delete_repo` off) and
    /// `linear` (remote). Profile `home` uses nothing.
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
                        headers: BTreeMap::new(),
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
    fn render_writes_one_file_per_server_and_a_manifest_per_agent() {
        let files = rendered(&config());
        assert_eq!(
            files.keys().collect::<Vec<_>>(),
            [
                "work/claude/launch.json",
                "work/claude/servers/github.json",
                "work/claude/servers/linear.json",
            ]
        );
        let github: Value =
            serde_json::from_str(&files["work/claude/servers/github.json"]).unwrap();
        assert_eq!(
            github,
            json!({ "mcpServers": { "github": {
                "type": "stdio",
                "command": "npx",
                "args": ["--prefix=/home/me", "-y", "gh"],
                "env": { "GITHUB_TOKEN": "${ENVROUTER_SECRET_7F3A}" },
            }}})
        );
        let linear: Value =
            serde_json::from_str(&files["work/claude/servers/linear.json"]).unwrap();
        assert_eq!(
            linear["mcpServers"]["linear"],
            json!({ "type": "http", "url": "https://mcp.linear.app/mcp", "headers": {} })
        );
    }

    #[test]
    fn only_npx_gets_the_home_prefix_and_only_once() {
        let home = home();
        let args = |list: &[&str]| list.iter().map(|&a| a.to_owned()).collect::<Vec<_>>();
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
                skip_if_present: vec!["/etc/claude-code/managed-mcp.json".into()],
                servers: vec![
                    LaunchServer {
                        name: "github".into(),
                        args: vec![
                            format!("--mcp-config={}", dir.join("github.json").display()),
                            "--disallowedTools=mcp__github__delete_repo,mcp__github__fork".into(),
                        ],
                        secrets: vec!["7F3A".into()],
                    },
                    LaunchServer {
                        name: "linear".into(),
                        args: vec![format!(
                            "--mcp-config={}",
                            dir.join("linear.json").display()
                        )],
                        secrets: Vec::new(),
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
        let entry = &github["mcpServers"]["github"];
        assert_eq!(entry["type"], "local");
        assert_eq!(entry["tools"], json!(["*"]));
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

    #[test]
    fn inject_leaves_out_servers_whose_secrets_are_missing() {
        let files = rendered(&config());
        let launch: Launch = serde_json::from_str(&files["work/claude/launch.json"]).unwrap();
        assert_eq!(launch.secret_ids(), BTreeSet::from(["7F3A"]));

        let without = launch.inject(&HashMap::new());
        assert_eq!(without.servers, ["linear"]);
        assert_eq!(without.dropped, ["github"]);
        assert_eq!(without.args.len(), 1);
        assert!(without.env.is_empty());

        let with = launch.inject(&HashMap::from([("7F3A".into(), "ghp_x".into())]));
        assert_eq!(with.servers, ["github", "linear"]);
        assert_eq!(with.args.len(), 3);
        assert_eq!(
            with.env,
            [("ENVROUTER_SECRET_7F3A".to_string(), "ghp_x".to_string())]
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
    fn applies_to_skips_subcommands_that_take_no_injected_options() {
        let launch = Launch {
            skip_subcommands: vec!["plugin".into()],
            ..Default::default()
        };
        assert!(!launch.applies_to(&["plugin".into(), "test".into(), ".".into()]));
        // Only as the first argument: the same word in a prompt is just a word.
        assert!(launch.applies_to(&["-p".into(), "plugin".into()]));
        assert!(launch.applies_to(&[]));
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
    /// `--mcp-config=<deleted file>`.
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
