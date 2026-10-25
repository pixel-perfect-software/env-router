//! Which agents a new terminal doesn't find: the offered agents it has nothing to run for, and no
//! editor carries. Something to run is a program of the command's name on its PATH behind the
//! shims (found as the shim finds the real tool, `programs::find_real`); an alias whose first word
//! resolves the same way (Claude Code's old installer left `~/.claude/local/claude` behind an
//! alias); or a function of that name, which counts as there because what it runs can't be known
//! without running it. An editor carries an agent when its extension is installed, which brings
//! its own copy, routed through the editor's wrapper setting (Claude Code for VS Code): it is
//! there, only not for a terminal. Nothing here runs an agent; a file's name and its mode are all
//! it reads. `SetupStatus` reports the answer, so every caller (the window, the CLI, rpc) has the
//! same one.
//!
//! The PATH, the aliases and the functions come from one run of the user's login shell
//! ([`shell::login_shell_report`]), kept for a few minutes, so looking again on every focus is a
//! walk along that PATH.

use std::collections::BTreeMap;
use std::path::Path;

use envrouter_core::config::{self, ConfigState, IdeHook};
use envrouter_core::{agents, paths, programs, Result};

use crate::editors::{self, Editor};
use crate::shell::{self, LoginReport};

/// The agents the window offers: the registry's, and any the saved config names besides. Reads
/// the config without creating one, since a status check mustn't make a folder. An unreadable
/// config offers the registry's alone.
pub struct Offered {
    pub commands: Vec<String>,
    /// For each that has an editor extension, how to recognise it.
    pub hooks: BTreeMap<String, IdeHook>,
}

pub fn offered(home: &Path) -> Offered {
    let saved = config::load(&paths::root(home))
        .ok()
        .flatten()
        .unwrap_or_default();
    offered_by(saved)
}

fn offered_by(saved: ConfigState) -> Offered {
    let filled = agents::with_agents(saved);
    Offered {
        commands: filled.agents.keys().cloned().collect(),
        hooks: agents::ide_hooks(&filled),
    }
}

/// The commands among `commands` that the shell that made `report` has nothing to run for. See
/// the module for what counts.
pub fn missing(home: &Path, commands: &[String], report: &LoginReport) -> Vec<String> {
    let shims = paths::shims(home);
    let on_path = |name: &str| {
        programs::find_real(report.path.as_ref(), name, Some(&shims), || None).is_some()
    };
    commands
        .iter()
        .filter(|command| {
            let there = match report.aliases.get(*command) {
                Some(expansion) => alias_runs(home, command, expansion, report, &on_path),
                None => report.functions.contains(command) || on_path(command),
            };
            !there
        })
        .cloned()
        .collect()
}

/// Whether the alias `command='<expansion>'` runs something that's there: what it runs first,
/// past `VAR=value` words and `command`, `builtin`, `noglob` and the like, is a program (an absolute path, or on PATH
/// as `on_path` says). What can't be known without a shell to expand it (`$HOME/bin/x`, a glob), a
/// relative path, and another alias or function the shell would run instead, count as there: the
/// mark says "Not installed", so it needs to be right.
fn alias_runs(
    home: &Path,
    command: &str,
    expansion: &str,
    report: &LoginReport,
    on_path: &dyn Fn(&str) -> bool,
) -> bool {
    let Some(word) = first_word(expansion) else {
        return true;
    };
    // The shell's own word for it: a builtin, a keyword, a function or another alias runs
    // whether or not a program of that name is anywhere.
    if let Some((said, kind)) = report.alias_words.get(command) {
        if *said == word
            && matches!(
                kind.as_str(),
                "builtin" | "reserved" | "keyword" | "function" | "alias"
            )
        {
            return true;
        }
    }
    if word.contains(['$', '`', '(', ')', '*', '?', '{']) {
        return true;
    }
    if let Some(rest) = word.strip_prefix("~/") {
        return programs::is_executable(&home.join(rest));
    }
    if word.contains('/') {
        return !Path::new(&word).is_absolute() || programs::is_executable(Path::new(&word));
    }
    if word != command && (report.functions.contains(&word) || report.aliases.contains_key(&word)) {
        return true;
    }
    on_path(&word)
}

