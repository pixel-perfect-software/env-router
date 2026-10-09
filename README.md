# EnvRouter

EnvRouter is a macOS app that picks the right coding-agent account from the folder you're in.
Run `claude` in `~/dev/work` and it uses your work config; run it in `~/dev/personal` and it
uses your personal one. There are no aliases to remember and nothing to reload.

You define **profiles**. Each profile has trigger folders and a config folder per agent:

| Agent | Command | Variable EnvRouter sets |
|---|---|---|
| Claude Code | `claude` | `CLAUDE_CONFIG_DIR` |
| Codex | `codex` | `CODEX_HOME` |
| Copilot CLI | `copilot` | `COPILOT_HOME` |
| Gemini CLI | `gemini` | `GEMINI_CLI_HOME` |

EnvRouter only sets these variables. It never signs you in to anything: a new config folder
starts logged out, and you sign in from the terminal as usual.

## How it works

EnvRouter uses shims, like mise or volta.

- `~/.envrouter/shims/<tool>` is a symlink to `~/.envrouter/bin/envrouter-shim`, a small Rust binary.
- A marked block at the end of your shell startup file puts `~/.envrouter/shims` first on `PATH`.
- Each time you run a tool, the shim reads `~/.envrouter/config.json`, finds the profile for the
  current folder, sets that tool's variable, and `exec`s the real tool found later on `PATH`.

Edits apply on the next run in every terminal. If the config is missing or broken, the tool
still runs, without a profile.

**The most specific folder wins outright.** The deepest trigger folder containing the current
folder picks the profile. If that profile doesn't set the tool you're running, the tool runs
with its default config; it does not fall back to a profile further up.

The app can also check a folder: it starts your shell the way a new terminal window would, runs
its prompt hooks once, and reports what running the tool there would really do, including an
alias, a shell function or another copy on `PATH` getting in the way. That includes a copy a
prompt hook (mise, direnv) moves ahead of EnvRouter's shims.

## Status

Pre-release. There are no signed builds yet, so for now you build it yourself. It runs on
macOS on Apple Silicon, with zsh, bash and fish.

## Build from source

You need Rust (stable), Node.js and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
pnpm tauri build --bundles app
```

The app is written to `target/release/bundle/macos/EnvRouter.app`.

## Uninstall

1. In the app, open **Shells…** and turn every shell off. This removes the marked block from
   each startup file. You can also delete the lines between `# >>> envrouter >>>` and
   `# <<< envrouter <<<` by hand.
2. Delete `~/.envrouter`.
3. Delete the app.

Your agents' config folders are yours and are left alone.

## Development

| Task | Command |
|---|---|
| Run the desktop app | `pnpm tauri dev` |
| Review the UI in a browser, with the backend mocked | `pnpm dev`, then `http://localhost:1420/?scenario=populated` |
| Rust tests | `cargo test --workspace` |
| Frontend tests | `pnpm test` |
| Type check | `pnpm check-types` |
| Lint and format | `pnpm format-and-lint:fix`, `cargo fmt --all`, `cargo clippy --workspace --all-targets` |

Running the desktop app reads and writes the real `~/.envrouter`, and its shell switches edit
your real startup files. To try it without touching them, launch the built binary with `HOME`
set to a scratch folder.

The code is a Cargo workspace plus a React frontend:

- `crates/core`: the profile model, validation and folder resolution, shared by the app and the shim.
- `crates/shim`: the shim binary.
- `src-tauri`: the desktop app (Tauri v2): commands, shell integration, menu bar.
- `src`: the window (React, TypeScript, Tailwind).

## License

[MIT](LICENSE)
