<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="EnvRouter app icon: a folder whose track forks to two accounts" />
</p>

<h1 align="center">EnvRouter</h1>

<p align="center">
  The right coding-agent account, and the right MCP servers, for the folder you're in.
</p>

<p align="center">
  <a href="https://github.com/pixel-perfect-software/env-router/actions/workflows/ci.yml"><img src="https://github.com/pixel-perfect-software/env-router/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/macOS-11%2B-000000?logo=apple&logoColor=white" alt="macOS 11 or later" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-1.99-CE422B?logo=rust&logoColor=white" alt="Rust 1.99" />
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Copilot%20CLI-6E56CF" alt="Agents: Claude Code and Copilot CLI" />
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/check-dark.png" />
    <img src="docs/images/check-light.png" width="860" alt="The Profiles view: one card per profile with its folders filed inside. A folder check at the bottom says ~/dev/work/api is routed to the Work profile, which sets CLAUDE_CONFIG_DIR to ~/.claude-work and adds the github, linear, postgres and sentry MCP servers." />
  </picture>
</p>

EnvRouter is a macOS app for people who use more than one account with their coding agents.
Run `claude` in `~/dev/work` and it uses your work config with your work MCP servers; run it in
`~/dev/personal` and it uses your personal ones. There are no aliases to remember, no wrapper
commands and nothing to reload.

You define **profiles**. Each profile has trigger folders, a config folder per agent, and a
selection of MCP servers from a library you keep in the app:

| Agent | Command | Variable EnvRouter sets | How it hands over MCP servers |
|---|---|---|---|
| Claude Code | `claude` | `CLAUDE_CONFIG_DIR` | `--mcp-config=<file>` |
| Copilot CLI | `copilot` | `COPILOT_HOME` | `--additional-mcp-config=@<file>` |

## ✨ Features

- 👤 **Per-folder accounts.** Each profile points an agent at its own config folder, so logins,
  settings and history stay separate. The deepest matching folder picks the profile.
- 🔌 **Per-folder MCP servers.** Keep one server library and choose which profiles load each
  server. Turn off individual tools per profile once a check has listed them.
- 📥 **Import and catalog.** Bring in the servers your agents already define (EnvRouter only reads
  their files), pick from a short catalog of well-known servers, or add one by hand.
- 🔑 **Secrets in the Keychain.** API keys and tokens you enter are stored in your login Keychain,
  never in `config.json`, a rendered file or a command line.
- 🔍 **Folder check.** Drop a folder on the window (or press ⌘O) and EnvRouter starts your shell the
  way a new terminal window would, then reports what running the agent there would really do,
  including an alias, a shell function, or a prompt hook (mise, direnv) getting in the way.
- 🪶 **No background process.** A small shim does the routing when you run a command. Config
  changes apply on the next run in every open terminal, with the app closed or open.
- 🛟 **Never in the way.** If the config is missing or broken, the agent still runs, without a
  profile. EnvRouter never signs you in to anything.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/servers-dark.png" />
    <img src="docs/images/servers-light.png" width="860" alt="The MCP Servers view: a list of five MCP servers (github, linear, playwright, postgres, sentry) beside the editor for github, whose Used by toggles show it loads in the Work profile." />
  </picture>
</p>

## 📋 Requirements

- macOS 11 or later, on Apple Silicon. Intel Macs should work the same way but haven't been
  tried, and the bundle is arm64-only for now.
- zsh, bash or fish.
- Claude Code and/or Copilot CLI, installed the usual way.

EnvRouter is pre-release. It's signed ad hoc rather than with a paid Apple Developer ID, so it
isn't notarized: install it with Homebrew, which clears the download's quarantine flag, or build
it yourself.

## 🚀 Install

