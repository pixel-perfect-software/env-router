//! Puts the shims directory first on PATH in the user's shells, through a marked block at
//! the end of each startup file, and checks the result in a real shell.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{ErrorKind, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::platform::{self, Platform};
use envrouter_core::programs::is_executable;
use envrouter_core::{mcp, paths, resolve, Error, Result, EXIT_TOOL_NOT_FOUND};
use serde::{Deserialize, Serialize};

use crate::uninstall;

const BEGIN: &str = "# >>> envrouter >>>";
const END: &str = "# <<< envrouter <<<";
const NOTE: &str =
    "# Added by EnvRouter: puts its shims first on PATH. Keep this at the end of the file.";

/// POSIX sh, so it's safe in `.profile` too. It removes any existing copies of the shims
/// directory before prepending it. A nested shell whose startup files prepend another
/// directory (say `~/.local/bin`) would otherwise leave the real tool ahead of the shim.
const POSIX_BODY: &str = r#"__envrouter_shims="$HOME/.envrouter/shims"
__envrouter_rest=":$PATH:"
while :; do
  case "$__envrouter_rest" in
    *":$__envrouter_shims:"*) __envrouter_rest="${__envrouter_rest%%":$__envrouter_shims:"*}:${__envrouter_rest#*":$__envrouter_shims:"}" ;;
    *) break ;;
  esac
done
__envrouter_rest="${__envrouter_rest#:}"
__envrouter_rest="${__envrouter_rest%:}"
PATH="$__envrouter_shims${__envrouter_rest:+:$__envrouter_rest}"
export PATH
unset __envrouter_shims __envrouter_rest"#;

// fish_add_path skips directories that don't exist, so `set_integration` creates it first.
const FISH_BODY: &str = "fish_add_path --global --move --path $HOME/.envrouter/shims";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Shell {
    Zsh,
    Bash,
    Fish,
}

impl Shell {
    pub const ALL: [Shell; 3] = [Shell::Zsh, Shell::Bash, Shell::Fish];

    /// The shell called `name` (`zsh`, `bash`, `fish`), if it's one EnvRouter handles.
    pub fn from_name(name: &str) -> Option<Shell> {
        Shell::ALL.into_iter().find(|shell| shell.name() == name)
    }

    pub fn name(self) -> &'static str {
        match self {
            Shell::Zsh => "zsh",
            Shell::Bash => "bash",
            Shell::Fish => "fish",
        }
    }

    /// The installed binary. The app may be launched with a minimal PATH (from Finder, or a
    /// `.desktop` file), so this looks at the login shell, then in `/etc/shells`, where
    /// Homebrew users register shells like fish, and then the usual install locations. The
    /// login shell comes first because Homebrew lists its bash after `/bin/bash`, and a check
    /// should run the bash a terminal does.
    pub fn binary(self) -> Option<PathBuf> {
        let listed = fs::read_to_string("/etc/shells").unwrap_or_default();
        login_shell()
            .into_iter()
            .chain(
                listed
                    .lines()
                    .map(str::trim)
                    .filter(|line| line.starts_with('/'))
                    .map(PathBuf::from),
            )
            .chain(
                [
                    "/bin",
                    "/usr/bin",
                    "/opt/homebrew/bin",
                    "/usr/local/bin",
                    "/home/linuxbrew/.linuxbrew/bin",
                ]
                .iter()
                .map(|dir| Path::new(dir).join(self.name())),
            )
            .find(|path| path.file_name().is_some_and(|n| n == self.name()) && path.is_file())
    }

    /// The files that get the block.
    pub fn startup_files(self, home: &Path) -> Vec<PathBuf> {
        match self {
            Shell::Zsh => vec![zsh_dotdir(home).join(".zshrc")],
            Shell::Bash => bash_startup_files(Platform::current(), home),
            Shell::Fish => vec![platform::xdg_config_home(home).join("fish/config.fish")],
        }
    }

    /// Every file any shell's block could be in, whether or not `startup_files` picks it now:
    /// which of bash's login files it picks depends on which exist, and zsh's folder on
    /// `ZDOTDIR`, and either may have changed since the block went in. Independent of which
    /// shells are installed.
    pub fn every_startup_file(home: &Path) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = Vec::new();
        for file in [
            zsh_dotdir(home).join(".zshrc"),
            home.join(".zshrc"),
            home.join(".bashrc"),
            home.join(".bash_profile"),
            home.join(".bash_login"),
            home.join(".profile"),
            platform::xdg_config_home(home).join("fish/config.fish"),
            home.join(".config/fish/config.fish"),
        ] {
            if !files.contains(&file) {
                files.push(file);
            }
        }
        files
    }

    fn block(self) -> String {
        let body = match self {
            Shell::Zsh | Shell::Bash => POSIX_BODY,
            Shell::Fish => FISH_BODY,
        };
        format!("{BEGIN}\n{NOTE}\n{body}\n{END}\n")
    }

    /// The commands, in this shell's syntax, that run its prompt hooks once as drawing the first
    /// prompt would (mise and direnv change PATH there). Hook output is discarded: a terminal
    /// title has no newline and would run into the next line. `cd` runs zsh's chpwd hooks; each
    /// prompt runs precmd's. PROMPT_COMMAND is a string, or an array from bash 5.1; `[@]` reads
    /// both. Prompt hooks in fish are `--on-event fish_prompt` functions. Both a folder check and
    /// the login PATH ([`login_shell_report`]) run these, so their answers agree.
    fn prompt_hooks(self) -> &'static str {
        match self {
            Shell::Zsh => {
                r"for __envrouter_hook in chpwd $chpwd_functions precmd $precmd_functions; do (( $+functions[$__envrouter_hook] )) && $__envrouter_hook >/dev/null; done"
            }
            Shell::Bash => {
                r#"for __envrouter_hook in "${PROMPT_COMMAND[@]}"; do eval "$__envrouter_hook" >/dev/null; done"#
            }
            Shell::Fish => "emit fish_prompt >/dev/null",
        }
    }

    /// One command, in this shell's syntax, that prints the PATH the startup files left, runs
    /// the prompt hooks once, then prints how `tool` resolves and the PATH.
    /// `tool` has passed `is_command_name`, so it's safe to interpolate.
    fn probe(self, tool: &str) -> String {
        let hooks = self.prompt_hooks();
        match self {
            // `whence -v` names the file a function came from: "claude is a shell function
            // from /Users/me/.zshrc". A zsh probe runs as a script file, not with `-c` (see
            // `start`): only a script's commands run at the shell's top level, and direnv's hook
            // does nothing elsewhere.
            Shell::Zsh => format!(
                "print -r -- \"{STARTUP_PATH}$PATH\"; {hooks}; print -r -- \"{KIND}$(whence -w -- {tool})\"; print -r -- \"{ORIGIN}$(whence -v -- {tool})\"; print -r -- \"{ALIAS}${{aliases[{tool}]}}\"; print -r -- \"{PATH_MARK}$PATH\""
            ),
            // With extdebug, `declare -F` prints "claude 12 /Users/me/.bashrc".
            Shell::Bash => format!(
                "printf '%s\\n' \"{STARTUP_PATH}$PATH\"; {hooks}; printf '%s\\n' \"{KIND}$(type -t -- {tool})\" \"{ORIGIN}$(shopt -s extdebug; declare -F -- {tool} 2>/dev/null)\" \"{ALIAS}$(alias -- {tool} 2>/dev/null)\" \"{PATH_MARK}$PATH\""
            ),
            // An empty command substitution would drop the whole argument in fish, so each
            // value goes through a variable.
            Shell::Fish => format!(
                "set -l startup (string join : $PATH); {hooks}; set -l kind (type -t {tool} 2>/dev/null); set -l origin (functions --details {tool} 2>/dev/null); printf '%s\\n' \"{STARTUP_PATH}$startup\" \"{KIND}$kind\" \"{ORIGIN}$origin\" \"{PATH_MARK}\"(string join : $PATH)"
            ),
        }
    }

    /// Starts this shell the way a new terminal window does, in `cwd`, to run `script`, and waits
    /// for it up to 15 seconds. Not in the app's environment: launched from a terminal (as in
    /// development), its PATH may already contain the shims.
    fn start(self, home: &Path, cwd: &Path, script: &str) -> Result<Finished> {
        let binary = self
            .binary()
            .ok_or_else(|| Error::Invalid(format!("{} isn't installed.", self.name())))?;
        let mut command = Command::new(binary);
        command.args(terminal_flags(Platform::current()));
        // zsh reads the script from a file (see `probe`), which lives until the shell exits.
        let _file = match self {
            Shell::Zsh => {
                let temp_err = |err| Error::Command(format!("temp file: {err}"));
                let mut file = tempfile::NamedTempFile::new().map_err(temp_err)?;
                file.write_all(script.as_bytes()).map_err(temp_err)?;
                command.arg(file.path());
                Some(file)
            }
            Shell::Bash | Shell::Fish => {
                command.args(["-c", script]);
                None
            }
        };
        command.current_dir(cwd);
        fresh_env(&mut command, home);
        run(command, Duration::from_secs(15))
    }

    /// What an alias named `tool` expands to, from the probe's alias line: zsh prints the
    /// text, bash its definition (`alias claude='claude --model opus'`). fish's aliases are
    /// functions, which a check can't see through.
    fn alias_expansion(self, line: &str, tool: &str) -> Option<String> {
        match self {
            Shell::Zsh => Some(line.to_string()),
            Shell::Bash => unquote(line.strip_prefix(&format!("alias {tool}="))?),
            Shell::Fish => None,
        }
        .filter(|expansion| !expansion.is_empty())
    }

    /// The file named in this shell's origin line, if it names one.
    fn origin_file(self, line: &str) -> Option<String> {
        let path = match self {
            Shell::Zsh => line.rsplit_once(" from ")?.1,
            Shell::Bash => line.splitn(3, ' ').nth(2)?,
            Shell::Fish => line,
        };
        path.starts_with('/').then(|| path.trim().to_string())
    }
}

