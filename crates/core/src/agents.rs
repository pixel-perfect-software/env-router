//! The coding agents EnvRouter knows, read from the registry the window builds its list from
//! (`src/lib/agents.json`), so the CLI can fill `config.agents` on a machine where the window
//! never saved (a server, a WSL distro). Nothing here branches on an agent's name: an entry is
//! data, the same data the window writes.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;

use serde::Deserialize;

use crate::config::{AgentDef, ConfigState, IdeHook};

const REGISTRY: &str = include_str!("../../../src/lib/agents.json");

/// One registry entry. The window's display fields (`label`, `defaultPath`, `install`, `note`, `mark`) are
/// skipped; Rust needs only what goes into `config.agents`. The same goes inside `ide`: its `note` is the
/// window's own line for the Editors popover, which `IdeHook` ignores, so never put
/// `deny_unknown_fields` on `IdeHook` (the CLI would fail to read this registry) and don't save the note.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownAgent {
    /// The command the shim stands in for, and the key in `Profile::tools` and `agents`.
    pub command: String,
    pub env_var: String,
    #[serde(flatten)]
    pub def: AgentDef,
}

/// Every agent in the registry, in its order.
pub fn known() -> Vec<KnownAgent> {
    serde_json::from_str(REGISTRY).expect("agents.json is checked by this module's tests")
}

/// `config` with each registry agent it doesn't name yet added, for callers without the window.
/// An agent it already names keeps what it has: the window rewrites those from its own registry
/// on every save, and a CLI a release apart from the app mustn't undo that with its older (or
/// newer) copy. Except that it gains the registry's skip rules it lacks (`skipAnyArgs`,
/// `skipSubcommands`, `skipIfPresent`): each only turns injection off for a run it would break,
/// and without this a machine with no window would never see one a release adds.
pub fn with_agents(mut config: ConfigState) -> ConfigState {
    for agent in known() {
        match config.agents.entry(agent.command) {
            Entry::Vacant(entry) => {
                entry.insert(agent.def);
            }
            Entry::Occupied(mut entry) => {
                if let (Some(mcp), Some(known)) = (entry.get_mut().mcp.as_mut(), agent.def.mcp) {
                    add_missing(&mut mcp.skip_any_args, known.skip_any_args);
                    add_missing(&mut mcp.skip_subcommands, known.skip_subcommands);
                    add_missing(&mut mcp.skip_if_present, known.skip_if_present);
                }
            }
        }
    }
    config
}

/// The editor hook of each agent in `config.agents` that has one, keyed by command: how the
/// window's Editors… and the installed check recognise an agent's extension.
pub fn ide_hooks(config: &ConfigState) -> BTreeMap<String, IdeHook> {
    config
        .agents
        .iter()
        .filter_map(|(command, agent)| agent.ide.clone().map(|hook| (command.clone(), hook)))
        .collect()
}

