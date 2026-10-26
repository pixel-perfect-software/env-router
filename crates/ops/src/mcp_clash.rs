//! Finds the servers a profile hands an agent that the agent's own files define with the other
//! transport. Codex merges two servers of one name key by key, and a command-and-url result is
//! no server at all: every `codex` in that folder exits at startup. The shim can't see this
//! (it reads no TOML), so a save warns of it and a folder check reports it. Neither refuses:
//! EnvRouter never edits the agent's files, and the agent's own error still names the server.
//!
//! The rules are pinned to Codex 0.164.0 (`config/src/mcp_types.rs`, `config/src/loader/mod.rs`):
//! the user's `config.toml` always counts; a project's `.codex/config.toml` counts from the
//! project root down to the folder, only where `[projects."<path>"]` says
//! `trust_level = "trusted"`. A key is read as it is written, so a server EnvRouter's import
//! would leave out is seen too. Missed: a worktree trusted only through its main repository,
//! `/etc/codex/config.toml`, `--profile` layers, managed config.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState, McpDialect, McpFiles, McpServer};
use envrouter_core::mcp;
use serde::Serialize;

use crate::commands;

/// A server the profile hands the agent that one of the agent's files defines another way.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClash {
    pub server: String,
    /// The agent's file that defines it.
    pub file: String,
    /// Whether `open_in_editor` will open `file`: it refuses one outside the home folder, which
    /// a `CODEX_HOME` on another volume or a trusted repository under `/opt` is.
    pub openable: bool,
}

/// How many servers a warning names before it counts the rest.
const NAMED: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Transport {
    Command,
    Url,
}

impl Transport {
    fn of(server: &McpServer) -> Self {
        match server {
            McpServer::Stdio { .. } => Self::Command,
            McpServer::Http { .. } | McpServer::Sse { .. } => Self::Url,
        }
    }

    fn other(self) -> Self {
        match self {
            Self::Command => Self::Url,
            Self::Url => Self::Command,
        }
    }

    fn noun(self) -> &'static str {
        match self {
            Self::Command => "a command",
            Self::Url => "a URL",
        }
    }

    /// The keys that make a server of this transport invalid, once merged into it. Codex checks
    /// them when it reads the merged table, whatever `enabled` says. Not `bearer_token`: Codex
    /// refuses an inline one in either transport on its own, so no merge brings it about.
    fn refuses(self) -> &'static [&'static str] {
        match self {
            Self::Command => &[
                "url",
                "bearer_token_env_var",
                "http_headers_helper",
                "http_headers",
                "env_http_headers",
                "oauth",
                "oauth_resource",
                "auth",
            ],
            Self::Url => &["command", "args", "env", "env_vars", "cwd"],
        }
    }
}

/// The save's warning: per profile and per agent that merges same-name servers, the servers it
/// hands that agent whose transport differs from a same-name server in the agent's user file
/// (in the profile's folder for that agent, else the agent's default). `None` when there are
/// none.
pub fn save_warning(config: &ConfigState, home: &Path) -> Option<String> {
    let mut sentences = Vec::new();
    // One read of each agent file, however many profiles share it.
    let mut tables: HashMap<PathBuf, Option<toml::Table>> = HashMap::new();
    for (command, _, files) in merging_agents(config) {
        for profile in &config.profiles {
            let handed = handed(config, &profile.id, command);
            if handed.is_empty() {
                continue;
            }
            let Some(folder) = profile
                .tool(command)
                .and_then(|tool| config::tool_dir(&tool.path, home))
                .or_else(|| config::tool_dir(&files.default_dir, home))
            else {
                continue;
            };
            let file = folder.join(&files.user_file);
            let table = tables
                .entry(file.clone())
                .or_insert_with(|| read_table(&file));
            let found = mismatches(&handed, table.as_ref());
            if found.is_empty() {
                continue;
            }
            let clause = |(server, ours): &(String, Transport)| {
                format!(
                    "{server} is {} in the profile and {} in {}",
                    ours.noun(),
                    ours.other().noun(),
                    shown(&file, home)
                )
            };
            let mut clauses: Vec<_> = found.iter().take(NAMED).map(clause).collect();
            if found.len() > NAMED {
                clauses.push(format!("and {} more", found.len() - NAMED));
            }
            sentences.push(format!(
                "{command} won't start in {}'s folders: {}. {command} merges servers with one name, so rename one of them.",
                profile.name,
                clauses.join(", ")
            ));
        }
    }
    (!sentences.is_empty()).then(|| sentences.join(" "))
}

