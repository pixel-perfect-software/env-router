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

    /// Whether asking the secret store if it works can take a while: Linux's Secret Service is
    /// started on demand over D-Bus, and a WSL distro runs a Windows process. macOS and Windows
    /// answer without asking anything.
    pub fn store_check_can_block(self) -> bool {
        matches!(self, Platform::Linux | Platform::Wsl)
    }

    /// What a value kept in that store reads as in its field: "In Keychain", "In the keyring".
    pub fn sealed_label(self) -> &'static str {
        match self {
            Platform::MacOs => "In Keychain",
            Platform::Linux => "In the keyring",
            Platform::Wsl | Platform::Windows => "In the Credential Manager",
        }
    }

    /// Whether this system's secret store is reached through the Windows helper installed in
    /// `~/.envrouter/bin`, which an uninstall must not delete before it has used it.
    pub fn secret_store_runs_installed_helper(self) -> bool {
        self == Platform::Wsl
    }

    /// What the file manager is called here: Finder on macOS, Files elsewhere.
    pub fn file_manager(self) -> &'static str {
        match self {
            Platform::MacOs => "Finder",
            Platform::Linux | Platform::Wsl | Platform::Windows => "Files",
        }
    }

    /// The verb for showing something in it: "Reveal" on macOS, "Show" elsewhere.
    pub fn reveal_verb(self) -> &'static str {
        match self {
            Platform::MacOs => "Reveal",
            Platform::Linux | Platform::Wsl | Platform::Windows => "Show",
        }
    }

    /// What the menu bar calls showing `what` in the file manager: "Reveal config.json in Finder"
    /// on macOS, "Show config.json in Files" elsewhere. The window words the same thing from
    /// [`Platform::reveal_verb`] and [`Platform::file_manager`], which `SetupStatus` sends it.
    pub fn reveal_label(self, what: &str) -> String {
        format!("{} {what} in {}", self.reveal_verb(), self.file_manager())
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
    xdg_dir(home, "XDG_CONFIG_HOME", &[".config"])
}

/// The XDG variable `var` when it's an absolute path inside `home`, otherwise `home/default`.
fn xdg_dir(home: &Path, var: &str, default: &[&str]) -> PathBuf {
    std::env::var_os(var)
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute() && dir.starts_with(home))
        .unwrap_or_else(|| home.join(default.iter().collect::<PathBuf>()))
}

/// The bundle identifier in `src-tauri/tauri.conf.json`. macOS names the folders the webview and
/// the system keep for the app after it.
pub const APP_IDENTIFIER: &str = "com.tylerrobertson.envrouter";

