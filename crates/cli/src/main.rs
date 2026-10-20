//! `envrouter`: EnvRouter without the window. It sets up and checks routing on a machine with
//! no desktop (a server, a WSL distro), and `envrouter rpc` is the bridge a window uses to
//! manage another machine. Every command is one of `envrouter_ops::commands`, the same code the
//! window runs.

use std::collections::HashMap;
use std::io::{self, BufRead, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand, ValueEnum};
use envrouter_core::config;
use envrouter_core::platform::Platform;
use envrouter_core::{agents, paths, Error, Result};
use envrouter_ops::commands::{self, SecretUse};
use envrouter_ops::editors::{Editor, EditorStatus};
use envrouter_ops::shell::{FolderCheck, Shell, ShellStatus};
use envrouter_ops::{rpc, shims};

#[derive(Parser)]
#[command(name = "envrouter", version, about = "Routes each coding agent to the right account and MCP servers by folder", long_about = None)]
struct Cli {
    /// Print results as JSON, in the window's wire format.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// What's set up: the shim, each shell and editor, and the config (the default).
    Status,
    /// Install the shim, the secrets helper and this command into ~/.envrouter/bin, and the
    /// shims for every agent the config names.
    Install,
    /// Turn routing on or off in a shell's startup files.
    Shell {
        #[arg(value_enum)]
        switch: Switch,
        #[arg(value_enum)]
        shell: ShellName,
    },
    /// Point an agent's editor extension at the shim, or stop it.
    Editor {
        #[arg(value_enum)]
        switch: Switch,
        #[arg(value_enum)]
        editor: EditorName,
        /// The agent whose extension to route, when the config has more than one.
        #[arg(long)]
        agent: Option<String>,
    },
    /// Open a shell the way a new terminal window would and report what running the tool there
    /// does. Exits 1 unless it's routed through the shim.
    Check {
        /// Defaults to the current folder.
        folder: Option<PathBuf>,
        #[arg(long, value_enum)]
        shell: Option<ShellName>,
        #[arg(long, default_value = "claude")]
        tool: String,
    },
    /// Which profile the saved config picks for a folder, without starting a shell.
    Explain {
        folder: Option<PathBuf>,
        #[arg(long, default_value = "claude")]
        tool: String,
    },
    /// Validate ~/.envrouter/config.json after editing it by hand, and render its MCP files and
    /// shims, as saving in the window does.
    Apply,
    /// Store the value of an MCP server's secret, or list the secrets the config refers to.
    Secret {
        #[command(subcommand)]
        action: SecretAction,
    },
    /// Answer the window's commands as JSON lines on stdin and stdout.
    Rpc,
}

#[derive(Subcommand)]
enum SecretAction {
    /// Store the value of a secret a server refers to as {"secret": "ID"} in its env or
    /// headers. The value is read from stdin, or typed without echo at a terminal, never from
    /// the command line.
    Set { id: String },
    /// Each secret the config refers to, the servers that use it, and whether it's stored.
    List,
}

#[derive(Clone, Copy, ValueEnum)]
enum Switch {
    On,
    Off,
}

#[derive(Clone, Copy, ValueEnum)]
enum ShellName {
    Zsh,
    Bash,
    Fish,
}

impl From<ShellName> for Shell {
    fn from(name: ShellName) -> Shell {
        match name {
            ShellName::Zsh => Shell::Zsh,
            ShellName::Bash => Shell::Bash,
            ShellName::Fish => Shell::Fish,
        }
    }
}

