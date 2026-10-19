//! Editor integration. An agent's editor extension, like Claude Code for VS Code, runs its own
//! copy of the agent rather than the one on PATH, so the shims never see it. Such extensions
//! take a process-wrapper setting instead: the editor runs `<wrapper> <its binary> <args>`.
//! Pointing that setting at the shim routes the extension's sessions like a terminal's.
//!
//! Which setting, and which extension, is agent data from `tools.ts` (an [`IdeHook`]); this
//! module only knows where VS Code and its forks keep their user settings.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub use envrouter_core::config::IdeHook;
use envrouter_core::platform::{self, Platform};
use envrouter_core::{config, paths, Error, Result};
use jsonc_parser::cst::{CstInputValue, CstRootNode};
use jsonc_parser::ParseOptions;
use serde::{Deserialize, Serialize};

/// VS Code and the forks that share its settings format and extensions, plus their remote
/// servers: VS Code on Windows opening a WSL folder (or any editor connected over SSH) runs the
/// extension inside the remote machine, where it reads that server's machine settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Editor {
    Code,
    CodeInsiders,
    Cursor,
    Windsurf,
    Codium,
    RemoteCode,
    RemoteCodeInsiders,
    RemoteCursor,
    RemoteWindsurf,
}

impl Editor {
    pub const ALL: [Editor; 9] = [
        Editor::Code,
        Editor::CodeInsiders,
        Editor::Cursor,
        Editor::Windsurf,
        Editor::Codium,
        Editor::RemoteCode,
        Editor::RemoteCodeInsiders,
        Editor::RemoteCursor,
        Editor::RemoteWindsurf,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Editor::Code => "VS Code",
            Editor::CodeInsiders => "VS Code Insiders",
            Editor::Cursor => "Cursor",
            Editor::Windsurf => "Windsurf",
            Editor::Codium => "VSCodium",
            Editor::RemoteCode => "VS Code Server",
            Editor::RemoteCodeInsiders => "VS Code Insiders Server",
            Editor::RemoteCursor => "Cursor Server",
            Editor::RemoteWindsurf => "Windsurf Server",
        }
    }

    /// A remote server's folder in the home folder, created when an editor first connects.
    fn server_dir(self, home: &Path) -> Option<PathBuf> {
        let dir = match self {
            Editor::RemoteCode => ".vscode-server",
            Editor::RemoteCodeInsiders => ".vscode-server-insiders",
            Editor::RemoteCursor => ".cursor-server",
            Editor::RemoteWindsurf => ".windsurf-server",
            _ => return None,
        };
        Some(home.join(dir))
    }

    /// The folder that shows the editor has run here: the desktop editor's settings folder,
    /// which it creates on first launch, or the remote server's folder.
    fn root_dir(self, home: &Path) -> PathBuf {
        if let Some(server) = self.server_dir(home) {
            return server;
        }
        let name = match self {
            Editor::CodeInsiders => "Code - Insiders",
            Editor::Cursor => "Cursor",
            Editor::Windsurf => "Windsurf",
            Editor::Codium => "VSCodium",
            _ => "Code",
        };
        platform::app_config_dir(Platform::current(), home).join(name)
    }

    /// User settings for a desktop editor; machine settings for a remote server, which is where
    /// a machine-scoped setting like a process wrapper is read from there.
    pub fn settings_file(self, home: &Path) -> PathBuf {
        match self.server_dir(home) {
            Some(server) => server.join("data/Machine/settings.json"),
            None => self.root_dir(home).join("User/settings.json"),
        }
    }

    fn extensions_dir(self, home: &Path) -> PathBuf {
        if let Some(server) = self.server_dir(home) {
            return server.join("extensions");
        }
        let dir = match self {
            Editor::CodeInsiders => ".vscode-insiders",
            Editor::Cursor => ".cursor",
            Editor::Windsurf => ".windsurf",
            Editor::Codium => ".vscode-oss",
            _ => ".vscode",
        };
        home.join(dir).join("extensions")
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorStatus {
    pub editor: Editor,
    /// The agent whose extension this is about.
    pub command: String,
    /// The editor has been run on this machine (for a server, connected to it).
    pub available: bool,
    pub extension_installed: bool,
    pub settings_file: String,
    /// The wrapper the setting names now, if any.
    pub wrapper: Option<String>,
    /// That wrapper is EnvRouter's shim.
    pub installed: bool,
}

pub fn status(editor: Editor, home: &Path, command: &str, hook: &IdeHook) -> EditorStatus {
    let file = editor.settings_file(home);
    // An unreadable file reads as off; turning it on reports why.
    let wrapper = fs::read_to_string(&file)
        .ok()
        .and_then(|text| CstRootNode::parse(&text, &ParseOptions::default()).ok())
        .and_then(|root| read_setting(&root, &hook.setting));
    let prefix = format!("{}-", hook.extension);
    let extension_installed = fs::read_dir(editor.extensions_dir(home)).is_ok_and(|entries| {
        entries.flatten().any(|entry| {
            entry.path().is_dir() && entry.file_name().to_string_lossy().starts_with(&prefix)
        })
    });
    EditorStatus {
        editor,
        command: command.to_owned(),
        available: editor.root_dir(home).is_dir(),
        extension_installed,
        settings_file: file.display().to_string(),
        installed: wrapper.as_deref() == Some(shim(home).as_str()),
        wrapper,
    }
}

/// Points the hook's setting at the shim, or clears it. Never replaces a wrapper the user set
/// themselves, and only clears the shim's own.
pub fn set_integration(
    editor: Editor,
    home: &Path,
    command: &str,
    hook: &IdeHook,
    enabled: bool,
) -> Result<EditorStatus> {
    let file = editor.settings_file(home);
    // Write through symlinks, so a dotfiles-managed file stays a link.
    let file = fs::canonicalize(&file).unwrap_or(file);
    let current = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(err) if err.kind() == ErrorKind::NotFound => {
            if !enabled {
                return Ok(status(editor, home, command, hook));
            }
            String::new()
        }
        Err(source) => return Err(Error::Io { path: file, source }),
    };
    let updated = with_wrapper(&current, &hook.setting, &shim(home), enabled).map_err(|why| {
        Error::Invalid(match why {
            Refusal::Unreadable(err) => format!(
                "{} couldn't be read: {err}. Fix it in {}, then try again.",
                file.display(),
                editor.label()
            ),
            Refusal::OtherWrapper(other) => format!(
                "{} already runs the extension through {other}. Clear {} in the {} settings to use EnvRouter.",
                editor.label(),
                hook.setting,
                editor.label()
            ),
        })
    })?;
    if updated != current {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|source| Error::Io {
                path: dir.to_path_buf(),
                source,
            })?;
        }
        config::write_atomic(&file, updated)?;
    }
    Ok(status(editor, home, command, hook))
}

