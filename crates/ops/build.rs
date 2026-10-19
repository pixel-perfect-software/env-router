use std::env;
use std::path::PathBuf;

/// The tests install the real shim and secrets helper into a temp home, so they're built first.
fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let helpers =
        envrouter_build_support::build_helpers(manifest_dir.parent().unwrap().parent().unwrap());
    println!(
        "cargo:rustc-env=ENVROUTER_STAGED_SHIM={}",
        helpers.shim.display()
    );
    println!(
        "cargo:rustc-env=ENVROUTER_STAGED_KEYCHAIN={}",
        helpers.keychain.display()
    );
}
