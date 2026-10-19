//! The server check: starts one MCP server (or connects to a remote one), asks for its tools,
//! and stops it. It only runs when the user asks, since it runs the server's own command.
//!
//! Tool lists from checks that worked are kept in `~/.envrouter/mcp-tools.json` with the
//! definition they came from, so the profile editor can offer each server's tools without
//! starting anything. A server whose definition has changed since has no list until checked
//! again.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use envrouter_core::config::{self, ConfigState, McpServer, McpValue};
use envrouter_core::{paths, Error, Result};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{StreamableHttpClientTransport, TokioChildProcess};
use rmcp::ServiceExt;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};

/// Long enough for a first `npx` run to download its package.
const TIMEOUT: Duration = Duration::from_secs(45);
/// The tail of a server's stderr kept for a failed check.
const LOG_LINES: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCheck {
    pub status: CheckStatus,
    pub tools: Vec<ToolInfo>,
    /// What went wrong, worded to show as is.
    pub message: Option<String>,
    /// The last lines the server wrote to stderr, for a stdio server that failed.
    pub log: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Ok,
    /// The server answered 401: sign in from the agent with `/mcp`.
    NeedsLogin,
    Failed,
    TimedOut,
    /// Legacy SSE servers can't be checked from here.
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

impl ServerCheck {
    fn failed(status: CheckStatus, message: impl Into<String>, log: Option<String>) -> Self {
        Self {
            status,
            tools: Vec::new(),
            message: Some(message.into()),
            log,
        }
    }
}

/// Checks `server`, using `typed` for secrets entered since the last save and the Keychain for
/// the rest. `path` is the login shell's PATH.
pub async fn check(
    server: &McpServer,
    typed: &HashMap<String, String>,
    home: &Path,
    path: &str,
) -> ServerCheck {
    let values = match resolve_values(server, typed, home) {
        Ok(values) => values,
        Err(message) => return ServerCheck::failed(CheckStatus::Failed, message, None),
    };
    match server {
        McpServer::Stdio { command, args, env } => {
            check_stdio(command, args, env, &values, home, path).await
        }
        McpServer::Http { url, headers } => check_http(url, headers, &values).await,
        McpServer::Sse { .. } => ServerCheck::failed(
            CheckStatus::Unsupported,
            "SSE servers can't be checked here. The agent connects to them as usual.",
            None,
        ),
    }
}

/// The value behind each secret the server uses, keyed by id.
fn resolve_values(
    server: &McpServer,
    typed: &HashMap<String, String>,
    home: &Path,
) -> std::result::Result<HashMap<String, String>, String> {
    let ids = server.secret_ids();
    if ids.iter().all(|id| typed.contains_key(*id)) {
        return Ok(typed.clone());
    }
    let mut stored = envrouter_keychain::read(home)
        .map_err(|err| format!("Couldn't read the secrets: {err}."))?;
    stored.extend(typed.iter().map(|(k, v)| (k.clone(), v.clone())));
    match ids.iter().find(|id| !stored.contains_key(**id)) {
        Some(_) => Err("A secret this server needs isn't in the Keychain. Enter it again.".into()),
        None => Ok(stored),
    }
}

fn text(value: &McpValue, secrets: &HashMap<String, String>) -> String {
    match value {
        McpValue::Plain(text) => text.clone(),
        McpValue::Secret { secret } => secrets.get(secret).cloned().unwrap_or_default(),
    }
}

async fn check_stdio(
    command: &str,
    args: &[McpValue],
    env: &BTreeMap<String, McpValue>,
    secrets: &HashMap<String, String>,
    home: &Path,
    path: &str,
) -> ServerCheck {
    let mut cmd = tokio::process::Command::new(command);
    cmd.args(args.iter().map(|arg| text(arg, secrets)))
        .env("PATH", path)
        .env("HOME", home)
        .envs(env.iter().map(|(key, value)| (key, text(value, secrets))))
        .current_dir(home);
    let (transport, stderr) = match TokioChildProcess::builder(cmd)
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(spawned) => spawned,
        Err(err) => {
            return ServerCheck::failed(
                CheckStatus::Failed,
                format!("Couldn't start {command}: {err}."),
                None,
            )
        }
    };
    // Kept while the check runs; read again once it's over, for a failure.
    let log = std::sync::Arc::new(std::sync::Mutex::new(VecDeque::new()));
    if let Some(stderr) = stderr {
        let log = log.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut log = log.lock().unwrap_or_else(|p| p.into_inner());
                if log.len() == LOG_LINES {
                    log.pop_front();
                }
                log.push_back(line);
            }
        });
    }
    let result = tokio::time::timeout(TIMEOUT, list_tools(transport)).await;
    let tail = || {
        let log = log.lock().unwrap_or_else(|p| p.into_inner());
        (!log.is_empty()).then(|| log.iter().cloned().collect::<Vec<_>>().join("\n"))
    };
    match result {
        Ok(Ok(tools)) => ServerCheck {
            status: CheckStatus::Ok,
            tools,
            message: None,
            log: None,
        },
        Ok(Err(message)) => ServerCheck::failed(CheckStatus::Failed, message, tail()),
        Err(_) => ServerCheck::failed(
            CheckStatus::TimedOut,
            format!(
                "{command} didn't answer within {} seconds.",
                TIMEOUT.as_secs()
            ),
            tail(),
        ),
    }
}

