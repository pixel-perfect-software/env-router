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

Pre-release, and distributed as source: you build EnvRouter on your own Mac. There are no
prebuilt downloads, because those need a paid Apple Developer account for signing and
notarization. It runs on macOS 11 or later with zsh, bash and fish. It's developed on Apple
Silicon; building on an Intel Mac should work the same way but hasn't been tried.

## Build and install

You need, once:

1. Xcode's command line tools: `xcode-select --install`
2. Rust, from [rustup.rs](https://rustup.rs)
3. Node.js 22 or later, from [nodejs.org](https://nodejs.org) or `brew install node`
4. pnpm: `npm install -g pnpm` (the project pins its own version, and pnpm fetches it)

Then build it and copy it into Applications:

```sh
pnpm install
pnpm tauri build
ditto target/release/bundle/macos/EnvRouter.app /Applications/EnvRouter.app
open /Applications/EnvRouter.app
```

The first build takes a few minutes. In the app, create a profile and turn on your shell, then
open a new terminal window.

To update, pull the latest code, quit EnvRouter from its menu bar icon, and run the same
commands. When the new version starts, it updates the shim in `~/.envrouter/bin` itself.

A build is signed ad hoc, so macOS trusts it only on the Mac that built it. If you send
someone your built copy rather than having them build it, macOS will refuse to open it as
damaged or unverified. Once it's in their Applications folder, they can clear that with
`xattr -dr com.apple.quarantine /Applications/EnvRouter.app`.

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
