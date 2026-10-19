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
use envrouter_core::{Error, Result};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands;
use crate::editors::Editor;
use crate::shell::{self, Shell};

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
}

/// Answers one line. A line that isn't a request gets an error with a null id.
pub async fn handle_line(home: &Path, line: &str) -> Response {
    match serde_json::from_str::<Request>(line) {
        Ok(request) => handle(home, request).await,
        Err(err) => Response {
            id: Value::Null,
            ok: None,
            error: Some(format!("not a request: {err}")),
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
        },
        Err(err) => Response {
            id: request.id,
            ok: None,
            error: Some(err.to_string()),
        },
    }
}

async fn dispatch(home: &Path, command: &str, args: Value) -> Result<Value> {
    match command {
        "get_config" => to_value(commands::get_config(home)?),
        "save_config" => {
            let Save { payload, secrets } = parse(args)?;
            to_value(commands::save_config(home, &payload, &secrets)?)
        }
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
        "get_mcp_tools" => to_value(commands::mcp_tools(home)?),
        "import_candidates" => {
            let Payload { payload } = parse(args)?;
            to_value(commands::import_candidates(home, &payload))
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
struct Payload {
    payload: ConfigState,
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

        let unknown = answer(home, r#"{"id": 8, "command": "open_in_editor"}"#);
        assert_eq!(
            unknown,
            json!({ "id": 8, "error": "unknown command \"open_in_editor\"" })
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
    }
}