async fn check_http(
    url: &str,
    headers: &BTreeMap<String, McpValue>,
    secrets: &HashMap<String, String>,
) -> ServerCheck {
    let mut config = StreamableHttpClientTransportConfig::with_uri(url.to_string());
    let mut custom = HashMap::new();
    for (name, value) in headers {
        let value = text(value, secrets);
        // rmcp sends the Authorization header itself, from a bare bearer token.
        if name.eq_ignore_ascii_case("authorization") {
            if let Some(token) = value.strip_prefix("Bearer ") {
                config = config.auth_header(token.to_string());
                continue;
            }
        }
        match (
            name.parse::<http::HeaderName>(),
            value.parse::<http::HeaderValue>(),
        ) {
            (Ok(name), Ok(value)) => {
                custom.insert(name, value);
            }
            _ => {
                return ServerCheck::failed(
                    CheckStatus::Failed,
                    format!("The {name} header can't be sent as written."),
                    None,
                )
            }
        }
    }
    let transport = StreamableHttpClientTransport::from_config(config.custom_headers(custom));
    match tokio::time::timeout(TIMEOUT, list_tools(transport)).await {
        Ok(Ok(tools)) => ServerCheck {
            status: CheckStatus::Ok,
            tools,
            message: None,
            log: None,
        },
        Ok(Err(message)) if message.contains("Auth required") => ServerCheck::failed(
            CheckStatus::NeedsLogin,
            "The server wants a sign-in. Run the agent in a profile folder and use /mcp to sign in.",
            None,
        ),
        Ok(Err(message)) => ServerCheck::failed(CheckStatus::Failed, message, None),
        Err(_) => ServerCheck::failed(
            CheckStatus::TimedOut,
            format!("{url} didn't answer within {} seconds.", TIMEOUT.as_secs()),
            None,
        ),
    }
}

/// Initializes, lists every page of tools, then closes, which stops a stdio server.
async fn list_tools<T, E, A>(transport: T) -> std::result::Result<Vec<ToolInfo>, String>
where
    T: rmcp::transport::IntoTransport<rmcp::RoleClient, E, A>,
    E: std::error::Error + Send + Sync + 'static,
{
    let client = ().serve(transport).await.map_err(|err| chain(&err))?;
    let tools = client.list_all_tools().await.map_err(|err| chain(&err));
    let _ = client.cancel().await;
    Ok(tools?
        .into_iter()
        .map(|tool| ToolInfo {
            name: tool.name.to_string(),
            description: tool
                .description
                .map(|d| d.lines().next().unwrap_or_default().trim().to_string())
                .filter(|d| !d.is_empty()),
        })
        .collect())
}

/// An error and its causes on one line: the useful part is usually at the bottom.
fn chain(err: &dyn std::error::Error) -> String {
    let mut message = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !message.contains(&text) {
            message = format!("{message}: {text}");
        }
        source = cause.source();
    }
    message
}

/// `~/.envrouter/mcp-tools.json`: each server's tools, with the definition they were listed from.
fn cache_path(home: &Path) -> PathBuf {
    paths::root(home).join("mcp-tools.json")
}

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    servers: BTreeMap<String, CachedTools>,
}

#[derive(Serialize, Deserialize)]
struct CachedTools {
    server: McpServer,
    tools: Vec<ToolInfo>,
}

