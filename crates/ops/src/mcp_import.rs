//! Finds MCP servers the user's agents already define, so the library can import them. It reads
//! each agent's own files where its descriptor says they are (its config folder, by default and
//! as each profile sets it, and the project files in each trigger folder), and never writes them.
//! Claude and Copilot keep theirs in JSON and Codex in TOML (`mcp_servers`), which is why `toml` is
//! a dependency here and nowhere near the shim. It also reads servers from JSON or TOML pasted into
//! the window, such as a README's snippet.

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
/// its outer braces (`"github": { ... }`). Text that isn't JSON is read as Codex's TOML: an
/// `[mcp_servers.<name>]` block, a bare `[<name>]` one, or a lone server's fields. The error is
/// worded to show as is.
pub fn parse_pasted(text: &str) -> std::result::Result<Pasted, String> {
    if text.trim().is_empty() {
        return Err("Paste a server's JSON first.".into());
    }
    let parse = |text: &str| {
        jsonc_parser::parse_to_serde_value::<Value>(text, &jsonc_parser::ParseOptions::default())
    };
    // The brace goes on its own line, so a trailing `//` comment can't swallow it.
    let json = parse(text).or_else(|err| parse(&format!("{{{text}\n}}")).map_err(|_| err));
    match json {
        Ok(json) => pasted_json(&json),
        Err(json_err) => match text.parse::<toml::Table>() {
            Ok(table) => pasted_toml(&table),
            // Say what's wrong with the format it looks like it was meant to be.
            Err(toml_err) => Err(format!(
                "That isn't JSON or TOML EnvRouter can read: {}.",
                if looks_like_toml(text) {
                    let line = toml_err
                        .span()
                        .map_or(1, |span| text[..span.start].matches('\n').count() + 1);
                    format!("{} (line {line})", toml_err.message())
                } else {
                    json_err.to_string()
                }
            )),
        },
    }
}

fn pasted_json(json: &Value) -> std::result::Result<Pasted, String> {
    if is_entry(json) {
        let server = parse_entry(json).ok_or(LONE_SERVER_UNUSABLE)?;
        return Ok(lone(server));
    }
    let table = [
        &json["mcpServers"],
        &json["servers"],
        &json["mcp"]["servers"],
    ]
    .into_iter()
    .find_map(Value::as_object)
    .or_else(|| json.as_object().filter(|map| is_bare_table(map)))
    .ok_or(NO_JSON_TABLE)?;
    pasted_of(
        table
            .iter()
            .map(|(name, entry)| (name.clone(), parse_entry(entry))),
    )
}

fn pasted_toml(table: &toml::Table) -> std::result::Result<Pasted, String> {
    let whole = toml::Value::Table(table.clone());
    if is_toml_entry(&whole) {
        return Ok(lone(codex_entry(&whole).ok_or(LONE_SERVER_UNUSABLE)?));
    }
    let servers = table
        .get("mcp_servers")
        .and_then(toml::Value::as_table)
        .or_else(|| Some(table).filter(|map| !map.is_empty() && map.values().all(is_toml_entry)))
        .ok_or(NO_TOML_TABLE)?;
    pasted_of(
        servers
            .iter()
            .map(|(name, entry)| (name.clone(), codex_entry(entry))),
    )
}

const LONE_SERVER_UNUSABLE: &str =
    "EnvRouter can't use this server's transport, values or sign-in.";
const NO_JSON_TABLE: &str = "There are no MCP servers in it. Paste the part with mcpServers, or one server with its command or url.";
const NO_TOML_TABLE: &str = "There are no MCP servers in it. Paste the [mcp_servers.<name>] part, or one server with its command or url.";

fn lone(server: McpServer) -> Pasted {
    Pasted {
        servers: vec![PastedServer { name: None, server }],
        skipped: Vec::new(),
    }
}

