# Contributing to EnvRouter

Thanks for helping. This guide covers setting up a development checkout, the commands CI runs,
how to work on the app without touching your real setup, and the rules the code keeps.

## 🛠️ Setup

Install the tools in the README's [Build and install](../README.md#-build-and-install) section
(Xcode command line tools, rustup, Node.js 22.12 or later, pnpm), then:

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

[Biome](https://biomejs.dev) formats and lints the frontend. The repository's `.vscode` folder
recommends its extension and turns on format-on-save.

## 🧰 Commands

| Task | Command |
|---|---|
| Run the desktop app with hot reload | `pnpm tauri dev` |
| Review the UI in a browser, with the backend mocked | `pnpm dev`, then open `http://localhost:1420/?scenario=populated` |
| Build the release app | `pnpm tauri build` |
| Frontend tests (Vitest) | `pnpm test` |
| Rust tests, including the built shim and a real zsh | `cargo test --workspace` |
| Type check | `pnpm check-types` |
| Format and lint the frontend | `pnpm format-and-lint:fix` |
| Format and lint the Rust | `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings` |
| Licences and RustSec advisories | `cargo deny check` |
| Unused Rust dependencies | `cargo machete` |

CI (`.github/workflows/ci.yml`) runs all of these on macOS for every pull request and every push
to `main`, so run them before you push.

## 🛡️ Working safely

Running the real app reads and writes `~/.envrouter`, and its shell switches edit your real
shell startup files. Two ways to avoid that:

- **The browser mock**, for UI work. `pnpm dev` serves the window with every Tauri command
  answered by `src/dev/mockTauri.ts`, which is never bundled. Pick a state with `?scenario=`:

  | Scenario | Shows |
  |---|---|
  | `first-run` (default) | No profiles, shell integration off |
  | `populated` | Several profiles, routing on in zsh |
  | `mcp` | `populated`, plus a library of MCP servers |
  | `shadowed` | A folder check where a shell function gets in the way |
  | `broken` | A `config.json` that can't be read |

  `window.__mockDrop('/Users/sam/dev/work/api', 400, 300)` in the console simulates dropping a
  folder from Finder. When you change a command's behaviour, keep the mock answering the way the
  real backend does.
- **A scratch home folder**, for the real app. Build it, then launch the binary with `HOME`
  pointing somewhere disposable:

  ```sh
  mkdir -p /tmp/envrouter-home
  HOME=/tmp/envrouter-home target/release/bundle/macos/EnvRouter.app/Contents/MacOS/envrouter
  ```

  The Keychain item is keyed by the canonical home folder, so a scratch home never sees your
  real secrets.

Tests follow the same rule: they must never touch the real home directory. Code that needs a
home folder or shell startup files takes them as parameters rather than reading `HOME` or
`ZDOTDIR` from the environment.

## 🗂️ Project layout

```
crates/core/       Profile model, validation, folder resolution, MCP file rendering.
                   Shared by the app and the shim; no Tauri dependency.
crates/shim/       The shim binary, with end-to-end tests in tests/shim.rs.
crates/keychain/   MCP secrets in one login-Keychain item, and the envrouter-keychain helper.
src-tauri/         The desktop app (Tauri 2): commands, shell integration, MCP checks and
                   import, menu bar. build.rs builds and stages the shim and helper.
src/               The window: React, TypeScript, Tailwind CSS 4.
src/lib/tools.ts   The agent registry: each agent's variable and MCP dialect.
src/dev/           The browser mock.
```

`.claude/context/ai-context/project-structure.md` has a fuller tree and a table of every Tauri
command.

## 📏 Rules the code keeps

- **The shim must never block the tool.** A missing config runs the tool silently; a broken one
  warns and still runs it. The same goes for MCP manifests and unreadable secrets.
  `crates/shim/tests/shim.rs` covers each case; add to it when you change the shim.
- **The shim stays small.** `crates/core` and `crates/shim` must not depend on
  `security-framework`; the shim runs the Keychain helper only when a server needs a secret.
  `otool -L` on the release shim should list only `libSystem`.
- **Compare canonical paths,** never `$PWD` text.
- **Agents are data.** Nothing in Rust branches on an agent's name. Adding an agent is one entry
  in `src/lib/tools.ts`, after checking that its variable relocates logins too, not only
  settings.
- **Config changes are versioned.** Any change to the shape of `config.json` bumps
  `CONFIG_VERSION` in `crates/core/src/config.rs` and migrates older versions in `config::load`.
- **Wire types live in `src/lib/types.ts`,** and a Rust test pins the JSON, so change both sides
  together.
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
- Rust: `cargo fmt`, and the workspace lints in the root `Cargo.toml` (no `unsafe`, a slice of
  clippy pedantic). Every crate opts in with `[lints] workspace = true`.
- Dependencies must have permissive licences; `cargo deny check` enforces it.

## 🖼️ UI changes

Read [`PRODUCT.md`](../PRODUCT.md) (who it's for and the principles) and
[`DESIGN.md`](../DESIGN.md) (tokens, components and rules) first. Review changes in the browser
mock in both light and dark appearance.

The app icon and menu bar glyph are drawn as SVG in `src-tauri/icons/`, and every PNG and
`icon.icns` is rendered from them. Don't run `tauri icon`, which rebuilds every size from one
source and loses the small-size cut.

The README screenshots in `docs/images/` come from the browser mock's `mcp` scenario at
960 × 640 and 2× scale, in light and dark.

## 🔀 Pull requests

1. Branch from `main`.
2. Keep each pull request to one change, with tests for new behaviour and a regression test for
   a bug fix.
3. Run the commands above. CI must pass.
4. Update the README when the change is visible to users.

Report bugs and suggest features in [GitHub issues](https://github.com/pixel-perfect-software/env-router/issues).
Include your macOS version, shell, and the output of `ENVROUTER_EXPLAIN=1 claude` (or `copilot`)
from the folder where it misbehaves.

Thanks for contributing to EnvRouter! 🎉