/// The folders the desktop app's webview and the system keep for it under `home`, whether or not
/// they exist now. Tauri's `app_data_dir`, `app_cache_dir` and `app_log_dir` are never made: the
/// app asks for none of them. Its `app_config_dir` (`<config dir>/<identifier>`, see
/// [`app_config_dir`]) holds the window-state plugin's `.window-state.json`, written when the
/// app exits, and is listed too: last on macOS and Windows, and on Linux after the data folders,
/// with `~/.config` itself after `$XDG_CONFIG_HOME`.
///
/// - macOS: WKWebView's default store keeps its data in `~/Library/WebKit/<identifier>` and its
///   caches in `~/Library/Caches/<identifier>`, and the open panel leaves `NSNavLastRootDirectory`
///   and the like in `~/Library/Preferences/<identifier>.plist` (these three were made by the
///   built app). `HTTPStorages` and `Saved Application State` are the other places the system
///   names after an identifier. The cask's `zap` stanza lists the same six, the config folder
///   among them.
/// - Linux and WSL, Windows: Tauri gives the webview `app_local_data_dir` as its data folder
///   (`manager/webview.rs`: "in `windows`, we need to force a data_directory", on Linux too), which
///   is `<local data dir>/<identifier>`, and wry points WebKitGTK's data and cache at it, so
///   everything is in that one folder (a run of the built app made `CacheStorage`,
///   `WebKitCache`, `hsts-storage.sqlite`, `mediakeys` and `storage` there and nothing else).
///   The local data dir is `$XDG_DATA_HOME` or `~/.local/share` on Linux, read from the
///   environment the app started in, which this one may not share, so the default under `home`
///   counts too; and `~/AppData/Local` on Windows.
pub fn app_data_dirs(platform: Platform, home: &Path) -> Vec<PathBuf> {
    let mut dirs = match platform {
        Platform::MacOs => {
            let library = home.join("Library");
            vec![
                library.join("WebKit").join(APP_IDENTIFIER),
                library.join("Caches").join(APP_IDENTIFIER),
                library.join("HTTPStorages").join(APP_IDENTIFIER),
                library
                    .join("Saved Application State")
                    .join(format!("{APP_IDENTIFIER}.savedState")),
                library
                    .join("Preferences")
                    .join(format!("{APP_IDENTIFIER}.plist")),
                app_config_dir(platform, home).join(APP_IDENTIFIER),
            ]
        }
        Platform::Linux | Platform::Wsl => vec![
            xdg_dir(home, "XDG_DATA_HOME", &LINUX_DATA_DIR).join(APP_IDENTIFIER),
            home.join(LINUX_DATA_DIR.iter().collect::<PathBuf>())
                .join(APP_IDENTIFIER),
            app_config_dir(platform, home).join(APP_IDENTIFIER),
            home.join(".config").join(APP_IDENTIFIER),
        ],
        Platform::Windows => vec![
            home.join("AppData").join("Local").join(APP_IDENTIFIER),
            app_config_dir(platform, home).join(APP_IDENTIFIER),
        ],
    };
    dirs.dedup();
    dirs
}

/// `~/.local/share`, as path components.
const LINUX_DATA_DIR: [&str; 2] = [".local", "share"];

/// The XDG base folders the app started in named, read at the edge by whoever asks
/// ([`XdgHomes::from_env`]): this process may not share them (a scratch home in a test, a CLI run
/// from another session), so the platform code trusts them only inside `home` ([`xdg_dir`]) and
/// otherwise only names the app's folder in them ([`app_dirs_outside_home`]).
#[derive(Clone, Debug, Default)]
pub struct XdgHomes {
    /// `$XDG_DATA_HOME`: where the webview keeps its data on Linux.
    pub data: Option<PathBuf>,
    /// `$XDG_CONFIG_HOME`: where the app's config folder, with the window's state, is.
    pub config: Option<PathBuf>,
}

impl XdgHomes {
    pub fn from_env() -> Self {
        Self {
            data: std::env::var_os("XDG_DATA_HOME").map(PathBuf::from),
            config: std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from),
        }
    }
}

/// The folders Linux would keep the app's data and config in if `xdg` pointed outside `home`:
/// [`app_data_dirs`] leaves such a folder alone, since a path from the environment doesn't get to
/// name what is deleted, but an uninstall can say it is there. A variable that's unset, relative
/// (glib ignores those too) or inside `home` names none.
pub fn app_dirs_outside_home(platform: Platform, home: &Path, xdg: &XdgHomes) -> Vec<PathBuf> {
    match platform {
        Platform::Linux | Platform::Wsl => [&xdg.data, &xdg.config]
            .into_iter()
            .flatten()
            .filter(|dir| dir.is_absolute() && !dir.starts_with(home))
            .map(|dir| dir.join(APP_IDENTIFIER))
            .collect(),
        Platform::MacOs | Platform::Windows => Vec::new(),
    }
}