/// The program word of an alias's value: the first one that isn't a `VAR=value` assignment or one
/// of `shell::ALIAS_PREFIXES`, with its quotes taken off.
fn first_word(text: &str) -> Option<String> {
    let mut chars = text.chars().peekable();
    loop {
        while chars.next_if(|c| c.is_whitespace()).is_some() {}
        let mut word = String::new();
        let mut quote: Option<char> = None;
        while let Some(&c) = chars.peek() {
            if quote.is_none() && c.is_whitespace() {
                break;
            }
            chars.next();
            match (quote, c) {
                (None, '\'' | '"') => quote = Some(c),
                (Some(q), c) if c == q => quote = None,
                (None | Some('"'), '\\') => word.extend(chars.next()),
                (_, c) => word.push(c),
            }
        }
        if word.is_empty() {
            return None;
        }
        let assignment = word.split_once('=').is_some_and(|(name, _)| {
            !name.is_empty()
                && !name.starts_with(|c: char| c.is_ascii_digit())
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        });
        if !assignment && !shell::ALIAS_PREFIXES.contains(&word.as_str()) {
            return Some(word);
        }
    }
}

/// Takes out of `missing` the agents an editor has the extension of.
fn without_the_carried(home: &Path, offered: &Offered, missing: &mut Vec<String>) {
    missing.retain(|command| {
        !offered.hooks.get(command).is_some_and(|hook| {
            Editor::ALL
                .into_iter()
                .any(|editor| editors::extension_installed(editor, home, hook))
        })
    });
}

