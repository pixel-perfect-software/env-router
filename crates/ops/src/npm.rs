//! Looks up an npm package's dist-tags (`latest` and the like), for pinning an `npx` server to
//! one version. It runs the user's own npm, so the registry and sign-in their `~/.npmrc` sets
//! apply, and only when the user asks. It never runs the package itself.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use envrouter_core::{Error, Result};
use serde::Deserialize;

/// A registry that answers at all answers well within this.
const TIMEOUT: Duration = Duration::from_secs(30);

/// The dist-tags of `package` (`{"latest": "1.4.0", "next": "2.0.0-beta.1"}`), from the npm
/// beside `command`, the `npx` the server runs with. `path` is the PATH a new terminal gets.
pub async fn dist_tags(
    home: &Path,
    path: &str,
    command: &str,
    package: &str,
) -> Result<BTreeMap<String, String>> {
    if !is_package_name(package) {
        return Err(Error::Invalid(format!(
            "{package} isn't an npm package name."
        )));
    }
    let npm = npm_beside(command)?;
    let run = tokio::process::Command::new(&npm)
        .args(["view", package, "dist-tags", "--json"])
        .env("PATH", path)
        .env("HOME", home)
        // Like the server itself (`mcp::launch_args`), away from any project's package.json.
        .current_dir(home)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = match tokio::time::timeout(TIMEOUT, run).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            return Err(Error::Command(format!(
                "Couldn't run {}: {err}.",
                npm.display()
            )))
        }
        Err(_) => {
            return Err(Error::Command(format!(
                "npm didn't answer within {} seconds.",
                TIMEOUT.as_secs()
            )))
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    if output.status.success() {
        if let Ok(tags) = serde_json::from_str::<BTreeMap<String, String>>(&stdout) {
            if !tags.is_empty() {
                return Ok(tags);
            }
        }
        return Err(Error::Command(format!(
            "npm didn't say which versions of {package} there are."
        )));
    }
    Err(Error::Command(failure(
        package,
        &stdout,
        &String::from_utf8_lossy(&output.stderr),
    )))
}

/// The npm that comes with `command`: the one in the same folder for a path, else the one on
/// PATH. Only `npx` servers have a package to look up.
fn npm_beside(command: &str) -> Result<PathBuf> {
    let command = Path::new(command);
    if command.file_name().is_none_or(|name| name != "npx") {
        return Err(Error::Invalid(format!(
            "{} isn't npx, so there's no npm package to look up.",
            command.display()
        )));
    }
    Ok(if command.components().count() > 1 {
        command.with_file_name("npm")
    } else {
        PathBuf::from("npm")
    })
}

