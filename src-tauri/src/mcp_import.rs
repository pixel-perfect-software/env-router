//! Finds MCP servers the user's agents already define, so the library can import them. It reads
//! each agent's own files where its descriptor says they are (its config folder, by default and
//! as each profile sets it, and the project file in each trigger folder), and never writes them.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState, McpDialect, McpServer, McpValue};
use serde::Serialize;
use serde_json::Value;

/// A server found in one or more files, with the same name and definition in each.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub name: String,
    pub server: McpServer,
    /// The files that define it.
    pub sources: Vec<String>,
}

pub fn candidates(config: &ConfigState, home: &Path) -> Vec<ImportCandidate> {
    let mut found: Vec<ImportCandidate> = Vec::new();
    for (command, agent) in &config.agents {
        let (Some(files), Some(mcp)) = (&agent.mcp_files, &agent.mcp) else {
            continue;
        };
        let mut user_dirs: Vec<PathBuf> = config::tool_dir(&files.default_dir, home)
            .into_iter()
            .collect();
        user_dirs.extend(
            config
                .profiles
                .iter()
                .filter_map(|p| p.tool(command))
                .filter_map(|tool| config::tool_dir(&tool.path, home)),
        );
        let mut sources: Vec<PathBuf> = user_dirs
            .iter()
            .map(|dir| dir.join(&files.user_file))
            .collect();
        if let Some(project_file) = &files.project_file {
            sources.extend(
                config
                    .profiles
                    .iter()
                    .flat_map(|p| &p.trigger_paths)
                    .filter_map(|raw| config::trigger_base(raw, home).ok())
                    .map(|dir| dir.join(project_file)),
            );
        }
        sources.sort();
        sources.dedup();
        for path in sources {
            for (name, server) in read_servers(&path, mcp.dialect) {
                let source = path.display().to_string();
                match found
                    .iter_mut()
                    .find(|c| c.name == name && c.server == server)
                {
                    Some(existing) if !existing.sources.contains(&source) => {
                        existing.sources.push(source)
                    }
                    Some(_) => {}
                    None => found.push(ImportCandidate {
                        name,
                        server,
                        sources: vec![source],
                    }),
                }
            }
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name).then(a.sources.cmp(&b.sources)));
    found
}

/// The servers in one file: its top-level `mcpServers`, plus, in Claude's `.claude.json`, each
/// project's. A file that's missing or unreadable has none.
fn read_servers(path: &Path, dialect: McpDialect) -> Vec<(String, McpServer)> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    let mut tables = vec![&json["mcpServers"]];
    if dialect == McpDialect::Claude {
        if let Some(projects) = json["projects"].as_object() {
            tables.extend(projects.values().map(|project| &project["mcpServers"]));
        }
    }
    tables
        .into_iter()
        .filter_map(Value::as_object)
        .flat_map(|table| table.iter())
        .filter_map(|(name, entry)| Some((name.clone(), parse_entry(entry)?)))
        .collect()
}