/// For a routed check of `tool` in `folder`, owned by `profile_id`: [`save_warning`]'s test against
/// `agent_home` (the folder the shim set for the agent, else its default), plus the project files
/// the agent would load in `folder`. `added` is what the shim adds to the run (the check's own
/// `mcp`): a server it leaves off (`ENVROUTER_MCP=0`, a manifest without it) can't clash.
pub fn in_folder(
    config: &ConfigState,
    home: &Path,
    folder: &Path,
    tool: &str,
    profile_id: &str,
    agent_home: Option<&str>,
    added: &[String],
) -> Vec<McpClash> {
    let Some((command, dialect, files)) =
        merging_agents(config).find(|(command, _, _)| *command == tool)
    else {
        return Vec::new();
    };
    let Some(agent_home) = agent_home
        .and_then(|raw| config::tool_dir(raw, home))
        .or_else(|| config::tool_dir(&files.default_dir, home))
    else {
        return Vec::new();
    };
    let mut handed = handed(config, profile_id, command);
    handed.retain(|(name, _)| added.iter().any(|added| added == name));
    if handed.is_empty() {
        return Vec::new();
    }
    let user_file = agent_home.join(&files.user_file);
    let user = read_table(&user_file);
    let project = project_files(dialect, folder, user.as_ref(), &agent_home, files);
    let mut clashes = Vec::new();
    let mut add = |file: &Path, table: Option<&toml::Table>| {
        for (server, _) in mismatches(&handed, table) {
            clashes.push(McpClash {
                server,
                file: file.display().to_string(),
                openable: commands::openable_file(home, file).is_ok(),
            });
        }
    };
    add(&user_file, user.as_ref());
    for file in project {
        add(&file, read_table(&file).as_ref());
    }
    clashes
}

/// The agents that merge same-name servers: the command each runs as, its dialect and where it
/// keeps its files.
fn merging_agents(config: &ConfigState) -> impl Iterator<Item = (&str, McpDialect, &McpFiles)> {
    config.agents.iter().filter_map(|(command, agent)| {
        let dialect = agent.mcp.as_ref()?.dialect;
        let files = agent.mcp_files.as_ref()?;
        dialect
            .merges_same_name()
            .then_some((command.as_str(), dialect, files))
    })
}

/// The servers `profile_id` hands `command`, with the transport each is rendered as.
fn handed<'a>(
    config: &'a ConfigState,
    profile_id: &str,
    command: &str,
) -> Vec<(&'a str, Transport)> {
    let Some(profile) = config.profiles.iter().find(|p| p.id == profile_id) else {
        return Vec::new();
    };
    mcp::servers_for(config, profile, command)
        .into_iter()
        .filter_map(|name| config.mcp_servers.get_key_value(&name))
        .map(|(name, server)| (name.as_str(), Transport::of(server)))
        .collect()
}

/// The handed servers whose same-name table in `file` has keys of the other transport.
fn mismatches(
    handed: &[(&str, Transport)],
    file: Option<&toml::Table>,
) -> Vec<(String, Transport)> {
    let Some(servers) = file
        .and_then(|file| file.get("mcp_servers"))
        .and_then(toml::Value::as_table)
    else {
        return Vec::new();
    };
    handed
        .iter()
        .filter(|(name, ours)| {
            servers
                .get(*name)
                .and_then(toml::Value::as_table)
                .is_some_and(|theirs| {
                    theirs
                        .keys()
                        .any(|key| ours.refuses().contains(&key.as_str()))
                })
        })
        .map(|(name, ours)| ((*name).to_string(), *ours))
        .collect()
}

/// A file that's missing, unreadable or not TOML has no servers.
fn read_table(path: &Path) -> Option<toml::Table> {
    fs::read_to_string(path).ok()?.parse().ok()
}