/// The preferences domain whose cached copy the system keeps, so that deleting its plist isn't
/// enough: `cfprefsd` can write it back. Only macOS has one.
pub fn preferences_domain(platform: Platform) -> Option<&'static str> {
    (platform == Platform::MacOs).then_some(APP_IDENTIFIER)
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

    /// `src/lib/platformWords.json` is what the window shows before the status arrives (and what
    /// its browser mock answers): it must say what each platform here says.
    #[test]
    fn the_windows_first_paint_words_match_these() {
        let file: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/lib/platformWords.json")).unwrap();
        let all = [
            Platform::MacOs,
            Platform::Linux,
            Platform::Wsl,
            Platform::Windows,
        ];
        assert_eq!(file.as_object().unwrap().len(), all.len());
        for platform in all {
            let key = serde_json::to_value(platform).unwrap();
            assert_eq!(
                file[key.as_str().unwrap()],
                serde_json::json!({
                    "secretStore": platform.secret_store_name(),
                    "sealedLabel": platform.sealed_label(),
                    "fileManager": platform.file_manager(),
                    "revealVerb": platform.reveal_verb(),
                }),
                "{platform:?}"
            );
        }
    }

    #[test]
    fn words_a_reveal_for_the_file_manager() {
        assert_eq!(
            Platform::MacOs.reveal_label("config.json"),
            "Reveal config.json in Finder"
        );
        assert_eq!(
            Platform::Wsl.reveal_label("config.json"),
            "Show config.json in Files"
        );
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
    fn the_apps_folders_are_named_under_the_given_home() {
        let home = Path::new("/scratch/home");
        let id = APP_IDENTIFIER;
        let library = home.join("Library");
        assert_eq!(
            app_data_dirs(Platform::MacOs, home),
            [
                library.join("WebKit").join(id),
                library.join("Caches").join(id),
                library.join("HTTPStorages").join(id),
                library
                    .join("Saved Application State")
                    .join(format!("{id}.savedState")),
                library.join("Preferences").join(format!("{id}.plist")),
                library.join("Application Support").join(id),
            ]
        );
        // Whatever XDG_DATA_HOME this test runs with, it isn't inside the scratch home, so it
        // counts for nothing and the default isn't listed twice.
        let linux = [
            home.join(".local").join("share").join(id),
            home.join(".config").join(id),
        ];
        assert_eq!(app_data_dirs(Platform::Linux, home), linux);
        assert_eq!(app_data_dirs(Platform::Wsl, home), linux);
        assert_eq!(
            app_data_dirs(Platform::Windows, home),
            [
                home.join("AppData").join("Local").join(id),
                home.join("AppData").join("Roaming").join(id)
            ]
        );
    }

    #[test]
    fn an_xdg_folder_outside_the_home_is_named_but_never_listed_for_deletion() {
        let home = Path::new("/scratch/home");
        let id = APP_IDENTIFIER;
        let outside = |platform, data: Option<&str>, config: Option<&str>| {
            app_dirs_outside_home(
                platform,
                home,
                &XdgHomes {
                    data: data.map(PathBuf::from),
                    config: config.map(PathBuf::from),
                },
            )
        };
        assert_eq!(
            outside(Platform::Linux, Some("/data"), Some("/conf")),
            [Path::new("/data").join(id), Path::new("/conf").join(id)]
        );
        assert_eq!(outside(Platform::Wsl, None, Some("/conf")).len(), 1);
        assert!(outside(Platform::Linux, Some("/scratch/home/data"), Some("conf")).is_empty());
        assert!(outside(Platform::Linux, None, None).is_empty());
        assert!(outside(Platform::MacOs, Some("/data"), Some("/conf")).is_empty());
    }

    /// The names come from the app's config and the cask; this is what keeps them in step.
    #[test]
    fn the_names_and_the_casks_zap_list_match_the_apps_config() {
        let config = |text: &str| serde_json::from_str::<serde_json::Value>(text).unwrap();
        let tauri = config(include_str!("../../../src-tauri/tauri.conf.json"));
        assert_eq!(tauri["identifier"], APP_IDENTIFIER);

        let cask = include_str!("../../../packaging/homebrew/envrouter.rb.in");
        let zap = cask.split("zap trash: [").nth(1).unwrap();
        let mut zapped: Vec<&str> = zap
            .split(']')
            .next()
            .unwrap()
            .split('"')
            .filter(|entry| entry.starts_with("~/Library/"))
            .collect();
        let mut removed: Vec<String> = app_data_dirs(Platform::MacOs, Path::new("~"))
            .iter()
            .map(|dir| dir.display().to_string())
            .collect();
        zapped.sort_unstable();
        removed.sort_unstable();
        assert_eq!(zapped, removed);
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
