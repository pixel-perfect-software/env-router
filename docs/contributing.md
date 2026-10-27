# Contributing to EnvRouter

Thanks for helping. This guide covers setting up a development checkout, the commands CI runs,
how to work on the app without touching your real setup, and the rules the code keeps.

## 🛠️ Setup

Install the tools in the README's [Build from source](../README.md#-build-from-source) section
(Xcode's command line tools on macOS or the WebKitGTK packages on Linux, rustup, Node.js 24 or
later, pnpm; or `asdf install` for the Node and pnpm in `.tool-versions`), then:

```sh
git clone https://github.com/pixel-perfect-software/env-router.git
cd env-router
pnpm install
```

The first Rust build installs the toolchain pinned in `rust-toolchain.toml`, with clippy and
rustfmt. To run the same checks as CI you also want:

```sh
cargo install cargo-deny cargo-machete
brew install fish   # optional: fish's folder-check tests run only where fish is installed
```

A shell test skips a shell that isn't installed; with `ENVROUTER_REQUIRE_SHELLS=1` (which CI
sets) a missing one fails instead.

[Biome](https://biomejs.dev) formats and lints the frontend. The repository's `.vscode` folder
recommends its extension and turns on format-on-save.

## 🧰 Commands

| Task                                                                                                                                 | Command                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run the desktop app with hot reload                                                                                                  | `pnpm tauri dev`                                                                                                                                                             |
| Review the UI in a browser, with the backend mocked                                                                                  | `pnpm dev`, then open `http://localhost:1420/?scenario=populated` (add `&platform=linux` for Linux chrome)                                                                   |
| Run the CLI against a scratch home                                                                                                   | `HOME=/tmp/envrouter-home cargo run -p envrouter-cli -- status`                                                                                                              |
| Build the release app, with LICENSE and the notices inside (needs cargo-about)                                                       | `pnpm bundle` (a bare `pnpm tauri build` leaves them out)                                                                                                                    |
| Frontend tests (Vitest): `*.test.ts` run in node, `*.test.tsx` render the window in happy-dom                                        | `pnpm test`                                                                                                                                                                  |
| Rust tests, including the built shim and real zsh, bash and fish                                                                     | `cargo test --workspace`                                                                                                                                                     |
| The secrets round trip through this machine's real store                                                                             | `cargo test -p envrouter-keychain -- --ignored`                                                                                                                              |
| Type check                                                                                                                           | `pnpm check-types`                                                                                                                                                           |
| Format and lint the frontend                                                                                                         | `pnpm format-and-lint:fix`                                                                                                                                                   |
| Format and lint the Rust                                                                                                             | `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`                                                                                                   |
| See which frontend dependencies have updates                                                                                         | `pnpm check-deps`                                                                                                                                                            |
| Take minor and patch updates, once a release is 2 days old (patch) or a week (minor), per `.always-up-to-date.json`                  | `pnpm update-deps`                                                                                                                                                           |
| Update Tauri, which `update-deps` leaves alone, since the Tauri CLI refuses an npm package and its crate on different minor versions | Move each `@tauri-apps/*` package in `package.json` and its crate (`cargo update -p tauri -p tauri-plugin-dialog -p tauri-plugin-opener`) to the same minor version together |
| Licences and RustSec advisories                                                                                                      | `cargo deny check`                                                                                                                                                           |
| Third-party notices, as a release ships them (needs `cargo install --locked --features cli cargo-about`)                             | `pnpm notices`, which writes `target/notices/THIRD-PARTY-NOTICES.txt`                                                                                                        |
| Unused Rust dependencies                                                                                                             | `cargo machete`                                                                                                                                                              |

CI (`.github/workflows/ci.yml`) runs these for every pull request and every push to `main`,
except changes that only touch docs, design notes or `dev/containers`. Most of it
runs on Linux: the frontend, formatting, licences, the backend, shim, secrets and CLI tests, the
secrets round trip through a GNOME Keyring, the Windows secrets helper (linted and linked with
mingw), the desktop app crate on Ubuntu 22.04, where the release builds it, and the shim's
launch overhead (`.github/scripts/shim-overhead.sh`: run it with a built shim to measure a
change; CI fails when, with 60 triggers, a launch through it takes over 1.8x a bare exec's on
`ubuntu-24.04`, where that limit was measured. A Mac starts processes more slowly, so the
multiple there is lower: compare against `main`'s shim instead). The macOS
job runs only what needs a Mac: clippy and the tests for the whole workspace, including the app
and the Keychain. Run them before you push.

Every Monday, and on demand from the Actions tab, `.github/workflows/advisories.yml` runs
`cargo deny check advisories` and `pnpm audit --prod` against `main` and against the latest
release, both with `main`'s `deny.toml`. A red release scan means users have a version with a
known advisory: the fix is a release, not a change to the scan.

The Linux jobs, in CI and in the release, run in a prebuilt image,
`ghcr.io/pixel-perfect-software/envrouter-ci`, rather than installing packages from Ubuntu's
mirror as they go. It's built from `.github/ci/Containerfile` (Ubuntu 22.04, the packages, rustup)
by `.github/workflows/ci-image.yml`, and the workflows pin it by digest. To add a package: edit
the Containerfile, push the branch, run `gh workflow run ci-image.yml --ref <branch>`, and copy the
digest it prints into `ci.yml` and `release.yml`. On `main` it rebuilds by itself when the file
changes.

Every action in the workflows is pinned to the full commit SHA of a release, with its version in
a comment, and Dependabot (`.github/dependabot.yml`) opens a monthly pull request to update them.
Keep new ones pinned the same way. Dependabot does the same for the Rust crates, except `tauri*`,
which move together with the `@tauri-apps/*` npm packages, and it opens a security update as soon
as an advisory lands.

### 🐳 Linux and Windows from a Mac

`dev/containers/compose.yaml` runs the Linux and Windows checks in containers, with Podman or
Docker. Everything is grouped under the project `envrouter-dev`; the checkout is mounted
read-only, and builds persist in named volumes. A change to `dev/containers/` builds both images in CI (`.github/workflows/dev-containers.yml`).
`run` doesn't rebuild an image whose Containerfile changed: run
`podman compose -f dev/containers/compose.yaml build` after pulling one. The containers run with
SELinux labels off (`label=disable`), so files one run leaves in the build volume stay readable to
the next.

```sh
podman compose -f dev/containers/compose.yaml run --rm linux-test            # backend tests, keyring round trip
podman compose -f dev/containers/compose.yaml run --rm linux-app             # the desktop app with WebKitGTK
podman compose -f dev/containers/compose.yaml run --rm linux-bundle          # the .deb and AppImage, as a release builds them
podman compose -f dev/containers/compose.yaml run --rm windows-helper-build  # the Windows secrets helper, with mingw
podman compose -f dev/containers/compose.yaml run --rm windows-helper-wine   # its Credential Manager round trip
```

The last one runs the Windows helper under [Wine](https://www.winehq.org), a compatibility
layer that runs Windows programs on Linux, in an x86_64 container. Only Wine runs emulated on
Apple Silicon; the helper builds natively, because emulation crashes Rust's tooling.

## 🛡️ Working safely

Running the real app reads and writes `~/.envrouter`, and its shell switches edit your real
shell startup files. Two ways to avoid that:

- **The browser mock**, for UI work. `pnpm dev` serves the window with every Tauri command
  answered by `src/dev/mockTauri.ts`, which is never bundled. Pick a state with `?scenario=`:

  | Scenario              | Shows                                                                                                                                                                                      |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `first-run` (default) | No profiles, shell integration off                                                                                                                                                         |
  | `populated`           | Several profiles, routing on in zsh                                                                                                                                                        |
  | `mcp`                 | `populated`, plus a library of MCP servers                                                                                                                                                 |
  | `shadowed`            | A folder check where a shell function gets in the way                                                                                                                                      |
  | `unrouted`            | `populated`, but no profile sets an agent: a check finds the agent untouched on PATH                                                                                                       |
  | `broken`              | A `config.json` that can't be read, until Open config.json (which stands in for fixing it) or a confirmed Back Up and Start Over… (which answers `config.json.bak` and empties the config) |
  | `newer`               | A `config.json` from a newer EnvRouter: the same banner, with no Back Up and Start Over…                                                                                                   |

  Add any of these to reach the states a real machine can be in:

  | Parameter             | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `&platform=linux`     | A Linux desktop: `/home/sam`, bash reading `.bashrc`, `~/.config` editor settings, the keyring; an uninstall ends by naming `sudo apt remove env-router`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
  | `&platform=wsl`       | A WSL distro: bash reading `.profile` and `.bashrc`, no zsh, the Credential Manager, VS Code Server and Cursor Server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
  | `&check=<result>`     | Forces a folder check's answer (use it with `populated` or `mcp`): `routed` (the default, worked out from the config), `managed` (an admin's `managed-mcp.json` turns the profile's MCP servers off), `clash` (a server the profile hands the agent that `~/.codex/config.toml` defines with the other transport: a problem verdict that opens the file), `alias` (the run goes through an alias that runs the tool), `owned` (a profile owns the folder but leaves the agent alone), `unowned` (no profile owns it), `shadowedOnPath`, `byPromptHook`, `shadowedByShell`, `notFound`, `notInstalled`, `shimFailed`, or the failures `timeout` and `noPath`                                                                                                                                                                                                                                      |
  | `&agents=<list>`      | Which agents a new terminal finds on its `PATH`: commands (`claude`, `claude,copilot`), `none`, or `unknown` (the shell didn't say, so nothing is marked). The default is every agent the window offers; the ones left out are marked Not installed in the editor, on cards and in the welcome, except one an editor's extension carries (VS Code has Claude Code's in the mock, so `none` still marks only Copilot)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
  | `&view=<view>`        | Opens on `profiles` or `servers`. Without it the window opens on the view the browser last left it on, as the app does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | `&gone=~/notes,~/dev` | Those folders are no longer on disk: showing one in Finder says "There's no … any more", as the backend's `locate` does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | `&shim=stale`         | The shim missing or out of date; any save or switch reinstalls it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | `&store=off`          | No secret store: a save that adds a secret fails as it would there, one that drops a secret goes through with a warning banner, and off macOS (`&platform=linux`) the setup status says so up front, locking the lock off. Uninstall EnvRouter… goes on past an unreachable store off macOS and says the secrets are still there; on macOS, where only the delete can tell, it stops at the store                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
  | `&fail=<what>`        | `home` (no home folder, so nothing to open the config from), `status` (the setup status can't be read), `shell` (turning a shell on is refused), `editor` (no editor opens a file: with `?scenario=broken`, Open config.json fails and Reveal takes the accent), `reveal` (every reveal fails, and every help link, as with no browser to open it; the reveals are the banner's, a folder's, the Shells panel's and the menu bar's, which `window.__mockMenuReveal({ kind: 'root' })` stands in for, and the Help menu's, `window.__mockMenuHelp('docs')`; the accent stays on Open) or `uninstall` (Uninstall EnvRouter… stops at VS Code's and Cursor's settings, which can't be read and name the shim: the banner shows why, a line each, the shells are already off, and nothing after that was touched): the failure stays until `window.__mockFix()` in the console, then Try Again works |

  The `mcp` library also holds a server named `slow`, whose check times out, and Import there
  reads realistic agent files, so a server already in the library shows as such.
  `window.__mockDrop('/Users/sam/dev/work/api', 400, 300)` in the console simulates dropping a
  folder from Finder (`/home/sam/…` with `platform=linux` or `wsl`).
  `window.__mockEditConfig((c) => ({ ...c, profiles: c.profiles.slice(1) }))` changes `config.json`
  behind the window's back, as the CLI or a hand edit would, so the next save meets it;
  `window.__mockDeleteConfig()` deletes it the same way. `window.__mockQuit()` quits as the menu
  bar's Quit does: with unsaved edits in an editor the window asks first, and a quit that goes
  ahead logs `quit` to the console. Uninstall EnvRouter… (in the Shells popover) runs to its end here too: the mock clears
  what it changed, then answers every command but the quit ones with the guard's message, as the app does until it quits (`quit` is logged). The mock's
  npm knows every package at `1.4.0` (`next` at `2.0.0-beta.2`), except a name ending in `-nope`. When you change a command's behaviour, keep the mock answering the way the
  real backend does.

  The window's component tests (`src/App.test.tsx`) render `<App />` against this same mock, so
  they never reach your home folder either. A `*.test.tsx` file starts with
  `// @vitest-environment happy-dom` (every other test stays in node), and each test boots the
  mock for one URL: `vi.resetModules()`, `history.replaceState(null, '', '?scenario=populated')`,
  `await import('./dev/mockTauri')`, then `render(<App />)`. happy-dom loads no CSS, so a test
  reads what a rule means on screen from the DOM (`inert`, the accent fill's `bg-accent` class),
  and it has no `window.confirm`, which the mock uses for the native sheets: answer them with
  `vi.stubGlobal('confirm', …)`.
- **A scratch home folder**, for the real app. Build it, then launch the binary with `HOME`
  pointing somewhere disposable:

  ```sh
  mkdir -p /tmp/envrouter-home
  HOME=/tmp/envrouter-home target/release/bundle/macos/EnvRouter.app/Contents/MacOS/envrouter
  ```

  On Linux, the binary is `target/release/envrouter-app`. The secret store's item is keyed by
  the canonical home folder, so a scratch home never sees your real secrets.

Tests follow the same rule: they must never touch the real home directory. Code that needs a
home folder or shell startup files takes them as parameters rather than reading `HOME` or
`ZDOTDIR` from the environment.

## 🗂️ Project layout

```
crates/core/       Profile model, validation, folder resolution, MCP file rendering, and
                   platform.rs: what differs between macOS, Linux and WSL.
crates/ops/        The backend with no UI: shell integration, shims, editors, MCP checks and
                   import. commands.rs holds every window command; rpc.rs serves them to the CLI.
crates/cli/        The envrouter command.
crates/shim/       The shim binary, with end-to-end tests in tests/shim.rs.
crates/keychain/   MCP secrets in the platform's store (src/store/), and the envrouter-keychain
                   helper the shim runs and agents start command servers through (src/launch.rs).
src-tauri/         The desktop app (Tauri 2): command wrappers, the menu bar, the window.
src/               The window: React, TypeScript, Tailwind CSS 4.
src/lib/agents.json  The agent registry: each agent's variable, MCP dialect and editor hook,
                   read by the window (src/lib/tools.ts) and the CLI (crates/core/src/agents.rs).
packaging/         The Homebrew cask and formula templates.
dev/containers/    The Linux and Windows check containers (the browser mock is in src/dev/).
```

`.claude/context/ai-context/project-structure.md` has a fuller tree and a table of every
command. A new window command goes in `crates/ops/src/commands.rs`, gets a Tauri wrapper in
`src-tauri/src/lib.rs`, and an entry in `crates/ops/src/rpc.rs`.

## 📏 Rules the code keeps

- **The shim must never block the tool.** A missing config runs the tool silently; a broken one
  warns and still runs it. The same goes for MCP manifests and unreadable secrets.
  `crates/shim/tests/shim.rs` covers each case; add to it when you change the shim.
- **The shim stays small.** `crates/core` and `crates/shim` must not depend on a secret store
  library; the shim runs the secrets helper only when a remote server's header needs a secret. `otool -L` on the
  release shim lists only `libSystem`, `ldd` only libc and libgcc.
- **Platform differences live in one place.** Rust asks `crates/core/src/platform.rs`; the
  window asks `usePlatform()` in `src/lib/platform.ts`. Don't check the OS inline, and don't
  word a platform's name for something in the window when the backend can send it (`SetupStatus`).
- **Compare canonical paths,** never `$PWD` text.
- **Agents are data.** Nothing in Rust branches on an agent's name. Adding an agent is one entry
  in `src/lib/agents.json`, after checking that its variable relocates logins too, not only
  settings.
- **Config changes are versioned.** Any change to the shape of `config.json` bumps
  `CONFIG_VERSION` in `crates/core/src/config.rs` and migrates older versions in `config::load`.
- **Wire types live in `src/lib/types.ts`,** and Rust tests pin the JSON (and the rpc envelope),
  so change both sides together.
- **All file access happens in Rust commands.** There's no Tauri fs plugin, the window's
  capabilities grant three plugin calls one by one, and the window's CSP allows no remote
  content. Changing either is a deliberate decision, not a convenience.
- **Tauri v2 APIs only.** v1 examples (`allowlist`, `@tauri-apps/api/fs`) don't apply.
- **No logins.** EnvRouter never signs anyone in to an agent or an MCP server.

## 🎨 Style

- pnpm only.
- Biome: 2-space indentation, single quotes, no semicolons, 150-column lines. Tauri's docs use
  double quotes and semicolons; don't copy that.
- Tailwind CSS 4 through `@tailwindcss/vite`, with design tokens in `src/index.css`. There's no
  Tailwind config file.
- Rust: `cargo fmt`, and the workspace lints in the root `Cargo.toml` (`unsafe` denied, a slice
  of clippy pedantic). Every crate opts in with `[lints] workspace = true`. The one exception to
  `unsafe` is the Windows Credential Manager module, which allows it and argues each call.
- Dependencies must have permissive licences; `cargo deny check` enforces it.

## 🖼️ UI changes

Read [`PRODUCT.md`](../PRODUCT.md) (who it's for and the principles) and
[`DESIGN.md`](../DESIGN.md) (tokens, components and rules) first. Review changes in the browser
mock in both light and dark appearance, and on both platforms (`&platform=linux`).

The app icon and menu bar glyph are drawn as SVG in `src-tauri/icons/`, and every PNG and
`icon.icns` is rendered from them. Don't run `tauri icon`, which rebuilds every size from one
source and loses the small-size cut.

The README screenshots in `docs/images/` come from the browser mock's `mcp` scenario at
1020 × 700 and 2× scale, in light and dark: a folder check of `~/dev/work/api` for `check-*.png`, and `github` selected in MCP Servers for `servers-*.png`.

## 📦 Releases

Releases go to GitHub and Homebrew. To cut one:

1. Bump `version` in two places, the root `Cargo.toml`'s `[workspace.package]` (every crate and the
   app inherit it) and `package.json`, run `cargo check` so `Cargo.lock` follows, and merge it to
   `main`.
2. Tag that commit and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.

The [release workflow](../.github/workflows/release.yml) refuses a tag that doesn't match the
app's version, isn't on `main`, or names a commit CI didn't pass on. A run still going is
waited for, so tagging the merge commit right after merging is fine; a cancelled or failed run
needs a rerun first. Then:

- **macOS** (Apple Silicon): the app as `EnvRouter-<version>-arm64.zip`, and the CLI as
  `envrouter-cli-<version>-aarch64-apple-darwin.tar.gz`.
- **Linux** (x86_64 and aarch64, on Ubuntu 22.04 for an older glibc): a `.deb` (carrying the
  Windows secrets helper for WSL) and an AppImage, and the CLI as
  `envrouter-cli-<version>-<arch>-unknown-linux-gnu.tar.gz` with the Windows helper inside.
- **Notices:** `pnpm notices` writes `THIRD-PARTY-NOTICES.txt`, the licence of every crate and
  npm package built into the release (`packaging/notices/`). Every app bundle and CLI archive
  carries it beside `LICENSE`, and the release lists it as a file of its own.
- **Publish:** one GitHub release with every file and `SHA256SUMS`, then
  `packaging/homebrew/render.sh` fills the templates in `packaging/homebrew/` (the `envrouter`
  cask and the `envrouter-cli` formula) and pushes them to
  [homebrew-tap](https://github.com/pixel-perfect-software/homebrew-tap) with the `TAP_TOKEN`
  secret: a fine-grained token with Contents read and write on that repository only.

Edit the cask or formula in `packaging/homebrew/`, never in the tap, which only holds what the
workflow renders. When the token expires, the tap update fails and the release stays
published; replace the secret and re-run the job.

## 🔀 Pull requests

1. Branch from `main`.
2. Keep each pull request to one change, with tests for new behaviour and a regression test for
   a bug fix.
3. Run the commands above. CI must pass.
4. Update the README when the change is visible to users.
5. Label it `bug`, `enhancement`, `ci` (workflows and releases) or `documentation`: the release
   notes group pull requests by label (`.github/release.yml`), and an unlabelled one lands under
   "Other changes".
6. Sign off every commit (`git commit -s`). The `Signed-off-by` line certifies the
   [Developer Certificate of Origin](https://developercertificate.org): you wrote the change, or
   otherwise have the right to submit it, under EnvRouter's licence,
   [GPL-3.0-or-later](../LICENSE). You keep the copyright on what you contribute.

Report bugs and suggest features in [GitHub issues](https://github.com/pixel-perfect-software/env-router/issues).
Include your OS and version (and whether it's WSL), shell, and the output of `ENVROUTER_EXPLAIN=1 claude` (or `copilot`)
from the folder where it misbehaves.

Thanks for contributing to EnvRouter! 🎉
