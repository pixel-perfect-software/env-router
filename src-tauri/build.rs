use std::path::PathBuf;
use std::process::Command;
use std::{env, fs};

fn main() {
    stage_shim();
    tauri_build::build()
}

/// Builds `envrouter-shim` and stages it where `bundle.externalBin` expects it, so
/// `tauri dev`, `tauri build` and `cargo test` all get a current shim with no separate step.
///
/// The shim is a release build whatever this build's profile. Every profile stages to the same
/// file, and the copy keeps the built file's timestamp, so with one build per profile a debug
/// build could leave its shim staged without the next release build noticing, and `tauri build`
/// would bundle it. One build for all also means development runs the shim users get.
fn stage_shim() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace = manifest_dir.parent().unwrap();
    let target = env::var("TARGET").unwrap();
    // The outer build holds the lock on the main target dir, so the shim gets its own.
    let target_dir = workspace.join("target").join("shim");

    let status = Command::new(env::var("CARGO").unwrap())
        .current_dir(workspace)
        .args([
            "build",
            "--release",
            "--package",
            "envrouter-shim",
            "--target",
            &target,
        ])
        .arg("--target-dir")
        .arg(&target_dir)
        .status()
        .expect("failed to run cargo for envrouter-shim");
    assert!(status.success(), "building envrouter-shim failed");

    let built = target_dir
        .join(&target)
        .join("release")
        .join("envrouter-shim");
    let staged = manifest_dir
        .join("binaries")
        .join(format!("envrouter-shim-{target}"));
    fs::create_dir_all(staged.parent().unwrap()).unwrap();
    fs::copy(&built, &staged).unwrap();

    // Tests install this copy into a temp home.
    println!("cargo:rustc-env=ENVROUTER_STAGED_SHIM={}", staged.display());
    for path in [
        workspace.join("crates/shim"),
        workspace.join("crates/core"),
        // Dependency versions and the release profile change the shim too.
        workspace.join("Cargo.lock"),
        workspace.join("Cargo.toml"),
        staged,
    ] {
        println!("cargo:rerun-if-changed={}", path.display());
    }
}
