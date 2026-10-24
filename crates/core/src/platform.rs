//! What differs between the systems EnvRouter runs on, in one place, so the rest of the code asks
//! a question ("does a new terminal start a login shell?") instead of checking the OS itself.
//!
//! Functions that take `home` never read `HOME` from the environment, so tests that pass a
//! scratch home can't reach the real one.

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    MacOs,
    /// A Linux desktop or server.
    Linux,
    /// A WSL 2 distro: Linux, started from Windows.
    Wsl,
    Windows,
}

impl Platform {
    /// The system this build is running on. WSL is told apart from other Linux at run time.
    pub fn current() -> Platform {
        if cfg!(target_os = "macos") {
            Platform::MacOs
        } else if cfg!(windows) {
            Platform::Windows
        } else if is_wsl() {
            Platform::Wsl
        } else {
            Platform::Linux
        }
    }

    /// How a new terminal window starts the user's shell. Terminal on macOS starts a login
    /// shell, and so does `wsl.exe` (and Windows Terminal through it). Linux desktop terminals
    /// (GNOME Terminal, Konsole and the rest) start an interactive shell that isn't a login
    /// shell, so bash reads only `.bashrc`.
    pub fn terminal_starts_login_shell(self) -> bool {
        !matches!(self, Platform::Linux)
    }

    /// What the window calls the store MCP secrets go to. A WSL distro keeps them in the
    /// Windows Credential Manager, through the Windows build of the helper.
    pub fn secret_store_name(self) -> &'static str {
        match self {
            Platform::MacOs => "Keychain",
            Platform::Linux => "keyring",
            Platform::Wsl | Platform::Windows => "Credential Manager",
        }
    }

    /// Whether this system's secret store is reached through the Windows helper installed in
    /// `~/.envrouter/bin`, which an uninstall must not delete before it has used it.
    pub fn secret_store_runs_installed_helper(self) -> bool {
        self == Platform::Wsl
    }

    /// What the menu bar calls showing `what` in the file manager: "Reveal config.json in Finder"
    /// on macOS, "Show config.json in Files" elsewhere. The window words the same thing in
    /// `src/lib/platform.ts` (`revealLabelOf`); #122 sends this one to it.
    pub fn reveal_label(self, what: &str) -> String {
        match self {
            Platform::MacOs => format!("Reveal {what} in Finder"),
            Platform::Linux | Platform::Wsl | Platform::Windows => format!("Show {what} in Files"),
        }
    }

    /// The shell to assume when the login shell can't be found: each system's default.
    pub fn default_shell_name(self) -> &'static str {
        match self {
            Platform::MacOs => "zsh",
            Platform::Linux | Platform::Wsl => "bash",
            Platform::Windows => "pwsh",
        }
    }
}

/// The folders Homebrew installs under: Apple Silicon, Intel, and Linux.
pub fn homebrew_prefixes() -> &'static [&'static str] {
    &["/opt/homebrew", "/usr/local", "/home/linuxbrew/.linuxbrew"]
}

/// The `.deb`'s package name (tauri-bundler's kebab-case of the product name), which
/// `apt remove` takes, and the binary it installs.
pub const DEB_PACKAGE: &str = "env-router";
pub const DEB_BINARY: &str = "/usr/bin/envrouter-app";

/// What is known about how the desktop app was installed.
#[derive(Debug, Default, PartialEq)]
pub struct AppFound<'a> {
    /// The app's bundle on macOS: the `.app` folder.
    pub bundle: Option<&'a Path>,
    /// Installed by Homebrew's cask (its Caskroom folder exists).
    pub cask: bool,
    /// The AppImage file the app runs from.
    pub appimage: Option<&'a Path>,
    /// Installed from the `.deb`.
    pub deb: bool,
}

