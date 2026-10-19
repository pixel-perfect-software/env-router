use std::path::{Path, PathBuf};
use std::{env, fs};

fn main() {
    stage_helpers();
    tauri_build::build();
}

/// Builds `envrouter-shim` and the `envrouter-keychain` helper and stages them where
/// `bundle.externalBin` expects them, so `tauri dev`, `tauri build` and `cargo test` all get
/// current ones with no separate step.
fn stage_helpers() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let target = env::var("TARGET").unwrap();
    let helpers = envrouter_build_support::build_helpers(manifest_dir.parent().unwrap());

    let stage = |built: &Path, name: &str| {
        let staged = manifest_dir
            .join("binaries")
            .join(format!("{name}-{target}"));
        fs::create_dir_all(staged.parent().unwrap()).unwrap();
        // The copy keeps the built file's timestamp, which is how `tauri build` sees it's current.
        fs::copy(built, &staged).unwrap();
        println!("cargo:rerun-if-changed={}", staged.display());
    };
    stage(&helpers.shim, "envrouter-shim");
    stage(&helpers.keychain, "envrouter-keychain");
}