#[derive(Clone, Copy, ValueEnum)]
enum EditorName {
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

impl From<EditorName> for Editor {
    fn from(name: EditorName) -> Editor {
        match name {
            EditorName::Code => Editor::Code,
            EditorName::CodeInsiders => Editor::CodeInsiders,
            EditorName::Cursor => Editor::Cursor,
            EditorName::Windsurf => Editor::Windsurf,
            EditorName::Codium => Editor::Codium,
            EditorName::RemoteCode => Editor::RemoteCode,
            EditorName::RemoteCodeInsiders => Editor::RemoteCodeInsiders,
            EditorName::RemoteCursor => Editor::RemoteCursor,
            EditorName::RemoteWindsurf => Editor::RemoteWindsurf,
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let Some(home) = std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
    else {
        eprintln!("envrouter: {}", Error::NoHome);
        return ExitCode::from(2);
    };
    match run(&cli, &home) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("envrouter: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: &Cli, home: &Path) -> Result<ExitCode> {
    match cli.command.as_ref().unwrap_or(&Command::Status) {
        Command::Status => status(cli, home),
        Command::Install => install(cli, home),
        Command::Shell { switch, shell } => {
            let status = commands::set_shell_integration(
                home,
                (*shell).into(),
                matches!(switch, Switch::On),
            )?;
            print(cli, &status, || shell_line(&status, home));
            Ok(ExitCode::SUCCESS)
        }
        Command::Editor {
            switch,
            editor,
            agent,
        } => {
            let hooks = commands::saved_hooks(home)?;
            let (command, hook) = match agent {
                Some(agent) => hooks.get_key_value(agent.as_str()).ok_or_else(|| {
                    Error::Invalid(format!("The config has no editor hook for {agent}."))
                })?,
                None if hooks.len() == 1 => hooks.iter().next().expect("one hook"),
                None if hooks.is_empty() => {
                    return Err(Error::Invalid(
                        "The config names no agent with an editor extension. Add one to agents in config.json.".into(),
                    ))
                }
                None => {
                    return Err(Error::Invalid(format!(
                        "Say which agent with --agent: {}.",
                        hooks.keys().cloned().collect::<Vec<_>>().join(", ")
                    )))
                }
            };
            let status = commands::set_editor_integration(
                home,
                (*editor).into(),
                command,
                hook,
                matches!(switch, Switch::On),
            )?;
            print(cli, &status, || editor_line(&status, home));
            Ok(ExitCode::SUCCESS)
        }
        Command::Check {
            folder,
            shell,
            tool,
        } => {
            let folder = folder_or_cwd(folder.as_deref())?;
            let shell = shell.map_or_else(|| login_shell(home), Shell::from);
            let check = commands::check_folder(home, shell, &folder, tool)?;
            let routed = matches!(check, FolderCheck::Routed { .. });
            print(cli, &check, || verdict(&check, tool, shell, home));
            Ok(if routed {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }
        Command::Explain { folder, tool } => {
            let folder = folder_or_cwd(folder.as_deref())?;
            let config = commands::get_config(home)?;
            let preview = commands::preview_folder(home, &config, &folder, tool);
            print(cli, &preview, || {
                match (&preview.profile, &preview.env_var) {
                    (None, _) => format!(
                        "No profile owns {}, so {tool} runs with its own config.",
                        tilde(&folder, home)
                    ),
                    (Some(profile), None) => format!(
                        "{profile} leaves {tool}'s config alone here{}.",
                        mcp_suffix(&preview.mcp)
                    ),
                    (Some(profile), Some(var)) => format!(
                        "{profile}: {var}={}{}",
                        preview
                            .value
                            .as_deref()
                            .map_or_else(String::new, |v| tilde(Path::new(v), home)),
                        mcp_suffix(&preview.mcp)
                    ),
                }
            });
            Ok(ExitCode::SUCCESS)
        }
        Command::Apply => {
            let config = agents::with_agents(commands::get_config(home)?);
            commands::save_config_from_cli(home, &config, &HashMap::new())?;
            let file = paths::root(home).join(config::CONFIG_FILE);
            let applied = serde_json::json!({
                "config": file.display().to_string(),
                "profiles": config.profiles.len(),
                "mcpServers": config.mcp_servers.len(),
            });
            print(cli, &applied, || {
                format!(
                    "Applied {}: {} profile(s), {} MCP server(s).",
                    tilde(&file, home),
                    config.profiles.len(),
                    config.mcp_servers.len()
                )
            });
            Ok(ExitCode::SUCCESS)
        }
        Command::Secret {
            action: SecretAction::Set { id },
        } => set_secret(cli, home, id),
        Command::Secret {
            action: SecretAction::List,
        } => {
            let (secrets, problem) = commands::secrets(home)?;
            if let Some(problem) = problem {
                eprintln!("envrouter: couldn't read the secret store ({problem}), so it's not known which are stored.");
            }
            print(cli, &secrets, || secret_lines(&secrets));
            Ok(ExitCode::SUCCESS)
        }
        Command::Rpc => {
            serve_rpc(home)?;
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn status(cli: &Cli, home: &Path) -> Result<ExitCode> {
    let setup = commands::setup_status(home)?;
    let editors: Vec<EditorStatus> = commands::editor_status(home, &commands::saved_hooks(home)?)
        .into_iter()
        .filter(|e| e.available)
        .collect();
    if cli.json {
        let json = serde_json::json!({ "setup": setup, "editors": editors });
        println!("{json}");
        return Ok(ExitCode::SUCCESS);
    }
    let config = commands::get_config(home)?;
    println!(
        "Config  {} ({} profile(s), {} MCP server(s))",
        tilde(&paths::root(home).join(config::CONFIG_FILE), home),
        config.profiles.len(),
        config.mcp_servers.len()
    );
    println!(
        "Shim    {}",
        if setup.shim_installed {
            tilde(&paths::shim_binary(home), home)
        } else if paths::shim_binary(home).is_file() {
            // A different build than this command's, usually the desktop app's, which installs
            // its own on every launch. Where the app is in use, leave it to the app.
            format!(
                "{} (another build of EnvRouter's, such as the app's; `envrouter install` replaces it with this one)",
                tilde(&paths::shim_binary(home), home)
            )
        } else {
            "not installed: run `envrouter install`".into()
        }
    );
    println!("Shells");
    for shell in &setup.shells {
        println!("  {}", shell_line(shell, home));
    }
    if !editors.is_empty() {
        println!("Editors");
        for editor in &editors {
            println!("  {}", editor_line(editor, home));
        }
    }
    Ok(ExitCode::SUCCESS)
}

/// Installs from the files beside this command, as a release's archive lays them out.
fn install(cli: &Cli, home: &Path) -> Result<ExitCode> {
    let me = std::env::current_exe().map_err(|source| Error::Io {
        path: PathBuf::from("current executable"),
        source,
    })?;
    let changed = shims::install_bundled(home)? | shims::install_cli(home, &me)?;
    // In memory: install changes no config. `apply` (or the window) saves the filled agents.
    shims::sync(home, &agents::with_agents(commands::get_config(home)?))?;
    let bin = paths::root(home).join("bin");
    let installed = serde_json::json!({ "changed": changed, "binDir": bin.display().to_string() });
    print(cli, &installed, || {
        format!(
            "{} {}\nNext: `envrouter shell on {}` puts the shims first on PATH in new terminals.",
            if changed {
                "Installed in"
            } else {
                "Already up to date in"
            },
            tilde(&bin, home),
            Shell::from_name(login_shell(home).name()).map_or("bash", Shell::name)
        )
    });
    Ok(ExitCode::SUCCESS)
}

/// Stores one secret through the same save the window makes, so it's checked and pruned the
/// same way.
fn set_secret(cli: &Cli, home: &Path, id: &str) -> Result<ExitCode> {
    let config = agents::with_agents(commands::get_config(home)?);
    // Asked before the value is typed, so nobody types a secret only to have it refused.
    let Some(servers) = config::secret_users(&config)
        .remove(id)
        .map(|servers| servers.into_iter().map(str::to_string).collect::<Vec<_>>())
    else {
        return Err(Error::Invalid(format!(
            "No server uses a secret named {id}. Refer to it as {{\"secret\": \"{id}\"}} in a server's env or headers in config.json first."
        )));
    };
    let value = read_secret(id)?;
    commands::save_config_from_cli(home, &config, &HashMap::from([(id.to_string(), value)]))?;
    let stored = SecretUse {
        id: id.to_string(),
        servers,
        stored: Some(true),
    };
    print(cli, &stored, || {
        format!(
            "Stored {id} in the {}, for {}.",
            Platform::current().secret_store_name(),
            stored.servers.join(", ")
        )
    });
    Ok(ExitCode::SUCCESS)
}

/// A secret's value: typed without echo at a terminal, otherwise all of stdin. One trailing
/// line break is dropped, since `echo` and the Return key add one.
fn read_secret(id: &str) -> Result<String> {
    let stdin = io::stdin();
    let read_err = |err: io::Error| Error::Command(format!("couldn't read the value: {err}"));
    let mut value = String::new();
    if stdin.is_terminal() {
        eprint!("Value for {id} (not shown): ");
        let _ = io::stderr().flush();
        let echo = Echo::off(&stdin);
        let line = stdin.lock().read_line(&mut value);
        drop(echo);
        eprintln!();
        line.map_err(read_err)?;
    } else {
        stdin.lock().read_to_string(&mut value).map_err(read_err)?;
    }
    let value = value.strip_suffix('\n').map_or(value.as_str(), |line| {
        line.strip_suffix('\r').unwrap_or(line)
    });
    if value.is_empty() {
        return Err(Error::Invalid(format!("No value given for {id}.")));
    }
    Ok(value.to_string())
}

/// Turns the terminal's echo off until dropped. Where it can't, typing still works, visibly.
/// Ctrl-C (or a hangup or kill) would end the process before `Drop` runs and leave the shell
/// typing blind, so those signals are blocked and a thread waits for them instead: it puts echo
/// back, then exits as the signal would have.
struct Echo<'a> {
    stdin: &'a io::Stdin,
    saved: Option<nix::sys::termios::Termios>,
}

impl<'a> Echo<'a> {
    fn off(stdin: &'a io::Stdin) -> Self {
        use nix::sys::signal::{SigSet, Signal};
        use nix::sys::termios::{tcgetattr, tcsetattr, LocalFlags, SetArg};
        let Ok(saved) = tcgetattr(stdin) else {
            return Echo { stdin, saved: None };
        };
        let mut endings = SigSet::empty();
        for signal in [
            Signal::SIGINT,
            Signal::SIGTERM,
            Signal::SIGHUP,
            Signal::SIGQUIT,
        ] {
            endings.add(signal);
        }
        // Blocked before the thread starts, so it inherits the mask and only `wait` sees them.
        if endings.thread_block().is_ok() {
            let restore = saved.clone();
            std::thread::spawn(move || {
                if let Ok(signal) = endings.wait() {
                    let _ = tcsetattr(io::stdin(), SetArg::TCSANOW, &restore);
                    eprintln!();
                    std::process::exit(128 + signal as i32);
                }
            });
        }
        let mut quiet = saved.clone();
        quiet.local_flags.remove(LocalFlags::ECHO);
        let saved = tcsetattr(stdin, SetArg::TCSANOW, &quiet)
            .is_ok()
            .then_some(saved);
        Echo { stdin, saved }
    }
}

impl Drop for Echo<'_> {
    fn drop(&mut self) {
        if let Some(saved) = &self.saved {
            let _ =
                nix::sys::termios::tcsetattr(self.stdin, nix::sys::termios::SetArg::TCSANOW, saved);
        }
    }
}

/// One request per line in, one answer per line out, until stdin closes.
fn serve_rpc(home: &Path) -> Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|err| Error::Command(err.to_string()))?;
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|err| Error::Command(err.to_string()))?;
        if line.trim().is_empty() {
            continue;
        }
        let response = runtime.block_on(rpc::handle_line(home, &line));
        let json = serde_json::to_string(&response).expect("a response always serializes");
        writeln!(stdout, "{json}")
            .and_then(|()| stdout.flush())
            .map_err(|err| Error::Command(err.to_string()))?;
    }
    Ok(())
}

fn print<T: serde::Serialize>(cli: &Cli, value: &T, human: impl FnOnce() -> String) {
    if cli.json {
        println!(
            "{}",
            serde_json::to_string(value).expect("results always serialize")
        );
    } else {
        println!("{}", human());
    }
}

fn secret_lines(secrets: &[SecretUse]) -> String {
    if secrets.is_empty() {
        return "No server uses a secret.".into();
    }
    let width = secrets.iter().map(|s| s.id.len()).max().unwrap_or(0);
    secrets
        .iter()
        .map(|secret| {
            format!(
                "{:<width$}  {:<7}  {}",
                secret.id,
                match secret.stored {
                    Some(true) => "stored",
                    Some(false) => "missing",
                    None => "unknown",
                },
                secret.servers.join(", ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn shell_line(status: &ShellStatus, home: &Path) -> String {
    let name = status.shell.name();
    if !status.available {
        return format!("{name:<5} not installed");
    }
    let files: Vec<String> = status
        .startup_files
        .iter()
        .map(|f| tilde(Path::new(f), home))
        .collect();
    format!(
        "{name:<5} {:<4} {}{}",
        if status.installed { "on" } else { "off" },
        files.join(", "),
        if status.is_default {
            "  (login shell)"
        } else {
            ""
        }
    )
}

fn editor_line(status: &EditorStatus, home: &Path) -> String {
    let state = if status.installed {
        "on".to_string()
    } else if let Some(other) = &status.wrapper {
        format!("off (runs through {})", tilde(Path::new(other), home))
    } else if !status.extension_installed {
        format!("off ({} extension not installed)", status.command)
    } else {
        "off".to_string()
    };
    format!(
        "{:<24} {:<8} {state}  {}",
        status.editor.label(),
        status.command,
        tilde(Path::new(&status.settings_file), home)
    )
}

fn verdict(check: &FolderCheck, tool: &str, shell: Shell, home: &Path) -> String {
    let shell = shell.name();
    match check {
        FolderCheck::Routed {
            profile,
            env_var,
            value,
            mcp,
            real,
        } => {
            let route = match (profile, env_var, value) {
                (None, _, _) => {
                    "no profile owns this folder, so it uses its own config".to_string()
                }
                (Some(p), Some(var), Some(value)) => {
                    format!("{p} sets {var}={}", tilde(Path::new(value), home))
                }
                (Some(p), _, _) => format!("{p} leaves its config alone"),
            };
            format!(
                "Routed: {tool} in a new {shell} window runs through the shim; {route}{}. Runs {}.",
                mcp_suffix(mcp),
                tilde(Path::new(real), home)
            )
        }
        FolderCheck::ShadowedByShell { kind, origin } => format!(
            "Blocked: a {kind} named {tool} runs before PATH is searched{}.",
            origin.as_deref().map_or_else(String::new, |o| format!(
                " (defined in {})",
                tilde(Path::new(o), home)
            ))
        ),
        FolderCheck::ShadowedOnPath {
            path,
            by_prompt_hook,
        } => format!(
            "Blocked: {} comes before the shim on PATH in new {shell} windows{}.",
            tilde(Path::new(path), home),
            if *by_prompt_hook {
                ", moved ahead by a prompt hook (mise, direnv)"
            } else {
                "; is routing on? `envrouter shell on <shell>`"
            }
        ),
        FolderCheck::NotFound => format!("Not found: there's no {tool} on PATH, and no shim."),
        FolderCheck::NotInstalled => {
            format!(
                "Not installed: the shim is first on PATH, but there's no real {tool} after it."
            )
        }
        FolderCheck::ShimFailed { message } => format!("The shim failed: {message}"),
    }
}

fn mcp_suffix(servers: &[String]) -> String {
    if servers.is_empty() {
        String::new()
    } else {
        format!(", with MCP servers {}", servers.join(", "))
    }
}

/// The user's login shell, or the platform's default when it's not one EnvRouter handles.
fn login_shell(home: &Path) -> Shell {
    Shell::ALL
        .into_iter()
        .find(|&s| envrouter_ops::shell::status(s, home).is_default)
        .or_else(|| Shell::from_name(Platform::current().default_shell_name()))
        .unwrap_or(Shell::Bash)
}

fn folder_or_cwd(folder: Option<&Path>) -> Result<PathBuf> {
    match folder {
        Some(folder) => std::path::absolute(folder).map_err(|source| Error::Io {
            path: folder.to_path_buf(),
            source,
        }),
        None => std::env::current_dir().map_err(|source| Error::Io {
            path: PathBuf::from("."),
            source,
        }),
    }
}

/// `~/…` for paths in the home folder, as the window shows them.
fn tilde(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".into(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}