/// The servers a table's entries make, and the names of those EnvRouter can't use.
fn pasted_of(
    entries: impl Iterator<Item = (String, Option<McpServer>)>,
) -> std::result::Result<Pasted, String> {
    let mut pasted = Pasted {
        servers: Vec::new(),
        skipped: Vec::new(),
    };
    for (name, server) in entries {
        match server {
            Some(server) => pasted.servers.push(PastedServer {
                name: Some(name),
                server,
            }),
            None => pasted.skipped.push(name),
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

/// Whether text that isn't JSON reads as TOML: its first line is a `[table]` header or a
/// `key = value` with no `:` ahead of the `=` (a JSON member's colon comes first).
fn looks_like_toml(text: &str) -> bool {
    let Some(line) = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("//"))
    else {
        return false;
    };
    line.starts_with('[')
        || line
            .split_once('=')
            .is_some_and(|(key, _)| !key.contains([':', '{']))
}

fn is_entry(value: &Value) -> bool {
    value.get("command").is_some() || value.get("url").is_some()
}

/// Named servers with no `mcpServers` around them, as Copilot reads `.mcp.json`. Every value
/// must be a server, so `.claude.json` or a `package.json` is never mistaken for one.
fn is_bare_table(map: &serde_json::Map<String, Value>) -> bool {
    !map.is_empty() && map.values().all(is_entry)
}

/// The servers in one file, read in its agent's format: JSON for Claude and Copilot, TOML for
/// Codex. A file that's missing, unreadable or unparsable has none.
fn read_servers(path: &Path, dialect: McpDialect) -> Vec<(String, McpServer)> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match dialect {
        McpDialect::Claude | McpDialect::Copilot => json_servers(&text, dialect),
        McpDialect::Codex => toml_servers(&text),
    }
}

/// A JSON file's top-level `mcpServers` (or, for Copilot and with no such key, a bare table of
/// named servers; Claude reads only the wrapped form), plus, in Claude's `.claude.json`, each
/// project's. Read as JSONC, as Paste is: hand-written project files carry comments.
fn json_servers(text: &str, dialect: McpDialect) -> Vec<(String, McpServer)> {
    let Ok(json) =
        jsonc_parser::parse_to_serde_value::<Value>(text, &jsonc_parser::ParseOptions::default())
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

/// A Codex `config.toml`'s `[mcp_servers.<name>]` tables. Nothing else in the file is read, so
/// its model, trust list and profiles stay out of the way.
fn toml_servers(text: &str) -> Vec<(String, McpServer)> {
    let Ok(file) = text.parse::<toml::Table>() else {
        return Vec::new();
    };
    file.get("mcp_servers")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flatten()
        .filter_map(|(name, entry)| Some((name.clone(), codex_entry(entry)?)))
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

/// What makes a TOML table a server, as `is_entry` does for JSON.
fn is_toml_entry(value: &toml::Value) -> bool {
    value
        .as_table()
        .is_some_and(|table| table.contains_key("command") || table.contains_key("url"))
}

/// One `[mcp_servers.<name>]` table (checked against Codex 0.164.0's `RawMcpServerConfig`).
/// Variables Codex passes through by name, `env_vars`, `env_http_headers` and
/// `bearer_token_env_var`, become `${NAME}` references, which render back to those fields under
/// Codex. Like `parse_entry`, anything EnvRouter can't represent is skipped rather than imported
/// half right: how the server signs in, where it runs (`cwd`, a remote `environment_id` or
/// `env_vars` source), an inline `bearer_token`, `command` with `url`. Tool filters, timeouts
/// and the rest of Codex's own settings aren't carried.
fn codex_entry(entry: &toml::Value) -> Option<McpServer> {
    use toml::Value;
    const LEFT_OUT: [&str; 6] = [
        "oauth",
        "oauth_resource",
        "scopes",
        "http_headers_helper",
        "cwd",
        "bearer_token",
    ];
    let entry = entry.as_table()?;
    let is = |key: &str, expected: &str| {
        entry
            .get(key)
            .is_none_or(|value| value.as_str() == Some(expected))
    };
    if LEFT_OUT.iter().any(|key| entry.contains_key(*key))
        || !is("environment_id", "local")
        || !is("auth", "oauth")
        || (entry.contains_key("command") && entry.contains_key("url"))
        // Turned off in Codex: imported, it would start under every agent of a profile.
        || entry.get("enabled").and_then(Value::as_bool) == Some(false)
    {
        return None;
    }
    let text = |value: &Value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Integer(number) => Some(number.to_string()),
        Value::Float(number) => Some(number.to_string()),
        Value::Boolean(flag) => Some(flag.to_string()),
        _ => None,
    };
    let strings = |key: &str| -> Option<BTreeMap<String, McpValue>> {
        match entry.get(key) {
            None => Some(BTreeMap::new()),
            Some(Value::Table(map)) => map
                .iter()
                .map(|(k, v)| Some((k.clone(), McpValue::Plain(text(v)?))))
                .collect(),
            Some(_) => None,
        }
    };
    let reference = |name: &str| McpValue::Plain(format!("${{{name}}}"));
    if let Some(command) = entry.get("command") {
        let args = match entry.get("args") {
            None => Vec::new(),
            Some(Value::Array(args)) => args
                .iter()
                .map(|a| Some(McpValue::Plain(text(a)?)))
                .collect::<Option<_>>()?,
            Some(_) => return None,
        };
        let mut env = strings("env")?;
        let names = match entry.get("env_vars") {
            None => &[][..],
            Some(Value::Array(names)) => names,
            Some(_) => return None,
        };
        for item in names {
            let name = match item {
                Value::String(name) => name,
                // Codex passes a `remote` one from the remote environment, which isn't ours to name.
                Value::Table(table)
                    if table
                        .get("source")
                        .is_none_or(|s| s.as_str() == Some("local")) =>
                {
                    table.get("name")?.as_str()?
                }
                _ => return None,
            };
            // A value typed in `env` is the one Codex starts the server with.
            env.entry(name.to_string())
                .or_insert_with(|| reference(name));
        }
        return Some(McpServer::Stdio {
            command: command.as_str()?.to_string(),
            args,
            env,
        });
    }
    let url = entry.get("url")?.as_str()?.to_string();
    let mut headers = strings("http_headers")?;
    match entry.get("env_http_headers") {
        None => {}
        Some(Value::Table(map)) => {
            for (header, name) in map {
                let name = name.as_str()?;
                headers
                    .entry(header.clone())
                    .or_insert_with(|| reference(name));
            }
        }
        Some(_) => return None,
    }
    if let Some(name) = entry.get("bearer_token_env_var") {
        // A second Authorization header would be a different server than the one Codex runs.
        if headers
            .keys()
            .any(|h| h.eq_ignore_ascii_case("authorization"))
        {
            return None;
        }
        headers.insert(
            "Authorization".into(),
            McpValue::Plain(format!("Bearer ${{{}}}", name.as_str()?)),
        );
    }
    Some(McpServer::Http { url, headers })
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
            // Codex's TOML: its own table, a bare one, and a whole config.toml around them.
            "[mcp_servers.gh]\ncommand = \"npx\"\nargs = [\"-y\", \"gh\"]",
            "[gh]\ncommand = \"npx\"\nargs = [\"-y\", \"gh\"]",
            "model = \"gpt-5\"\n\n[mcp_servers.gh]\ncommand = \"npx\"\n\n[projects.\"/p\"]\ntrust_level = \"trusted\"",
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
        assert_eq!(named(&parse_pasted("command = \"npx\"").unwrap()), [None]);
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
            ("[mcp_servers.x]\ncommand = ", "isn't JSON or TOML"),
            // JSONC whose comment holds an `=` still gets JSON's own error.
            (
                "// set DEBUG=1 for logs\n{ \"mcpServers\": { \"x\": ",
                "unexpected end of input",
            ),
            (r#"{ "name": "x" }"#, "no MCP servers"),
            ("model = \"gpt-5\"", "no MCP servers"),
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
                options_before_subcommand: None,
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

    fn codex_config() -> ConfigState {
        ConfigState {
            profiles: vec![Profile {
                id: "w".into(),
                name: "Work".into(),
                trigger_paths: vec!["~/dev/app".into()],
                tools: BTreeMap::from([(
                    "codex".into(),
                    ToolConfig {
                        env_var: "CODEX_HOME".into(),
                        path: "~/.codex-work".into(),
                    },
                )]),
                ..Default::default()
            }],
            agents: BTreeMap::from([(
                "codex".into(),
                AgentDef {
                    mcp: Some(McpInjection {
                        dialect: McpDialect::Codex,
                        config_arg: "--config=".into(),
                        ..claude().mcp.unwrap()
                    }),
                    mcp_files: Some(McpFiles {
                        user_file: "config.toml".into(),
                        default_dir: "~/.codex".into(),
                        project_files: vec![".codex/config.toml".into()],
                    }),
                    ide: None,
                },
            )]),
            ..Default::default()
        }
    }

    #[test]
    fn reads_codex_servers_from_toml() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        for folder in [".codex", ".codex-work", "dev/app/.codex"] {
            fs::create_dir_all(home.join(folder)).unwrap();
        }
        fs::write(
            home.join(".codex/config.toml"),
            r#"model = "gpt-5"
            [projects."/p"]
            trust_level = "trusted"

            [mcp_servers."docs.search"]
            command = "npx"
            args = ["-y", "d", 3]
            env = { LOG = "debug" }
            env_vars = ["GITHUB_TOKEN", { name = "X" }, { name = "LOG" }]
            startup_timeout_sec = 20
            disabled_tools = ["w"]
            "#,
        )
        .unwrap();
        fs::write(
            home.join(".codex-work/config.toml"),
            r#"[mcp_servers.linear]
            url = "https://mcp.linear.app/mcp"
            http_headers = { X-Team = "eng" }
            env_http_headers = { X-Key = "LIN_KEY" }
            bearer_token_env_var = "LIN_TOKEN"
            "#,
        )
        .unwrap();
        fs::write(
            home.join("dev/app/.codex/config.toml"),
            "[mcp_servers.local]\ncommand = \"uvx\"\n",
        )
        .unwrap();

        let found = candidates(&codex_config(), home);
        let by_name = |name: &str| found.iter().find(|c| c.name == name).unwrap();
        let plain = |text: &str| McpValue::Plain(text.into());
        assert_eq!(
            by_name("docs.search").server,
            McpServer::Stdio {
                command: "npx".into(),
                args: vec![plain("-y"), plain("d"), plain("3")],
                env: BTreeMap::from([
                    // A value typed in `env` is not replaced by the reference beside it.
                    ("LOG".into(), plain("debug")),
                    ("GITHUB_TOKEN".into(), plain("${GITHUB_TOKEN}")),
                    ("X".into(), plain("${X}")),
                ]),
            }
        );
        assert_eq!(
            by_name("linear").server,
            McpServer::Http {
                url: "https://mcp.linear.app/mcp".into(),
                headers: BTreeMap::from([
                    ("X-Team".into(), plain("eng")),
                    ("X-Key".into(), plain("${LIN_KEY}")),
                    ("Authorization".into(), plain("Bearer ${LIN_TOKEN}")),
                ]),
            }
        );
        assert_eq!(
            by_name("local").sources,
            [home
                .join("dev/app/.codex/config.toml")
                .display()
                .to_string()]
        );
        assert_eq!(found.len(), 3);
    }

    #[test]
    fn leaves_out_codex_servers_it_cannot_represent() {
        let table = |text: &str| -> Option<McpServer> {
            let file: toml::Table = format!("[s]\n{text}").parse().unwrap();
            codex_entry(&file["s"])
        };
        assert!(table("command = \"npx\"").is_some());
        assert!(table("url = \"https://x/mcp\"\nauth = \"oauth\"").is_some());
        for (why, text) in [
            ("an OAuth client", "url = \"https://x\"\noauth = { client_id = \"a\" }"),
            ("an OAuth resource", "url = \"https://x\"\noauth_resource = \"r\""),
            ("scopes", "url = \"https://x\"\nscopes = [\"a\"]"),
            ("a headers helper", "url = \"https://x\"\nhttp_headers_helper = \"/bin/t\""),
            ("another sign-in", "url = \"https://x\"\nauth = \"chatgpt\""),
            ("turned off", "command = \"npx\"\nenabled = false"),
            ("a working folder", "command = \"npx\"\ncwd = \"/p\""),
            ("another environment", "command = \"npx\"\nenvironment_id = \"remote\""),
            ("a remote variable", "command = \"npx\"\nenv_vars = [{ name = \"X\", source = \"remote\" }]"),
            ("an inline token", "url = \"https://x\"\nbearer_token = \"abc\""),
            ("two transports", "command = \"npx\"\nurl = \"https://x\""),
            ("two Authorization headers", "url = \"https://x\"\nhttp_headers = { authorization = \"a\" }\nbearer_token_env_var = \"T\""),
        ] {
            assert!(table(text).is_none(), "{why}");
        }
    }
}