/// The project files `dialect`'s agent loads when run in `folder`, lowest precedence first.
fn project_files(
    dialect: McpDialect,
    folder: &Path,
    user: Option<&toml::Table>,
    agent_home: &Path,
    files: &McpFiles,
) -> Vec<PathBuf> {
    // Without a readable user file there is no trust to find.
    let Some(user) = user else {
        return Vec::new();
    };
    match dialect {
        McpDialect::Codex => codex_project_files(folder, user, agent_home, files),
        McpDialect::Claude | McpDialect::Copilot => Vec::new(),
    }
}

/// Codex loads `<dir>/.codex/config.toml` for every folder from the project root down to the
/// working folder, skipping a `.codex` that is its own home, and only where the folder's own
/// `[projects]` entry, else the root's, says `trusted`. The files that exist, root first.
fn codex_project_files(
    folder: &Path,
    user: &toml::Table,
    agent_home: &Path,
    files: &McpFiles,
) -> Vec<PathBuf> {
    // Codex works from the physical working folder, so its keys are canonical paths.
    let folder = fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    let agent_home = fs::canonicalize(agent_home).unwrap_or_else(|_| agent_home.to_path_buf());
    let markers: Vec<&str> = match user
        .get("project_root_markers")
        .and_then(toml::Value::as_array)
    {
        Some(markers) => markers.iter().filter_map(toml::Value::as_str).collect(),
        None => vec![".git"],
    };
    let root = folder
        .ancestors()
        .find(|dir| markers.iter().any(|marker| is_marker(dir, marker)))
        .unwrap_or(&folder);
    let projects = user.get("projects").and_then(toml::Value::as_table);
    let trust = |dir: &Path| {
        [dir, root]
            .into_iter()
            .find_map(|key| projects?.get(key.to_str()?)?.get("trust_level")?.as_str())
            == Some("trusted")
    };
    let mut dirs: Vec<&Path> = folder.ancestors().take_while(|dir| *dir != root).collect();
    dirs.push(root);
    dirs.reverse();
    dirs.into_iter()
        .filter(|dir| trust(dir))
        .flat_map(|dir| files.project_files.iter().map(move |file| dir.join(file)))
        .filter(|file| file.is_file())
        .filter(|file| {
            let own_folder = file
                .parent()
                .and_then(|parent| fs::canonicalize(parent).ok());
            own_folder.as_deref() != Some(agent_home.as_path())
        })
        .collect()
}

/// Whether `dir` holds the project-root marker: a `.git` folder only with a `HEAD` in it, a
/// `.git` file or any other marker as it is.
fn is_marker(dir: &Path, marker: &str) -> bool {
    let path = dir.join(marker);
    match fs::metadata(&path) {
        Ok(meta) if marker == ".git" && meta.is_dir() => path.join("HEAD").exists(),
        Ok(_) => true,
        Err(_) => false,
    }
}

