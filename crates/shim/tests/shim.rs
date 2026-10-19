//! Runs the built shim the way a shell would: through a `claude` symlink in a shims
//! directory at the front of PATH, with a fake `claude` further along that reports what it
//! received.

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const SHIM: &str = env!("CARGO_BIN_EXE_envrouter-shim");

const CONFIG: &str = r#"{
  "version": 2,
  "profiles": [
    { "id": "1", "name": "Personal", "triggerPaths": ["~/dev"],
      "tools": { "claude": { "envVar": "CLAUDE_CONFIG_DIR", "path": "~/.claude-me" } } },
    { "id": "2", "name": "Work", "triggerPaths": ["~/dev/work/*"],
      "tools": { "claude": { "envVar": "CLAUDE_CONFIG_DIR", "path": "~/.claude-work" } } },
    { "id": "3", "name": "Plain", "triggerPaths": ["~/dev/plain"], "tools": {} }
  ]
}"#;

struct Fixture {
    _root: tempfile::TempDir,
    home: PathBuf,
    shims: PathBuf,
    real_bin: PathBuf,
}

impl Fixture {
    fn new(config: Option<&str>) -> Self {
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap().join("home");
        for dir in [
            "dev/work/app",
            "dev/workshop",
            "dev/plain/sub",
            "elsewhere",
            ".envrouter/shims",
        ] {
            fs::create_dir_all(home.join(dir)).unwrap();
        }
        let shims = home.join(".envrouter/shims");
        symlink(SHIM, shims.join("claude")).unwrap();

        let real_bin = home.join("real-bin");
        fs::create_dir_all(&real_bin).unwrap();
        write_executable(
            &real_bin.join("claude"),
            "#!/bin/sh\necho \"${CLAUDE_CONFIG_DIR-unset} $# $*\"\nexit 3\n",
        );

        if let Some(config) = config {
            fs::write(home.join(".envrouter/config.json"), config).unwrap();
        }
        Self {
            _root: root,
            home,
            shims,
            real_bin,
        }
    }

    fn default_path(&self) -> String {
        format!(
            "{}:{}:/usr/bin:/bin",
            self.shims.display(),
            self.real_bin.display()
        )
    }

    fn run(&self, cwd: &str, path: &str) -> Output {
        Command::new(self.shims.join("claude"))
            .args(["two words", "x"])
            .current_dir(self.home.join(cwd))
            .env("HOME", &self.home)
            .env("PATH", path)
            .env_remove("CLAUDE_CONFIG_DIR")
            .env_remove("ENVROUTER_EXPLAIN")
            .output()
            .unwrap()
    }
}