/// Where zsh reads `.zshrc` from: `$ZDOTDIR` if `/etc/zshenv` or `~/.zshenv` sets it,
/// otherwise home. Asked of zsh itself in a fresh environment, because the app's own
/// environment says nothing about a new terminal's. When launched from a terminal, it may
/// carry a ZDOTDIR that a new window wouldn't have.
fn zsh_dotdir(home: &Path) -> PathBuf {
    let probe = Shell::Zsh.binary().and_then(|zsh| {
        let mut command = Command::new(zsh);
        command.args([
            "-c",
            &format!("print -r -- \"{ZDOTDIR_MARK}${{ZDOTDIR:-$HOME}}\""),
        ]);
        fresh_env(&mut command, home);
        run(command, Duration::from_secs(5)).ok()
    });
    // `.zshenv` may print something of its own, so the answer is the marked line.
    probe
        .filter(|output| output.success)
        .and_then(|output| {
            output
                .stdout
                .lines()
                .rev()
                .find_map(|line| line.split_once(ZDOTDIR_MARK))
                .map(|(_, dir)| dir.trim().to_string())
        })
        .filter(|dir| dir.starts_with('/'))
        .map_or_else(|| home.to_path_buf(), PathBuf::from)
}

/// The files a new terminal's bash reads, which depends on whether it's a login shell.
///
/// - A login shell (Terminal on macOS, WSL) reads only the first of `.bash_profile`,
///   `.bash_login` and `.profile` that exists; `.bashrc` covers non-login shells, like `bash`
///   typed at a prompt. With none of them, macOS gets `.bash_profile`; Linux gets `.profile`,
///   because a new `.bash_profile` would hide the `.profile` a distro sources `.bashrc` from
///   when one turns up later.
/// - A Linux desktop terminal's bash isn't a login shell and reads only `.bashrc`. Distros'
///   login files source it, so SSH logins get the block too.
fn bash_startup_files(platform: Platform, home: &Path) -> Vec<PathBuf> {
    let rc = home.join(".bashrc");
    if !platform.terminal_starts_login_shell() {
        return vec![rc];
    }
    let fallback = if platform == Platform::MacOs {
        ".bash_profile"
    } else {
        ".profile"
    };
    let login = [".bash_profile", ".bash_login", ".profile"]
        .iter()
        .map(|name| home.join(name))
        .find(|path| path.exists())
        .unwrap_or_else(|| home.join(fallback));
    if rc.exists() {
        vec![login, rc]
    } else {
        vec![login]
    }
}

/// The user's login shell: `$SHELL`, or on Linux the account database when an app started from
/// a `.desktop` file has no `$SHELL`.
fn login_shell() -> Option<PathBuf> {
    std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let user = std::env::var("USER")
                .or_else(|_| std::env::var("LOGNAME"))
                .unwrap_or_default();
            platform::login_shell_from_account(&user)
        })
}

/// The flags that start a shell the way a new terminal window does: interactive, and a login
/// shell where terminals start one.
fn terminal_flags(platform: Platform) -> &'static [&'static str] {
    if platform.terminal_starts_login_shell() {
        &["-l", "-i"]
    } else {
        &["-i"]
    }
}

/// The environment a new terminal window starts from, before any startup file runs: the basics,
/// the session's variables where a desktop session passes them on, and the PATH the platform's
/// terminals start with.
fn fresh_env(command: &mut Command, home: &Path) {
    let platform = Platform::current();
    let session = platform::session_vars(platform);
    let inherited = std::env::var("PATH").unwrap_or_default();
    command
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            let key = key.to_string_lossy();
            ["USER", "LOGNAME", "SHELL", "TMPDIR", "LANG"].contains(&key.as_ref())
                || key.starts_with("LC_")
                || session.contains(&key.as_ref())
        }))
        .env("HOME", home)
        .env("PATH", platform::new_terminal_path(platform, &inherited))
        .env("TERM", "xterm-256color");
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellStatus {
    pub shell: Shell,
    pub available: bool,
    pub is_default: bool,
    pub installed: bool,
    pub startup_files: Vec<String>,
}

pub fn status(shell: Shell, home: &Path) -> ShellStatus {
    let files = shell.startup_files(home);
    // A whole block, not just its first line: a BEGIN that lost its END runs nothing.
    let installed = files
        .iter()
        .all(|file| fs::read_to_string(file).is_ok_and(|text| block_range(&text).is_some()));
    let is_default =
        login_shell().is_some_and(|login| login.file_name().is_some_and(|n| n == shell.name()));
    ShellStatus {
        shell,
        available: shell.binary().is_some(),
        is_default,
        installed,
        startup_files: files.iter().map(|f| f.display().to_string()).collect(),
    }
}

/// Adds or removes the block in each of the shell's startup files.
pub fn set_integration(shell: Shell, home: &Path, enabled: bool) -> Result<ShellStatus> {
    if enabled {
        let shims = paths::shims(home);
        fs::create_dir_all(&shims).map_err(|source| Error::Io {
            path: shims,
            source,
        })?;
    }
    for file in shell.startup_files(home) {
        let Some(file) = config::write_target(&file) else {
            if !enabled {
                continue; // No block to remove from a file that isn't there.
            }
            return Err(Error::Invalid(format!(
                "{} links to a file that doesn't exist. Fix the link, then turn {} on again.",
                file.display(),
                shell.name()
            )));
        };
        let current = match fs::read_to_string(&file) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(source) => return Err(Error::Io { path: file, source }),
        };
        let updated = if enabled {
            upsert_block(&current, &shell.block())
        } else {
            remove_block(&current)
        };
        if updated != current {
            config::write_atomic(&file, updated)?;
        }
    }
    Ok(status(shell, home))
}

/// Takes EnvRouter's block out of every startup file that has one: the files, and what stopped
/// it for the others. A file is written only when it held a block, through a link the way a
/// turn-off does; a missing file, a link to nothing and a file that isn't text are skipped, and
/// nothing is created. `dry_run` writes nothing and lists the files it would change.
pub fn remove_every_block(home: &Path, dry_run: bool) -> (Vec<PathBuf>, Vec<String>) {
    let mut cleared = Vec::new();
    let mut problems = Vec::new();
    for file in Shell::every_startup_file(home) {
        let Some(target) = config::write_target(&file) else {
            continue;
        };
        let text = match fs::read_to_string(&target) {
            Ok(text) => text,
            Err(err) if matches!(err.kind(), ErrorKind::NotFound | ErrorKind::InvalidData) => {
                continue
            }
            Err(err) => {
                problems.push(uninstall::cant_remove_lines(&file, &err.to_string()));
                continue;
            }
        };
        let updated = remove_block(&text);
        if updated == text {
            continue;
        }
        if !dry_run {
            if let Err(err) = config::write_atomic(&target, updated) {
                problems.push(uninstall::cant_remove_lines(
                    &file,
                    &uninstall::reason(&err),
                ));
                continue;
            }
        }
        cleared.push(file);
    }
    (cleared, problems)
}

/// Replaces the block where it is (the user may have moved it on purpose), or appends it.
fn upsert_block(text: &str, block: &str) -> String {
    match block_range(text) {
        Some((start, end)) => format!("{}{block}{}", &text[..start], &text[end..]),
        None if text.is_empty() => block.to_string(),
        None => {
            let newline = if text.ends_with('\n') { "" } else { "\n" };
            format!("{text}{newline}\n{block}")
        }
    }
}

/// Removes every block (a pasted copy would otherwise keep routing on), each with the blank
/// line `upsert_block` put before it.
fn remove_block(text: &str) -> String {
    let mut text = text.to_string();
    while let Some((start, end)) = block_range(&text) {
        let before = &text[..start];
        let before = before
            .strip_suffix("\n\n")
            .map_or(before, |b| &before[..=b.len()]);
        text = format!("{before}{}", &text[end..]);
    }
    text
}

/// Whether a whole block is in any of the usual startup files directly under `home`, by reading
/// them: no shell is asked, unlike [`status`], which asks zsh where its folder is. A `ZDOTDIR`
/// elsewhere isn't looked in, so this can say no where `status` says yes.
pub fn block_in_home_files(home: &Path) -> bool {
    [
        ".zshrc",
        ".bashrc",
        ".bash_profile",
        ".bash_login",
        ".profile",
        ".config/fish/config.fish",
    ]
    .iter()
    .any(|file| fs::read_to_string(home.join(file)).is_ok_and(|text| block_range(&text).is_some()))
}

