# Project Structure

## Tree
```
env-router/
├── Cargo.toml                 # workspace root; shared deps and the release profile
├── crates/
│   ├── core/                  # shared by app and shim; no Tauri dependency
│   │   ├── src/config.rs      # ConfigState model (mirrors TS types), config.json I/O, CONFIG_VERSION, validate
│   │   ├── src/resolve.rs     # folder → active profile → env var (canonical-path matching)
│   │   ├── src/paths.rs       # ~/.envrouter layout: shims/, bin/envrouter-shim, config.json
│   │   └── src/error.rs       # Error enum, serialized to the frontend as a message string
│   └── shim/
│       ├── src/main.rs        # the shim: route, find the real binary, exec; ENVROUTER_EXPLAIN mode
│       └── tests/shim.rs      # end-to-end tests of the built binary through a symlink
├── src-tauri/                 # the desktop app
│   ├── build.rs               # builds the shim and stages it for bundle.externalBin
│   ├── src/lib.rs             # Tauri commands (below) and app setup
│   ├── src/shims.rs           # installs the shim binary; syncs one symlink per tool
│   ├── src/shell.rs           # startup-file blocks for zsh/bash/fish, check_folder, preview
│   ├── src/tray.rs            # menu bar icon and menu; close-to-hide; Dock icon only while the window is open
│   ├── capabilities/default.json  # core, plus the three dialog/opener calls the window makes; no fs
│   ├── tauri.conf.json        # id com.tylerrobertson.envrouter, CSP, externalBin, app/dmg bundles
│   └── binaries/, gen/        # generated, gitignored
├── src/                       # React frontend (Vite)
│   ├── App.tsx                # state, health derivation, check flow, shortcuts (⌘N, ⌘O)
│   ├── index.css              # design tokens (light/dark, system accent), hairline utilities
│   ├── components/            # Chrome (titlebar, health line, shells panel), Frame (slots),
│   │                          # ProfileInspector (slide-in editor), Docket (check result), ui (controls, status, icons)
│   ├── lib/                   # api.ts (typed commands), types.ts (wire types), tools.ts (tool registry),
│   │                          # verdict.ts (check wording, tested in verdict.test.ts), paths.ts, useFolderDrop.ts, confirm.ts
│   └── dev/mockTauri.ts       # dev-only browser mock; never bundled
├── README.md, LICENSE         # what it is, how it works, build, uninstall; MIT
├── .github/workflows/ci.yml   # lint, type check, frontend and Rust tests on macOS (with fish installed)
├── PRODUCT.md                 # product truth for design work
├── .impeccable/               # design-workflow state: surface brief, review captures
├── .claude/                   # Claude Code settings and context docs
├── .vscode/                   # Biome-on-save settings, recommended extensions
└── biome.json
```

Created on the user's machine at runtime: `~/.envrouter/config.json`,
`~/.envrouter/bin/envrouter-shim`, and `~/.envrouter/shims/<tool>` (symlinks). The app also
adds a marked block to the end of `~/.zshrc` (or `$ZDOTDIR/.zshrc`), bash's login file plus
`~/.bashrc`, or `~/.config/fish/config.fish`.

## Tauri commands (`src-tauri/src/lib.rs`)
| Command | Does |
|---|---|
| `get_config` | Reads the config, creating an empty one if it's missing |
| `save_config(payload)` | Validates, saves, installs the shim, syncs the symlinks |
| `get_setup_status` | Whether the shim is installed, plus per-shell availability, default shell and block status |
| `set_shell_integration(shell, enabled)` | Adds or removes the startup-file block |
| `check_folder(shell, folder, tool)` | Real-shell check, after running the prompt hooks once: routed, shadowed by an alias/function, shadowed on PATH (which includes a shell that's off, and says whether a prompt hook did it), not found, tool not installed, or shim failed |
| `preview_folder(payload, folder, tool)` | Instant profile preview from an unsaved config |
| `open_in_editor(path)` | Opens an existing file inside the home folder in the default text editor |

## Tech stack
| Concern | Choice |
|---|---|
| App shell | Tauri 2 with plugins: dialog, opener |
| Backend | Rust 2021 edition, Cargo workspace, serde / serde_json / thiserror |
| Frontend | React 19, TypeScript 6, Vite 8 |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite` |
| Lint / format | Biome 2.5 (TS/JSON/CSS); `cargo fmt` and clippy (Rust) |
| Tests | `cargo test` (Rust, including the built shim and a real zsh); Vitest (`src/**/*.test.ts`) |
| Package manager | pnpm 12.9.1 (pinned) |
| Platform | macOS (arm64 bundle for now) |

## Commands
| Task | Command |
|---|---|
| Run the desktop app | `pnpm tauri dev` |
| Build the app bundle | `pnpm tauri build` (`--bundles app` skips the dmg) |
| All Rust tests | `cargo test --workspace` |
| Frontend tests | `pnpm test` |
| Rust lint | `cargo clippy --workspace --all-targets` |
| Rust format | `cargo fmt --all` |
| Type check | `pnpm check-types` |
| Lint and format | `pnpm format-and-lint` / `pnpm format-and-lint:fix` |
| Add a Tauri plugin | `pnpm tauri add <name>`, then tighten the permission it adds to `capabilities/default.json` |