/// `~/…` for a path in the home folder.
fn shown(path: &Path, home: &Path) -> String {
    path.strip_prefix(home).map_or_else(
        |_| path.display().to_string(),
        |rest| format!("~/{}", rest.display()),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use envrouter_core::agents;
    use envrouter_core::config::{McpUse, Profile};

    use super::*;

    fn breaks(ours: Transport, theirs: &str) -> bool {
        let file = format!("[mcp_servers.x]\n{theirs}");
        !mismatches(&[("x", ours)], Some(&file.parse().unwrap())).is_empty()
    }

    /// Codex merges a same-name server key by key and then checks the transport: a key of the
    /// other one fails it whichever side brought it, and a key both accept doesn't.
    #[test]
    fn a_different_transport_breaks_codexs_merge_either_way() {
        use Transport::{Command, Url};
        assert!(breaks(Command, "url = \"https://x/mcp\""));
        assert!(breaks(Url, "command = \"npx\""));
        assert!(breaks(Command, "http_headers = { A = \"b\" }"));
        assert!(breaks(Url, "args = [\"-y\"]"));
        // Codex refuses an inline bearer_token on its own, in either transport: no merge clash.
        assert!(!breaks(Url, "bearer_token = \"t\""));
        assert!(!breaks(Command, "bearer_token = \"t\""));
        assert!(!breaks(
            Command,
            "command = \"npx\"\nenv = { A = \"b\" }\nenabled_tools = [\"t\"]"
        ));
        assert!(!breaks(
            Url,
            "url = \"https://x/mcp\"\noauth = { client_id = \"c\" }"
        ));
    }

    /// Only a server the shim adds to the run can clash; one it leaves off (`ENVROUTER_MCP=0`,
    /// a manifest without it) starts fine. And only a file inside home is offered to open.
    #[test]
    fn only_servers_the_shim_adds_clash_and_only_home_files_are_openable() {
        let dir = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(dir.path()).unwrap().join("home");
        let elsewhere = fs::canonicalize(dir.path()).unwrap().join("volume");
        for folder in [&home, &elsewhere] {
            fs::create_dir_all(folder.join(".codex")).unwrap();
            fs::write(
                folder.join(".codex/config.toml"),
                "[mcp_servers.x]\nurl = \"https://x/mcp\"\n",
            )
            .unwrap();
        }
        let mut config = agents::with_agents(ConfigState::default());
        config.mcp_servers.insert(
            "x".into(),
            McpServer::Stdio {
                command: "npx".into(),
                args: Vec::new(),
                env: BTreeMap::new(),
            },
        );
        config.profiles.push(Profile {
            id: "p".into(),
            mcp_servers: BTreeMap::from([("x".into(), McpUse::default())]),
            ..Profile::default()
        });
        let check = |agent_home: &Path, added: &[&str]| {
            let added: Vec<String> = added.iter().map(ToString::to_string).collect();
            let agent_home = agent_home.join(".codex").display().to_string();
            in_folder(
                &config,
                &home,
                &home,
                "codex",
                "p",
                Some(&agent_home),
                &added,
            )
        };

        let clash = |agent_home: &Path, openable| McpClash {
            server: "x".into(),
            file: agent_home.join(".codex/config.toml").display().to_string(),
            openable,
        };
        assert_eq!(check(&home, &["x"]), [clash(&home, true)]);
        assert_eq!(check(&elsewhere, &["x"]), [clash(&elsewhere, false)]);
        assert_eq!(check(&home, &[]), []);
    }

    /// Codex loads a project's `.codex/config.toml` from the project root down to the working
    /// folder, and only where the folder's own `[projects]` entry, else the root's, trusts it.
    #[test]
    fn project_files_follow_codexs_root_and_trust() {
        let dir = tempfile::tempdir().unwrap();
        let repo = fs::canonicalize(dir.path()).unwrap().join("repo");
        let work = repo.join("a/b");
        for folder in [&repo, &repo.join("a")] {
            fs::create_dir_all(folder.join(".codex")).unwrap();
            fs::write(folder.join(".codex/config.toml"), "").unwrap();
        }
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join(".git/HEAD"), "").unwrap();
        fs::create_dir_all(&work).unwrap();
        let files = McpFiles {
            user_file: "config.toml".into(),
            default_dir: "~/.codex".into(),
            project_files: vec![".codex/config.toml".into()],
        };
        let found = |user: &str, agent_home: &Path| {
            codex_project_files(&work, &user.parse().unwrap(), agent_home, &files)
        };
        let trust = |folder: &Path, level: &str| {
            format!(
                "[projects.\"{}\"]\ntrust_level = \"{level}\"\n",
                folder.display()
            )
        };
        let root_file = repo.join(".codex/config.toml");
        let a_file = repo.join("a/.codex/config.toml");
        let nowhere = dir.path().join("elsewhere");

        let trusted = trust(&repo, "trusted");
        assert_eq!(found(&trusted, &nowhere), [root_file.clone(), a_file]);
        let a_untrusted = trusted.clone() + &trust(&repo.join("a"), "untrusted");
        assert_eq!(found(&a_untrusted, &nowhere), [root_file]);
        assert_eq!(
            found(&trust(&repo, "untrusted"), &nowhere),
            [] as [PathBuf; 0]
        );
        assert_eq!(found("", &nowhere), [] as [PathBuf; 0]);
        // A `.codex` that is the agent's own home is its user file, not a project's.
        assert_eq!(found(&trusted, &repo.join(".codex")).len(), 1);
        // A `.git` folder without a `HEAD` is no repository: the folder itself is the root.
        fs::remove_file(repo.join(".git/HEAD")).unwrap();
        fs::create_dir_all(work.join(".codex")).unwrap();
        fs::write(work.join(".codex/config.toml"), "").unwrap();
        assert_eq!(
            found(&trust(&work, "trusted"), &nowhere),
            [work.join(".codex/config.toml")]
        );
    }
}