/// The installed shim, as the setting names it. Editors don't expand `~`.
fn shim(home: &Path) -> String {
    paths::shim_binary(home).display().to_string()
}

#[derive(Debug, PartialEq)]
enum Refusal {
    Unreadable(String),
    OtherWrapper(String),
}

/// `text` with `setting` naming `ours`, or without it, keeping every other line, comment and
/// trailing comma as it was.
fn with_wrapper(
    text: &str,
    setting: &str,
    ours: &str,
    enabled: bool,
) -> std::result::Result<String, Refusal> {
    let root = CstRootNode::parse(text, &ParseOptions::default())
        .map_err(|err| Refusal::Unreadable(err.to_string()))?;
    let current = read_setting(&root, setting);
    match (enabled, current.as_deref()) {
        (true, Some(value)) if value == ours => Ok(text.to_owned()),
        (true, Some(other)) if !other.is_empty() => Err(Refusal::OtherWrapper(other.to_owned())),
        (true, _) => {
            let object = match root.value() {
                None => root.object_value_or_set(),
                Some(_) => root
                    .object_value()
                    .ok_or_else(|| Refusal::Unreadable("it isn't a JSON object".into()))?,
            };
            let value = CstInputValue::String(ours.to_owned());
            match object.get(setting) {
                Some(prop) => prop.set_value(value),
                None => {
                    object.append(setting, value);
                }
            }
            let mut updated = root.to_string();
            if !updated.ends_with('\n') {
                updated.push('\n');
            }
            Ok(updated)
        }
        (false, Some(value)) if value == ours => {
            if let Some(prop) = root.object_value().and_then(|object| object.get(setting)) {
                prop.remove();
            }
            Ok(root.to_string())
        }
        (false, _) => Ok(text.to_owned()),
    }
}