/// The command that removes the desktop app, which EnvRouter can't remove itself. `None` when
/// it wasn't found installed (a development build, a system with no app).
pub fn app_removal(platform: Platform, found: &AppFound) -> Option<String> {
    match platform {
        Platform::MacOs if found.cask => Some("brew uninstall --zap --cask envrouter".into()),
        Platform::MacOs => found
            .bundle
            .map(|bundle| format!("mv {} ~/.Trash/", shell_quote(&bundle.to_string_lossy()))),
        Platform::Linux | Platform::Wsl => match found.appimage {
            Some(file) => Some(format!("rm {}", shell_quote(&file.to_string_lossy()))),
            None if found.deb => Some(format!("sudo apt remove {DEB_PACKAGE}")),
            None => None,
        },
        Platform::Windows => None,
    }
}

/// `text` in double quotes for a POSIX shell, to paste into a terminal.
pub fn shell_quote(text: &str) -> String {
    let mut quoted = String::from("\"");
    for c in text.chars() {
        if matches!(c, '"' | '\\' | '$' | '`') {
            quoted.push('\\');
        }
        quoted.push(c);
    }
    quoted.push('"');
    quoted
}

/// WSL sets `WSL_DISTRO_NAME` for processes it starts, and registers Windows interop with the
/// kernel. Either one is enough.
fn is_wsl() -> bool {
    std::env::var_os("WSL_DISTRO_NAME").is_some_and(|name| !name.is_empty())
        || Path::new("/proc/sys/fs/binfmt_misc/WSLInterop").exists()
}

/// Where desktop apps keep their per-user settings: `~/Library/Application Support` on macOS,
/// the XDG config folder elsewhere. `XDG_CONFIG_HOME` counts only when it's inside `home`, so a
/// scratch home in a test never points at the real config folder.
pub fn app_config_dir(platform: Platform, home: &Path) -> PathBuf {
    match platform {
        Platform::MacOs => home.join("Library/Application Support"),
        Platform::Windows => home.join("AppData/Roaming"),
        Platform::Linux | Platform::Wsl => xdg_config_home(home),
    }
}

/// `$XDG_CONFIG_HOME` when it's an absolute path inside `home`, otherwise `~/.config`.
pub fn xdg_config_home(home: &Path) -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute() && dir.starts_with(home))
        .unwrap_or_else(|| home.join(".config"))
}

/// The command that opens a text file in the user's editor, followed by the file.
pub fn open_text_file_command(platform: Platform) -> (&'static str, &'static [&'static str]) {
    match platform {
        Platform::MacOs => ("/usr/bin/open", &["-t"]),
        Platform::Linux | Platform::Wsl => ("xdg-open", &[]),
        Platform::Windows => ("notepad.exe", &[]),
    }
}

/// The user's login shell from the account database, for when `$SHELL` isn't set (an app
/// started from a `.desktop` file may not have it). Only on Linux, where `getent` reads
/// `/etc/passwd`, LDAP and the rest alike.
pub fn login_shell_from_account(user: &str) -> Option<PathBuf> {
    if !cfg!(target_os = "linux") || user.is_empty() {
        return None;
    }
    let output = std::process::Command::new("getent")
        .args(["passwd", user])
        .output()
        .ok()?;
    parse_passwd_shell(&String::from_utf8_lossy(&output.stdout))
}

/// The seventh field of a passwd line.
fn parse_passwd_shell(line: &str) -> Option<PathBuf> {
    let shell = line.lines().next()?.split(':').nth(6)?.trim();
    shell.starts_with('/').then(|| PathBuf::from(shell))
}

/// The PATH a new terminal window starts with, before any startup file runs.
///
/// - macOS: the bare system PATH; the login shell's `/etc/zprofile` or `/etc/profile` runs
///   `path_helper`, which rebuilds it.
/// - Linux: the desktop session's PATH, which terminals inherit. It comes from `PATH=` in
///   `/etc/environment` (set by PAM on Debian and Ubuntu), or the usual default.
/// - WSL: WSL's own default, followed by the Windows folders it appends (the `/mnt/` entries of
///   `inherited`, the PATH this process got).
pub fn new_terminal_path(platform: Platform, inherited: &str) -> String {
    const LINUX_DEFAULT: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    match platform {
        Platform::MacOs => "/usr/bin:/bin:/usr/sbin:/sbin".into(),
        Platform::Linux => fs::read_to_string("/etc/environment")
            .ok()
            .and_then(|text| path_from_etc_environment(&text))
            .unwrap_or_else(|| LINUX_DEFAULT.into()),
        Platform::Wsl => {
            let mut path = format!("{LINUX_DEFAULT}:/usr/games:/usr/local/games:/usr/lib/wsl/lib");
            for dir in inherited.split(':').filter(|dir| dir.starts_with("/mnt/")) {
                path.push(':');
                path.push_str(dir);
            }
            path
        }
        Platform::Windows => inherited.into(),
    }
}

/// `PATH=` from `/etc/environment`, which is `KEY=value` lines, optionally quoted, and no
/// variable expansion.
fn path_from_etc_environment(text: &str) -> Option<String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("PATH="))
        .map(|value| {
            value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string()
        })
        .rfind(|value| !value.is_empty())
}