fn write_executable(path: &Path, contents: &str) {
    fs::write(path, contents).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn routes_each_folder_to_its_most_specific_profile() {
    let f = Fixture::new(Some(CONFIG));
    let h = f.home.display();
    for (cwd, expected) in [
        ("dev/work/app", format!("{h}/.claude-work")),
        ("dev/workshop", format!("{h}/.claude-me")),
        ("dev", format!("{h}/.claude-me")),
        ("dev/plain/sub", "unset".into()),
        ("elsewhere", "unset".into()),
    ] {
        let output = f.run(cwd, &f.default_path());
        assert_eq!(
            stdout(&output),
            format!("{expected} 2 two words x\n"),
            "{cwd}: {}",
            stderr(&output)
        );
        assert_eq!(output.status.code(), Some(3), "exit code passes through");
    }
}

#[test]
fn missing_config_runs_the_tool_unrouted_and_quietly() {
    let f = Fixture::new(None);
    let output = f.run("dev/work/app", &f.default_path());
    assert_eq!(stdout(&output), "unset 2 two words x\n");
    assert_eq!(stderr(&output), "");
}

#[test]
fn broken_config_warns_but_still_runs_the_tool() {
    let f = Fixture::new(Some("{ not json"));
    let output = f.run("dev/work/app", &f.default_path());
    assert_eq!(stdout(&output), "unset 2 two words x\n");
    assert!(
        stderr(&output).starts_with("envrouter: "),
        "{}",
        stderr(&output)
    );
}

#[test]
fn reports_a_missing_tool_with_exit_127() {
    let f = Fixture::new(Some(CONFIG));
    let output = f.run("elsewhere", &format!("{}:/usr/bin:/bin", f.shims.display()));
    assert_eq!(output.status.code(), Some(127));
    assert!(
        stderr(&output).contains("can't find `claude`"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn never_execs_itself_through_duplicate_or_aliased_shim_dirs() {
    let f = Fixture::new(Some(CONFIG));
    let alias_dir = f.home.join("other-shims");
    fs::create_dir_all(&alias_dir).unwrap();
    symlink(SHIM, alias_dir.join("claude")).unwrap();
    let linked_dir = f.home.join("linked-shims");
    symlink(&f.shims, &linked_dir).unwrap();

    let path = format!(
        "{s}:{s}:{}:{}:{}:/usr/bin:/bin",
        linked_dir.display(),
        alias_dir.display(),
        f.real_bin.display(),
        s = f.shims.display()
    );
    let output = f.run("dev/work/app", &path);
    assert!(
        stdout(&output).ends_with("2 two words x\n"),
        "{}",
        stderr(&output)
    );
}

/// A second install of the shim (one made under a scratch HOME, say) is on PATH too, and
/// HOME names neither install, so the shims-directory filter can't help. Without the copy
/// check, each shim would exec the other forever; the deadline turns that into a failure.
#[test]
fn never_execs_another_copy_of_the_shim() {
    let f = Fixture::new(Some(CONFIG));
    let other = f.home.join("scratch/.envrouter");
    fs::create_dir_all(other.join("bin")).unwrap();
    fs::create_dir_all(other.join("shims")).unwrap();
    fs::copy(SHIM, other.join("bin/envrouter-shim")).unwrap();
    symlink(other.join("bin/envrouter-shim"), other.join("shims/claude")).unwrap();

    let mut child = Command::new(f.shims.join("claude"))
        .args(["two words", "x"])
        .current_dir(f.home.join("elsewhere"))
        .env("HOME", f.home.join("elsewhere"))
        .env(
            "PATH",
            format!(
                "{}:{}:{}:/usr/bin:/bin",
                f.shims.display(),
                other.join("shims").display(),
                f.real_bin.display()
            ),
        )
        .env_remove("CLAUDE_CONFIG_DIR")
        .env_remove("ENVROUTER_EXPLAIN")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() > deadline {
            child.kill().unwrap();
            panic!("the shim and its copy kept exec'ing each other");
        }
        thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().unwrap();
    assert_eq!(
        stdout(&output),
        "unset 2 two words x\n",
        "{}",
        stderr(&output)
    );
}

#[test]
fn skips_empty_path_entries_instead_of_searching_the_current_directory() {
    let f = Fixture::new(Some(CONFIG));
    write_executable(
        &f.home.join("elsewhere/claude"),
        "#!/bin/sh\necho planted\n",
    );
    let output = f.run(
        "elsewhere",
        &format!(
            "{}::{}:/usr/bin:/bin",
            f.shims.display(),
            f.real_bin.display()
        ),
    );
    assert_eq!(stdout(&output), "unset 2 two words x\n");
}

#[test]
fn explain_reports_the_route_without_running_the_tool() {
    let f = Fixture::new(Some(CONFIG));
    let output = Command::new(f.shims.join("claude"))
        .current_dir(f.home.join("dev/work/app"))
        .env("HOME", &f.home)
        .env("PATH", f.default_path())
        .env("ENVROUTER_EXPLAIN", "1")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", stderr(&output));
    let explanation: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(explanation["profile"], "Work");
    assert_eq!(explanation["envVar"], "CLAUDE_CONFIG_DIR");
    assert_eq!(
        explanation["value"],
        format!("{}/.claude-work", f.home.display())
    );
    assert_eq!(
        explanation["real"],
        f.real_bin.join("claude").display().to_string()
    );
}

#[test]
fn explain_needs_exactly_1_so_a_stray_value_still_runs_the_tool() {
    let f = Fixture::new(Some(CONFIG));
    for value in ["0", ""] {
        let output = Command::new(f.shims.join("claude"))
            .current_dir(f.home.join("elsewhere"))
            .env("HOME", &f.home)
            .env("PATH", f.default_path())
            .env("ENVROUTER_EXPLAIN", value)
            .env_remove("CLAUDE_CONFIG_DIR")
            .output()
            .unwrap();
        assert_eq!(stdout(&output), "unset 0 \n", "ENVROUTER_EXPLAIN={value:?}");
    }
}

#[test]
fn refuses_to_run_under_its_own_name() {
    let home = tempfile::tempdir().unwrap();
    let output = Command::new(SHIM)
        .env_clear()
        .env("HOME", home.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
}

impl Fixture {
    /// Writes the launch manifest the app would render for `profile_id`'s `claude`.
    fn write_launch(&self, profile_id: &str, launch: &serde_json::Value) {
        let dir = self
            .home
            .join(".envrouter/mcp")
            .join(profile_id)
            .join("claude");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("launch.json"), launch.to_string()).unwrap();
    }

    fn run_with(&self, cwd: &str, args: &[&str], env: &[(&str, &str)]) -> Output {
        Command::new(self.shims.join("claude"))
            .args(args)
            .current_dir(self.home.join(cwd))
            .env("HOME", &self.home)
            .env("PATH", self.default_path())
            .env_remove("CLAUDE_CONFIG_DIR")
            .env_remove("ENVROUTER_EXPLAIN")
            .env_remove("ENVROUTER_MCP")
            .envs(env.iter().copied())
            .output()
            .unwrap()
    }
}

fn fs_server() -> serde_json::Value {
    serde_json::json!({
        "skipAnyArgs": ["--strict-mcp-config"],
        "servers": [{
            "name": "fs",
            "args": ["--mcp-config=/m/fs.json", "--disallowedTools=mcp__fs__rm"],
        }],
    })
}

#[test]
fn injects_mcp_arguments_ahead_of_the_users_own() {
    let f = Fixture::new(Some(CONFIG));
    f.write_launch("2", &fs_server());
    let output = f.run_with("dev/work/app", &["--", "two words"], &[]);
    assert_eq!(
        stdout(&output),
        format!(
            "{}/.claude-work 4 --mcp-config=/m/fs.json --disallowedTools=mcp__fs__rm -- two words\n",
            f.home.display()
        )
    );
    assert_eq!(stderr(&output), "");

    // Another profile has no manifest, so it gets nothing, quietly.
    let output = f.run_with("dev", &["x"], &[]);
    assert_eq!(
        stdout(&output),
        format!("{}/.claude-me 1 x\n", f.home.display())
    );
    assert_eq!(stderr(&output), "");
}

#[test]
fn injects_mcp_servers_for_a_profile_that_leaves_the_variable_alone() {
    let f = Fixture::new(Some(CONFIG));
    f.write_launch("3", &fs_server());
    let output = f.run_with("dev/plain/sub", &[], &[]);
    assert_eq!(
        stdout(&output),
        "unset 2 --mcp-config=/m/fs.json --disallowedTools=mcp__fs__rm\n"
    );
}

#[test]
fn skips_mcp_injection_when_asked() {
    let f = Fixture::new(Some(CONFIG));
    f.write_launch("2", &fs_server());
    let output = f.run_with("dev/work/app", &["--strict-mcp-config", "x"], &[]);
    assert!(
        stdout(&output).ends_with(" 2 --strict-mcp-config x\n"),
        "{}",
        stdout(&output)
    );
    let output = f.run_with("dev/work/app", &["x"], &[("ENVROUTER_MCP", "0")]);
    assert!(stdout(&output).ends_with(" 1 x\n"), "{}", stdout(&output));
}

#[test]
fn a_broken_manifest_warns_and_runs_without_mcp() {
    let f = Fixture::new(Some(CONFIG));
    let dir = f.home.join(".envrouter/mcp/2/claude");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("launch.json"), "{ not json").unwrap();
    let output = f.run_with("dev/work/app", &["x"], &[]);
    assert_eq!(
        stdout(&output),
        format!("{}/.claude-work 1 x\n", f.home.display())
    );
    assert!(
        stderr(&output).contains("without MCP servers"),
        "{}",
        stderr(&output)
    );
}

/// The scratch HOME has no Keychain item, so the server that needs a secret is left out and
/// the other still loads. (The lookup is keyed by HOME, so it never sees the real secrets.)
#[test]
fn leaves_out_a_server_whose_secret_is_unavailable() {
    let f = Fixture::new(Some(CONFIG));
    f.write_launch(
        "2",
        &serde_json::json!({
            "servers": [
                { "name": "github", "args": ["--mcp-config=/m/github.json"], "secrets": ["7F3A"] },
                { "name": "fs", "args": ["--mcp-config=/m/fs.json"] },
            ],
        }),
    );
    let output = f.run_with("dev/work/app", &["x"], &[]);
    assert_eq!(
        stdout(&output),
        format!(
            "{}/.claude-work 2 --mcp-config=/m/fs.json x\n",
            f.home.display()
        )
    );
    assert!(stderr(&output).contains("github"), "{}", stderr(&output));
}

#[test]
fn explain_lists_the_mcp_servers_without_asking_the_keychain() {
    let f = Fixture::new(Some(CONFIG));
    f.write_launch(
        "2",
        &serde_json::json!({
            "servers": [{ "name": "github", "args": ["--mcp-config=/m/github.json"], "secrets": ["7F3A"] }],
        }),
    );
    let output = f.run_with("dev/work/app", &[], &[("ENVROUTER_EXPLAIN", "1")]);
    assert!(output.status.success(), "{}", stderr(&output));
    let explanation: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(explanation["mcp"], serde_json::json!(["github"]));
    assert_eq!(stderr(&output), "");
}

/// A fake Keychain helper hands back the secret, and only servers whose secrets all arrived
/// load. Values reach the agent's environment, never its arguments.
#[test]
fn passes_secrets_from_the_keychain_helper_as_environment_variables() {
    let f = Fixture::new(Some(CONFIG));
    let bin = f.home.join(".envrouter/bin");
    fs::create_dir_all(&bin).unwrap();
    write_executable(
        &bin.join("envrouter-keychain"),
        "#!/bin/sh\n[ \"$1\" = read ] && [ \"$2\" = 7F3A ] && echo '{\"7F3A\":\"ghp_x\"}'\n",
    );
    write_executable(
        &f.real_bin.join("claude"),
        "#!/bin/sh\necho \"${ENVROUTER_SECRET_7F3A-unset} $*\"\n",
    );
    f.write_launch(
        "2",
        &serde_json::json!({
            "servers": [{ "name": "github", "args": ["--mcp-config=/m/github.json"], "secrets": ["7F3A"] }],
        }),
    );
    let output = f.run_with("dev/work/app", &["x"], &[]);
    assert_eq!(
        stdout(&output),
        "ghp_x --mcp-config=/m/github.json x\n",
        "{}",
        stderr(&output)
    );
    assert_eq!(stderr(&output), "");
}