fn read_setting(root: &CstRootNode, setting: &str) -> Option<String> {
    root.object_value()?
        .get(setting)?
        .value()?
        .as_string_lit()?
        .decoded_value()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "claudeCode.claudeProcessWrapper";
    const OURS: &str = "/Users/me/.envrouter/bin/envrouter-shim";

    fn hook() -> IdeHook {
        IdeHook {
            setting: KEY.into(),
            extension: "anthropic.claude-code".into(),
        }
    }

    /// Pins the JSON of `Editor`, `IdeHook` and `EditorStatus` in `src/lib/types.ts`. Update
    /// both together.
    #[test]
    fn wire_format_matches_the_typescript_types() {
        let names: Vec<String> = Editor::ALL
            .iter()
            .map(|e| serde_json::to_string(e).unwrap())
            .collect();
        assert_eq!(
            names,
            [
                r#""code""#,
                r#""codeInsiders""#,
                r#""cursor""#,
                r#""windsurf""#,
                r#""codium""#,
                r#""remoteCode""#,
                r#""remoteCodeInsiders""#,
                r#""remoteCursor""#,
                r#""remoteWindsurf""#
            ]
        );
        let hook: IdeHook = serde_json::from_str(r#"{"setting":"a.b","extension":"x.y"}"#).unwrap();
        assert_eq!(
            (hook.setting.as_str(), hook.extension.as_str()),
            ("a.b", "x.y")
        );
        let status = EditorStatus {
            editor: Editor::Code,
            command: "claude".into(),
            available: true,
            extension_installed: false,
            settings_file: "/s.json".into(),
            wrapper: None,
            installed: false,
        };
        assert_eq!(
            serde_json::to_string(&status).unwrap(),
            r#"{"editor":"code","command":"claude","available":true,"extensionInstalled":false,"settingsFile":"/s.json","wrapper":null,"installed":false}"#
        );
    }

    #[test]
    fn adds_the_setting_keeping_comments_and_trailing_commas() {
        let text = "{\n  // Formatting\n  \"editor.tabSize\": 2,\n  \"files.exclude\": {\n    \"**/.git\": true,\n  },\n}\n";
        let updated = with_wrapper(text, KEY, OURS, true).unwrap();
        assert!(updated.contains("// Formatting"), "{updated}");
        assert!(updated.contains("\"**/.git\": true,"), "{updated}");
        let root = CstRootNode::parse(&updated, &ParseOptions::default()).unwrap();
        assert_eq!(read_setting(&root, KEY).as_deref(), Some(OURS));
        assert!(updated.contains("\"editor.tabSize\": 2,"), "{updated}");

        // Turning it off again gives back what the user had.
        let restored = with_wrapper(&updated, KEY, OURS, false).unwrap();
        assert_eq!(
            restored.replace([' ', '\n', ','], ""),
            text.replace([' ', '\n', ','], "")
        );
        assert!(restored.contains("// Formatting"));
    }

    #[test]
    fn starts_an_empty_or_missing_file() {
        for text in ["", "{}", "{}\n"] {
            let updated = with_wrapper(text, KEY, OURS, true).unwrap();
            let value: serde_json::Value = serde_json::from_str(&updated).unwrap();
            assert_eq!(value[KEY], OURS, "{text:?} → {updated}");
        }
    }

    #[test]
    fn never_replaces_or_clears_someone_elses_wrapper() {
        let text = format!("{{ \"{KEY}\": \"/usr/local/bin/my-wrapper\" }}");
        assert_eq!(
            with_wrapper(&text, KEY, OURS, true),
            Err(Refusal::OtherWrapper("/usr/local/bin/my-wrapper".into()))
        );
        assert_eq!(with_wrapper(&text, KEY, OURS, false).unwrap(), text);
        // An empty value is nobody's.
        let empty = format!("{{ \"{KEY}\": \"\" }}");
        let updated = with_wrapper(&empty, KEY, OURS, true).unwrap();
        assert!(updated.contains(OURS), "{updated}");
    }

    #[test]
    fn leaves_a_file_it_cant_read_alone() {
        assert!(matches!(
            with_wrapper("{ \"a\": ", KEY, OURS, true),
            Err(Refusal::Unreadable(_))
        ));
        assert!(matches!(
            with_wrapper("[1, 2]", KEY, OURS, true),
            Err(Refusal::Unreadable(_))
        ));
    }

    #[test]
    fn turning_on_and_off_edits_only_the_settings_file() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let editor = Editor::Code;
        assert!(!status(editor, home, "claude", &hook()).available);

        let ext = home.join(".vscode/extensions/anthropic.claude-code-2.1.301-darwin-arm64");
        fs::create_dir_all(&ext).unwrap();
        let on = set_integration(editor, home, "claude", &hook(), true).unwrap();
        assert!(
            on.available && on.installed && on.extension_installed,
            "{on:?}"
        );
        assert_eq!(on.wrapper.as_deref(), Some(shim(home).as_str()));

        let off = set_integration(editor, home, "claude", &hook(), false).unwrap();
        assert!(!off.installed && off.wrapper.is_none(), "{off:?}");
        let text = fs::read_to_string(editor.settings_file(home)).unwrap();
        assert!(
            serde_json::from_str::<serde_json::Value>(&text).is_ok(),
            "{text}"
        );

        // Off with no settings file at all creates nothing.
        let cursor = set_integration(Editor::Cursor, home, "claude", &hook(), false).unwrap();
        assert!(!cursor.available);
        assert!(!Editor::Cursor.settings_file(home).exists());
    }

    /// VS Code on Windows opening a WSL folder runs the extension in the distro's server, which
    /// reads the wrapper from the server's machine settings.
    #[test]
    fn a_remote_server_uses_its_machine_settings() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let editor = Editor::RemoteCode;
        assert!(!status(editor, home, "claude", &hook()).available);

        fs::create_dir_all(
            home.join(".vscode-server/extensions/anthropic.claude-code-2.1.301-linux-x64"),
        )
        .unwrap();
        let on = set_integration(editor, home, "claude", &hook(), true).unwrap();
        assert!(
            on.available && on.installed && on.extension_installed,
            "{on:?}"
        );
        let machine = home.join(".vscode-server/data/Machine/settings.json");
        assert_eq!(on.settings_file, machine.display().to_string());
        assert!(fs::read_to_string(machine).unwrap().contains(KEY));
    }

    #[test]
    fn writes_through_a_linked_settings_file() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let real = home.join("dotfiles/settings.json");
        fs::create_dir_all(real.parent().unwrap()).unwrap();
        fs::write(&real, "{}\n").unwrap();
        let link = Editor::Code.settings_file(home);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        set_integration(Editor::Code, home, "claude", &hook(), true).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        assert!(fs::read_to_string(&real).unwrap().contains(KEY));
    }
}