/// Byte range of the block, from the start of the BEGIN line through the END line's newline.
/// The range starts at the last BEGIN before the END: if an earlier block lost its END line,
/// the user's own lines between that orphan and a later block must never be taken for ours.
fn block_range(text: &str) -> Option<(usize, usize)> {
    let mut offset = 0;
    let mut start = None;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == BEGIN {
            start = Some(offset);
        } else if trimmed == END {
            if let Some(start) = start {
                return Some((start, offset + line.len()));
            }
        }
        offset += line.len();
    }
    None
}

const KIND: &str = "__ENVROUTER_KIND__=";
const PATH_MARK: &str = "__ENVROUTER_PATH__=";
const ORIGIN: &str = "__ENVROUTER_ORIGIN__=";
/// What an alias with the tool's name expands to.
const ALIAS: &str = "__ENVROUTER_ALIAS__=";
/// PATH as the startup files left it, before any prompt hook ran.
const STARTUP_PATH: &str = "__ENVROUTER_STARTUP_PATH__=";
/// The kind of the program word an alias starts with, in the login report's run.
const WORD: &str = "__ENVROUTER_WORD__=";
const ZDOTDIR_MARK: &str = "__ENVROUTER_ZDOTDIR__=";

/// What running `tool` in `folder` would do in a fresh terminal window.
#[derive(Debug, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FolderCheck {
    /// The shim runs. It reported the profile and variable it would apply.
    Routed {
        profile: Option<String>,
        /// The profile's id: names aren't unique, ids are.
        profile_id: Option<String>,
        env_var: Option<String>,
        value: Option<String>,
        /// The MCP servers the run gets, if every secret they need is readable.
        mcp: Vec<String>,
        /// A file that turns the profile's MCP servers off on this machine, such as Claude
        /// Code's enterprise `managed-mcp.json`. `mcp` is empty then.
        mcp_managed_by: Option<String>,
        /// The run goes through an alias with the tool's name that runs the tool itself, as
        /// `alias claude='claude --model opus'` does: what it expands to.
        via_alias: Option<String>,
        real: String,
    },
    /// An alias or function with the tool's name runs instead of anything on PATH.
    ShadowedByShell {
        kind: String,
        /// The startup file that defines it, when the shell can say (functions, not aliases).
        origin: Option<String>,
    },
    /// Another `tool` is found before the shim: it's earlier on PATH than the shims
    /// directory, or the shims directory isn't on PATH at all (the integration is off).
    ShadowedOnPath {
        path: String,
        /// The startup files left the shim first, and a prompt hook (mise, direnv) moved
        /// this ahead of it. Where the block sits in the file doesn't matter then.
        by_prompt_hook: bool,
    },
    /// Nothing named `tool` is on PATH: no shim and no real tool.
    NotFound,
    /// The shim is first on PATH, but there's no real `tool` after it to run.
    NotInstalled,
    /// The shim is first on PATH but couldn't report a route.
    ShimFailed { message: String },
}

/// What a new terminal's shell said about itself, from one run.
#[derive(Clone, Debug, PartialEq)]
pub struct LoginReport {
    /// The PATH after its startup files and prompt hooks.
    pub path: String,
    /// Which of the commands asked about (`login_shell_report`) it runs a function for. What a
    /// function runs can't be known without running it, so a caller takes one as there. An alias
    /// whose value the shell wouldn't give is counted here too, since nothing says it isn't.
    pub functions: Vec<String>,
    /// Which it runs an alias for, and what the alias says (`alias claude='FOO=1 claude --x'`),
    /// so a caller can see whether what it runs is there. zsh and bash only: fish's aliases are
    /// functions, which a check can't see through.
    pub aliases: BTreeMap<String, String>,
    /// For each alias, the program word it starts with and what the shell calls it (`builtin`,
    /// `function`, `command`, `none`…), so an alias to a builtin or to a function of the user's
    /// counts without a program of that name. Empty where the shell can't say (bash before 4).
    pub alias_words: BTreeMap<String, (String, String)>,
}

/// The words an alias may start with that aren't its program: a `VAR=value` assignment is
/// matched on its own. What follows them is what the alias runs.
pub const ALIAS_PREFIXES: [&str; 7] = [
    "command",
    "builtin",
    "noglob",
    "nocorrect",
    "exec",
    "time",
    "-",
];

/// What [`login_shell_report`] last found for a home, and whether a run is under way.
#[derive(Default)]
struct Slot {
    running: bool,
    /// Counts the runs that have ended, so one waiting for the run under way can tell it from
    /// another wake-up (the condition variable serves every home, and may wake with nothing new).
    ended: u64,
    kept: Option<Kept>,
}

struct Kept {
    shell: Shell,
    /// The commands the run was asked about.
    commands: Vec<String>,
    /// The report, or why there isn't one (kept as it was, kind and all).
    outcome: Result<LoginReport>,
    at: Instant,
}

/// By home, so a scratch home in a test never meets another's (or the real one's) answer.
static LOGIN_REPORTS: Mutex<BTreeMap<PathBuf, Slot>> = Mutex::new(BTreeMap::new());
/// Told when a run under way finishes, for whoever is waiting to share it.
static LOGIN_REPORT_DONE: Condvar = Condvar::new();

/// How long a login shell's answer is believed. Running it runs every startup file the user has
/// (version managers, prompt themes, update checks), and the window asks whenever it gains focus,
/// so it can't be asked each time; but its answer changes only when someone edits a startup file
/// or something a startup file sources (`nvm alias`, `~/.cargo/env`), which no list of files can
/// follow. Three minutes: a window switched back to a few times in a sitting costs one run, and
/// someone who installs an agent that adds its folder to a startup file sees it in the window
/// within a coffee. A program that lands in a folder already on PATH shows at once: the walk along
/// PATH is done afresh each time. A server check asks for a PATH no older than [`LOGIN_PATH_FOR_A_CHECK`].
const LOGIN_REPORT_TTL: Duration = Duration::from_secs(180);

/// How long a failed ask (a shell that hung to its timeout, say) is believed, so a window that
/// refocuses doesn't start a hanging shell back to back.
pub(crate) const LOGIN_REPORT_FAILURE_TTL: Duration = Duration::from_secs(60);

/// The PATH a new terminal window gets from the user's shell, after its startup files and prompt
/// hooks, as it was kept (see [`login_shell_report`]) or asked for now. An app opened from Finder
/// or a `.desktop` file may have a bare PATH, so MCP server checks start `npx` and the like with
/// this one.
pub fn login_path(home: &Path) -> Result<String> {
    login_shell_report(home, &[]).map(|report| report.path)
}

/// How old the PATH a server check starts its server with may be. A check is something the user
/// asked for, so it doesn't take a PATH from minutes ago, but a few checks in a row (trying a
/// server, fixing its command, trying again) needn't each run every startup file.
pub const LOGIN_PATH_FOR_A_CHECK: Duration = Duration::from_secs(30);

/// [`login_path`], but run again if what is kept is older than `max_age`, for the commands it
/// was kept for as well, so the agents' answer isn't lost to it.
pub fn login_path_recent(home: &Path, max_age: Duration) -> Result<String> {
    report_of(home, &[], Some(max_age)).map(|report| report.path)
}

/// One run of the user's login shell the way a new terminal starts it: its PATH, and for each of
/// `commands` whether it's a function or an alias there. Kept per home (see
/// [`LOGIN_REPORT_TTL`]); an ask about a command the kept run wasn't asked about runs again,
/// about those and the kept ones.
pub fn login_shell_report(home: &Path, commands: &[String]) -> Result<LoginReport> {
    report_of(home, commands, None)
}

fn report_of(
    home: &Path,
    commands: &[String],
    newer_than: Option<Duration>,
) -> Result<LoginReport> {
    let shell = login_shell_kind();
    cached_report(
        home,
        shell,
        commands,
        (LOGIN_REPORT_TTL, LOGIN_REPORT_FAILURE_TTL),
        newer_than,
        |commands| ask_login_shell(shell, home, commands),
    )
}

