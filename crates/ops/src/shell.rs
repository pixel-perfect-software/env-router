//! Puts the shims directory first on PATH in the user's shells, through a marked block at
//! the end of each startup file, and checks the result in a real shell.

use std::fs::{self, File};
use std::io::{Read, Seek, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::platform::{self, Platform};
use envrouter_core::{mcp, paths, resolve, Error, Result, EXIT_TOOL_NOT_FOUND};
use serde::{Deserialize, Serialize};

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

    fn block(self) -> String {
        let body = match self {
            Shell::Zsh | Shell::Bash => POSIX_BODY,
            Shell::Fish => FISH_BODY,
        };
        format!("{BEGIN}\n{NOTE}\n{body}\n{END}\n")
    }

    /// One command, in this shell's syntax, that prints the PATH the startup files left, runs
    /// the prompt hooks once as drawing the first prompt would (mise and direnv change PATH
    /// there), then prints how `tool` resolves and the PATH. Hook output is discarded: a
    /// terminal title has no newline and would run into the next line.
    /// `tool` has passed `is_command_name`, so it's safe to interpolate.
    fn probe(self, tool: &str) -> String {
        match self {
            // `whence -v` names the file a function came from: "claude is a shell function
            // from /Users/me/.zshrc". `cd` runs the chpwd hooks; each prompt runs precmd's.
            // `check_folder` runs this as a script file, not with `-c`: only a script's
            // commands run at the shell's top level, and direnv's hook does nothing elsewhere.
            Shell::Zsh => format!(
                "print -r -- \"{STARTUP_PATH}$PATH\"; for __envrouter_hook in chpwd $chpwd_functions precmd $precmd_functions; do (( $+functions[$__envrouter_hook] )) && $__envrouter_hook >/dev/null; done; print -r -- \"{KIND}$(whence -w -- {tool})\"; print -r -- \"{ORIGIN}$(whence -v -- {tool})\"; print -r -- \"{PATH_MARK}$PATH\""
            ),
            // PROMPT_COMMAND is a string, or an array from bash 5.1; `[@]` reads both. With
            // extdebug, `declare -F` prints "claude 12 /Users/me/.bashrc".
            Shell::Bash => format!(
                "printf '%s\\n' \"{STARTUP_PATH}$PATH\"; for __envrouter_hook in \"${{PROMPT_COMMAND[@]}}\"; do eval \"$__envrouter_hook\" >/dev/null; done; printf '%s\\n' \"{KIND}$(type -t -- {tool})\" \"{ORIGIN}$(shopt -s extdebug; declare -F -- {tool} 2>/dev/null)\" \"{PATH_MARK}$PATH\""
            ),
            // Prompt hooks are `--on-event fish_prompt` functions. An empty command
            // substitution would drop the whole argument in fish, so each value goes through
            // a variable.
            Shell::Fish => format!(
                "set -l startup (string join : $PATH); emit fish_prompt >/dev/null; set -l kind (type -t {tool} 2>/dev/null); set -l origin (functions --details {tool} 2>/dev/null); printf '%s\\n' \"{STARTUP_PATH}$startup\" \"{KIND}$kind\" \"{ORIGIN}$origin\" \"{PATH_MARK}\"(string join : $PATH)"
            ),
        }
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
        // Write through symlinks, so a dotfiles-managed file stays a link.
        let file = match fs::canonicalize(&file) {
            Ok(target) => target,
            // A link to a file that's missing, say dotfiles on a volume that isn't mounted.
            // Writing would replace the link with a new file, so leave it for the user to fix.
            Err(_) if fs::symlink_metadata(&file).is_ok_and(|meta| meta.is_symlink()) => {
                if !enabled {
                    continue; // No block to remove from a file that isn't there.
                }
                return Err(Error::Invalid(format!(
                    "{} links to a file that doesn't exist. Fix the link, then turn {} on again.",
                    file.display(),
                    shell.name()
                )));
            }
            Err(_) => file,
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
/// PATH as the startup files left it, before any prompt hook ran.
const STARTUP_PATH: &str = "__ENVROUTER_STARTUP_PATH__=";
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
        env_var: Option<String>,
        value: Option<String>,
        /// The MCP servers the run gets, if every secret they need is readable.
        mcp: Vec<String>,
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

/// The PATH a new terminal window gets from the user's shell, after its startup files. An app
/// opened from Finder or a `.desktop` file may have a bare PATH, so MCP server checks start
/// `npx` and the like with this one. Asked once per app run; a failure is reported, not cached.
pub fn login_path(home: &Path) -> Result<String> {
    static CACHE: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((cached_home, path)) = cache.as_ref() {
        if cached_home == home {
            return Ok(path.clone());
        }
    }
    let platform = Platform::current();
    let shell = Shell::ALL
        .into_iter()
        .find(|&s| status(s, home).is_default)
        .or_else(|| Shell::from_name(platform.default_shell_name()))
        .unwrap_or(Shell::Bash);
    let binary = shell
        .binary()
        .ok_or_else(|| Error::Invalid(format!("{} isn't installed.", shell.name())))?;
    let print = match shell {
        Shell::Fish => format!("printf '%s\\n' \"{PATH_MARK}\"(string join : $PATH)"),
        Shell::Zsh | Shell::Bash => format!("printf '%s\\n' \"{PATH_MARK}$PATH\""),
    };
    let mut command = Command::new(binary);
    command
        .args(terminal_flags(platform))
        .args(["-c", &print])
        .current_dir(home);
    fresh_env(&mut command, home);
    let output = run(command, Duration::from_secs(15))?;
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
    *cache = Some((home.to_path_buf(), path.clone()));
    Ok(path)
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
    let binary = shell
        .binary()
        .ok_or_else(|| Error::Invalid(format!("{} isn't installed.", shell.name())))?;
    let probe = shell.probe(tool);
    let mut command = Command::new(binary);
    command.args(terminal_flags(Platform::current()));
    // zsh reads the probe from a file (see `probe`), which lives until the shell exits.
    let _script = match shell {
        Shell::Zsh => {
            let temp_err = |err| Error::Command(format!("temp file: {err}"));
            let mut script = tempfile::NamedTempFile::new().map_err(temp_err)?;
            script.write_all(probe.as_bytes()).map_err(temp_err)?;
            command.arg(script.path());
            Some(script)
        }
        Shell::Bash | Shell::Fish => {
            command.args(["-c", &probe]);
            None
        }
    };
    // Not the app's environment: launched from a terminal (as in development), its PATH may
    // already contain the shims.
    command.current_dir(folder);
    fresh_env(&mut command, home);
    let output = run(command, Duration::from_secs(15))?;

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
    match kind {
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
        env_var: explanation.env_var,
        value: explanation.value,
        mcp: explanation.mcp,
        real: explanation.real,
    })
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
    env_var: Option<String>,
    value: Option<String>,
    mcp: Vec<String>,
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

fn is_executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
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
                env_var: Some("V".into()),
                value: Some("/x".into()),
                mcp: vec!["github".into()],
                real: "/bin/t".into(),
            }),
            r#"{"status":"routed","profile":null,"envVar":"V","value":"/x","mcp":["github"],"real":"/bin/t"}"#
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
        let real = home.join("bin/claude");
        fs::write(&real, "#!/bin/sh\necho REAL CLAUDE RAN\n").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o755)).unwrap();

        let config = config();
        shims::install_binary(&home, Path::new(env!("ENVROUTER_STAGED_SHIM"))).unwrap();
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
                env_var: Some("CLAUDE_CONFIG_DIR".into()),
                value: Some(home.join(".claude-work").display().to_string()),
                mcp: Vec::new(),
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