/// Environment variables a new terminal inherits from the desktop session besides the basics,
/// so that programs started from startup files (a keyring agent, a prompt that checks the
/// display) behave as they would in a real window.
pub fn session_vars(platform: Platform) -> &'static [&'static str] {
    match platform {
        Platform::MacOs | Platform::Windows => &[],
        Platform::Linux | Platform::Wsl => &[
            "XDG_RUNTIME_DIR",
            "XDG_SESSION_TYPE",
            "XDG_CURRENT_DESKTOP",
            "XDG_DATA_DIRS",
            "XDG_CONFIG_DIRS",
            "DBUS_SESSION_BUS_ADDRESS",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "WSL_DISTRO_NAME",
            "WSL_INTEROP",
            "WSLENV",
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminals_start_login_shells_except_on_linux_desktops() {
        assert!(Platform::MacOs.terminal_starts_login_shell());
        assert!(Platform::Wsl.terminal_starts_login_shell());
        assert!(!Platform::Linux.terminal_starts_login_shell());
    }

    #[test]
    fn wsl_names_the_store_its_secrets_go_to() {
        assert_eq!(Platform::Linux.secret_store_name(), "keyring");
        assert_eq!(Platform::Wsl.secret_store_name(), "Credential Manager");
    }

    #[test]
    fn config_dirs_stay_inside_the_given_home() {
        let home = Path::new("/scratch/home");
        assert_eq!(
            app_config_dir(Platform::MacOs, home),
            home.join("Library/Application Support")
        );
        // Whatever XDG_CONFIG_HOME this test runs with, it isn't inside the scratch home.
        assert_eq!(app_config_dir(Platform::Linux, home), home.join(".config"));
    }

    #[test]
    fn reads_the_shell_from_a_passwd_line() {
        assert_eq!(
            parse_passwd_shell("sam:x:1000:1000:Sam,,,:/home/sam:/usr/bin/zsh\n"),
            Some(PathBuf::from("/usr/bin/zsh"))
        );
        assert_eq!(parse_passwd_shell("sam:x:1000:1000::/home/sam:"), None);
        assert_eq!(parse_passwd_shell(""), None);
    }

    #[test]
    fn reads_path_from_etc_environment() {
        assert_eq!(
            path_from_etc_environment("LANG=C\nPATH=\"/usr/local/bin:/usr/bin:/bin\"\n").as_deref(),
            Some("/usr/local/bin:/usr/bin:/bin")
        );
        assert_eq!(path_from_etc_environment("LANG=C\n"), None);
    }

    #[test]
    fn wsl_keeps_the_windows_folders_it_appended() {
        let path = new_terminal_path(
            Platform::Wsl,
            "/home/sam/.envrouter/shims:/usr/bin:/mnt/c/Windows/system32:/mnt/c/Users/sam/bin",
        );
        assert!(path.starts_with("/usr/local/sbin:"), "{path}");
        assert!(
            path.ends_with(":/mnt/c/Windows/system32:/mnt/c/Users/sam/bin"),
            "{path}"
        );
        assert!(!path.contains(".envrouter"), "{path}");
    }
}