/// The cache around the question. `ask` is given the commands to ask about, `commands` and the
/// ones kept; it runs when nothing believed answers for `commands`:
/// - a success is believed for the first TTL, when the kept run was asked about all of `commands`
///   and, if `newer_than` is given, is younger than that;
/// - a failure is believed for the second TTL whatever `commands` are (a shell that just hung
///   isn't started again for a longer list), unless `newer_than` is given: that is a click, and it
///   may retry.
///
/// Only one run is under way for a home: whoever asks meanwhile waits for it to end, then looks
/// at what it found as any ask would. The cache isn't locked while the shell runs.
fn cached_report(
    home: &Path,
    shell: Shell,
    commands: &[String],
    (ttl, failure_ttl): (Duration, Duration),
    newer_than: Option<Duration>,
    ask: impl FnOnce(&[String]) -> Result<LoginReport>,
) -> Result<LoginReport> {
    let commands: Vec<String> = commands
        .iter()
        .filter(|command| config::is_command_name(command))
        .cloned()
        .collect();
    // The run this ask is waiting for the end of, if it is waiting.
    let mut waiting_for: Option<u64> = None;
    let mut cache = LOGIN_REPORTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let asked = loop {
        let slot = cache.entry(home.to_path_buf()).or_default();
        if let Some(ended) = waiting_for.take() {
            if slot.running && slot.ended == ended {
                waiting_for = Some(ended);
                cache = LOGIN_REPORT_DONE
                    .wait(cache)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                continue;
            }
        }
        if let Some(kept) = &slot.kept {
            let age = kept.at.elapsed();
            let believed = kept.shell == shell
                && match &kept.outcome {
                    Ok(_) => {
                        age < ttl
                            && commands.iter().all(|c| kept.commands.contains(c))
                            && newer_than.is_none_or(|max| age < max)
                    }
                    Err(_) => age < failure_ttl && newer_than.is_none(),
                };
            if believed {
                return clone_outcome(&kept.outcome);
            }
        }
        if slot.running {
            waiting_for = Some(slot.ended);
            continue;
        }
        slot.running = true;
        let mut all = slot
            .kept
            .as_ref()
            .map_or_else(Vec::new, |kept| kept.commands.clone());
        for command in &commands {
            if !all.contains(command) {
                all.push(command.clone());
            }
        }
        break all;
    };
    drop(cache);
    // However the run ends, a panic included, whoever waits for it is let go.
    let finish = RunDone(home);
    let outcome = ask(&asked);
    let result = clone_outcome(&outcome);
    finish.with(Kept {
        shell,
        commands: asked,
        outcome,
        at: Instant::now(),
    });
    result
}

fn clone_outcome(outcome: &Result<LoginReport>) -> Result<LoginReport> {
    match outcome {
        Ok(report) => Ok(report.clone()),
        Err(err) => Err(err.replay()),
    }
}

/// Ends a run in `LOGIN_REPORTS`: puts what it found (if anything) in its slot, and frees it.
struct RunDone<'a>(&'a Path);

impl RunDone<'_> {
    fn with(self, kept: Kept) {
        self.end(Some(kept));
    }

    fn end(&self, kept: Option<Kept>) {
        let mut cache = LOGIN_REPORTS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let slot = cache.entry(self.0.to_path_buf()).or_default();
        slot.running = false;
        slot.ended += 1;
        if kept.is_some() {
            slot.kept = kept;
        }
        LOGIN_REPORT_DONE.notify_all();
    }
}

impl Drop for RunDone<'_> {
    fn drop(&mut self) {
        // Reached with nothing found only when the run panicked before `with`.
        if std::thread::panicking() {
            self.end(None);
        }
    }
}

/// Whether the shell a new terminal runs is fish, whose aliases are functions. For tests that
/// have to expect what the machine's own shell makes of an alias.
#[cfg(test)]
pub(crate) fn login_shell_kind_is_fish() -> bool {
    login_shell_kind() == Shell::Fish
}

/// The shell a new terminal window runs: the user's login shell, else the platform's usual one.
fn login_shell_kind() -> Shell {
    login_shell()
        .and_then(|login| {
            login
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(Shell::from_name)
        })
        .or_else(|| Shell::from_name(Platform::current().default_shell_name()))
        .unwrap_or(Shell::Bash)
}

/// Runs `shell` as a new terminal does, prompt hooks included (as `check_folder` runs them, or
/// a mise or direnv PATH would read differently here), and reports its PATH and how each of
/// `commands` resolves. `commands` have passed `is_command_name`, so they're safe to put in a
/// script.
fn ask_login_shell(shell: Shell, home: &Path, commands: &[String]) -> Result<LoginReport> {
    let list = commands.join(" ");
    let hooks = shell.prompt_hooks();
    // The words an alias may start with that aren't the program (`FOO=1`, `noglob`), as a `case`
    // pattern: what the shell then calls the first word is the program, whose kind is asked too.
    let skipped = ALIAS_PREFIXES.join("|");
    // Per command, in order: "<command>: <kind>" as the shell words it (`whence -w`, `type -t`);
    // for zsh and bash what an alias says, in the form `Shell::alias_expansion` reads; and for an
    // alias the kind of its program word ("<command> <word>: <kind>"): zsh splits the value as
    // the shell would (`(z)`), bash by blanks, from `BASH_ALIASES` (4.0 and later).
    let script = match shell {
        Shell::Fish => format!(
            "{hooks}; printf '%s\\n' \"{PATH_MARK}\"(string join : $PATH); for __c in {list}; set -l __k (type -t $__c 2>/dev/null); printf '%s\\n' \"{KIND}$__c: $__k\"; end"
        ),
        Shell::Zsh => format!(
            "{hooks}; print -r -- \"{PATH_MARK}$PATH\"; for __c in {list}; do print -r -- \"{KIND}$(whence -w -- $__c)\"; print -r -- \"{ALIAS}${{aliases[$__c]}}\"; for __w in ${{(z)aliases[$__c]}}; do case $__w in *=*|{skipped}) ;; *) print -r -- \"{WORD}$__c $(whence -w -- $__w)\"; break ;; esac; done; done"
        ),
        Shell::Bash => format!(
            "{hooks}; printf '%s\\n' \"{PATH_MARK}$PATH\"; for __c in {list}; do printf '%s\\n' \"{KIND}$__c: $(type -t -- $__c)\" \"{ALIAS}$(alias -- $__c 2>/dev/null)\"; read -ra __ws <<< \"${{BASH_ALIASES[$__c]}}\"; for __w in \"${{__ws[@]}}\"; do case $__w in *=*|{skipped}) ;; *) printf '%s\\n' \"{WORD}$__c $__w: $(type -t -- $__w)\"; break ;; esac; done; done"
        ),
    };
    let output = shell.start(home, home, &script)?;
    let path = output
        .stdout
        .lines()
        .rev()
        .find_map(|line| line.split_once(PATH_MARK))
        .map(|(_, path)| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            Error::Command(format!(
                "{} didn't report its PATH. {}",
                shell.name(),
                output.stderr.trim()
            ))
        })?;
    // The lines come in the order they were printed, each command's alias and word after its
    // kind. A marker may follow output a startup file printed without a newline.
    let mut kinds: Vec<(String, String)> = Vec::new();
    let mut aliases = BTreeMap::new();
    let mut alias_words = BTreeMap::new();
    for line in output.stdout.lines() {
        if let Some((_, said)) = line.split_once(KIND) {
            if let Some((command, kind)) = said.split_once(": ") {
                kinds.push((command.to_string(), kind.trim().to_string()));
            }
        } else if let Some((_, said)) = line.split_once(ALIAS) {
            if let Some((command, _)) = kinds.last() {
                if let Some(value) = shell.alias_expansion(said, command) {
                    aliases.insert(command.clone(), value);
                }
            }
        } else if let Some((_, said)) = line.split_once(WORD) {
            // "<command> <word>: <kind>"
            if let Some((command, rest)) = said.split_once(' ') {
                if let Some((word, kind)) = rest.rsplit_once(": ") {
                    alias_words.insert(
                        command.to_string(),
                        (word.to_string(), kind.trim().to_string()),
                    );
                }
            }
        }
    }
    let functions = kinds
        .into_iter()
        .filter(|(command, kind)| match kind.as_str() {
            "function" => true,
            // An alias the shell gave no value for: nothing says it isn't there.
            "alias" => !aliases.contains_key(command),
            _ => false,
        })
        .map(|(command, _)| command)
        .collect();
    Ok(LoginReport {
        path,
        functions,
        aliases,
        alias_words,
    })
}

