//! `envrouter rpc`: the window's commands over a pipe, one JSON object per line each way, so a
//! window can manage another machine (a WSL distro, through `wsl.exe -d <distro> -- envrouter
//! rpc`) with the same calls it makes locally.
//!
//! A request names a Tauri command and passes its arguments under the same names `invoke` uses:
//! `{"id": 1, "command": "check_folder", "args": {"shell": "zsh", "folder": "/x", "tool":
//! "claude"}}`. The answer echoes the id with either `ok`, the command's result in the window's
//! wire format (`src/lib/types.ts`), or `error`, a message written to show the user as is.
//! `open_in_editor` isn't offered: it would open the file on the other machine.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use envrouter_core::config::{ConfigState, IdeHook, McpServer};
use envrouter_core::{Error, ErrorKind, Result};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands;
use crate::editors::Editor;
use crate::shell::{self, Shell};

/// Every command this serves: the window's, but `open_in_editor`. The app's tests hold it to
/// the Tauri handler's list.
pub const COMMANDS: &[&str] = &[
    "get_config",
    "save_config",
    "reset_unreadable_config",
    "get_setup_status",
    "set_shell_integration",
    "get_editor_status",
    "set_editor_integration",
    "check_folder",
    "preview_folder",
    "check_mcp_server",
    "npm_dist_tags",
    "get_mcp_tools",
    "import_candidates",
    "parse_mcp_json",
];

#[derive(Debug, Deserialize)]
pub struct Request {
    /// Anything; echoed back so a caller can match answers to requests.
    #[serde(default)]
    pub id: Value,
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Response {
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ok: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// With `error`: what kind of failure, as the window's config read reports it.
    #[serde(rename = "errorKind", skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<ErrorKind>,
}

/// Answers one line. A line that isn't a request gets an error with a null id.
pub async fn handle_line(home: &Path, line: &str) -> Response {
    match serde_json::from_str::<Request>(line) {
        Ok(request) => handle(home, request).await,
        Err(err) => Response {
            id: Value::Null,
            ok: None,
            error: Some(format!("not a request: {err}")),
            error_kind: None,
        },
    }
}

pub async fn handle(home: &Path, request: Request) -> Response {
    let result = dispatch(home, &request.command, request.args).await;
    match result {
        Ok(value) => Response {
            id: request.id,
            ok: Some(value),
            error: None,
            error_kind: None,
        },
        Err(err) => Response {
            id: request.id,
            ok: None,
            error: Some(err.to_string()),
            error_kind: Some(err.kind()),
        },
    }
}

async fn dispatch(home: &Path, command: &str, args: Value) -> Result<Value> {
    match command {
        "get_config" => to_value(commands::get_config(home)?),
        "save_config" => {
            let Save {
                payload,
                secrets,
                base,
            } = parse(args)?;
            to_value(commands::save_config(
                home,
                &payload,
                &secrets,
                base.as_ref(),
            )?)
        }
        "reset_unreadable_config" => to_value(commands::reset_unreadable_config(home)?),
        "get_setup_status" => to_value(commands::setup_status(home)?),
        "set_shell_integration" => {
            let ShellSwitch { shell, enabled } = parse(args)?;
            to_value(commands::set_shell_integration(home, shell, enabled)?)
        }
        "get_editor_status" => {
            let Hooks { hooks } = parse(args)?;
            to_value(commands::editor_status(home, &hooks))
        }
        "set_editor_integration" => {
            let EditorSwitch {
                editor,
                command,
                hook,
                enabled,
            } = parse(args)?;
            to_value(commands::set_editor_integration(
                home, editor, &command, &hook, enabled,
            )?)
        }
        "check_folder" => {
            let Check {
                shell,
                folder,
                tool,
            } = parse(args)?;
            to_value(commands::check_folder(home, shell, &folder, &tool)?)
        }
        "preview_folder" => {
            let PreviewArgs {
                payload,
                folder,
                tool,
            } = parse(args)?;
            to_value(commands::preview_folder(home, &payload, &folder, &tool))
        }
        "check_mcp_server" => {
            let ServerCheck {
                name,
                server,
                secrets,
            } = parse(args)?;
            let path = shell::login_path(home)?;
            to_value(commands::check_mcp_server(home, &path, &name, &server, &secrets).await?)
        }
        "npm_dist_tags" => {
            let Package { command, package } = parse(args)?;
            let path = shell::login_path(home)?;
            to_value(commands::npm_dist_tags(home, &path, &command, &package).await?)
        }
        "get_mcp_tools" => to_value(commands::mcp_tools(home)?),
        "import_candidates" => {
            let Payload { payload } = parse(args)?;
            to_value(commands::import_candidates(home, &payload))
        }
        "parse_mcp_json" => {
            let Text { text } = parse(args)?;
            to_value(commands::parse_mcp_json(&text)?)
        }
        other => Err(Error::Invalid(format!("unknown command {other:?}"))),
    }
}

fn parse<T: DeserializeOwned>(args: Value) -> Result<T> {
    serde_json::from_value(args).map_err(|err| Error::Invalid(format!("bad arguments: {err}")))
}

fn to_value(value: impl Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|err| Error::Command(err.to_string()))
}

