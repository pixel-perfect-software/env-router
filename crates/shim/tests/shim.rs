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
  "version": 1,
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