/// One `mcpServers` entry in the shape Claude and Copilot share. Anything EnvRouter can't
/// represent is skipped rather than imported half right.
fn parse_entry(entry: &Value) -> Option<McpServer> {
    let strings = |value: &Value| -> Option<BTreeMap<String, McpValue>> {
        match value {
            Value::Null => Some(BTreeMap::new()),
            Value::Object(map) => map
                .iter()
                .map(|(k, v)| Some((k.clone(), McpValue::Plain(v.as_str()?.to_string()))))
                .collect(),
            _ => None,
        }
    };
    let kind = entry["type"].as_str();
    if let Some(command) = entry["command"].as_str() {
        if !matches!(kind, None | Some("stdio" | "local")) {
            return None;
        }
        let args = match &entry["args"] {
            Value::Null => Vec::new(),
            Value::Array(args) => args
                .iter()
                .map(|a| Some(McpValue::Plain(a.as_str()?.to_string())))
                .collect::<Option<_>>()?,
            _ => return None,
        };
        return Some(McpServer::Stdio {
            command: command.to_string(),
            args,
            env: strings(&entry["env"])?,
        });
    }
    let url = entry["url"].as_str()?.to_string();
    let headers = strings(&entry["headers"])?;
    match kind {
        Some("http" | "streamable-http") | None => Some(McpServer::Http { url, headers }),
        Some("sse") => Some(McpServer::Sse { url, headers }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use envrouter_core::config::{AgentDef, McpFiles, McpInjection, Profile, ToolConfig};

    fn claude() -> AgentDef {
        AgentDef {
            mcp: Some(McpInjection {
                dialect: McpDialect::Claude,
                config_arg: "--mcp-config=".into(),
                deny_arg: None,
                skip_any_args: Vec::new(),
            }),
            mcp_files: Some(McpFiles {
                user_file: ".claude.json".into(),
                default_dir: "~".into(),
                project_file: Some(".mcp.json".into()),
            }),
        }
    }

    #[test]
    fn finds_user_project_and_profile_servers_and_merges_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        fs::create_dir_all(home.join(".claude-work")).unwrap();
        fs::create_dir_all(home.join("dev/app")).unwrap();
        let gh = r#"{ "command": "npx", "args": ["-y", "gh"], "env": { "TOKEN": "x" } }"#;
        fs::write(
            home.join(".claude.json"),
            format!(
                r#"{{ "mcpServers": {{ "gh": {gh}, "odd": {{ "type": "ws", "url": "ws://x" }} }},
                     "projects": {{ "/p": {{ "mcpServers": {{ "lin": {{ "type": "http", "url": "https://l/mcp" }} }} }} }} }}"#
            ),
        )
        .unwrap();
        fs::write(
            home.join(".claude-work/.claude.json"),
            format!(r#"{{ "mcpServers": {{ "gh": {gh} }} }}"#),
        )
        .unwrap();
        fs::write(
            home.join("dev/app/.mcp.json"),
            r#"{ "mcpServers": { "gh": { "command": "uvx", "args": ["gh"] }, "s": { "type": "sse", "url": "https://s/sse" } } }"#,
        )
        .unwrap();
        let config = ConfigState {
            profiles: vec![Profile {
                id: "w".into(),
                name: "Work".into(),
                trigger_paths: vec!["~/dev/app".into()],
                tools: BTreeMap::from([(
                    "claude".into(),
                    ToolConfig {
                        env_var: "CLAUDE_CONFIG_DIR".into(),
                        path: "~/.claude-work".into(),
                    },
                )]),
                ..Default::default()
            }],
            agents: BTreeMap::from([
                ("claude".into(), claude()),
                ("other".into(), AgentDef::default()),
            ]),
            ..Default::default()
        };
        let found = candidates(&config, home);
        let summary: Vec<(&str, usize)> = found
            .iter()
            .map(|c| (c.name.as_str(), c.sources.len()))
            .collect();
        // Two different `gh`s; the same one in two files is one candidate. `odd` is a ws server.
        assert_eq!(summary, [("gh", 2), ("gh", 1), ("lin", 1), ("s", 1)]);
        assert_eq!(
            found[0].server,
            McpServer::Stdio {
                command: "npx".into(),
                args: vec![McpValue::Plain("-y".into()), McpValue::Plain("gh".into())],
                env: BTreeMap::from([("TOKEN".into(), McpValue::Plain("x".into()))]),
            }
        );
        assert!(matches!(found[3].server, McpServer::Sse { .. }));
    }

    #[test]
    fn reads_copilot_local_servers_and_skips_entries_it_cannot_represent() {
        let entry: Value =
            serde_json::from_str(r#"{ "type": "local", "command": "npx", "tools": ["*"] }"#)
                .unwrap();
        assert!(matches!(parse_entry(&entry), Some(McpServer::Stdio { .. })));
        let bad: Value =
            serde_json::from_str(r#"{ "command": "npx", "env": { "N": 1 } }"#).unwrap();
        assert_eq!(parse_entry(&bad), None);
    }
}