#[derive(Deserialize)]
struct Save {
    payload: ConfigState,
    #[serde(default)]
    secrets: HashMap<String, String>,
    /// The config the edit started from; see `commands::SaveOutcome`.
    #[serde(default)]
    base: Option<ConfigState>,
}

#[derive(Deserialize)]
struct ShellSwitch {
    shell: Shell,
    enabled: bool,
}

#[derive(Deserialize)]
struct Hooks {
    hooks: BTreeMap<String, IdeHook>,
}

#[derive(Deserialize)]
struct EditorSwitch {
    editor: Editor,
    command: String,
    hook: IdeHook,
    enabled: bool,
}

#[derive(Deserialize)]
struct Check {
    shell: Shell,
    folder: PathBuf,
    tool: String,
}

#[derive(Deserialize)]
struct PreviewArgs {
    payload: ConfigState,
    folder: PathBuf,
    tool: String,
}

#[derive(Deserialize)]
struct ServerCheck {
    name: String,
    server: McpServer,
    #[serde(default)]
    secrets: HashMap<String, String>,
}

#[derive(Deserialize)]
struct Package {
    command: String,
    package: String,
}

#[derive(Deserialize)]
struct Payload {
    payload: ConfigState,
}

#[derive(Deserialize)]
struct Text {
    text: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn answer(home: &Path, line: &str) -> Value {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        serde_json::to_value(runtime.block_on(handle_line(home, line))).unwrap()
    }

    /// Pins the envelope a remote window relies on. The payloads inside are the window's own
    /// wire types, pinned by the other wire-format tests.
    #[test]
    fn answers_by_command_name_with_ok_or_error() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();

        let config = answer(home, r#"{"id": 7, "command": "get_config"}"#);
        assert_eq!(config["id"], 7);
        assert_eq!(config["ok"]["profiles"], json!([]));
        assert!(config.get("error").is_none());

        let preview = answer(
            home,
            &json!({
                "id": "p",
                "command": "preview_folder",
                "args": { "payload": config["ok"], "folder": "/tmp", "tool": "claude" },
            })
            .to_string(),
        );
        assert_eq!(preview["ok"]["profile"], Value::Null);

        let setup = answer(home, r#"{"id": 3, "command": "get_setup_status"}"#);
        let platform = setup["ok"]["platform"].as_str().unwrap();
        assert!(
            ["macos", "linux", "wsl", "windows"].contains(&platform),
            "{setup}"
        );
        assert!(setup["ok"]["secretStore"].is_string(), "{setup}");
        // Null or the store's reason, depending on the machine the test runs on.
        let problem = setup["ok"].get("secretStoreProblem");
        assert!(
            problem.is_some_and(|p| p.is_null() || p.is_string()),
            "{setup}"
        );

        // The shape `Pasted` has in src/lib/types.ts.
        let pasted = answer(
            home,
            &json!({
                "id": 5,
                "command": "parse_mcp_json",
                "args": { "text": r#"{ "mcpServers": { "lin": { "url": "https://l/mcp" } } }"# },
            })
            .to_string(),
        );
        assert_eq!(
            pasted["ok"],
            json!({
                "servers": [{ "name": "lin", "server": { "transport": "http", "url": "https://l/mcp", "headers": {} } }],
                "skipped": [],
            })
        );
        let unreadable = answer(
            home,
            r#"{"id": 6, "command": "parse_mcp_json", "args": {"text": " "}}"#,
        );
        assert_eq!(unreadable["error"], "Paste a server's JSON first.");

        let unknown = answer(home, r#"{"id": 8, "command": "open_in_editor"}"#);
        assert_eq!(
            unknown,
            json!({ "id": 8, "error": "unknown command \"open_in_editor\"", "errorKind": "other" })
        );

        let bad = answer(
            home,
            r#"{"id": 9, "command": "set_shell_integration", "args": {}}"#,
        );
        assert!(
            bad["error"].as_str().unwrap().starts_with("bad arguments"),
            "{bad}"
        );

        let junk = answer(home, "not json");
        assert_eq!(junk["id"], Value::Null);
        assert!(junk["error"].as_str().unwrap().starts_with("not a request"));

        // A config.json that won't parse says so by kind, since only that one can be started over.
        std::fs::write(home.join(".envrouter/config.json"), "{ half-typed").unwrap();
        let broken = answer(home, r#"{"id": 10, "command": "get_config"}"#);
        assert_eq!(broken["errorKind"], "parse", "{broken}");
    }

    /// `COMMANDS` is what the app's test compares with the window's; this keeps it honest about
    /// what `dispatch` answers. Empty arguments fail to parse before anything runs, and the
    /// commands that take none only read the scratch home.
    #[test]
    fn dispatches_every_listed_command() {
        let home = tempfile::tempdir().unwrap();
        for command in COMMANDS {
            let answer = answer(
                home.path(),
                &json!({ "id": 1, "command": command, "args": {} }).to_string(),
            );
            assert!(
                !answer["error"]
                    .as_str()
                    .is_some_and(|e| e.starts_with("unknown command")),
                "{command}: {answer}"
            );
        }
    }
}
