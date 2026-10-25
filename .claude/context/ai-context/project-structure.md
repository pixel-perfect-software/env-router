# Project Structure

## Tree
```
env-router/
├── Cargo.toml                 # workspace root; shared deps, workspace lints, the release profile
├── crates/
│   ├── core/                  # shared by app, CLI and shim; no Tauri dependency
│   │   ├── src/config.rs      # ConfigState model (mirrors TS types), config.json I/O, CONFIG_VERSION, validate
│   │   ├── src/resolve.rs     # folder → active profile → env var (canonical-path matching)
│   │   ├── src/mcp.rs         # renders per-profile MCP files + launch manifests; what the shim injects
│   │   ├── src/agents.rs      # the agent registry (src/lib/agents.json, include_str!) and with_agents, so the CLI fills config.agents
│   │   ├── src/platform.rs    # what differs per system: terminal login shells, new-terminal PATH, config dirs, opener
│   │   ├── src/paths.rs       # ~/.envrouter layout: shims/, bin/ (shim, helpers, CLI), config.json, mcp/
│   │   └── src/error.rs       # Error enum, serialized to the frontend as a message string
│   ├── ops/                   # the backend with no UI, for the app and the CLI
│   │   ├── src/commands.rs    # the body of every window command (below)
│   │   ├── src/rpc.rs         # those commands by name as JSON lines: `envrouter rpc`
│   │   ├── src/shell.rs       # startup-file blocks for zsh/bash/fish, check_folder, preview, login_path
│   │   ├── src/shims.rs       # installs the shim and helpers; syncs one symlink per tool
│   │   ├── src/uninstall.rs   # uninstall: shell blocks, editor wrappers, the secret item, ~/.envrouter, the app's webview folders (the app deletes its own as it exits, `finish_uninstall`), in that order (a problem before the secrets stops the run), the commands that remove the app and CLI, and the app's lock the CLI's uninstall checks
│   │   ├── src/editors.rs     # points an agent extension's process-wrapper setting at the shim (desktop editors and remote servers)
│   │   ├── src/mcp_import.rs  # reads the agents' own MCP files (by their mcpFiles descriptor) for import, and pasted JSON
│   │   ├── src/mcp_probe.rs   # MCP server check (rmcp): tools, needs-login, stderr tail; tool-list cache
│   │   └── build.rs           # builds the shim and helper its tests install
│   ├── cli/                   # `envrouter`: status, install, shell, editor, check, explain, apply, secret, uninstall, rpc
│   ├── keychain/              # MCP secrets in one item of the platform's store; envrouter-keychain helper bin (the shim runs it, never links it)
│   │   ├── src/store/         # macos.rs (Keychain), linux.rs → secret_service.rs or wsl.rs, windows.rs (Credential Manager), unavailable.rs
│   │   ├── src/checker.rs     # one-thread, timed "is the store usable" check behind setup_status (Linux and WSL)
│   │   └── tests/store.rs     # round trip through the real store; ignored by default, run by CI on Linux
│   ├── shim/
│   │   ├── src/main.rs        # the shim: route, find the real binary, exec; wrapper mode for editors; ENVROUTER_EXPLAIN mode
│   │   └── tests/shim.rs      # end-to-end tests of the built binary through a symlink
│   └── build-support/         # builds the shim and helper for the build scripts that bundle or test them
├── src-tauri/                 # the desktop app
│   ├── build.rs               # stages the shim and helper for bundle.externalBin
│   ├── src/lib.rs             # Tauri commands (wrappers over ops::commands), app setup, and the `Gate` every home() call goes through (it counts commands in flight, so an uninstall can wait for them, then turn the rest away) and the app's `app.lock`
│   ├── src/tray.rs            # menu bar icon and menu; on macOS close-to-hide and the Dock icon only while open
│   ├── capabilities/default.json  # core, plus the three dialog/opener calls the window makes; no fs
│   ├── tauri.conf.json        # id com.tylerrobertson.envrouter, CSP, externalBin, an .app bundle signed ad hoc
│   ├── tauri.linux.conf.json  # Linux: binary envrouter-app, native decorations, opaque window, .deb and AppImage
│   ├── icons/                 # app icon and menu bar glyph: SVG sources plus the PNGs and icon.icns rendered from them
│   └── binaries/, gen/        # generated, gitignored
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # composition: view, inspector and popover state, the handlers that tie the hooks below to the components; App.test.tsx drives it against the mock (the one accent button, unsaved edits, focus)
│   ├── index.css              # design tokens (light/dark, system accent), hairline utilities
│   ├── assets/                # illustrations drawn from the mark's SVG: the first-run welcome and the empty server library
│   ├── components/            # Titlebar, Health (banner and setup steps), Popovers (Shells and Editors), Frame (slots),
│   │                          # ProfileInspector (slide-in editor), Servers (the MCP Servers view: list beside editor), ServerEditor (with ServerFields and ServerVersion), ServerSources (Catalog and Import), ServerMark (server logos), Welcome (first run),
│   │                          # Docket (check result), ui (controls, status), icons (Lucide and agent marks)
│   ├── lib/                   # api.ts (typed commands), types.ts (wire types), agents.json (the agent registry: variables, MCP descriptors, editor hooks, logo marks; also read by crates/core/src/agents.rs), tools.ts (KNOWN_TOOLS from it, withAgents), platform.ts (usePlatform: shortcuts, store name),
│   │                          # mcp.ts (server drafts, rename/remove, secret locking), mcpCatalog.ts (well-known servers), serverLogo.ts (logo matching),
│   │                          # verdict.ts (check wording, tested in verdict.test.ts), health.ts (the health line and the one-accent rule, tested in health.test.ts), paths.ts, text.ts (plural, listOf), confirm.ts,
│   │                          # hooks the window composes: useConfigStore.ts (load, save and its merge loop), useFolderCheck.ts, useShortcuts.ts, useFolderDrop.ts
│   └── dev/mockTauri.ts       # dev-only browser mock (?scenario=, ?platform=, ?check= and more; see docs/contributing.md); never bundled; mockTauri.test.ts pins it, and App.test.tsx boots it
├── packaging/homebrew/        # cask and CLI formula templates; render.sh fills them from a release's SHA256SUMS
├── packaging/notices/         # `pnpm notices`: render.mjs and cargo-about's about.toml write THIRD-PARTY-NOTICES.txt for releases
├── dev/containers/            # compose.yaml (project envrouter-dev): Linux tests, app build, bundles, Windows helper under Wine
├── README.md, LICENSE         # users: what it is, install per platform, WSL, getting started, troubleshooting, uninstall; GPL-3.0-or-later
├── docs/contributing.md       # contributors: setup, commands, containers, mock scenarios, rules, releases, PRs
├── docs/images/               # README screenshots (browser mock, `mcp` scenario, light and dark)
├── .github/workflows/ci.yml   # Linux: lint, types, frontend tests, build, fmt, deny, machete, backend tests, keyring round trip, Windows helper lint and link, app crate; Linux jobs in the CI image; macOS: clippy and cargo test
├── .github/ci/Containerfile   # the Linux CI and release jobs' image: Ubuntu 22.04, their packages, rustup
├── .github/workflows/ci-image.yml  # builds that image for amd64 and arm64 into ghcr.io, prints the digest to pin
├── .github/workflows/advisories.yml  # weekly: cargo deny advisories and pnpm audit, for main and the latest release
├── .github/workflows/release.yml  # on a v* tag: macOS and Linux builds, one release, then the tap from packaging/homebrew
├── .github/dependabot.yml     # monthly action and dependency updates
├── PRODUCT.md                 # product truth for design work
├── DESIGN.md                  # design system: tokens (light/dark), components, rules
├── .impeccable/               # design-workflow state: surface brief, review captures
├── .claude/                   # Claude Code settings and context docs
├── .vscode/                   # Biome-on-save settings, recommended extensions
├── biome.json
├── rust-toolchain.toml        # pins the Rust toolchain rustup installs
├── deny.toml                  # cargo deny: permissive licences only, RustSec advisories
└── .tool-versions             # asdf: Node and pnpm versions (CI reads Node from it)
```

