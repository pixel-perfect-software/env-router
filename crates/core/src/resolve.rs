//! Which profile owns a folder, and what that means for one tool.
//!
//! The most specific profile wins outright. The deepest trigger containing the folder picks
//! the profile, and if that profile doesn't configure a tool, the tool runs with no override
//! rather than falling back to a shallower profile.
//!
//! Both sides are compared as canonical paths. `$PWD` keeps whatever symlinks and letter case
//! the user typed, but canonical paths resolve symlinks and, on macOS's case-insensitive
//! volumes, use the on-disk case.

use std::fs;
use std::path::Path;

use crate::config::{self, ConfigState, Profile};

pub struct Resolution<'a> {
    pub profile: Option<&'a Profile>,
    /// The variable to set and its value, with `~` expanded.
    pub env: Option<(String, String)>,
}

pub fn resolve<'a>(
    config: &'a ConfigState,
    home: &Path,
    folder: &Path,
    tool: &str,
) -> Resolution<'a> {
    let profile = active_profile(config, home, folder);
    let env = profile
        .and_then(|profile| profile.tool(tool))
        .filter(|settings| config::is_env_var_name(&settings.env_var))
        // A folder `validate` would reject only reaches here in a hand-edited config. The
        // tool then runs unrouted rather than with a variable pointing somewhere unintended.
        .and_then(|settings| {
            let value = config::tool_dir(&settings.path, home)?;
            Some((
                settings.env_var.clone(),
                value.to_string_lossy().into_owned(),
            ))
        });
    Resolution { profile, env }
}

pub fn active_profile<'a>(
    config: &'a ConfigState,
    home: &Path,
    folder: &Path,
) -> Option<&'a Profile> {
    let folder = fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    let ancestors = Ancestors::of(&folder);
    let mut best: Option<(usize, &Profile)> = None;
    for profile in &config.profiles {
        for raw in &profile.trigger_paths {
            // Invalid triggers only reach here in a hand-edited config. Skip them rather
            // than fail, since the shim must always let the tool run.
            let Ok(base) = config::trigger_base(raw, home) else {
                continue;
            };
            if let Some(depth) = ancestors.depth_of(&base) {
                if best.is_none_or(|(deepest, _)| depth > deepest) {
                    best = Some((depth, profile));
                }
            }
        }
    }
    best.map(|(_, profile)| profile)
}

/// The folder being resolved and the folders above it, so each trigger can be tested against
/// them: the shim does this for every trigger on every agent launch.
struct Ancestors<'a> {
    folder: &'a Path,
    /// On Unix, each existing ancestor's device and inode, with its depth.
    #[cfg(unix)]
    ids: Vec<((u64, u64), usize)>,
}

impl<'a> Ancestors<'a> {
    fn of(folder: &'a Path) -> Self {
        Self {
            folder,
            #[cfg(unix)]
            ids: folder
                .ancestors()
                .filter_map(|dir| Some((id(dir)?, dir.components().count())))
                .collect(),
        }
    }

    /// How deep the folder `base` names sits, if it's the folder or one above it.
    ///
    /// On Unix that's a match of device and inode, which follows a symlinked trigger and, on a
    /// case-insensitive volume, ignores letter case, as comparing canonical paths would, at one
    /// `stat` per trigger rather than canonicalizing it, which costs one per component (about
    /// 200,000 instructions per trigger on macOS). A trigger that doesn't exist, or a platform
    /// without inodes, falls back to comparing paths: `starts_with` compares whole components, so
    /// ~/dev/work doesn't match ~/dev/workshop.
    fn depth_of(&self, base: &Path) -> Option<usize> {
        #[cfg(unix)]
        if let Some(base_id) = id(base) {
            return self
                .ids
                .iter()
                .find(|(dir, _)| *dir == base_id)
                .map(|&(_, depth)| depth);
        }
        let base = fs::canonicalize(base).unwrap_or_else(|_| base.to_path_buf());
        self.folder
            .starts_with(&base)
            .then(|| base.components().count())
    }
}