/// Starts the shell the way a new terminal window does (interactive, and a login shell where
/// terminals start one) in `folder`, runs its prompt
/// hooks once, asks it how `tool` resolves, then asks the shim, run with that shell's PATH,
/// how it would route. Nothing here runs the real tool.
pub fn check_folder(shell: Shell, home: &Path, folder: &Path, tool: &str) -> Result<FolderCheck> {
    if !config::is_command_name(tool) {
        return Err(Error::Invalid(format!(
            "\"{tool}\" isn't a valid command name."
        )));
    }
    if !folder.is_dir() {
        return Err(Error::Invalid(format!(
            "{} isn't a folder. Drop or choose a folder to check.",
            folder.display()
        )));
    }
    let output = shell.start(home, folder, &shell.probe(tool))?;

    // A marker may follow output a startup file printed without a newline.
    let field = |mark: &str| {
        output
            .stdout
            .lines()
            .rev()
            .find_map(|line| line.split_once(mark))
            .map(|(_, value)| value.trim())
    };
    let (Some(kind), Some(path)) = (field(KIND), field(PATH_MARK)) else {
        return Err(Error::Command(format!(
            "{} exited without reporting its PATH. {}",
            shell.name(),
            output.stderr.trim()
        )));
    };
    // zsh says "claude: function"; bash and fish say "function".
    let kind = kind.rsplit(": ").next().unwrap_or(kind);
    // An alias that runs the tool itself, adding arguments, still goes through PATH. Read from
    // its text, never run: an alias or function can run anything, the real tool included.
    let alias = (kind == "alias")
        .then(|| field(ALIAS).and_then(|line| shell.alias_expansion(line, tool)))
        .flatten()
        .and_then(|expansion| alias_args(&expansion, tool).map(|args| (expansion, args)));
    match kind {
        "alias" if alias.is_some() => {}
        "alias" | "function" | "builtin" | "keyword" | "reserved" => {
            return Ok(FolderCheck::ShadowedByShell {
                kind: kind.into(),
                origin: field(ORIGIN).and_then(|line| shell.origin_file(line)),
            })
        }
        "" | "none" => return Ok(FolderCheck::NotFound),
        _ => {}
    }

    let shim = fs::canonicalize(paths::shim_binary(home)).ok();
    let is_shim = |candidate: &Path| shim.is_some() && fs::canonicalize(candidate).ok() == shim;
    let Some(first) = first_on_path(path, tool) else {
        return Ok(FolderCheck::NotFound);
    };
    if !is_shim(&first) {
        let by_prompt_hook = field(STARTUP_PATH)
            .and_then(|startup| first_on_path(startup, tool))
            .is_some_and(|before_hooks| is_shim(&before_hooks));
        return Ok(FolderCheck::ShadowedOnPath {
            path: first.display().to_string(),
            by_prompt_hook,
        });
    }

    let mut explain = Command::new(&first);
    // The alias's own arguments, so one like `--strict-mcp-config` is accounted for.
    if let Some((_, args)) = &alias {
        explain.args(args);
    }
    explain
        .current_dir(folder)
        .env("HOME", home)
        .env("PATH", path)
        .env("ENVROUTER_EXPLAIN", "1");
    let output = run(explain, Duration::from_secs(5))?;
    if output.code == Some(i32::from(EXIT_TOOL_NOT_FOUND)) {
        return Ok(FolderCheck::NotInstalled);
    }
    if !output.success {
        return Ok(FolderCheck::ShimFailed {
            message: output
                .stderr
                .trim()
                .trim_start_matches("envrouter: ")
                .to_string(),
        });
    }
    let explanation: Explanation = serde_json::from_str(output.stdout.trim())
        .map_err(|err| Error::Command(format!("The shim's report wasn't readable: {err}")))?;
    Ok(FolderCheck::Routed {
        profile: explanation.profile,
        profile_id: explanation.profile_id,
        env_var: explanation.env_var,
        value: explanation.value,
        mcp: explanation.mcp,
        mcp_managed_by: explanation.mcp_managed_by,
        via_alias: alias.map(|(expansion, _)| expansion),
        real: explanation.real,
    })
}

/// The arguments an alias adds when it runs `tool` itself (`claude --model opus`, or
/// `command claude …`), so the run still reaches PATH. `None` when it runs anything else.
/// Words are split on whitespace: close enough to tell whether a flag is among them.
fn alias_args(expansion: &str, tool: &str) -> Option<Vec<String>> {
    let mut words = expansion.split_whitespace();
    let mut first = words.next()?;
    if first == "command" {
        first = words.next()?;
    }
    (first == tool).then(|| words.map(str::to_string).collect())
}

/// One shell word as bash's `alias` prints it: single-quoted, with a quote inside written as
/// `'\''`.
fn unquote(word: &str) -> Option<String> {
    let mut out = String::new();
    let mut chars = word.chars();
    while let Some(c) = chars.next() {
        match c {
            '\'' => loop {
                match chars.next()? {
                    '\'' => break,
                    c => out.push(c),
                }
            },
            '\\' => out.push(chars.next()?),
            c => out.push(c),
        }
    }
    Some(out)
}

/// What the app would route for `tool` in `folder`, from the config alone. Instant, and
/// independent of shell setup, so the editor can preview a profile before it's saved.
pub fn preview(config: &ConfigState, home: &Path, folder: &Path, tool: &str) -> Preview {
    let resolution = resolve::resolve(config, home, folder, tool);
    let (env_var, value) = resolution.env.unzip();
    Preview {
        profile_id: resolution.profile.map(|p| p.id.clone()),
        profile: resolution.profile.map(|p| p.name.clone()),
        env_var,
        value,
        mcp: resolution
            .profile
            .map(|profile| mcp::servers_for(config, profile, tool))
            .unwrap_or_default(),
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub profile_id: Option<String>,
    pub profile: Option<String>,
    pub env_var: Option<String>,
    pub value: Option<String>,
    /// The MCP servers the profile hands the tool.
    pub mcp: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Explanation {
    profile: Option<String>,
    /// Absent from a shim that predates it.
    #[serde(default)]
    profile_id: Option<String>,
    env_var: Option<String>,
    value: Option<String>,
    mcp: Vec<String>,
    /// Absent from a shim older than version 5's.
    #[serde(default)]
    mcp_managed_by: Option<String>,
    real: String,
}

struct Finished {
    success: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Runs `command` with a deadline. Output goes to temp files rather than pipes, because an
/// interactive shell's background jobs (prompt themes, plugin managers) can hold a pipe open
/// long after the shell exits.
fn run(mut command: Command, timeout: Duration) -> Result<Finished> {
    let command_err = |what: &str, err: std::io::Error| Error::Command(format!("{what}: {err}"));
    let mut stdout = tempfile::tempfile().map_err(|e| command_err("temp file", e))?;
    let mut stderr = tempfile::tempfile().map_err(|e| command_err("temp file", e))?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(
            stdout
                .try_clone()
                .map_err(|e| command_err("temp file", e))?,
        )
        .stderr(
            stderr
                .try_clone()
                .map_err(|e| command_err("temp file", e))?,
        )
        .spawn()
        .map_err(|e| command_err(&format!("couldn't start {:?}", command.get_program()), e))?;

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| command_err("wait", e))? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::Command(format!(
                "{:?} didn't finish within {} seconds. Something in your shell startup files may be waiting for input.",
                command.get_program(),
                timeout.as_secs()
            )));
        }
        thread::sleep(Duration::from_millis(25));
    };
    Ok(Finished {
        success: status.success(),
        code: status.code(),
        stdout: read_all(&mut stdout),
        stderr: read_all(&mut stderr),
    })
}

/// The `tool` a shell with this PATH runs. The shell skips a file it can't execute, so this
/// does too.
fn first_on_path(path: &str, tool: &str) -> Option<PathBuf> {
    std::env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(tool))
        .find(|candidate| is_executable(candidate))
}