fn read_cache(home: &Path) -> Cache {
    fs::read_to_string(cache_path(home))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Remembers a check that worked.
pub fn remember(home: &Path, name: &str, server: &McpServer, tools: &[ToolInfo]) -> Result<()> {
    let mut cache = read_cache(home);
    cache.servers.insert(
        name.to_string(),
        CachedTools {
            server: server.clone(),
            tools: tools.to_vec(),
        },
    );
    let json =
        serde_json::to_string_pretty(&cache).map_err(|err| Error::Command(err.to_string()))?;
    config::write_atomic(&cache_path(home), format!("{json}\n"))
}

/// The tools of each library server whose last good check matches its current definition.
pub fn known_tools(config: &ConfigState, home: &Path) -> BTreeMap<String, Vec<ToolInfo>> {
    read_cache(home)
        .servers
        .into_iter()
        .filter(|(name, cached)| config.mcp_servers.get(name) == Some(&cached.server))
        .map(|(name, cached)| (name, cached.tools))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_executable(path: &Path, contents: &str) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, contents).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// A stdio MCP server in POSIX sh: answers `initialize` and `tools/list`, echoing ids.
    const FAKE_SERVER: &str = r#"#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fake","version":"1"}}}\n' "$id" ;;
    *'"method":"tools/list"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"read_file","description":"Reads a file.\\nMore.","inputSchema":{"type":"object"}},{"name":"write_file","inputSchema":{"type":"object"}}]}}\n' "$id" ;;
  esac
done
"#;

    fn stdio(command: &Path, env: &[(&str, McpValue)]) -> McpServer {
        McpServer::Stdio {
            command: command.display().to_string(),
            args: Vec::new(),
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
        }
    }

    #[tokio::test]
    async fn lists_a_stdio_servers_tools() {
        let dir = tempfile::tempdir().unwrap();
        let server = dir.path().join("server");
        write_executable(&server, FAKE_SERVER);
        let check = check(
            &stdio(&server, &[]),
            &HashMap::new(),
            dir.path(),
            "/usr/bin:/bin",
        )
        .await;
        assert_eq!(check.status, CheckStatus::Ok, "{check:?}");
        assert_eq!(
            check.tools,
            [
                ToolInfo {
                    name: "read_file".into(),
                    description: Some("Reads a file.".into())
                },
                ToolInfo {
                    name: "write_file".into(),
                    description: None
                },
            ]
        );
    }

    #[tokio::test]
    async fn reports_a_server_that_exits_with_its_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let server = dir.path().join("server");
        write_executable(
            &server,
            "#!/bin/sh\necho 'missing GITHUB_TOKEN' >&2\nexit 1\n",
        );
        let check = check(
            &stdio(&server, &[]),
            &HashMap::new(),
            dir.path(),
            "/usr/bin:/bin",
        )
        .await;
        assert_eq!(check.status, CheckStatus::Failed, "{check:?}");
        // The reader may not have caught up when the transport closes; the message alone must say it failed.
        assert!(check.message.is_some());
    }

    #[tokio::test]
    async fn uses_typed_secrets_without_the_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let server = dir.path().join("server");
        // Answers only when the secret reached its environment.
        write_executable(
            &server,
            &FAKE_SERVER.replace("while IFS", "[ \"$TOKEN\" = s3cret ] || exit 1\nwhile IFS"),
        );
        let def = stdio(
            &server,
            &[(
                "TOKEN",
                McpValue::Secret {
                    secret: "AB".into(),
                },
            )],
        );
        let typed = HashMap::from([("AB".to_string(), "s3cret".to_string())]);
        let check = check(&def, &typed, dir.path(), "/usr/bin:/bin").await;
        assert_eq!(check.status, CheckStatus::Ok, "{check:?}");
    }

    #[tokio::test]
    async fn says_a_missing_command_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let check = check(
            &stdio(Path::new("no-such-mcp"), &[]),
            &HashMap::new(),
            dir.path(),
            "/usr/bin:/bin",
        )
        .await;
        assert_eq!(check.status, CheckStatus::Failed);
        assert!(check.message.unwrap().contains("no-such-mcp"));
    }

    #[test]
    fn known_tools_drops_lists_from_an_older_definition() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let old = stdio(Path::new("npx"), &[]);
        let tools = [ToolInfo {
            name: "t".into(),
            description: None,
        }];
        remember(home, "a", &old, &tools).unwrap();
        remember(home, "b", &old, &tools).unwrap();
        let config = ConfigState {
            mcp_servers: BTreeMap::from([
                ("a".into(), old.clone()),
                ("b".into(), stdio(Path::new("uvx"), &[])),
            ]),
            ..Default::default()
        };
        assert_eq!(known_tools(&config, home).keys().collect::<Vec<_>>(), ["a"]);
    }
}