#[cfg(unix)]
fn id(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).ok().map(|meta| (meta.dev(), meta.ino()))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::config::ToolConfig;

    fn profile(name: &str, triggers: &[&str], claude_dir: Option<&str>) -> Profile {
        Profile {
            id: name.into(),
            name: name.into(),
            trigger_paths: triggers.iter().copied().map(String::from).collect(),
            tools: claude_dir
                .map(|dir| {
                    (
                        "claude".to_string(),
                        ToolConfig {
                            env_var: "CLAUDE_CONFIG_DIR".into(),
                            path: dir.into(),
                        },
                    )
                })
                .into_iter()
                .collect(),
            ..Default::default()
        }
    }

    /// A temp home with real directories, since resolution canonicalizes.
    fn home_with(dirs: &[&str]) -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        for dir in dirs {
            fs::create_dir_all(home.join(dir)).unwrap();
        }
        (root, home)
    }

    fn config() -> ConfigState {
        ConfigState {
            profiles: vec![
                profile("Personal", &["~/dev"], Some("~/.claude-me")),
                profile("Work", &["~/dev/work/*"], Some("~/.claude-work")),
                profile("Plain", &["~/dev/plain"], None),
            ],
            ..Default::default()
        }
    }

    fn profile_name(home: &Path, folder: &str) -> Option<String> {
        active_profile(&config(), home, &home.join(folder)).map(|p| p.name.clone())
    }

    #[test]
    fn deepest_trigger_wins_regardless_of_profile_order() {
        let (_root, home) = home_with(&["dev/work/app", "dev/workshop", "elsewhere"]);
        assert_eq!(profile_name(&home, "dev/work/app").as_deref(), Some("Work"));
        assert_eq!(profile_name(&home, "dev/work").as_deref(), Some("Work"));
        assert_eq!(
            profile_name(&home, "dev/workshop").as_deref(),
            Some("Personal")
        );
        assert_eq!(profile_name(&home, "elsewhere"), None);
    }

    #[test]
    fn most_specific_profile_owns_the_folder_even_without_the_tool() {
        let (_root, home) = home_with(&["dev/plain/sub"]);
        let config = config();
        let resolution = resolve(&config, &home, &home.join("dev/plain/sub"), "claude");
        assert_eq!(resolution.profile.map(|p| p.name.as_str()), Some("Plain"));
        assert_eq!(resolution.env, None);
    }

    #[test]
    fn env_value_has_home_expanded() {
        let (_root, home) = home_with(&["dev/work"]);
        let config = config();
        let resolution = resolve(&config, &home, &home.join("dev/work"), "claude");
        assert_eq!(
            resolution.env,
            Some((
                "CLAUDE_CONFIG_DIR".into(),
                home.join(".claude-work").display().to_string()
            ))
        );
    }

    #[test]
    fn a_relative_tool_folder_is_never_applied() {
        let (_root, home) = home_with(&["dev"]);
        let config = ConfigState {
            profiles: vec![profile("Personal", &["~/dev"], Some("claude-config"))],
            ..Default::default()
        };
        let resolution = resolve(&config, &home, &home.join("dev"), "claude");
        assert_eq!(
            resolution.profile.map(|p| p.name.as_str()),
            Some("Personal")
        );
        assert_eq!(resolution.env, None);
    }

    #[cfg(unix)]
    #[test]
    fn matches_through_a_symlink() {
        let (_root, home) = home_with(&["dev/work/app"]);
        std::os::unix::fs::symlink(home.join("dev/work"), home.join("shortcut")).unwrap();
        assert_eq!(profile_name(&home, "shortcut/app").as_deref(), Some("Work"));
    }

    /// A trigger that's itself a link (dotfiles pointing ~/work at a disk) owns the folder it
    /// points to, matched by the folder's identity rather than its text.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_trigger_owns_the_folder_it_points_to() {
        let (_root, home) = home_with(&["disk/projects/app", "dev"]);
        std::os::unix::fs::symlink(home.join("disk/projects"), home.join("work")).unwrap();
        let config = ConfigState {
            profiles: vec![
                profile("Personal", &["~"], Some("~/.claude-me")),
                profile("Linked", &["~/work"], Some("~/.claude-work")),
            ],
            ..Default::default()
        };
        let owner = |folder: &str| {
            active_profile(&config, &home, &home.join(folder)).map(|p| p.name.as_str())
        };
        assert_eq!(owner("disk/projects/app"), Some("Linked"));
        assert_eq!(owner("work/app"), Some("Linked"));
        assert_eq!(owner("dev"), Some("Personal"));
    }

    /// A trigger folder that doesn't exist yet has no identity, so it's compared as a path, and
    /// an existing folder is never inside it.
    #[test]
    fn a_missing_trigger_folder_owns_nothing() {
        let (_root, home) = home_with(&["dev/app"]);
        let config = ConfigState {
            profiles: vec![profile(
                "Later",
                &["~/dev/app/not-yet"],
                Some("~/.claude-later"),
            )],
            ..Default::default()
        };
        assert!(active_profile(&config, &home, &home.join("dev/app")).is_none());
    }

    #[test]
    fn matches_a_differently_cased_path_on_a_case_insensitive_volume() {
        let (_root, home) = home_with(&["dev/work/app"]);
        if !home.join("DEV/WORK").exists() {
            return; // Case-sensitive volume: different case is a different folder.
        }
        assert_eq!(profile_name(&home, "DEV/Work/app").as_deref(), Some("Work"));
    }
}
