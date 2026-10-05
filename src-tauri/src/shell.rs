//! Puts the shims directory first on PATH in the user's shells, through a marked block at
//! the end of each startup file, and checks the result in a real shell.

use std::fs::{self, File};
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::{paths, resolve, Error, Result};
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

    fn name(self) -> &'static str {
        match self {
            Shell::Zsh => "zsh",
            Shell::Bash => "bash",
            Shell::Fish => "fish",
        }
    }

    /// The installed binary. The app is launched from Finder with a minimal PATH, so this
    /// looks in `/etc/shells`, where Homebrew users register shells like fish, and then the
    /// usual install locations.
    pub fn binary(self) -> Option<PathBuf> {
        let listed = fs::read_to_string("/etc/shells").unwrap_or_default();
        listed
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with('/'))
            .map(PathBuf::from)
            .chain(
                ["/bin", "/opt/homebrew/bin", "/usr/local/bin"]
                    .iter()
                    .map(|dir| Path::new(dir).join(self.name())),
            )
            .find(|path| path.file_name().is_some_and(|n| n == self.name()) && path.is_file())
    }

    /// The files that get the block.
    pub fn startup_files(self, home: &Path) -> Vec<PathBuf> {
        match self {
            Shell::Zsh => vec![zsh_dotdir(home).join(".zshrc")],
            Shell::Bash => {
                // Terminal on macOS starts login shells, which read only the first of these
                // that exists. `.bashrc` covers non-login shells, like `bash` typed at a prompt.
                let login = [".bash_profile", ".bash_login", ".profile"]
                    .iter()
                    .map(|name| home.join(name))
                    .find(|path| path.exists())
                    .unwrap_or_else(|| home.join(".bash_profile"));
                let rc = home.join(".bashrc");
                if rc.exists() {
                    vec![login, rc]
                } else {
                    vec![login]
                }
            }
            Shell::Fish => vec![home.join(".config/fish/config.fish")],
        }
    }

    fn block(self) -> String {
        let body = match self {
            Shell::Zsh | Shell::Bash => POSIX_BODY,
            Shell::Fish => FISH_BODY,
        };
        format!("{BEGIN}\n{NOTE}\n{body}\n{END}\n")
    }

    /// One command, in this shell's syntax, that prints how `tool` resolves and the PATH.
    /// `tool` has passed `is_command_name`, so it's safe to interpolate.
    fn probe(self, tool: &str) -> String {
        match self {
            Shell::Zsh => format!(
                "print -r -- \"{KIND}$(whence -w -- {tool})\"; print -r -- \"{PATH_MARK}$PATH\""
            ),
            Shell::Bash => format!(
                "printf '%s\\n' \"{KIND}$(type -t -- {tool})\" \"{PATH_MARK}$PATH\""
            ),
            // An empty command substitution would drop the whole argument in fish, so the
            // kind goes through a variable.
            Shell::Fish => format!(
                "set -l kind (type -t {tool} 2>/dev/null); printf '%s\\n' \"{KIND}$kind\" \"{PATH_MARK}\"(string join : $PATH)"
            ),
        }
    }
}

/// Where zsh reads `.zshrc` from: `$ZDOTDIR` if `/etc/zshenv` or `~/.zshenv` sets it,
/// otherwise home. Asked of zsh itself in a fresh environment, because the app's own
/// environment says nothing about a new terminal's. When launched from a terminal, it may
/// carry a ZDOTDIR that a new window wouldn't have.
fn zsh_dotdir(home: &Path) -> PathBuf {
    let probe = Shell::Zsh.binary().and_then(|zsh| {
        let mut command = Command::new(zsh);
        command.args(["-c", "print -r -- \"${ZDOTDIR:-$HOME}\""]);
        fresh_env(&mut command, home);
        run(command, Duration::from_secs(5)).ok()
    });
    probe
        .filter(|output| output.success)
        .map(|output| output.stdout.trim().to_string())
        .filter(|dir| dir.starts_with('/'))
        .map_or_else(|| home.to_path_buf(), PathBuf::from)
}