/// The offered agents a new terminal has nothing to run for and no editor carries, from the
/// report [`shell`] has (asking the shell, up to its 15 seconds, only when it has none that's
/// recent).
pub fn probe(home: &Path) -> Result<Vec<String>> {
    let offered = offered(home);
    let report = shell::login_shell_report(home, &offered.commands)?;
    let mut missing = missing(home, &offered.commands, &report);
    without_the_carried(home, &offered, &mut missing);
    Ok(missing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::Shell;
    use std::fs;
    use std::os::unix::fs::{symlink, PermissionsExt};

    /// An empty file with the mode a program has; nothing here ever runs one.
    fn program(dir: &Path, name: &str, mode: u32) {
        fs::create_dir_all(dir).unwrap();
        let file = dir.join(name);
        fs::write(&file, "").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(mode)).unwrap();
    }

    fn names(commands: &[&str]) -> Vec<String> {
        commands.iter().map(|c| (*c).to_string()).collect()
    }

    /// What a shell with this PATH, these functions and these aliases says.
    fn said(dirs: &[&Path], functions: &[&str], aliases: &[(&str, &str)]) -> LoginReport {
        LoginReport {
            path: std::env::join_paths(dirs).unwrap().into_string().unwrap(),
            functions: names(functions),
            aliases: aliases
                .iter()
                .map(|(c, v)| ((*c).to_string(), (*v).to_string()))
                .collect(),
            alias_words: BTreeMap::new(),
        }
    }

    /// An agent is there when a program of its name is on the PATH a terminal gets. A file that
    /// can't run, and one in a folder that isn't on the PATH, are not it.
    #[test]
    fn an_agent_is_there_when_an_executable_of_its_name_is_on_the_path() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("home");
        let (bin, elsewhere) = (scratch.path().join("bin"), scratch.path().join("other"));
        program(&bin, "claude", 0o755);
        program(&bin, "copilot", 0o644);
        program(&elsewhere, "gemini", 0o755);

        let gone = missing(
            &home,
            &names(&["claude", "copilot", "gemini"]),
            &said(&[&bin], &[], &[]),
        );
        assert_eq!(gone, ["copilot", "gemini"]);
    }

    /// The shims folder says nothing about the agent, whatever it holds: not by its name, not
    /// through another spelling of it, and no link to the shim anywhere else on PATH either. The
    /// real one, later on PATH, is what counts.
    #[test]
    fn the_shims_do_not_count_as_the_agent() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("home");
        let shim = paths::shim_binary(&home);
        program(shim.parent().unwrap(), paths::SHIM_NAME, 0o755);
        let shims = paths::shims(&home);
        // Not even a link to the shim: a file of the agent's name that something else left here.
        program(&shims, "claude", 0o755);
        let alias = scratch.path().join("alias");
        symlink(&shims, &alias).unwrap();
        let stray = scratch.path().join("stray");
        fs::create_dir_all(&stray).unwrap();
        symlink(&shim, stray.join("claude")).unwrap();

        let commands = names(&["claude"]);
        for only_shims in [&shims, &alias, &stray] {
            let gone = missing(&home, &commands, &said(&[only_shims], &[], &[]));
            assert_eq!(gone, ["claude"]);
        }

        let real = scratch.path().join("real");
        program(&real, "claude", 0o755);
        let report = said(&[&shims, &stray, &real], &[], &[]);
        assert!(missing(&home, &commands, &report).is_empty());
    }

    /// A function counts as there, since what it runs can't be known; an alias counts when what
    /// it runs first is there, however it's dressed (variables, `command`, quotes), and when it
    /// can't be told without a shell, or is another alias.
    #[test]
    fn an_alias_is_there_when_what_it_runs_is_and_a_function_always_is() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("home");
        let bin = scratch.path().join("bin");
        program(&bin, "real", 0o755);
        program(&home.join("tools"), "mine", 0o755);
        let gone_path = scratch.path().join("gone/agent");
        let here = bin.join("real");
        let at = |value: &str| value.to_string();
        let report = said(
            &[&bin],
            &["fn"],
            &[
                (
                    "live",
                    &at(&format!("FOO=1 command {} --x", here.display())),
                ),
                ("dead", &at(&format!("{} --x", gone_path.display()))),
                ("bare", &at("real --x")),
                ("lost", &at("nothing-here --x")),
                ("quoted", &at(&format!("'{}' -y", here.display()))),
                ("tilde", &at("~/tools/mine")),
                ("unknowable", &at("$HOME/bin/x")),
                ("chained", &at("live")),
                // It wraps the command it replaces, which isn't on this PATH.
                ("wrap", &at("wrap --model opus")),
                ("modified", &at("noglob real --x")),
                ("modifier_only", &at("noglob gone-too --x")),
                ("tofn", &at("myfn --x")),
                ("tobuiltin", &at(": --x")),
            ],
        );
        // What the shell calls a program word of an alias, for the ones a PATH walk can't tell.
        let mut report = report;
        report
            .alias_words
            .insert("tobuiltin".into(), (":".into(), "builtin".into()));
        report
            .alias_words
            .insert("tofn".into(), ("myfn".into(), "function".into()));
        let all = names(&[
            "fn",
            "live",
            "dead",
            "bare",
            "lost",
            "quoted",
            "tilde",
            "unknowable",
            "chained",
            "wrap",
            "modified",
            "modifier_only",
            "tofn",
            "tobuiltin",
        ]);

        assert_eq!(
            missing(&home, &all, &report),
            ["dead", "lost", "wrap", "modifier_only"]
        );
    }

    /// What the shell said about the program word, in the shapes aliases take.
    #[test]
    fn the_first_word_of_an_alias_is_the_program() {
        let word = |text: &str| first_word(text);
        assert_eq!(word("claude --model opus"), Some("claude".into()));
        assert_eq!(word("A=1 B='x y' command claude"), Some("claude".into()));
        assert_eq!(word("builtin command  /a/b"), Some("/a/b".into()));
        assert_eq!(word("\"/a b/c\" d"), Some("/a b/c".into()));
        assert_eq!(word("a\\ b c"), Some("a b".into()));
        assert_eq!(
            word("noglob nocorrect exec time claude"),
            Some("claude".into())
        );
        assert_eq!(word("X=1"), None);
        assert_eq!(word("  "), None);
    }

    /// An agent an editor's extension carries is there for the window, the CLI and rpc alike, hook
    /// on or off; one whose extension isn't installed anywhere is not.
    #[test]
    fn an_agent_an_editors_extension_carries_is_there() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path();
        let offered = offered(home);
        let hook = offered
            .hooks
            .get("claude")
            .expect("claude has an editor hook");
        let still_missing = || {
            let mut missing = names(&["claude", "copilot"]);
            without_the_carried(home, &offered, &mut missing);
            missing
        };
        assert_eq!(still_missing(), ["claude", "copilot"]);

        let extension = format!("{}-2.1.0-darwin-arm64", hook.extension);
        fs::create_dir_all(Editor::Code.extensions_dir(home).join(extension)).unwrap();
        assert_eq!(still_missing(), ["copilot"]);
    }

    /// What a new terminal has to run is what its startup files and prompt hooks make of it: a
    /// program on the PATH they build, or an alias or function, wherever the machine's default
    /// shell reads them. The agents are made-up ones the config names, so nothing on the machine
    /// running the test can be mistaken for them. Asked of the login shell and of bash too: on a
    /// Mac that is `/bin/bash`, 3.2, which has no `BASH_ALIASES` and is the stock login shell of
    /// some users, but never the one a zsh developer's machine would run.
    #[test]
    fn the_probe_reads_the_path_and_the_aliases_the_startup_files_build() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("home");
        let bin = scratch.path().join("bin");
        program(&bin, "fakeagent121", 0o755);
        let mut saved = ConfigState::default();
        for name in [
            "fakeagent121",
            "liveagent121",
            "deadagent121",
            "fnagent121",
            "noglobagent121",
            "tofnagent121",
            "tobuiltinagent121",
            "ghostagent121",
        ] {
            saved
                .agents
                .insert(name.into(), config::AgentDef::default());
        }
        config::write_atomic(
            &paths::config_file(&home),
            serde_json::to_vec(&saved).unwrap(),
        )
        .unwrap();
        fs::create_dir_all(home.join(".config/fish")).unwrap();
        // The folder comes only from a prompt hook, as mise and direnv add theirs: a PATH read
        // before the hooks run (as `-c` alone does) wouldn't hold it.
        let gone = scratch.path().join("gone/agent");
        let posix = format!(
            "precmd() {{ export PATH=\"{bin}:$PATH\"; }}\nPROMPT_COMMAND='export PATH=\"{bin}:$PATH\"'\nalias liveagent121='FOO=1 command {bin}/fakeagent121 --x'\nalias deadagent121='{gone} --x'\nfnagent121() {{ :; }}\nalias noglobagent121='noglob {bin}/fakeagent121 --x'\nalias tofnagent121='wrapfn121 --x'\nwrapfn121() {{ :; }}\nalias tobuiltinagent121=': x'\n",
            bin = bin.display(),
            gone = gone.display()
        );
        for file in [".zshenv", ".bash_profile", ".bashrc", ".profile"] {
            fs::write(home.join(file), &posix).unwrap();
        }
        fs::write(
            home.join(".config/fish/config.fish"),
            format!(
                "function __hook --on-event fish_prompt; set -gx PATH {bin} $PATH; end\nalias liveagent121 '{bin}/fakeagent121 --x'\nalias deadagent121 '{gone} --x'\nfunction fnagent121; end\nalias noglobagent121 '{bin}/fakeagent121 --x'\nalias tofnagent121 'wrapfn121 --x'\nfunction wrapfn121; end\nalias tobuiltinagent121 ': x'\n",
                bin = bin.display(),
                gone = gone.display()
            ),
        )
        .unwrap();

        let mut shells = vec![shell::login_shell_kind()];
        if !shells.contains(&Shell::Bash) {
            shells.push(Shell::Bash);
        }
        for shell in shells {
            let offered = offered(&home);
            let report = shell::login_shell_report_as(shell, &home, &offered.commands).unwrap();
            let gone_agents = missing(&home, &offered.commands, &report);
            let is_missing = |name: &str| gone_agents.contains(&name.to_string());
            let said = |what: &str| format!("{} {what}: {gone_agents:?}", shell.name());
            assert!(is_missing("ghostagent121"), "{}", said("ghost"));
            assert!(!is_missing("fakeagent121"), "{}", said("fake"));
            assert!(!is_missing("liveagent121"), "{}", said("live"));
            assert!(!is_missing("fnagent121"), "{}", said("fn"));
            // Past a modifier, and to a function or a builtin of the shell's, which no PATH holds.
            for name in ["noglobagent121", "tofnagent121", "tobuiltinagent121"] {
                assert!(!is_missing(name), "{}", said(name));
            }
            // fish's aliases are functions, which can't be seen through.
            assert_eq!(
                is_missing("deadagent121"),
                shell != Shell::Fish,
                "{}",
                said("dead")
            );
        }
    }

    /// The offered agents are the registry's plus any the config names; a config that can't be
    /// read leaves the registry's.
    #[test]
    fn the_commands_are_the_registrys_and_the_configs() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path();
        let registry = offered(home).commands;
        assert!(registry.contains(&"claude".to_string()));
        assert!(!home.join(".envrouter").exists(), "asking creates nothing");

        let mut saved = ConfigState::default();
        saved
            .agents
            .insert("mine".into(), config::AgentDef::default());
        let both = offered_by(saved).commands;
        assert!(both.contains(&"mine".to_string()) && both.contains(&"claude".to_string()));

        fs::create_dir_all(paths::root(home)).unwrap();
        fs::write(paths::config_file(home), "{ not json").unwrap();
        assert_eq!(offered(home).commands, registry);
    }
}
