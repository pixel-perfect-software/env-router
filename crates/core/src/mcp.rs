//! Handing a profile's MCP servers to an agent when it starts.
//!
//! On every save the app renders, for each profile that uses servers and each agent with an
//! MCP descriptor, one config file per server in the agent's dialect, plus a launch manifest
//! listing the arguments that load them. The shim reads only the manifest, so it never needs
//! an agent's file format. Secret values are nowhere on disk: a rendered file refers to
//! `${ENVROUTER_SECRET_<ID>}`, which the shim sets on the agent's process from the Keychain.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

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
        !user_args
            .iter()
            .any(|arg| self.skip_any_args.iter().any(|skip| arg == skip.as_str()))
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
                servers: Vec::new(),
            };
            for (name, using) in &profile.mcp_servers {
                let Some(server) = config.mcp_servers.get(name) else {
                    continue;
                };
                // In their own folder, so a server named `launch` can't collide.
                let file = dir.join("servers").join(format!("{name}.json"));
                let contents = server_file(injection.dialect, name, server);
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

/// Writes what [`render`] gives, then removes every other file under [`paths::mcp`]. New files
/// land before old ones go, so a tool starting mid-save never finds a manifest missing.
#[cfg(unix)]
pub fn sync(config: &ConfigState, home: &Path) -> Result<()> {
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
    remove_except(&root, &keep)
}

/// Removes everything in `dir` that isn't in `keep`, and folders left empty. Links are removed,
/// never followed.
fn remove_except(dir: &Path, keep: &HashSet<&Path>) -> Result<()> {
    let io_err = |path: &Path| {
        let path = path.to_path_buf();
        move |source| Error::Io { path, source }
    };
    for entry in fs::read_dir(dir).map_err(io_err(dir))? {
        let path = entry.map_err(io_err(dir))?.path();
        let meta = fs::symlink_metadata(&path).map_err(io_err(&path))?;
        if meta.is_dir() {
            remove_except(&path, keep)?;
            if fs::read_dir(&path).map_err(io_err(&path))?.next().is_none() {
                fs::remove_dir(&path).map_err(io_err(&path))?;
            }
        } else if !keep.contains(path.as_path()) {
            fs::remove_file(&path).map_err(io_err(&path))?;
        }
    }
    Ok(())
}

fn pretty(value: &impl Serialize) -> String {
    let json = serde_json::to_string_pretty(value).expect("rendered files always serialize");
    format!("{json}\n")
}

/// One server as an agent's config file in `dialect`.
fn server_file(dialect: McpDialect, name: &str, server: &McpServer) -> Value {
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
            "args": args.iter().map(text).collect::<Vec<_>>(),
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
                "args": ["-y", "gh"],
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
    fn the_manifest_loads_each_server_with_one_equals_form_argument() {
        let files = rendered(&config());
        let launch: Launch = serde_json::from_str(&files["work/claude/launch.json"]).unwrap();
        let dir = paths::mcp(&home()).join("work/claude/servers");
        assert_eq!(
            launch,
            Launch {
                skip_any_args: vec!["--strict-mcp-config".into()],
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
            servers: Vec::new(),
        };
        assert!(launch.applies_to(&["-p".into(), "hi".into()]));
        assert!(!launch.applies_to(&["--strict-mcp-config".into()]));
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

        config.profiles[0].mcp_servers.remove("linear");
        sync(&config, home).unwrap();
        let servers = launch.parent().unwrap().join("servers");
        assert!(servers.join("github.json").exists());
        assert!(!servers.join("linear.json").exists());

        config.profiles[0].mcp_servers.clear();
        sync(&config, home).unwrap();
        assert_eq!(fs::read_dir(paths::mcp(home)).unwrap().count(), 0);
        assert_eq!(load_launch(home, "work", "claude").unwrap(), None);
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