/// The environment a new Terminal window starts from, before any startup file runs.
fn fresh_env(command: &mut Command, home: &Path) {
    command
        .env_clear()
        .envs(std::env::vars_os().filter(|(key, _)| {
            ["USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL"]
                .iter()
                .any(|kept| key == kept)
        }))
        .env("HOME", home)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
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
    let installed = files.iter().all(|file| {
        fs::read_to_string(file).is_ok_and(|text| text.lines().any(|line| line == BEGIN))
    });
    let is_default = std::env::var_os("SHELL").is_some_and(|login| {
        Path::new(&login)
            .file_name()
            .is_some_and(|n| n == shell.name())
    });
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
        let file = fs::canonicalize(&file).unwrap_or(file);
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

/// Removes the block and the blank line `upsert_block` put before it.
fn remove_block(text: &str) -> String {
    let Some((start, end)) = block_range(text) else {
        return text.to_string();
    };
    let before = &text[..start];
    let before = before
        .strip_suffix("\n\n")
        .map_or(before, |b| &before[..b.len() + 1]);
    format!("{before}{}", &text[end..])
}

/// Byte range of the block, from the start of the BEGIN line through the END line's newline.
fn block_range(text: &str) -> Option<(usize, usize)> {
    let mut offset = 0;
    let mut start = None;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == BEGIN && start.is_none() {
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
        real: String,
    },
    /// An alias or function with the tool's name runs instead of anything on PATH.
    ShadowedByShell { kind: String },
    /// Another `tool` comes before the shims directory on PATH.
    ShadowedOnPath { path: String },
    /// The shell integration isn't active. Nothing named `tool` is on PATH.
    NotFound,
    /// The shim is first on PATH but couldn't route, e.g. the real tool isn't installed.
    ShimFailed { message: String },
}

/// Starts the shell the way Terminal does (login, interactive) in `folder`, asks it how
/// `tool` resolves, then asks the shim, run with that shell's PATH, how it would route.
/// Nothing here runs the real tool.
pub fn check_folder(shell: Shell, home: &Path, folder: &Path, tool: &str) -> Result<FolderCheck> {
    if !config::is_command_name(tool) {
        return Err(Error::Invalid(format!(
            "\"{tool}\" isn't a valid command name."
        )));
    }
    let binary = shell
        .binary()
        .ok_or_else(|| Error::Invalid(format!("{} isn't installed.", shell.name())))?;
    // Not the app's environment: launched from a terminal (as in development), its PATH may
    // already contain the shims.
    let mut command = Command::new(binary);
    command
        .args(["-l", "-i", "-c", &shell.probe(tool)])
        .current_dir(folder);
    fresh_env(&mut command, home);
    let output = run(command, Duration::from_secs(15))?;

    let field = |mark: &str| {
        output
            .stdout
            .lines()
            .rev()
            .find_map(|line| line.strip_prefix(mark))
            .map(str::trim)
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
            return Ok(FolderCheck::ShadowedByShell { kind: kind.into() })
        }
        "" | "none" => return Ok(FolderCheck::NotFound),
        _ => {}
    }

    let shim = fs::canonicalize(paths::shim_binary(home)).ok();
    let Some(first) = std::env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(tool))
        .find(|candidate| candidate.is_file())
    else {
        return Ok(FolderCheck::NotFound);
    };
    if shim.is_none() || fs::canonicalize(&first).ok() != shim {
        return Ok(FolderCheck::ShadowedOnPath {
            path: first.display().to_string(),
        });
    }

    let mut explain = Command::new(&first);
    explain
        .current_dir(folder)
        .env("HOME", home)
        .env("PATH", path)
        .env("ENVROUTER_EXPLAIN", "1");
    let output = run(explain, Duration::from_secs(5))?;
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
        real: explanation.real,
    })
}

/// What the app would route for `tool` in `folder`, from the config alone. Instant, and
/// independent of shell setup, so the editor can preview a profile before it's saved.
pub fn preview(config: &ConfigState, home: &Path, folder: &Path, tool: &str) -> Preview {
    let resolution = resolve::resolve(config, home, folder, tool);
    let (env_var, value) = resolution.env.unzip();
    Preview {
        profile: resolution.profile.map(|p| p.name.clone()),
        env_var,
        value,
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub profile: Option<String>,
    pub env_var: Option<String>,
    pub value: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Explanation {
    profile: Option<String>,
    env_var: Option<String>,
    value: Option<String>,
    real: String,
}

struct Finished {
    success: bool,
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
        stdout: read_all(&mut stdout),
        stderr: read_all(&mut stderr),
    })
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
        if Shell::Zsh.binary().is_none() {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        assert_eq!(Shell::Zsh.startup_files(&home), vec![home.join(".zshrc")]);

        fs::write(home.join(".zshenv"), "ZDOTDIR=\"$HOME/.config/zsh\"\n").unwrap();
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
                let output = Command::new(shell)
                    .args(["-c", &script])
                    .env_clear()
                    .env("HOME", home)
                    .env("PATH", before)
                    .output()
                    .unwrap();
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
        use std::os::unix::fs::PermissionsExt;
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
        if Shell::Zsh.binary().is_none() {
            return;
        }

        let (_root, home) = zsh_home("");
        assert_eq!(
            check(&home),
            FolderCheck::ShadowedOnPath {
                path: home.join("bin/claude").display().to_string()
            }
        );

        set_integration(Shell::Zsh, &home, true).unwrap();
        assert_eq!(
            check(&home),
            FolderCheck::Routed {
                profile: Some("Work".into()),
                env_var: Some("CLAUDE_CONFIG_DIR".into()),
                value: Some(home.join(".claude-work").display().to_string()),
                real: home.join("bin/claude").display().to_string(),
            }
        );

        let (_root, home) = zsh_home("claude() { echo mine; }\n");
        set_integration(Shell::Zsh, &home, true).unwrap();
        assert_eq!(
            check(&home),
            FolderCheck::ShadowedByShell {
                kind: "function".into()
            }
        );
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
