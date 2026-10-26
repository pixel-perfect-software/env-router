//! Finds MCP servers the user's agents already define, so the library can import them. It reads
//! each agent's own files where its descriptor says they are (its config folder, by default and
//! as each profile sets it, and the project files in each trigger folder), and never writes them.
//! It also reads servers from JSON pasted into the window, such as a README's snippet.

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
        for raw in config.profiles.iter().flat_map(|p| &p.trigger_paths) {
            if let Ok(dir) = config::trigger_base(raw, home) {
                sources.extend(files.project_files.iter().map(|file| dir.join(file)));
            }
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
                        existing.sources.push(source);
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

/// What pasted text holds: each server it defines, and the names of entries EnvRouter can't use.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pasted {
    pub servers: Vec<PastedServer>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastedServer {
    /// None for a lone entry, which the text doesn't name.
    pub name: Option<String>,
    pub server: McpServer,
}

/// Reads servers from pasted text, as READMEs and agents write them: an `mcpServers` table,
/// VS Code's `servers` (or `mcp.servers` in its settings), a bare table of named servers, or a
/// lone server. Comments and trailing commas are fine, and so is a table entry copied without
/// its outer braces (`"github": { ... }`). The error is worded to show as is.
pub fn parse_pasted(text: &str) -> std::result::Result<Pasted, String> {
    if text.trim().is_empty() {
        return Err("Paste a server's JSON first.".into());
    }
    let parse = |text: &str| {
        jsonc_parser::parse_to_serde_value::<Value>(text, &jsonc_parser::ParseOptions::default())
    };
    let json = match parse(text) {
        Ok(json) => json,
        // The brace goes on its own line, so a trailing `//` comment can't swallow it.
        Err(err) => parse(&format!("{{{text}\n}}"))
            .map_err(|_| format!("That isn't JSON EnvRouter can read: {err}."))?,
    };
    if is_entry(&json) {
        let server = parse_entry(&json)
            .ok_or("EnvRouter can't use this server's transport, values or sign-in.")?;
        return Ok(Pasted {
            servers: vec![PastedServer { name: None, server }],
            skipped: Vec::new(),
        });
    }
    let table = [&json["mcpServers"], &json["servers"], &json["mcp"]["servers"]]
        .into_iter()
        .find_map(Value::as_object)
        .or_else(|| {
            json.as_object()
                .filter(|map| is_bare_table(map))
        })
        .ok_or("There are no MCP servers in it. Paste the part with mcpServers, or one server with its command or url.")?;
    let mut pasted = Pasted {
        servers: Vec::new(),
        skipped: Vec::new(),
    };
    for (name, entry) in table {
        match parse_entry(entry) {
            Some(server) => pasted.servers.push(PastedServer {
                name: Some(name.clone()),
                server,
            }),
            None => pasted.skipped.push(name.clone()),
        }
    }
    if pasted.servers.is_empty() && pasted.skipped.is_empty() {
        return Err("There are no MCP servers in it.".into());
    }
    if pasted.servers.is_empty() {
        return Err(format!(
            "EnvRouter can't use {}: their transports, values or sign-in aren't ones it supports.",
            pasted.skipped.join(", ")
        ));
    }
    Ok(pasted)
}

fn is_entry(value: &Value) -> bool {
    value.get("command").is_some() || value.get("url").is_some()
}

/// Named servers with no `mcpServers` around them, as Copilot reads `.mcp.json`. Every value
/// must be a server, so `.claude.json` or a `package.json` is never mistaken for one.
fn is_bare_table(map: &serde_json::Map<String, Value>) -> bool {
    !map.is_empty() && map.values().all(is_entry)
}

/// The servers in one file: its top-level `mcpServers` (or, for Copilot and with no such key, a
/// bare table of named servers; Claude reads only the wrapped form), plus, in Claude's
/// `.claude.json`, each project's. Read as JSONC, as Paste is: hand-written project files carry
/// comments. A file that's missing or unreadable has none.
fn read_servers(path: &Path, dialect: McpDialect) -> Vec<(String, McpServer)> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(json) =
        jsonc_parser::parse_to_serde_value::<Value>(&text, &jsonc_parser::ParseOptions::default())
    else {
        return Vec::new();
    };
    let bare = dialect == McpDialect::Copilot
        && json
            .as_object()
            .is_some_and(|map| !map.contains_key("mcpServers") && is_bare_table(map));
    let mut tables = vec![if bare { &json } else { &json["mcpServers"] }];
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
    // READMEs write `"--port", 3000` and `"DEBUG": true`; agents pass them on as text.
    let text = |value: &Value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    };
    let strings = |value: &Value| -> Option<BTreeMap<String, McpValue>> {
        match value {
            Value::Null => Some(BTreeMap::new()),
            Value::Object(map) => map
                .iter()
                .map(|(k, v)| Some((k.clone(), McpValue::Plain(text(v)?))))
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
                .map(|a| Some(McpValue::Plain(text(a)?)))
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
    // A pre-registered OAuth client (Claude's `oauth`, Copilot's `oauthClientId` and the like) or
    // a headers helper is how the server signs in; without it the import couldn't connect.
    let signs_in_itself = entry.as_object()?.iter().any(|(key, value)| {
        (key.starts_with("oauth") || key == "headersHelper") && !value.is_null()
    });
    if signs_in_itself {
        return None;
    }
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

    fn named(pasted: &Pasted) -> Vec<Option<&str>> {
        pasted.servers.iter().map(|s| s.name.as_deref()).collect()
    }

    #[test]
    fn reads_pasted_tables_in_every_shape_readmes_use() {
        let shapes = [
            r#"{ "mcpServers": { "gh": { "command": "npx", "args": ["-y", "gh"] } } }"#,
            // VS Code's mcp.json, with a comment and a trailing comma.
            r#"{ "servers": { "gh": { "type": "stdio", "command": "npx", "args": ["-y", "gh"], }, } // vs code
            }"#,
            r#"{ "mcp": { "servers": { "gh": { "command": "npx", "args": ["-y", "gh"] } } } }"#,
            r#"{ "gh": { "command": "npx", "args": ["-y", "gh"] } }"#,
            // An entry copied without the table's braces.
            r#""gh": { "command": "npx", "args": ["-y", "gh"] },"#,
            r#""gh": { "command": "npx", "args": ["-y", "gh"] }, // from the README"#,
        ];
        for text in shapes {
            let pasted = parse_pasted(text).unwrap_or_else(|err| panic!("{text}: {err}"));
            assert_eq!(named(&pasted), [Some("gh")], "{text}");
        }
    }

    #[test]
    fn reads_a_lone_server_unnamed_and_names_what_it_skips() {
        let lone =
            parse_pasted(r#"{ "type": "http", "url": "https://mcp.linear.app/mcp" }"#).unwrap();
        assert_eq!(named(&lone), [None]);
        let mixed = parse_pasted(
            r#"{ "mcpServers": { "lin": { "url": "https://l/mcp" }, "odd": { "type": "ws", "url": "ws://x" } } }"#,
        )
        .unwrap();
        assert_eq!(named(&mixed), [Some("lin")]);
        assert_eq!(mixed.skipped, ["odd"]);
    }

    #[test]
    fn skips_a_server_that_signs_in_with_its_own_client_or_helper() {
        // Imported without these, the server would sign in with the wrong client or none at all.
        let pasted = parse_pasted(
            r#"{ "mcpServers": {
                "asana": { "type": "http", "url": "https://mcp.asana.com/v2/mcp",
                           "oauth": { "clientId": "abc", "callbackPort": 8080 } },
                "copilot": { "type": "http", "url": "https://c/mcp", "oauthClientId": "abc" },
                "helped": { "type": "http", "url": "https://h/mcp", "headersHelper": "/bin/token" },
                "plain": { "type": "http", "url": "https://p/mcp", "oauth": null }
            } }"#,
        )
        .unwrap();
        assert_eq!(named(&pasted), [Some("plain")]);
        assert_eq!(pasted.skipped, ["asana", "copilot", "helped"]);
    }

    #[test]
    fn takes_numbers_and_flags_as_text() {
        let pasted = parse_pasted(
            r#"{ "command": "srv", "args": ["--port", 3000], "env": { "DEBUG": true } }"#,
        )
        .unwrap();
        let McpServer::Stdio { args, env, .. } = &pasted.servers[0].server else {
            panic!("{pasted:?}");
        };
        assert_eq!(args[1], McpValue::Plain("3000".into()));
        assert_eq!(env["DEBUG"], McpValue::Plain("true".into()));
    }

    #[test]
    fn explains_text_it_cant_use() {
        for (text, says) in [
            ("  ", "Paste"),
            ("{ nope", "isn't JSON"),
            (r#"{ "name": "x" }"#, "no MCP servers"),
            (r#"{ "mcpServers": {} }"#, "no MCP servers"),
            (
                r#"{ "mcpServers": { "odd": { "type": "ws", "url": "ws://x" } } }"#,
                "can't use odd",
            ),
        ] {
            let err = parse_pasted(text).unwrap_err();
            assert!(err.contains(says), "{text}: {err}");
        }
    }
    use envrouter_core::config::{AgentDef, McpFiles, McpInjection, Profile, ToolConfig};

    fn claude() -> AgentDef {
        AgentDef {
            mcp: Some(McpInjection {
                dialect: McpDialect::Claude,
                config_arg: "--mcp-config=".into(),
                deny_arg: None,
                skip_any_args: Vec::new(),
                skip_subcommands: Vec::new(),
                skip_if_present: Vec::new(),
            }),
            mcp_files: Some(McpFiles {
                user_file: ".claude.json".into(),
                default_dir: "~".into(),
                project_files: vec![".mcp.json".into()],
            }),
            ide: None,
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
    fn reads_every_project_file_with_or_without_the_wrapper() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        fs::create_dir_all(home.join("dev/app/.github")).unwrap();
        fs::create_dir_all(home.join("dev/other")).unwrap();
        fs::write(
            home.join("dev/app/.mcp.json"),
            // A server named like an entry's field is still inside the wrapper.
            r#"{ "mcpServers": { "url": { "command": "npx" } } }"#,
        )
        .unwrap();
        fs::write(
            home.join("dev/app/.github/mcp.json"),
            "{\n  // Hand-written, so commented.\n  \"bare\": { \"type\": \"http\", \"url\": \"https://b/mcp\" },\n}",
        )
        .unwrap();
        // Not a table of servers: one value isn't one.
        fs::write(
            home.join("dev/other/.mcp.json"),
            r#"{ "numStartups": 3, "lookalike": { "command": "npx" } }"#,
        )
        .unwrap();
        let mut copilot = claude();
        copilot.mcp.as_mut().unwrap().dialect = McpDialect::Copilot;
        copilot.mcp_files.as_mut().unwrap().project_files =
            vec![".mcp.json".into(), ".github/mcp.json".into()];
        let config = ConfigState {
            profiles: vec![Profile {
                id: "w".into(),
                name: "Work".into(),
                trigger_paths: vec!["~/dev/app".into(), "~/dev/other".into()],
                ..Default::default()
            }],
            agents: BTreeMap::from([("copilot".into(), copilot)]),
            ..Default::default()
        };
        let names = |config: &ConfigState| -> Vec<String> {
            candidates(config, home)
                .into_iter()
                .map(|c| c.name)
                .collect()
        };
        assert_eq!(names(&config), ["bare", "url"]);

        // Claude reads only the wrapped form.
        let mut claude_reads = config.clone();
        let agent = claude_reads.agents.remove("copilot").unwrap();
        claude_reads.agents.insert(
            "claude".into(),
            AgentDef {
                mcp: Some(McpInjection {
                    dialect: McpDialect::Claude,
                    ..agent.mcp.clone().unwrap()
                }),
                ..agent
            },
        );
        assert_eq!(names(&claude_reads), ["url"]);
    }

    #[test]
    fn reads_copilot_local_servers_and_skips_entries_it_cannot_represent() {
        let entry: Value =
            serde_json::from_str(r#"{ "type": "local", "command": "npx", "tools": ["*"] }"#)
                .unwrap();
        assert!(matches!(parse_entry(&entry), Some(McpServer::Stdio { .. })));
        let bad: Value =
            serde_json::from_str(r#"{ "command": "npx", "env": { "N": { "nested": 1 } } }"#)
                .unwrap();
        assert_eq!(parse_entry(&bad), None);
    }
}
