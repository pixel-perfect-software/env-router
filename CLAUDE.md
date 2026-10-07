# EnvRouter

@.claude/context/ai-context/docs-overview.md

EnvRouter is a macOS desktop app (Tauri v2) that sets per-folder environment variables for
coding agents (Claude Code, Codex, Copilot CLI, Gemini CLI), so `claude` run in `~/dev/work` uses a different `CLAUDE_CONFIG_DIR` than in
`~/dev/personal`. The user defines **profiles**: each one maps trigger folders to a variable
per tool. Profiles are stored in `~/.envrouter/config.json`. It's meant to be distributed to
other macOS users, so plan for code signing and notarization.

**How it works: shims, like mise or volta.** `~/.envrouter/shims/<tool>` is a symlink to
`~/.envrouter/bin/envrouter-shim`, a small Rust binary, and a marked block in the user's shell
startup files puts `shims/` first on PATH. On each run the shim reads `config.json`, picks the
profile for the current folder, sets that tool's variable, and `exec`s the real tool found
later on PATH. Config edits apply on the next run in every terminal, with nothing to reload.

The window is built around a direction called **the Sorting Frame**: one card per profile
with its folders filed inside, rendered as modern layered Mac cards (the user asked for
clearly separated surfaces, so don't regress to flat ruled grids). Before changing the UI, read `PRODUCT.md` and
`.impeccable/surfaces/src-app-tsx.md` (the direction contract), and `DESIGN.md` (tokens and
rules: one accent button per state, status-free profile colours, the editor is a right-side
inspector). The app also lives in the menu bar (`src-tauri/src/tray.rs`), and closing the window
only hides it.

## How routing resolves (`crates/core/src/resolve.rs`)
- **The most specific profile wins outright.** The deepest trigger containing the folder picks the profile. If that profile doesn't configure the tool, the tool runs with **no** override; it never falls back to a shallower profile. The user chose this deliberately.
- **Compare canonical paths, never `$PWD` text.** `$PWD` keeps typed symlinks and letter case (`~/Dev` on a case-insensitive volume), so both the folder and each trigger go through `fs::canonicalize`.
- **Triggers are whole-subtree prefixes.** `~` is expanded and a trailing `/*` or `/**` is dropped (`config::trigger_base`); any other `*` is rejected. `config.json` keeps what the user typed.
- **`config::validate` runs on every save.** It rejects a folder claimed by two profiles, tool or env var names that aren't strict identifiers, and a tool folder that isn't absolute or `~`-based (a relative one would resolve against wherever the tool runs; `resolve` skips one from a hand-edited config too). Tool names become file names in `shims/` and are interpolated into shell probes, so keep `is_command_name` strict.

## The shim must never block the tool
A missing config means the tool runs silently. A broken one prints a warning and the tool still runs. When looking for the real binary, the shim skips the shims directory, empty PATH entries (the current directory), and anything that canonicalizes to itself, so it can never exec itself in a loop. Keep these properties; `crates/shim/tests/shim.rs` covers each one.

## Constraints
- **No OAuth or credential handling.** EnvRouter only routes env vars; it never logs anyone into a tool.
- **Tauri v2 APIs only.** v1 examples (`tauri.conf.json > allowlist`, `@tauri-apps/api/fs`) are wrong here. Use plugins and `capabilities/*.json`.
- **All file access happens in Rust commands.** There's deliberately no fs plugin, and `capabilities/default.json` grants only the three plugin calls the window makes (dialog open, dialog message, opener reveal), one by one. Don't go back to a plugin's `:default` set, and don't add `@tauri-apps/plugin-fs` back.
- **The window has a CSP** (`app.security.csp` in `tauri.conf.json`): scripts and styles from the bundle only, and IPC. Loading anything remote or adding an inline script means changing the policy on purpose.
- **Keep the data model tool-agnostic.** `Profile.tools` is a `Record<toolName, { envVar, path }>`. Nothing in Rust special-cases an agent. Add an agent with one entry in `src/lib/tools.ts`, and only after checking its docs: the variable must relocate logins too, not just settings. Note quirks such as Gemini's parent-folder semantics in the entry's `note`. `save_config` creates missing agent folders inside home, because Codex refuses a `CODEX_HOME` that doesn't exist.
- **Bump `CONFIG_VERSION` in `config.rs`** for any change to the shape of `config.json`, and migrate older versions in `config::load`. The shim refuses configs from a newer version.

## Conventions
- **pnpm only.** `packageManager` pins `pnpm@12.9.1`, and `devEngines` downloads it if it's missing.
- **Biome, not ESLint or Prettier:** 2-space indentation, **single quotes, no semicolons**, 150-column lines. Don't copy the double-quote/semicolon style from Tauri docs. Run `pnpm format-and-lint:fix`.
- **Tailwind v4** through `@tailwindcss/vite`: no config file and no PostCSS; theme tokens go in `src/index.css` with `@theme`.
- **Rust is a Cargo workspace** rooted at the repo (`crates/core`, `crates/shim`, `src-tauri`), with one `target/` at the root. Use `cargo fmt --all`. Release profile settings live in the root `Cargo.toml`.

## Gotchas
- **Tests must never touch the real home directory.** Shell code resolves startup files from the `home` it's given, and finds zsh's `ZDOTDIR` by asking a fresh zsh, never from the process environment. Don't read `ZDOTDIR` or `HOME` from `std::env` in testable code. Claude Code's own environment sets `ZDOTDIR`.
- **The shell block is POSIX sh** (`shell.rs`, `POSIX_BODY`), so it's safe when bash's login file is `.profile`. It moves the shims directory to the front of PATH rather than skipping it when it's already there, because nested shells re-prepend `~/.local/bin`.
- **`check_folder` emulates a new Terminal window,** with a cleared environment and a login, interactive shell. Output goes to temp files, not pipes, because prompt themes leave background jobs holding pipes open. It never runs the real tool. The shim's `ENVROUTER_EXPLAIN=1` mode reports the route instead.
- **`src-tauri/build.rs` builds the shim** into `target/shim/` and stages it as `src-tauri/binaries/envrouter-shim-<triple>` for `bundle.externalBin`. The bundle is arm64-only for now; Intel support needs a universal build plus `lipo` of the shim.
- **Review the UI in a browser, never against the real home folder.** `pnpm dev` and then `http://localhost:1420/?scenario=first-run|populated|shadowed|broken` runs the frontend with every Tauri call answered by `src/dev/mockTauri.ts` (dev-only; `window.__mockDrop(path, x, y)` simulates a Finder drop). Keep the mock answering as the real backend does, with fresh objects each call: a check in a shell that's off returns `shadowedOnPath`, not `notFound`, whenever the tool is installed. Running the real app touches `~/.envrouter`, and its shell toggles edit the real startup files. To try the real app safely, launch the built binary with `HOME` set to a scratch folder.
- **Wire types live in `src/lib/types.ts`.** A Rust test (`wire_format_matches_the_typescript_types` in `shell.rs`) pins the JSON, so change both sides together.
- `.claude/settings.json` denies Claude read access to `.env` files. Ask the user for variable names instead.