Created on the user's machine at runtime: `~/.envrouter/config.json`, `~/.envrouter/bin/` (the
shim, `envrouter-keychain`, the `envrouter` CLI when installed from a release archive, and on
Linux `envrouter-keychain.exe` for WSL), `~/.envrouter/shims/<tool>` (symlinks), and
`~/.envrouter/mcp/<profile id>/<command>/` (rendered MCP server files and `launch.json`), plus an
"EnvRouter MCP secrets" item in the platform's store once a secret is saved (the login Keychain,
the Secret Service, or the Windows Credential Manager as `EnvRouter MCP secrets:wsl:<distro>:<home>#<n>`).
The app also adds a marked block to the end of `~/.zshrc` (or `$ZDOTDIR/.zshrc`), bash's files
(`.bashrc` on a Linux desktop; the login file, plus `.bashrc` when it exists, on macOS and WSL), or
fish's `config.fish` (under `XDG_CONFIG_HOME`), and an editor's turned-on hook sets
`claudeCode.claudeProcessWrapper` in its `settings.json`.

## Commands (`crates/ops/src/commands.rs`)
Each is a Tauri command in `src-tauri/src/lib.rs` and, except `open_in_editor`, an `envrouter rpc`
command of the same name and arguments.

| Command | Does |
|---|---|
| `get_config` | Reads the config, creating an empty one if it's missing |
| `save_config(payload, secrets)` | Validates, stores new MCP secrets in the platform's store (pruning unused ones), saves, installs the shim, renders the MCP files, syncs the symlinks |
| `get_setup_status` | The platform and its store's name, whether the shim is installed, plus per-shell availability, default shell and block status |
| `set_shell_integration(shell, enabled)` | Adds or removes the startup-file block |
| `get_editor_status(hooks)` | Each VS Code-family editor's (and remote server's) state for each agent's extension hook (from `agents.json`) |
| `set_editor_integration(editor, command, hook, enabled)` | Sets or clears the extension's process-wrapper setting in the editor's settings, keeping comments; never replaces someone else's wrapper |
| `check_folder(shell, folder, tool)` | Real-shell check, after running the prompt hooks once: routed (with the MCP servers it adds), shadowed by an alias/function, shadowed on PATH (which includes a shell that's off, and says whether a prompt hook did it), not found, tool not installed, or shim failed |
| `preview_folder(payload, folder, tool)` | Instant profile preview from an unsaved config |
| `check_mcp_server(name, server, secrets)` | Starts or connects to one MCP server with a new terminal's PATH and lists its tools: ok, needs sign-in (401), failed with its stderr tail, timed out, or unsupported (SSE); caches a good list |
| `import_candidates(payload)` | MCP servers the agents already define in their own files, merged when identical; read only |
| `parse_mcp_json(text)` | Reads MCP servers from pasted JSON (JSONC, `mcpServers`, VS Code's `servers`, a bare table or one server) the way import reads a file; read only |
| `get_mcp_tools` | Each library server's cached tool list, while its definition is unchanged |
| `uninstall(dry_run)` | Turns every shell block and editor wrapper off, deletes the stored MCP secrets, `~/.envrouter` and the webview folders (the window's, as it exits), and reports (`UninstallReport`) what it did and the commands that remove the app and CLI; a problem in the first two steps stops before the secrets. `dry_run` is required over rpc and changes nothing. The window quits after a finished run |
| `open_in_editor(path)` | Opens an existing file inside the home folder in the default text editor (`open -t`, `xdg-open`) |

## Tech stack
| Concern | Choice |
|---|---|
| App shell | Tauri 2 with plugins: dialog, opener |
| Backend | Rust 2021 edition, Cargo workspace, serde / serde_json / thiserror; clap (CLI); jsonc-parser (editor settings); secret-service (Linux), windows-sys (Windows) |
| Frontend | React 19, TypeScript 7, Vite 8 |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite` |
| Lint / format | Biome 2.5 (TS/JSON/CSS); `cargo fmt` and clippy (Rust) |
| Tests | `cargo test` (Rust, including the built shim and real zsh, bash and fish); Vitest: `src/**/*.test.ts` in node, and `src/**/*.test.tsx` (the window rendered against `mockTauri` with Testing Library) in happy-dom, chosen by a `// @vitest-environment happy-dom` comment on the file |
| Package manager | pnpm 12.14.0 and Node 24.22.1 (pinned in `.tool-versions`; pnpm also in `packageManager`) |
| Platform | macOS 11+ on Apple Silicon with Safari 16.4+ (the window's WebKit; `vite.config.ts` targets it); Linux x86_64 and aarch64 (glibc of Ubuntu 22.04 or later), WSL 2 included |

## Commands
| Task | Command |
|---|---|
| Run the desktop app | `pnpm tauri dev` |
| Build the app bundle | `pnpm tauri build` (macOS: `target/release/bundle/macos/EnvRouter.app`; Linux: `bundle/deb`, `bundle/appimage`) |
| Run the CLI | `cargo run -p envrouter-cli -- <command>` (with `HOME` set to a scratch folder) |
| All Rust tests | `cargo test --workspace` |
| Secrets round trip | `cargo test -p envrouter-keychain -- --ignored` (uses the machine's real store) |
| Frontend tests | `pnpm test` |
| Rust lint | `cargo clippy --workspace --all-targets` (workspace lints in the root `Cargo.toml`) |
| Linux and Windows checks | `podman compose -f dev/containers/compose.yaml run --rm <linux-test\|linux-app\|linux-bundle\|windows-helper-build\|windows-helper-wine>` |
| Licences and advisories | `cargo deny check` (`deny.toml`) |
| Unused dependencies | `cargo machete` |
| Shim overhead | `hyperfine -N` a release `envrouter-shim` against an exec-only wrapper; `otool -L` should list only `libSystem` |
| Rust format | `cargo fmt --all` |
| Type check | `pnpm check-types` |
| Lint and format | `pnpm format-and-lint` / `pnpm format-and-lint:fix` |
| Add a Tauri plugin | `pnpm tauri add <name>`, then tighten the permission it adds to `capabilities/default.json` |