With [Homebrew](https://brew.sh):

```sh
brew install --cask pixel-perfect-software/tap/envrouter
open /Applications/EnvRouter.app
```

The cask comes from [pixel-perfect-software/homebrew-tap](https://github.com/pixel-perfect-software/homebrew-tap).
Each release is built from its tagged source by this repository's
[release workflow](.github/workflows/release.yml) on GitHub Actions. Installing by full name
trusts only this cask, not the whole tap.

### 🔨 Build from source

You need, once:

1. Xcode's command line tools: `xcode-select --install`
2. Rust, from [rustup.rs](https://rustup.rs). The repository pins its toolchain in
   `rust-toolchain.toml`, and rustup installs that version on first build. (Homebrew's `rust`
   doesn't read the pin; if you use it, match the version by hand.)
3. Node.js 22.12 or later, from [nodejs.org](https://nodejs.org) or `brew install node`
4. pnpm: `npm install -g pnpm`. The project pins its own pnpm version, and pnpm fetches it.

Then clone, build, and copy the app into Applications:

```sh
git clone https://github.com/pixel-perfect-software/env-router.git
cd env-router
pnpm install
pnpm tauri build
ditto target/release/bundle/macos/EnvRouter.app /Applications/EnvRouter.app
open /Applications/EnvRouter.app
```

The first build takes a few minutes.

## 🧭 Getting started

1. **Create a profile** (⌘N). Give it a name, add its trigger folders with **Add Folder…**, and set a config folder for each agent you want to route, such as
   `~/.claude-work`. EnvRouter creates missing config folders inside your home folder when you
   save.
2. **Turn on your shell.** Open **Shells…** and switch on the shells you use. This adds a marked
   block to the end of each startup file that puts EnvRouter's shims first on `PATH`.
3. **Open a new terminal window,** `cd` into a trigger folder and run `claude` or `copilot`.
   A new config folder starts logged out, so sign in once there as usual.
4. **Check it.** Drop a folder on the window, or press ⌘O, to see which profile a new terminal
   window would use there and what it would set. From a terminal,
   `ENVROUTER_EXPLAIN=1 claude` prints the route as JSON instead of running Claude.

To give a profile MCP servers, switch to **Servers** (⌘2), add servers from the catalog, by
import or by hand, and choose the profiles that use each one, either with the server's **Used
by** toggles or from the profile's own checklist. **Check Server** starts a server and lists its
tools, so a profile can turn individual tools off. Remote servers that need a login sign in
through the agent (`/mcp` in Claude Code), not through EnvRouter.

EnvRouter lives in the menu bar. Closing the window only hides it; quit from the menu bar icon.

## ⚙️ How it works

EnvRouter uses shims, like [mise](https://mise.jdx.dev) or [Volta](https://volta.sh).

- `~/.envrouter/shims/<tool>` is a symlink to `~/.envrouter/bin/envrouter-shim`, a small Rust
  binary.
- A marked block at the end of your shell startup file puts `~/.envrouter/shims` first on `PATH`.
- Each time you run a tool, the shim reads `~/.envrouter/config.json`, finds the profile for the
  current folder, sets that tool's variable, adds that profile's MCP servers to the command
  line, and `exec`s the real tool found later on `PATH`.
- When you save, the app writes each profile's MCP server files in each agent's own format, so
  servers keep working with the app closed. When a server needs a secret, the shim asks a small
  helper, `envrouter-keychain`, to read it and passes it to the agent in its environment.

**The most specific folder wins outright.** The deepest trigger folder containing the current
folder picks the profile. If that profile doesn't set the tool you're running, the tool runs
with its default config; it does not fall back to a profile further up. Folders are compared
after resolving symlinks and letter case, and a trigger covers its whole subtree.

### 📁 Files EnvRouter creates

| Where | What |
|---|---|
| `~/.envrouter/config.json` | Your profiles and server library |
| `~/.envrouter/bin/` | The shim and the Keychain helper, updated by the app when it starts |
| `~/.envrouter/shims/` | One symlink per routed command |
| `~/.envrouter/mcp/` | Rendered MCP server files per profile and agent (readable only by you) |
| `~/.envrouter/mcp-tools.json` | Tool lists from server checks |
| Login Keychain, "EnvRouter MCP secrets" | Secret values you've entered, once there are any |
| Shell startup files | A block between `# >>> envrouter >>>` and `# <<< envrouter <<<` in `~/.zshrc` (or `$ZDOTDIR/.zshrc`), bash's login file and `~/.bashrc`, or `~/.config/fish/config.fish` |

Your agents' own config folders are yours; EnvRouter only creates missing ones.

### 🔒 Privacy and security

EnvRouter has no account, no telemetry and no background process. It makes network requests
only when you check a remote MCP server. Secret values never appear in `config.json`, in a
rendered file or on a command line, and the window never reads them back once they're saved.

## 🩺 Troubleshooting

| Problem | Try |
|---|---|
| The agent ignores the profile | Check the folder in the app (⌘O). It names what's in the way: the shell block is off, an alias or function, another copy earlier on `PATH`, or a prompt hook (mise, direnv) moving one ahead. Remember to open a new terminal window after turning a shell on. |
| You want to see what the shim would do | `ENVROUTER_EXPLAIN=1 claude` (or `copilot`) prints the profile, variable, MCP servers and real binary as JSON, without running the tool. |
| You want one run without EnvRouter's MCP servers | `ENVROUTER_MCP=0 claude`, or pass `--strict-mcp-config` to `claude`. |
| An MCP server doesn't show in `claude mcp list` or `copilot mcp list` | Expected: those commands don't list servers passed on the command line. Use `/mcp` inside the agent. |
| A copy of the app built on another Mac won't open | Builds are signed ad hoc, so macOS trusts one only on the Mac that built it. Build it yourself, or run `xattr -dr com.apple.quarantine /Applications/EnvRouter.app`. |

## 🔄 Updating

With Homebrew, `brew upgrade --cask envrouter`. It quits EnvRouter first; open it again
afterwards. From source, pull the latest code, quit EnvRouter from its menu bar icon, and run the
build and `ditto` commands again. Either way, when the new version starts it updates the shim and
helper in `~/.envrouter/bin` itself.

## 🗑️ Uninstall

1. In the app, open **Shells…** and turn every shell off. This removes the marked block from
   each startup file. You can also delete the lines between `# >>> envrouter >>>` and
   `# <<< envrouter <<<` by hand.
2. If you turned on an editor in **Editors…**, turn it off. This removes
   `claudeCode.claudeProcessWrapper` from that editor's settings.
3. Quit EnvRouter and delete `/Applications/EnvRouter.app` (with Homebrew,
   `brew uninstall --cask envrouter`).
4. Delete `~/.envrouter` (with Homebrew, `brew uninstall --zap --cask envrouter` does steps 3
   and 4).
5. If you stored MCP secrets, delete the "EnvRouter MCP secrets" item in Keychain Access, or run
   `security delete-generic-password -s "EnvRouter MCP secrets"`.

Your agents' config folders are left alone.

## 🤝 Contributing

Contributions are welcome. See the [contributing guide](docs/contributing.md) for setup,
the development commands, how to review the UI safely in a browser, and the project layout.

## 💸 Support this project

<a href="https://www.buymeacoffee.com/tylernrobertson" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" height="50" width="217" /></a>

## 📝 License

MIT © [Tyler Robertson](https://github.com/TylerNRobertson) @ [Pixel Perfect Software Inc.](https://github.com/pixel-perfect-software). See [LICENSE](LICENSE).