fn add_missing(ours: &mut Vec<String>, theirs: Vec<String>) {
    for item in theirs {
        if !ours.contains(&item) {
            ours.push(item);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    use crate::config::{is_command_name, is_env_var_name, validate, IdeHook, McpDialect};

    #[test]
    fn the_registry_parses_into_agent_defs() {
        let agents = known();
        assert!(!agents.is_empty());
        for agent in &agents {
            assert!(is_command_name(&agent.command), "{agent:?}");
            assert!(is_env_var_name(&agent.env_var), "{agent:?}");
        }
        // Saving validates the descriptors (the `=` in each flag among them), so these must pass.
        validate(
            &with_agents(ConfigState::default()),
            Path::new("/scratch/home"),
        )
        .unwrap();
        let claude = agents.iter().find(|a| a.command == "claude").unwrap();
        assert_eq!(
            claude.def.mcp.as_ref().map(|mcp| mcp.dialect),
            Some(McpDialect::Claude)
        );
        assert!(claude.def.ide.is_some());
    }

    /// The registry's `ide.note` is for the window alone: it must stay in the file and out of what
    /// Rust reads, so an `IdeHook` that refuses unknown fields fails here, not in the CLI.
    #[test]
    fn the_windows_note_on_an_editor_hook_is_ignored() {
        let raw: serde_json::Value = serde_json::from_str(REGISTRY).unwrap();
        let claude = raw
            .as_array()
            .unwrap()
            .iter()
            .find(|agent| agent["command"] == "claude")
            .unwrap();
        assert!(claude["ide"]["note"].is_string());

        let registry = known();
        let claude = registry.iter().find(|a| a.command == "claude").unwrap();
        assert_eq!(
            claude.def.ide.as_ref().map(|ide| ide.setting.as_str()),
            Some("claudeCode.claudeProcessWrapper")
        );
    }

    /// A machine with no window keeps the agents its config names, so a skip rule a release
    /// adds to the registry (version 5's `skipIfPresent`) would never reach it.
    #[test]
    fn adds_the_registrys_skip_rules_to_an_agent_already_named() {
        let registry = known();
        let claude = registry.iter().find(|a| a.command == "claude").unwrap();
        let known = claude.def.mcp.as_ref().unwrap();
        let mut old = claude.def.clone();
        let mcp = old.mcp.as_mut().unwrap();
        mcp.skip_if_present.clear();
        mcp.skip_subcommands = vec!["mine".into()];
        let config = ConfigState {
            agents: [("claude".to_string(), old)].into(),
            ..ConfigState::default()
        };

        let filled = with_agents(config);
        let mcp = filled.agents["claude"].mcp.as_ref().unwrap();
        assert_eq!(mcp.skip_if_present, known.skip_if_present);
        assert!(mcp
            .skip_if_present
            .iter()
            .any(|p| p.ends_with("managed-mcp.json")));
        // Its own entries stay, first, and nothing is listed twice.
        assert_eq!(mcp.skip_subcommands[0], "mine");
        assert_eq!(mcp.skip_subcommands[1..], known.skip_subcommands[..]);
        assert_eq!(with_agents(filled.clone()), filled);
    }

    /// Claude's subcommands that don't run with an option ahead of them, from a sweep of
    /// 2.1.309 (the reasons are beside the registry's import in `src/lib/tools.ts`). Change
    /// this only after checking a current release.
    #[test]
    fn claude_skips_injection_for_the_subcommands_that_refuse_it() {
        let registry = known();
        let claude = registry.iter().find(|a| a.command == "claude").unwrap();
        assert_eq!(
            claude.def.mcp.as_ref().unwrap().skip_subcommands,
            [
                "attach",
                "daemon",
                "kill",
                "logs",
                "plugin",
                "plugins",
                "remote-control",
                "respawn",
                "rm",
                "self-hosted-runner",
                "stop",
            ]
        );
    }

    #[test]
    fn fills_missing_agents_and_keeps_every_one_already_named() {
        let mut config = ConfigState::default();
        let own = AgentDef {
            ide: Some(IdeHook {
                setting: "tool.wrapper".into(),
                extension: "me.tool".into(),
            }),
            ..AgentDef::default()
        };
        config.agents.insert("mytool".into(), own.clone());
        // What another release's window saved for a registry agent stays as it is.
        let saved = AgentDef::default();
        config.agents.insert("claude".into(), saved.clone());

        let filled = with_agents(config);
        for agent in known().into_iter().filter(|a| a.command != "claude") {
            assert_eq!(filled.agents.get(&agent.command), Some(&agent.def));
        }
        assert_eq!(filled.agents.get("claude"), Some(&saved));
        assert_eq!(filled.agents.get("mytool"), Some(&own));
        assert_eq!(filled.agents.len(), known().len() + 1);
        // Already filled, nothing changes, so callers can tell when to save.
        assert_eq!(with_agents(filled.clone()), filled);
    }
}
