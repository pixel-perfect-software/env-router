//! Used from build scripts only. Builds `envrouter-shim` and the `envrouter-keychain` helper,
//! so the app can bundle them and the backend's tests can install them into a temp home.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The freshly built helper binaries, for the target this build is for.
pub struct Helpers {
    pub shim: PathBuf,
    pub keychain: PathBuf,
}

/// Builds both helpers and returns where they are. Call it from a build script; `workspace` is
/// the repository root.
///
/// It's always the `helpers` profile (release, with whole-program LTO), whatever the calling
/// build's profile. Every profile shares one build, so a debug build can't leave a debug shim
/// where `tauri build` would bundle it, and development runs the shim users get.
pub fn build_helpers(workspace: &Path) -> Helpers {
    let target = env::var("TARGET").unwrap();
    // The outer build holds the lock on the main target dir, so the helpers get their own,
    // inside whichever target dir this build uses.
    let target_dir = env::var_os("CARGO_TARGET_DIR")
        .map_or_else(|| workspace.join("target"), PathBuf::from)
        .join("shim");

    let status = Command::new(env::var("CARGO").unwrap())
        .current_dir(workspace)
        .args([
            "build",
            "--profile",
            "helpers",
            "--package",
            "envrouter-shim",
            "--package",
            "envrouter-keychain",
            "--target",
            &target,
        ])
        .arg("--target-dir")
        .arg(&target_dir)
        .status()
        .expect("failed to run cargo for envrouter-shim");
    assert!(status.success(), "building envrouter-shim failed");

    for path in [
        workspace.join("crates/shim"),
        workspace.join("crates/core"),
        workspace.join("crates/keychain"),
        // Dependency versions and the release profile change the shim too.
        workspace.join("Cargo.lock"),
        workspace.join("Cargo.toml"),
    ] {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    let built = |name: &str| target_dir.join(&target).join("helpers").join(name);
    Helpers {
        shim: built("envrouter-shim"),
        keychain: built("envrouter-keychain"),
    }
}
