//! The coding agents EnvRouter knows, read from the registry the window builds its list from
//! (`src/lib/agents.json`), so the CLI can fill `config.agents` on a machine where the window
//! never saved (a server, a WSL distro). Nothing here branches on an agent's name: an entry is
//! data, the same data the window writes.

use serde::Deserialize;

use crate::config::{AgentDef, ConfigState};

const REGISTRY: &str = include_str!("../../../src/lib/agents.json");

/// One registry entry. The window's display fields (`label`, `defaultPath`, `note`) are
/// skipped; Rust needs only what goes into `config.agents`.
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
/// newer) copy.
pub fn with_agents(mut config: ConfigState) -> ConfigState {
    for agent in known() {
        config.agents.entry(agent.command).or_insert(agent.def);
    }
    config
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