fn read_all(file: &mut File) -> String {
    let mut bytes = Vec::new();
    let _ = file.rewind().and_then(|()| file.read_to_end(&mut bytes));
    String::from_utf8_lossy(&bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shims;
    use envrouter_core::config::{Profile, ToolConfig};

    fn report(path: &str, functions: &[String]) -> Result<LoginReport> {
        Ok(LoginReport {
            path: path.into(),
            functions: functions.to_vec(),
            aliases: BTreeMap::new(),
            alias_words: BTreeMap::new(),
        })
    }

    fn names(commands: &[&str]) -> Vec<String> {
        commands.iter().map(|c| (*c).to_string()).collect()
    }

    const THIRTY: Duration = Duration::from_secs(30);
    const LONG: (Duration, Duration) = (Duration::from_secs(60), Duration::from_secs(60));

    /// The login shell runs every startup file the user has, so its answer is kept for a while
    /// instead of asked on every focus; time, or an explicit ask, makes it run again.
    #[test]
    fn the_login_report_is_kept_until_it_expires_or_is_older_than_asked_for() {
        use std::cell::Cell;
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path();
        let asked = Cell::new(0);
        let path = |ttl, newer_than| {
            cached_report(home, Shell::Bash, &[], ttl, newer_than, |_| {
                asked.set(asked.get() + 1);
                report(&format!("/bin{}", asked.get()), &[])
            })
            .unwrap()
            .path
        };

        assert_eq!(path(LONG, None), "/bin1");
        assert_eq!(path(LONG, None), "/bin1");
        assert_eq!(path((Duration::ZERO, Duration::ZERO), None), "/bin2");
        // Younger than asked for is kept; not younger (nothing is younger than none) runs again.
        assert_eq!(path(LONG, Some(Duration::from_secs(30))), "/bin2");
        assert_eq!(path(LONG, Some(Duration::ZERO)), "/bin3");
        assert_eq!(path(LONG, None), "/bin3");
    }

    /// A kept run answers only for the commands it was asked about; one more is a new run, for
    /// it and the kept ones, and so is an explicit ask, which mustn't lose the agents' answer
    /// for a report that names none.
    #[test]
    fn a_new_run_is_asked_about_the_commands_kept_as_well() {
        use std::cell::RefCell;
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path();
        let runs: RefCell<Vec<Vec<String>>> = RefCell::new(Vec::new());
        let ask = |commands: &[&str], newer_than| {
            cached_report(
                home,
                Shell::Bash,
                &names(commands),
                LONG,
                newer_than,
                |all| {
                    runs.borrow_mut().push(all.to_vec());
                    report("/bin", all)
                },
            )
            .unwrap()
            .functions
        };

        ask(&["claude"], None);
        ask(&["claude"], None);
        ask(&[], None);
        assert_eq!(runs.borrow().len(), 1);
        assert_eq!(ask(&["copilot"], None), ["claude", "copilot"]);
        assert_eq!(ask(&[], Some(Duration::ZERO)), ["claude", "copilot"]);
        assert_eq!(runs.borrow().len(), 3);
    }

    /// A shell that failed (hung to its timeout, say) isn't started again back to back, whatever
    /// commands are asked about, but a minute on it is, and a click may retry it at once. The
    /// failure comes back as what it was, not as a generic one.
    #[test]
    fn a_failed_login_report_is_believed_for_a_while_and_keeps_its_kind() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path();
        let fail = |commands: &[&str], failure_ttl, newer_than, asks: &mut u32| {
            cached_report(
                home,
                Shell::Bash,
                &names(commands),
                (Duration::from_secs(60), failure_ttl),
                newer_than,
                |_| {
                    *asks += 1;
                    Err(Error::Invalid("bash isn't installed.".into()))
                },
            )
            .unwrap_err()
        };
        let minute = Duration::from_secs(60);
        let mut asks = 0;
        fail(&["claude"], minute, None, &mut asks);
        let again = fail(&["claude", "copilot"], minute, None, &mut asks);
        assert!(
            matches!(again, Error::Invalid(ref m) if m == "bash isn't installed."),
            "{again:?}"
        );
        assert_eq!(asks, 1, "a longer list doesn't start the shell again");
        fail(
            &["claude"],
            minute,
            Some(Duration::from_secs(30)),
            &mut asks,
        );
        assert_eq!(asks, 2, "a click retries");
        fail(&["claude"], Duration::ZERO, None, &mut asks);
        assert_eq!(asks, 3, "a minute on it is believed no more");
    }

    /// The cache isn't locked while the shell runs, or an explicit check would queue behind a
    /// slow one (and, asked from inside it as here, never return).
    #[test]
    fn the_login_report_cache_is_not_locked_while_the_shell_runs() {
        let (one, two) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let answer = cached_report(one.path(), Shell::Bash, &[], LONG, None, |_| {
            let other = cached_report(two.path(), Shell::Bash, &[], LONG, None, |_| {
                report("/other", &[])
            });
            assert_eq!(other.unwrap().path, "/other");
            report("/one", &[])
        });
        assert_eq!(answer.unwrap().path, "/one");
    }

    /// An ask that waits for a run under way takes what that run found, not an older report it is
    /// woken to (the condition variable serves every home, so another home's run ending wakes it
    /// with nothing new).
    #[test]
    fn an_ask_waiting_for_a_run_is_not_given_an_older_report_when_woken_early() {
        use std::sync::mpsc;
        let (one, other) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (home, other) = (one.path(), other.path());
        let young = Duration::from_millis(100);
        let old_report = || {
            cached_report(home, Shell::Bash, &[], LONG, None, |_| report("/old", &[])).unwrap();
        };
        old_report();
        std::thread::sleep(Duration::from_millis(150));
        let (release, gate) = mpsc::channel::<()>();
        std::thread::scope(|scope| {
            // A run for `home` is under way, and the kept report is older than `young`.
            let running = scope.spawn(move || {
                cached_report(home, Shell::Bash, &[], LONG, Some(young), |_| {
                    gate.recv().ok();
                    report("/new", &[])
                })
            });
            while !LOGIN_REPORTS
                .lock()
                .unwrap()
                .get(home)
                .is_some_and(|slot| slot.running)
            {
                std::thread::sleep(Duration::from_millis(5));
            }
            let waiter = scope.spawn(move || {
                cached_report(home, Shell::Bash, &[], LONG, Some(young), |_| {
                    report("/own", &[])
                })
            });
            std::thread::sleep(Duration::from_millis(50));
            // Another home's run ends, waking everyone waiting.
            cached_report(other, Shell::Bash, &[], LONG, None, |_| {
                report("/elsewhere", &[])
            })
            .unwrap();
            std::thread::sleep(Duration::from_millis(50));
            assert!(!waiter.is_finished(), "it went on with the old report");
            release.send(()).unwrap();
            assert_eq!(running.join().unwrap().unwrap().path, "/new");
            assert_eq!(waiter.join().unwrap().unwrap().path, "/new");
        });
    }

    /// Asks that come while a run is under way share it, explicit ones included, instead of each
    /// starting a shell.
    #[test]
    fn asks_during_a_run_share_it() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::mpsc;
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().to_path_buf();
        let runs = AtomicUsize::new(0);
        let (release, gate) = mpsc::channel::<()>();
        let (home, runs) = (&home, &runs);
        std::thread::scope(|scope| {
            let first = scope.spawn(move || {
                cached_report(home, Shell::Bash, &[], LONG, Some(THIRTY), |_| {
                    runs.fetch_add(1, Ordering::SeqCst);
                    gate.recv().ok();
                    report("/shared", &[])
                })
            });
            // Wait until the first ask is running its shell.
            while runs.load(Ordering::SeqCst) == 0 {
                std::thread::sleep(Duration::from_millis(5));
            }
            let second = scope.spawn(move || {
                cached_report(home, Shell::Bash, &[], LONG, Some(THIRTY), |_| {
                    runs.fetch_add(1, Ordering::SeqCst);
                    report("/second", &[])
                })
            });
            std::thread::sleep(Duration::from_millis(100));
            release.send(()).unwrap();
            assert_eq!(first.join().unwrap().unwrap().path, "/shared");
            assert_eq!(second.join().unwrap().unwrap().path, "/shared");
        });
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    /// The file a new terminal's bash reads first in an empty home on this platform:
    /// `.bash_profile` on macOS, `.bashrc` on a Linux desktop, `.profile` in WSL.
    fn first_bash_file(home: &Path) -> PathBuf {
        bash_startup_files(Platform::current(), home).remove(0)
    }

    #[test]
    fn bash_gets_the_files_each_platforms_terminal_reads() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let names = |platform| -> Vec<String> {
            bash_startup_files(platform, home)
                .iter()
                .map(|f| f.file_name().unwrap().to_string_lossy().into_owned())
                .collect()
        };
        // An empty home: Linux never gets a new .bash_profile, which would hide .profile.
        assert_eq!(names(Platform::MacOs), [".bash_profile"]);
        assert_eq!(names(Platform::Wsl), [".profile"]);
        assert_eq!(names(Platform::Linux), [".bashrc"]);

        // An existing login file is used as it is, with .bashrc beside it once that exists.
        fs::write(home.join(".profile"), "").unwrap();
        fs::write(home.join(".bashrc"), "").unwrap();
        assert_eq!(names(Platform::MacOs), [".profile", ".bashrc"]);
        assert_eq!(names(Platform::Wsl), [".profile", ".bashrc"]);
        assert_eq!(names(Platform::Linux), [".bashrc"]);
    }

    /// Whether to skip a test that needs `shell`. CI sets `ENVROUTER_REQUIRE_SHELLS` so a shell
    /// that didn't install fails the run rather than quietly testing less.
    fn missing(shell: Shell) -> bool {
        if shell.binary().is_some() {
            return false;
        }
        assert!(
            std::env::var_os("ENVROUTER_REQUIRE_SHELLS").is_none(),
            "{} isn't installed, and ENVROUTER_REQUIRE_SHELLS is set",
            shell.name()
        );
        true
    }

    /// Pins the JSON the frontend's `FolderCheck` and `ShellStatus` types in
    /// `src/lib/types.ts` expect. Update both together.
    #[test]
    fn wire_format_matches_the_typescript_types() {
        fn json(value: impl Serialize) -> String {
            serde_json::to_string(&value).unwrap()
        }
        assert_eq!(
            json(&FolderCheck::Routed {
                profile: None,
                profile_id: None,
                env_var: Some("V".into()),
                value: Some("/x".into()),
                mcp: vec!["github".into()],
                mcp_managed_by: None,
                via_alias: Some("t -v".into()),
                real: "/bin/t".into(),
            }),
            r#"{"status":"routed","profile":null,"profileId":null,"envVar":"V","value":"/x","mcp":["github"],"mcpManagedBy":null,"viaAlias":"t -v","real":"/bin/t"}"#
        );
        assert_eq!(
            json(&Preview {
                profile_id: Some("1".into()),
                profile: Some("Work".into()),
                env_var: None,
                value: None,
                mcp: Vec::new(),
            }),
            r#"{"profileId":"1","profile":"Work","envVar":null,"value":null,"mcp":[]}"#
        );
        assert_eq!(
            json(&FolderCheck::ShadowedByShell {
                kind: "function".into(),
                origin: Some("/h/.zshrc".into()),
            }),
            r#"{"status":"shadowedByShell","kind":"function","origin":"/h/.zshrc"}"#
        );
        assert_eq!(
            json(&FolderCheck::ShadowedOnPath {
                path: "/p".into(),
                by_prompt_hook: true,
            }),
            r#"{"status":"shadowedOnPath","path":"/p","byPromptHook":true}"#
        );
        assert_eq!(json(&FolderCheck::NotFound), r#"{"status":"notFound"}"#);
        assert_eq!(
            json(&FolderCheck::NotInstalled),
            r#"{"status":"notInstalled"}"#
        );
        assert_eq!(
            json(&FolderCheck::ShimFailed {
                message: "m".into()
            }),
            r#"{"status":"shimFailed","message":"m"}"#
        );
        assert_eq!(
            json(&ShellStatus {
                shell: Shell::Zsh,
                available: true,
                is_default: false,
                installed: true,
                startup_files: vec!["/h/.zshrc".into()],
            }),
            r#"{"shell":"zsh","available":true,"isDefault":false,"installed":true,"startupFiles":["/h/.zshrc"]}"#
        );
    }

    #[test]
    fn upsert_appends_once_and_replaces_in_place() {
        let block = Shell::Zsh.block();
        let once = upsert_block("export A=1", &block);
        assert_eq!(once, format!("export A=1\n\n{block}"));
        assert_eq!(upsert_block(&once, &block), once);

        let moved = format!("{block}export A=1\n");
        let stale = moved.replace("Keep this", "Old note. Keep this");
        assert_eq!(upsert_block(&stale, &block), moved);
    }

    #[test]
    fn remove_restores_the_original_text() {
        for original in ["", "export A=1\n", "export A=1"] {
            let with = upsert_block(original, &Shell::Bash.block());
            let without = remove_block(&with);
            let expected = if original.is_empty() || original.ends_with('\n') {
                original.to_string()
            } else {
                format!("{original}\n")
            };
            assert_eq!(without, expected, "{original:?}");
        }
    }

    #[test]
    fn a_block_missing_its_end_line_never_costs_the_user_their_own_lines() {
        let block = Shell::Zsh.block();
        let orphan = format!("export A=1\n{BEGIN}\n{NOTE}\nexport B=2\n");
        let with = upsert_block(&orphan, &block);
        assert_eq!(with, format!("{orphan}\n{block}"));
        assert_eq!(upsert_block(&with, &block), with);
        assert_eq!(remove_block(&with), orphan);
    }

    #[test]
    fn a_begin_line_without_its_end_does_not_count_as_installed() {
        let home = tempfile::tempdir().unwrap();
        let profile = first_bash_file(home.path());
        fs::write(&profile, format!("export A=1\n{BEGIN}\n{NOTE}\n")).unwrap();
        assert!(!status(Shell::Bash, home.path()).installed);

        assert!(
            set_integration(Shell::Bash, home.path(), true)
                .unwrap()
                .installed
        );
        assert!(
            !set_integration(Shell::Bash, home.path(), false)
                .unwrap()
                .installed
        );
    }

    #[test]
    fn remove_takes_out_every_copy_of_the_block() {
        let block = Shell::Bash.block();
        let twice = format!("export A=1\n\n{block}export B=2\n\n{block}");
        assert_eq!(remove_block(&twice), "export A=1\nexport B=2\n");
    }

    /// An uninstall must find a block in a file `startup_files` no longer picks (bash reads the
    /// first of its login files that exists, so `.bash_login` lost to `.bash_profile`), and a
    /// pasted second copy, without touching a line of the user's or creating a file.
    #[test]
    fn uninstall_sweeps_files_the_shell_no_longer_reads() {
        let home = tempfile::tempdir().unwrap();
        let home = home.path();
        let block = Shell::Bash.block();
        fs::write(home.join(".bash_profile"), "").unwrap();
        fs::write(home.join(".bash_login"), format!("export A=1\n\n{block}")).unwrap();
        fs::write(
            home.join(".bashrc"),
            format!("export B=2\n\n{block}export C=3\n\n{block}"),
        )
        .unwrap();
        assert!(!Shell::Bash
            .startup_files(home)
            .contains(&home.join(".bash_login")));

        let (cleared, problems) = remove_every_block(home, false);

        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(cleared, [home.join(".bashrc"), home.join(".bash_login")]);
        assert_eq!(
            fs::read_to_string(home.join(".bash_login")).unwrap(),
            "export A=1\n"
        );
        assert_eq!(
            fs::read_to_string(home.join(".bashrc")).unwrap(),
            "export B=2\nexport C=3\n"
        );
        for name in [".zshrc", ".profile", ".config"] {
            assert!(!home.join(name).exists(), "{name} was created");
        }
    }

    #[test]
    fn set_integration_leaves_a_dangling_symlinked_rc_file_alone() {
        let home = tempfile::tempdir().unwrap();
        let link = first_bash_file(home.path());
        std::os::unix::fs::symlink(home.path().join("unmounted/bash_profile"), &link).unwrap();

        let err = set_integration(Shell::Bash, home.path(), true).unwrap_err();
        assert!(matches!(err, Error::Invalid(_)), "{err}");
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        // Turning it off has nothing to remove, so it isn't an error.
        set_integration(Shell::Bash, home.path(), false).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
    }

    #[test]
    fn set_integration_writes_through_a_symlinked_rc_file() {
        let home = tempfile::tempdir().unwrap();
        let dotfiles = home.path().join("dotfiles/zshrc");
        fs::create_dir_all(dotfiles.parent().unwrap()).unwrap();
        fs::write(&dotfiles, "export A=1\n").unwrap();
        std::os::unix::fs::symlink(&dotfiles, home.path().join(".zshrc")).unwrap();

        let status = set_integration(Shell::Zsh, home.path(), true).unwrap();
        assert!(status.installed);
        assert!(fs::symlink_metadata(home.path().join(".zshrc"))
            .unwrap()
            .is_symlink());
        assert!(fs::read_to_string(&dotfiles).unwrap().contains(BEGIN));

        set_integration(Shell::Zsh, home.path(), false).unwrap();
        assert_eq!(fs::read_to_string(&dotfiles).unwrap(), "export A=1\n");
    }

    #[test]
    fn zsh_startup_file_follows_zdotdir_from_zshenv_not_the_app_environment() {
        if missing(Shell::Zsh) {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        assert_eq!(Shell::Zsh.startup_files(&home), vec![home.join(".zshrc")]);

        // Output of its own doesn't hide the answer.
        fs::write(
            home.join(".zshenv"),
            "echo loading env\nZDOTDIR=\"$HOME/.config/zsh\"\n",
        )
        .unwrap();
        assert_eq!(
            Shell::Zsh.startup_files(&home),
            vec![home.join(".config/zsh/.zshrc")]
        );
    }

    /// Sources the block in each POSIX shell and checks the resulting PATH.
    #[test]
    fn posix_block_moves_shims_to_the_front_exactly_once() {
        let home = "/h";
        let shims = "/h/.envrouter/shims";
        let cases = [
            ("/usr/bin:/bin", format!("{shims}:/usr/bin:/bin")),
            (
                &format!("/a:{shims}:/b:{shims}") as &str,
                format!("{shims}:/a:/b"),
            ),
            (shims, shims.to_string()),
            ("", shims.to_string()),
        ];
        let script = format!("{}\nprintf '%s' \"$PATH\"", Shell::Zsh.block());
        for shell in ["/bin/sh", "/bin/bash", "/bin/zsh"] {
            if !Path::new(shell).exists() {
                continue;
            }
            for (before, after) in &cases {
                let run = |script: &str| {
                    Command::new(shell)
                        .args(["-c", script])
                        .env_clear()
                        .env("HOME", home)
                        .env("PATH", before)
                        .output()
                        .unwrap()
                };
                // Debian's /etc/zsh/zshenv, which zsh always reads first, fills in an empty
                // PATH before the block runs. The case only tests the block where the shell
                // starts with the PATH it was given.
                if String::from_utf8_lossy(&run("printf '%s' \"$PATH\"").stdout) != *before {
                    continue;
                }
                let output = run(&script);
                assert_eq!(
                    String::from_utf8_lossy(&output.stdout),
                    *after,
                    "{shell} with PATH={before:?}: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
    }

    fn config() -> ConfigState {
        ConfigState {
            profiles: vec![Profile {
                id: "1".into(),
                name: "Work".into(),
                trigger_paths: vec!["~/work".into()],
                tools: [(
                    "claude".to_string(),
                    ToolConfig {
                        env_var: "CLAUDE_CONFIG_DIR".into(),
                        path: "~/.claude-work".into(),
                    },
                )]
                .into(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    /// A temp home with the shim installed and a fake real `claude` in `~/bin`, and a
    /// zshrc that puts `~/bin` on PATH followed by `extra`.
    fn zsh_home(extra: &str) -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        fs::create_dir_all(home.join("work/app")).unwrap();
        fs::create_dir_all(home.join("bin")).unwrap();
        // The fake tool and the shim are installed the way the app installs a shim, by a child
        // `dd`, so no fork of this process can hold them open for writing when they run (Linux
        // refuses that with "Text file busy").
        shims::write_executable(
            &home.join("bin/claude"),
            "#!/bin/sh\necho REAL CLAUDE RAN\n",
        );

        let config = config();
        shims::install_file_with(
            &paths::shim_binary(&home),
            Path::new(env!("ENVROUTER_STAGED_SHIM")),
            false,
        )
        .unwrap();
        shims::sync(&home, &config).unwrap();
        config::save(&paths::root(&home), &config).unwrap();
        fs::write(
            home.join(".zshrc"),
            format!("export PATH=\"$HOME/bin:$PATH\"\n{extra}"),
        )
        .unwrap();
        (root, home)
    }

    fn check(home: &Path) -> FolderCheck {
        check_folder(Shell::Zsh, home, &home.join("work/app"), "claude").unwrap()
    }

    #[test]
    fn check_folder_in_real_zsh() {
        if missing(Shell::Zsh) {
            return;
        }

        let (_root, home) = zsh_home("");
        assert_eq!(
            check(&home),
            FolderCheck::ShadowedOnPath {
                path: home.join("bin/claude").display().to_string(),
                by_prompt_hook: false,
            }
        );

        set_integration(Shell::Zsh, &home, true).unwrap();
        assert_eq!(
            check(&home),
            FolderCheck::Routed {
                profile: Some("Work".into()),
                profile_id: Some("1".into()),
                env_var: Some("CLAUDE_CONFIG_DIR".into()),
                value: Some(home.join(".claude-work").display().to_string()),
                mcp: Vec::new(),
                mcp_managed_by: None,
                via_alias: None,
                real: home.join("bin/claude").display().to_string(),
            }
        );

        let (_root, home) = zsh_home("claude() { echo mine; }\n");
        set_integration(Shell::Zsh, &home, true).unwrap();
        assert_eq!(
            check(&home),
            FolderCheck::ShadowedByShell {
                kind: "function".into(),
                origin: Some(home.join(".zshrc").display().to_string()),
            }
        );
    }

    /// `alias claude='claude --model opus'` still runs the shim, through PATH: it used to be
    /// reported as blocked. An alias that runs something else still is.
    #[test]
    fn check_folder_sees_through_an_alias_that_runs_the_tool() {
        if missing(Shell::Zsh) {
            return;
        }
        let (_root, home) = zsh_home("alias claude='claude --model opus'\n");
        set_integration(Shell::Zsh, &home, true).unwrap();
        assert!(
            matches!(
                check(&home),
                FolderCheck::Routed { ref profile, ref via_alias, .. }
                    if profile.as_deref() == Some("Work") && via_alias.as_deref() == Some("claude --model opus")
            ),
            "{:?}",
            check(&home)
        );

        let (_root, home) = zsh_home("alias claude='echo mine'\n");
        set_integration(Shell::Zsh, &home, true).unwrap();
        assert!(
            matches!(check(&home), FolderCheck::ShadowedByShell { ref kind, .. } if kind == "alias"),
            "{:?}",
            check(&home)
        );

        if missing(Shell::Bash) {
            return;
        }
        let (_root, home) = zsh_home("");
        let profile = first_bash_file(&home);
        fs::write(
            &profile,
            "export PATH=\"$HOME/bin:$PATH\"\nalias claude='command claude --append-system-prompt '\\''be brief'\\'''\n",
        )
        .unwrap();
        set_integration(Shell::Bash, &home, true).unwrap();
        let check = check_folder(Shell::Bash, &home, &home.join("work/app"), "claude").unwrap();
        assert!(
            matches!(
                check,
                FolderCheck::Routed { ref via_alias, .. }
                    if via_alias.as_deref() == Some("command claude --append-system-prompt 'be brief'")
            ),
            "{check:?}"
        );
    }

    #[test]
    fn reads_the_arguments_an_alias_adds_to_the_tool() {
        assert_eq!(
            alias_args("claude --model opus", "claude").unwrap(),
            ["--model", "opus"]
        );
        assert_eq!(
            alias_args("command claude", "claude").unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(alias_args("npx claude", "claude"), None);
        assert_eq!(alias_args("claudex", "claude"), None);
        assert_eq!(
            unquote(r"'claude --x='\''q'\'' -y'").as_deref(),
            Some("claude --x='q' -y")
        );
        assert_eq!(
            Shell::Bash
                .alias_expansion("alias claude='claude -c'", "claude")
                .as_deref(),
            Some("claude -c")
        );
        assert_eq!(Shell::Zsh.alias_expansion("", "claude"), None);
    }

    /// mise and direnv change PATH from a prompt hook, after every startup file has run. Like
    /// direnv's, this one does nothing unless it runs at the shell's top level, and it prints
    /// a terminal title with no newline, as oh-my-zsh does.
    #[test]
    fn check_folder_runs_zsh_prompt_hooks() {
        if missing(Shell::Zsh) {
            return;
        }
        let (_root, home) = zsh_home(concat!(
            "fake_direnv() {\n",
            "  setopt localoptions extendedglob\n",
            "  [[ -n $ZSH_EVAL_CONTEXT && $ZSH_EVAL_CONTEXT != toplevel(:[a-z]#func|)# ]] && return\n",
            "  PATH=\"$HOME/bin:$PATH\"\n",
            "  print -n 'title'\n",
            "}\n",
            "precmd_functions+=(fake_direnv)\n",
        ));
        set_integration(Shell::Zsh, &home, true).unwrap();
        assert_eq!(
            check(&home),
            FolderCheck::ShadowedOnPath {
                path: home.join("bin/claude").display().to_string(),
                by_prompt_hook: true,
            }
        );
    }

    /// The same through bash's PROMPT_COMMAND, which also runs bash's probe end to end.
    #[test]
    fn check_folder_runs_bash_prompt_command() {
        if missing(Shell::Bash) {
            return;
        }
        let (_root, home) = zsh_home("");
        let profile = first_bash_file(&home);
        fs::write(&profile, "export PATH=\"$HOME/bin:$PATH\"\n").unwrap();
        set_integration(Shell::Bash, &home, true).unwrap();
        let check = || check_folder(Shell::Bash, &home, &home.join("work/app"), "claude").unwrap();
        assert!(
            matches!(check(), FolderCheck::Routed { ref profile, .. } if profile.as_deref() == Some("Work")),
            "{:?}",
            check()
        );

        let mut text = fs::read_to_string(&profile).unwrap();
        text.push_str("PROMPT_COMMAND='PATH=\"$HOME/bin:$PATH\"'\n");
        fs::write(&profile, text).unwrap();
        assert_eq!(
            check(),
            FolderCheck::ShadowedOnPath {
                path: home.join("bin/claude").display().to_string(),
                by_prompt_hook: true,
            }
        );
    }

    /// fish end to end: its block, its probe, a prompt hook, and a function in its own file
    /// that shadows the tool, the way fish users keep functions.
    #[test]
    fn check_folder_in_real_fish() {
        if missing(Shell::Fish) {
            return;
        }
        let (_root, home) = zsh_home("");
        let config = home.join(".config/fish/config.fish");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        fs::write(&config, "set -gx PATH $HOME/bin $PATH\n").unwrap();
        set_integration(Shell::Fish, &home, true).unwrap();
        let check = || check_folder(Shell::Fish, &home, &home.join("work/app"), "claude").unwrap();
        assert!(
            matches!(check(), FolderCheck::Routed { ref profile, .. } if profile.as_deref() == Some("Work")),
            "{:?}",
            check()
        );

        let mut text = fs::read_to_string(&config).unwrap();
        text.push_str(
            "function fake_mise --on-event fish_prompt\n    set -gx PATH $HOME/bin $PATH\nend\n",
        );
        fs::write(&config, text).unwrap();
        assert_eq!(
            check(),
            FolderCheck::ShadowedOnPath {
                path: home.join("bin/claude").display().to_string(),
                by_prompt_hook: true,
            }
        );

        let functions = home.join(".config/fish/functions");
        fs::create_dir_all(&functions).unwrap();
        fs::write(
            functions.join("claude.fish"),
            "function claude\n    echo mine\nend\n",
        )
        .unwrap();
        assert_eq!(
            check(),
            FolderCheck::ShadowedByShell {
                kind: "function".into(),
                origin: Some(functions.join("claude.fish").display().to_string()),
            }
        );
    }

    /// A shim with no real tool behind it. The name is one no machine has installed.
    #[test]
    fn check_folder_tells_a_missing_tool_from_a_failed_shim() {
        if missing(Shell::Zsh) {
            return;
        }
        let tool = "envrouter-absent-tool";
        let (_root, home) = zsh_home("");
        let mut config = config();
        let settings = config.profiles[0].tools["claude"].clone();
        config.profiles[0].tools.insert(tool.into(), settings);
        shims::sync(&home, &config).unwrap();
        set_integration(Shell::Zsh, &home, true).unwrap();
        assert_eq!(
            check_folder(Shell::Zsh, &home, &home.join("work/app"), tool).unwrap(),
            FolderCheck::NotInstalled
        );
    }

    #[test]
    fn origin_file_reads_each_shells_report() {
        assert_eq!(
            Shell::Zsh.origin_file("claude is a shell function from /h/.zshrc"),
            Some("/h/.zshrc".into())
        );
        assert_eq!(
            Shell::Zsh.origin_file("claude is an alias for claude --x"),
            None
        );
        assert_eq!(
            Shell::Bash.origin_file("claude 12 /h/.bashrc"),
            Some("/h/.bashrc".into())
        );
        assert_eq!(Shell::Bash.origin_file(""), None);
        assert_eq!(
            Shell::Fish.origin_file("/h/.config/fish/functions/claude.fish"),
            Some("/h/.config/fish/functions/claude.fish".into())
        );
        assert_eq!(Shell::Fish.origin_file("stdin"), None);
    }

    #[test]
    fn preview_uses_the_unsaved_config() {
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        fs::create_dir_all(home.join("work/app")).unwrap();
        assert_eq!(
            preview(&config(), &home, &home.join("work/app"), "claude")
                .profile
                .as_deref(),
            Some("Work")
        );
    }
}