/// npm's own `--json` error (`{"error": {"code": "E404", "summary": …}}`), else its last line.
fn failure(package: &str, stdout: &str, stderr: &str) -> String {
    #[derive(Deserialize)]
    struct Failure {
        error: Detail,
    }
    #[derive(Deserialize)]
    struct Detail {
        code: Option<String>,
        summary: Option<String>,
    }
    let detail = serde_json::from_str::<Failure>(stdout)
        .ok()
        .map(|f| f.error);
    if detail.as_ref().and_then(|d| d.code.as_deref()) == Some("E404") {
        return format!("npm has no package named {package}.");
    }
    let said = detail
        .and_then(|d| d.summary)
        .or_else(|| {
            stderr
                .lines()
                .rev()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "it failed without saying why".into());
    format!("npm couldn't look up {package}: {said}")
}

/// A registry package's name, scoped or not. It goes to npm as an argument, so nothing that
/// npm would read as an option or a path gets through.
fn is_package_name(s: &str) -> bool {
    let name = match s.strip_prefix('@') {
        Some(scoped) => match scoped.split_once('/') {
            Some((scope, name)) if is_name_part(scope) => name,
            _ => return false,
        },
        None => s,
    };
    s.len() <= 214 && is_name_part(name)
}

fn is_name_part(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with(['.', '_', '-'])
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// See `mcp_probe`'s: the script is copied into place so no test thread forks while this
    /// process holds it open for writing.
    fn write_executable(path: &Path, contents: &str) {
        use std::os::unix::fs::PermissionsExt;
        let source = path.with_extension("src");
        fs::write(&source, contents).unwrap();
        let copied = std::process::Command::new("cp")
            .arg(&source)
            .arg(path)
            .status()
            .unwrap();
        assert!(copied.success());
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn run(
        home: &Path,
        path: &str,
        command: &str,
        package: &str,
    ) -> Result<BTreeMap<String, String>> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(dist_tags(home, path, command, package))
    }

    /// An npm that answers `view <package> dist-tags --json` for one package and 404s the rest,
    /// as npm 11 does.
    const FAKE_NPM: &str = r#"#!/bin/sh
[ "$1 $3 $4" = "view dist-tags --json" ] || exit 2
if [ "$2" = "@acme/mcp" ]; then
  printf '{\n  "latest": "1.4.0",\n  "next": "2.0.0-beta.1"\n}\n'
else
  printf '{\n  "error": {\n    "code": "E404",\n    "summary": "Not Found - GET https://registry.npmjs.org/%s"\n  }\n}\n' "$2"
  echo "npm error code E404" >&2
  exit 1
fi
"#;

    #[test]
    fn reads_the_tags_from_the_npm_beside_npx() {
        let dir = tempfile::tempdir().unwrap();
        write_executable(&dir.path().join("npm"), FAKE_NPM);
        let npx = dir.path().join("npx").display().to_string();
        let tags = run(dir.path(), "/usr/bin:/bin", &npx, "@acme/mcp").unwrap();
        assert_eq!(tags["latest"], "1.4.0");
        assert_eq!(tags["next"], "2.0.0-beta.1");
    }

    #[test]
    fn finds_npm_on_the_path_for_a_bare_npx() {
        let dir = tempfile::tempdir().unwrap();
        write_executable(&dir.path().join("npm"), FAKE_NPM);
        let path = format!("{}:/usr/bin:/bin", dir.path().display());
        let tags = run(dir.path(), &path, "npx", "@acme/mcp").unwrap();
        assert_eq!(tags["latest"], "1.4.0");
    }

    #[test]
    fn says_when_there_is_no_such_package() {
        let dir = tempfile::tempdir().unwrap();
        write_executable(&dir.path().join("npm"), FAKE_NPM);
        let path = format!("{}:/usr/bin:/bin", dir.path().display());
        let err = run(dir.path(), &path, "npx", "acme-nope").unwrap_err();
        assert_eq!(err.to_string(), "npm has no package named acme-nope.");
    }

    #[test]
    fn says_what_npm_said_when_it_fails_otherwise() {
        let dir = tempfile::tempdir().unwrap();
        write_executable(
            &dir.path().join("npm"),
            "#!/bin/sh\necho 'npm error code ENOTFOUND' >&2\necho 'npm error network request failed' >&2\nexit 1\n",
        );
        let npx = dir.path().join("npx").display().to_string();
        let err = run(dir.path(), "/usr/bin:/bin", &npx, "@acme/mcp").unwrap_err();
        assert_eq!(
            err.to_string(),
            "npm couldn't look up @acme/mcp: npm error network request failed"
        );
    }

    #[test]
    fn looks_up_only_npx_packages_by_name() {
        let dir = tempfile::tempdir().unwrap();
        for (command, package) in [
            ("uvx", "mcp-server-git"),
            ("npx", "--registry=https://evil.example"),
            ("npx", "./server"),
            ("npx", "@scope"),
            ("npx", "github:acme/mcp"),
        ] {
            assert!(
                matches!(
                    run(dir.path(), "/usr/bin:/bin", command, package),
                    Err(Error::Invalid(_))
                ),
                "{command} {package}"
            );
        }
    }

    #[test]
    fn accepts_registry_names() {
        for name in [
            "@upstash/context7-mcp",
            "chrome-devtools-mcp",
            "firebase-tools",
            "JSONStream",
        ] {
            assert!(is_package_name(name), "{name}");
        }
    }
}
