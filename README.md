<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="EnvRouter app icon: a folder whose track forks to two accounts" />
</p>

<h1 align="center">EnvRouter</h1>

<p align="center">
  The right coding-agent account, and the right MCP servers, for the folder you're in.
</p>

<p align="center">
  <a href="https://github.com/pixel-perfect-software/env-router/actions/workflows/ci.yml"><img src="https://github.com/pixel-perfect-software/env-router/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/pixel-perfect-software/env-router/releases/latest"><img src="https://img.shields.io/github/v/release/pixel-perfect-software/env-router?sort=semver&label=release" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License: GPL-3.0-or-later" /></a>
  <img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20WSL%202-4C6EF5" alt="Platforms: macOS, Linux and WSL 2" />
  <a href="https://github.com/pixel-perfect-software/homebrew-tap"><img src="https://img.shields.io/badge/homebrew-pixel--perfect--software%2Ftap-FBB040?logo=homebrew&logoColor=white" alt="Homebrew tap: pixel-perfect-software/tap" /></a>
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Copilot%20CLI%20%7C%20Codex%20CLI-6E56CF" alt="Agents: Claude Code, Copilot CLI and Codex CLI" />
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/check-dark.png" />
    <img src="docs/images/check-light.png" width="860" alt="The Profiles view: one card per profile with its folders filed inside. A folder check at the bottom says ~/dev/work/api is routed to the Work profile, which sets CLAUDE_CONFIG_DIR to ~/.claude-work and adds the github, linear, postgres and sentry MCP servers, and the Work card highlights the folder under ~/dev/work." />
  </picture>
</p>

EnvRouter is for people who use more than one account with their coding agents. Run `claude` in
`~/dev/work` and it uses your work config with your work MCP servers; run it in `~/dev/personal`
and it uses your personal ones. There are no aliases to remember, no wrapper commands and
nothing to reload.

It's a desktop app for macOS and Linux, including WSL 2, and an `envrouter` command for machines
without a desktop.

You define **profiles**. Each profile has trigger folders, a config folder per agent, and a
selection of MCP servers from a library you keep in the app:

| Agent       | Command   | Variable EnvRouter sets | How it hands over MCP servers                                                           |
| ----------- | --------- | ----------------------- | --------------------------------------------------------------------------------------- |
| Claude Code | `claude`  | `CLAUDE_CONFIG_DIR`     | `--mcp-config=<file>`                                                                   |
| Copilot CLI | `copilot` | `COPILOT_HOME`          | `--additional-mcp-config=@<file>`                                                       |
| Codex CLI   | `codex`   | `CODEX_HOME`            | `--config=mcp_servers.<name>={…}`, one inline table per server, no file; no SSE servers |

## ✨ Features

- 👤 **Per-folder accounts.** Each profile points an agent at its own config folder, so logins,
  settings and history stay separate. The deepest matching folder picks the profile.
- 🔌 **Per-folder MCP servers.** Keep one server library and choose which profiles load each
  server. Turn off individual tools per profile once a check has listed them.
- 📥 **Import, paste and catalog.** Bring in the servers your agents already define (EnvRouter only
  reads their files, Codex's TOML included), paste a server's JSON or TOML straight from its README, search a catalog of nearly 90
  vendors' own servers (hosted or local, and what each needs to sign in), or add one by hand.
  Duplicate a server or a profile to start from one you have.
- 🔑 **Secrets in your system's store.** API keys and tokens you enter go to the macOS Keychain,
  the Linux keyring, or, inside WSL, the Windows Credential Manager. Never `config.json` or a
  rendered file. A server the agent runs as a command gets its own when it starts, in its own
  environment rather than the agent's, and, kept in an environment variable or a header, never
  on a command line.
- 🧩 **Editor extensions too.** Claude Code for VS Code (and in Cursor, Windsurf, VSCodium) runs
  its own copy of `claude`; **Editors…** routes it through EnvRouter as well, including VS Code
  connected to WSL or over SSH.
- 💻 **A CLI for headless machines.** `envrouter` sets up and checks routing on a server or in a
  WSL distro, without the window.
- 🔍 **Folder check.** Drop a folder on the window (or press ⌘O; Ctrl+O on Linux) and EnvRouter
  starts your shell the way a new terminal window would, then reports what running the agent
  there would really do, including an alias, a shell function, or a prompt hook (mise, direnv)
  getting in the way.
- 🪶 **No background process.** A small shim does the routing when you run a command. Config
  changes apply on the next run in every open terminal, with the app closed or open.
- 🛟 **Never in the way.** If the config is missing or broken, the agent still runs, without a
  profile. EnvRouter never signs you in to anything.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/servers-dark.png" />
    <img src="docs/images/servers-light.png" width="860" alt="The MCP Servers view: a list of six MCP servers (github, linear, playwright, postgres, sentry, slow) under a filter field, beside the editor for github, whose Used by toggles show it loads in the Work profile, above its name, command and arguments." />
  </picture>
</p>

## 📋 Requirements

- **macOS** 11 Big Sur or later, on Apple Silicon, with Safari 16.4 or later: the window is drawn
  by the system's WebKit, which Safari updates bring, and its styles need 16.4's. Intel Macs should
  work the same way but haven't been tried, and the bundle is arm64-only for now.
- **Linux** on x86_64 or aarch64: Ubuntu 22.04 or newer, or a distro of the same age, and WSL 2.
  The app needs WebKitGTK 4.1, which the `.deb` installs. Secrets need a keyring (GNOME Keyring
  or KWallet); in WSL they go to Windows instead, through a helper that comes with EnvRouter.
- zsh, bash or fish.
- Claude Code, Copilot CLI or Codex CLI, installed the usual way.

EnvRouter is pre-release. The macOS app is signed ad hoc rather than with a paid Apple Developer
ID, so it isn't notarized: install it with Homebrew, which clears the download's quarantine
flag, or build it yourself. Native Windows support is planned.

## 🚀 Install

### 🍎 macOS

With [Homebrew](https://brew.sh):

```sh
brew install --cask pixel-perfect-software/tap/envrouter
open /Applications/EnvRouter.app
```

### 🐧 Linux

From the [latest release](https://github.com/pixel-perfect-software/env-router/releases/latest),
take the `.deb` (Debian, Ubuntu and their relatives) or the AppImage (any distro) for your
architecture: `amd64`/`x86_64` or `arm64`/`aarch64`. The `.deb` is about 7 MB and uses your
system's WebKitGTK; the AppImage is about 85 MB because it carries WebKitGTK with it, so it
runs where `webkit2gtk-4.1` isn't packaged. Both work in WSL 2.

```sh
sudo apt install ./EnvRouter_<version>_amd64.deb     # then open EnvRouter from your apps
# or
chmod +x EnvRouter_<version>_amd64.AppImage && ./EnvRouter_<version>_amd64.AppImage
```

### 💻 The CLI

`envrouter` does the same setup without the window, for servers, WSL distros and scripts:

```sh
brew install pixel-perfect-software/tap/envrouter-cli
envrouter install          # the shim and helpers, into ~/.envrouter/bin
envrouter shell on zsh     # or bash, fish
```

On a Mac with the app installed, skip `envrouter install`: the app keeps `~/.envrouter/bin`
current itself. Without Homebrew, unpack `envrouter-cli-<version>-<target>.tar.gz` from the release (for example
`envrouter-cli-0.10.0-x86_64-unknown-linux-gnu.tar.gz`)
and run `./envrouter install` from that folder.

Every release comes with `SHA256SUMS`; `sha256sum -c SHA256SUMS --ignore-missing` checks the
files you downloaded. From 0.7.1 on, every file also has a signed build provenance attestation,
which ties it to the release workflow run and the tagged commit that built it. With the
[GitHub CLI](https://cli.github.com):

```sh
gh attestation verify envrouter-cli-<version>-<target>.tar.gz --repo pixel-perfect-software/env-router \
  --signer-workflow pixel-perfect-software/env-router/.github/workflows/release.yml
```

`--signer-workflow` accepts only files built by the release workflow.

The cask and formula come from [pixel-perfect-software/homebrew-tap](https://github.com/pixel-perfect-software/homebrew-tap).
Every build in a release comes from its tagged source, built by this repository's
[release workflow](.github/workflows/release.yml) on GitHub Actions. Installing by full name
trusts only that cask or formula, not the whole tap.

### 🔨 Build from source

You need, once:

1. On macOS, Xcode's command line tools: `xcode-select --install`. On Linux, a C toolchain and
   the WebKitGTK development packages: on Debian or Ubuntu, `sudo apt install build-essential
   libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`
2. Rust, from [rustup.rs](https://rustup.rs). The repository pins its toolchain in
   `rust-toolchain.toml`, and rustup installs that version on first build. (Homebrew's `rust`
   doesn't read the pin; if you use it, match the version by hand.)
3. Node.js 24 or later, from [nodejs.org](https://nodejs.org) or `brew install node`
4. pnpm: `npm install -g pnpm`. The project pins its own pnpm version, and pnpm fetches it.
5. cargo-about, which writes the third-party notices every build carries:
   `cargo install --locked --features cli cargo-about`

(With [asdf](https://asdf-vm.com), `asdf install` sets up the Node and pnpm versions pinned in
`.tool-versions` instead of steps 3 and 4.)

Then clone and build:

```sh
git clone https://github.com/pixel-perfect-software/env-router.git
cd env-router
pnpm install
pnpm bundle    # tauri build, with LICENSE and the third-party notices inside
# macOS: copy the app into Applications
ditto target/release/bundle/macos/EnvRouter.app /Applications/EnvRouter.app
open /Applications/EnvRouter.app
# Linux: install the package it built
sudo apt install ./target/release/bundle/deb/EnvRouter_*.deb
```

For the CLI alone, `cargo build --release -p envrouter-cli -p envrouter-shim -p envrouter-keychain`
and then `target/release/envrouter install`. The first build takes a few minutes.

## 🧭 Getting started

1. **Create a profile** (⌘N; Ctrl+N on Linux). Give it a name, add its trigger folders with
   **Add Folder…**, and set a config folder for each agent you want to route, such as
   `~/.claude-work`. EnvRouter creates missing config folders inside your home folder when you
   save, and again when an agent starts in a folder whose config folder has been deleted. An agent a new terminal can't find on its `PATH` is still offered, marked **Not
   installed** (with its vendor's install line), so you can set it up first.
2. **Turn on your shell.** Click the shell status in the toolbar (the `zsh` and `bash` dots) and
   switch on the shells you use. This adds a marked block to the end of each startup file that
   puts EnvRouter's shims first on `PATH`.
3. **Open a new terminal window,** `cd` into a trigger folder and run `claude`, `copilot` or `codex`.
   A new config folder starts logged out, so sign in once there as usual.
4. **Check it.** Drop a folder on the window, or press ⌘O (Ctrl+O), to see which profile a new
   terminal window would use there and what it would set. From a terminal, `envrouter check`
   does the same, and `ENVROUTER_EXPLAIN=1 claude` prints the route as JSON instead of running
   Claude.

To route an editor extension, open **Editors…** (the `</>` button in the toolbar) and switch on
the editor. It points the extension's process-wrapper setting (`claudeCode.claudeProcessWrapper`
for Claude Code) at EnvRouter; new sessions in that editor then use the folder's profile.
EnvRouter never replaces a wrapper you set yourself. The button appears once EnvRouter finds an
editor with an agent extension it can route.

To start a profile from one you have, right-click its card and choose **Duplicate Profile…**
(or **Duplicate** in its editor). The copy keeps the agents, servers and turned-off tools, but no
folders, since a folder belongs to one profile.

## 🔌 MCP servers

Switch to **MCP Servers** (⌘2; Ctrl+2). The list on the left is your server library; the editor
beside it changes one server at a time. A server reaches an agent only in the folders of the
profiles that use it. Once the library grows past a handful, a **Filter servers** field appears
above the list: it matches the name, the command or URL, and the arguments (so an `npx` package
or a Docker image), and Escape clears it. Right-click a server, or use the **…** that appears on
its row, for **Duplicate…**, **Check Server** and **Delete…**.

### ➕ Add a server

- **Add from Catalog** (the package icon): search the vendors' own servers. Filter by where they
  run (**Hosted** by the vendor, or **Runs locally** on your machine) and by what they need
  (**No sign-in**, **Sign-in**, **Secret**). Picking one opens the editor filled in, with any
  secret fields empty and the expected format as a hint. An `npx` server comes pinned to the
  package's current release.
- **Import from Your Agents** (the import icon): lists the servers your agents already define, in
  Claude Code's `.claude.json` (your home folder and each profile's config folder) and any
  `.mcp.json` in a trigger folder, and in Copilot's `mcp-config.json` and the `.mcp.json` and
  `.github/mcp.json` in a trigger folder, each written with an `mcpServers` wrapper or as a bare
  table of named servers. Codex CLI keeps its servers in TOML, so the `[mcp_servers.<name>]`
  tables of `config.toml` (your `~/.codex` and each profile's `CODEX_HOME`) and of a trigger
  folder's `.codex/config.toml` are listed too. Tick the ones to bring in.
  Values that look like credentials go to your system's secret store, and Docker or Podman
  servers get `--init` so the container stops with the agent. EnvRouter never changes those
  files, and a server already in the library is shown as such.

  From Codex, a server's `command`, `args`, `env`, `url` and `http_headers` come as they are, and
  the variables Codex passes by name (`env_vars`, `env_http_headers`, `bearer_token_env_var`)
  come as `${NAME}` references, which go back to Codex as the same fields. A server that signs
  in its own way (`oauth`, `oauth_resource`, `scopes`, `http_headers_helper`, an `auth` other
  than `oauth`), runs somewhere else (`cwd`, a remote `environment_id` or `env_vars` source),
  holds an inline `bearer_token`, or sets both `command` and `url` is left out, since it
  couldn't be imported right, and so is one you turned off there (`enabled = false`). Codex's own tool filters (`enabled_tools`, `disabled_tools`),
  timeouts and the like aren't carried: set the tools in the profile instead, or they all show
  until you do. A name Codex allows and agents don't (`docs.search`) is offered under one they
  accept (`docs-search`), so the original in `config.toml` runs beside it under Codex until you
  remove it.
- **Paste JSON** (the clipboard icon): paste a server's config as its README or an agent's file
  writes it: an `mcpServers` block, VS Code's `servers`, a bare table of servers, or one server on
  its own. Codex's TOML works too: `[mcp_servers.<name>]` blocks, bare `[<name>]` ones, or one
  server's `command` or `url` fields. Comments and trailing commas are fine. One server opens in the editor; several open
  the import review. ⌘Return (Ctrl+Return) continues.
- **Add Server** (the plus): fill in the editor by hand. **Connects with** picks a command the
  agent starts (with arguments and environment variables), or a URL (HTTP or SSE) with headers.
  Codex CLI has no SSE transport, so an SSE server reaches Claude Code and Copilot CLI, not Codex.

### 👥 Choose which profiles use it

Switch a profile on in the server's **Used by** row, or tick the server in the profile's own
**MCP servers** checklist. Both change the same thing. Each profile card lists its servers;
click a name to open it.

### 🔑 Keep secrets out of config.json

Every value field has a lock at its right edge. Click it to keep that value in the macOS
Keychain, the Linux keyring or, in WSL, the Windows Credential Manager, instead of
`config.json`. A new value under a name like `API_KEY` or `Authorization` starts locked. A stored
value shows as **In Keychain** (**In the keyring**, **In the Credential Manager**) and is never
shown again; **Replace**
sets a new one. EnvRouter also warns when a value that looks like a credential would be saved as
plain text, such as an `--api-key=` argument or a password in a connection string.
With no store to keep values in (no Secret Service running on Linux, say), the lock is off and the editor says why; values are saved in `config.json` and flagged as such.

Give a server its secret through an environment variable or a header. An argument can hold one
too, under every agent, but the value then sits on the server's command line once it starts (and
while you check it), where other programs you run can read it.

**A server the agent runs as a command** and that needs a secret starts through EnvRouter's
helper. Where the agent would run the server, it runs `~/.envrouter/bin/envrouter-keychain exec
<file>`; the helper reads that server's values from the store, then replaces itself with the
server's own command, so the values are in that server's environment (or arguments) and nowhere
else. It reads them every time the server starts, so a value you **Replace** applies the next
time the server starts, with no need to restart the agent. If the store can't be read or a value
isn't in it, that server doesn't start: the agent shows it as failed, and EnvRouter's reason is
one line in the server's error output, wherever the agent shows that. The other servers load.
The helper also fills in a `${NAME}` or `${NAME:-default}` in that server's other values, as the
agent would, from the environment the agent starts it with (EnvRouter tells Copilot CLI and Codex
CLI, which pass a server only some of theirs, which variables to hand on). One that isn't set
and has no default stops that server the same way.

**A remote server** (a URL) has no process of its own to start, since the agent sends its
headers. The shim reads the values and gives them to the agent in its environment, which the
agent puts into the headers. One it can't read is left out, with a warning when the agent
starts. [Privacy and security](#-privacy-and-security) says what that means for who can see
them.

### 🧵 Codex CLI takes its servers differently

Claude Code and Copilot CLI load a file EnvRouter wrote. Codex has no such flag, so each server
reaches it as one `--config=mcp_servers.<name>={…}` argument, a TOML table holding the whole
server, and nothing is written to disk for it. That has some consequences:

- **Lock what's secret.** Codex expands no `${VAR}` in a server's values. EnvRouter tells it to
  read a variable where a whole value is one: an environment variable set to `${SAME_NAME}`, a
  header that is `${VAR}`, or `Authorization: Bearer ${VAR}`. Anything else reaches the server as
  typed. And the table is on Codex's command line, so a value you leave unlocked (a plain
  environment variable, a plain header, an argument) can be read by other programs you run. A locked value in an environment variable
  or a header isn't on it: a command server gets it from the helper as it starts, and a remote
  server's header only names the variable the shim sets.
- **In a folder with servers, Codex runs without its shared background server.** Given any
  configuration override, `codex`, `codex resume` and `codex fork` run the session themselves
  instead of handing it to the background server. `codex queue`,
  `archive`, `unarchive`, `delete` and `remote-control` are left alone by EnvRouter, also with
  your own options ahead of them (`codex -C ~/proj queue …`), because they refuse an override or
  would write session state through a second server; they get no servers and need none.
- **A server named like one of yours in Codex's own `config.toml` merges with it.** Codex joins the
  two key by key, so the same transport works (EnvRouter's fields win, yours still apply). A
  different transport, say a command in one and a URL in the other, stops every `codex` command
  in that folder with an error ending in `url is not supported for stdio`. EnvRouter warns when you
  save, and Check Folder shows it with the file to open (`envrouter check` prints it and exits 1);
  it reads the `config.toml` of the profile's Codex folder (`~/.codex` when it doesn't set one) and
  the checked folder's `.codex/config.toml` files that Codex trusts. Rename one of them, or run
  `ENVROUTER_MCP=0 codex` meanwhile.
- **`codex_apps` and `codex_tui` are Codex's own servers' names**, so a server in your library can't
  take either name while Codex is set up.
- **Sign-ins are Codex's:** `codex mcp login <name>`. They're kept in the system's keyring by
  server name and URL, so every profile shares them.

### 🧰 Check a server and turn tools off

**Check Server** starts the server (or calls its URL), lists its tools and stops it again. Once a
server has been checked, each profile that uses it can turn individual tools off: open the
profile, expand the server's **All 9 tools** line under **MCP servers**, and untick tools, or use
**All On** and **All Off**. A tool turned off in a profile stays available in the others.

### 📌 Pin a server's version

An `npx` server with no version, or with `@latest`, runs whatever npm has newest when an agent
starts it, so a new release (or a bad one) reaches every session the day it's published, with
the server's secrets in its environment. The editor says so under **Arguments**: **Pin Version**
asks your own npm (`npm view`, so your registry and `~/.npmrc` apply) for the current release and
writes it into the argument (`chrome-devtools-mcp@0.9.0`). A pinned server shows its version, and
**Check for Update** offers **Update to …** when a newer release is out. Nothing changes until you
save.

Remote servers that need a login sign in through the agent (`/mcp` in Claude Code), not through
EnvRouter. **Duplicate** in the editor's footer starts a new server from this one, with its
secret fields empty; **Delete…** removes it from the library and from every profile.

On macOS, EnvRouter lives in the menu bar: closing the window only hides it; quit from the menu
bar icon. On Linux, closing the window quits; routing keeps working without it. The window opens
where you left it, at the size you left it, on the view (Profiles or MCP Servers) you left it
on. The menu bar's menu carries **Check Last Folder** (the folder you last checked in the
window; greyed out until there is one) and the version.

**Settings…** (⌘, on macOS, Ctrl+, on Linux) opens the Shells panel: EnvRouter has no
Preferences window, since shells are the one setting. The Shells panel also links to the
documentation and to **Report an Issue**; on macOS the Help menu has both.

The keyboard reaches everything the pointer does. The arrow keys, Home and End move between the
profile cards, the servers in the list and the entries in the catalog (Tab leaves the list rather
than stepping through each one); the context-menu key (or Shift+F10) opens a card's or a row's
menu under it. ⌘N (Ctrl+N) starts a new profile on Profiles and a new server on MCP Servers, and
⌘S (Ctrl+S) saves whichever editor is open. When a check can't start (the profile editor is open,
or `config.json` can't be read), EnvRouter says why instead of doing nothing.

To see EnvRouter's own files, the menu bar icon's menu and the Shells panel show `config.json` in
Finder (Files off macOS) and open `~/.envrouter`, and a profile card's right-click menu opens the
folder its MCP files are written to.

## ⌨️ CLI commands

`envrouter` runs the same operations as the window:

| Command                                                         | Does                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envrouter` or `envrouter status`                               | The shim, each shell and editor, and the config. `--agents` also says which agents a new terminal doesn't find (an `Agents` line, or `missingAgents` in `--json`), by running your login shell; without it nothing runs one, and `missingAgents` is null |
| `envrouter install`                                             | Installs the shim, the secrets helper and the CLI into `~/.envrouter/bin`, and a shim per agent. When that changes the installed files, it renders the MCP files again to match, and asks the system's store once to let the new helper in               |
| `envrouter shell on\|off <zsh\|bash\|fish>`                     | Adds or removes the block in that shell's startup files                                                                                                                                                                                                  |
| `envrouter editor on\|off <editor> [--agent <command>]`         | Routes an editor extension (`code`, `cursor`, `remote-code` for the VS Code Server, …)                                                                                                                                                                   |
| `envrouter check [folder] [--tool <command>] [--shell <shell>]` | Starts a shell the way a new terminal would and reports what running the agent there does; exits 1 unless it's routed, and when Codex won't start there because one of its own files defines a server of the profile's with the other transport          |
| `envrouter explain [folder] [--tool <command>]`                 | Which profile the saved config picks, without starting a shell                                                                                                                                                                                           |
| `envrouter apply`                                               | Validates `~/.envrouter/config.json` after you edit it by hand, and renders its MCP files and shims                                                                                                                                                      |
| `envrouter secret set <ID>`                                     | Stores the value of a server's secret in the system's store: piped in, or typed without echo; never on the command line                                                                                                                                  |
| `envrouter secret list`                                         | Each secret the config refers to, the servers that use it, and whether it's stored (`unknown` when the store can't be read)                                                                                                                              |
| `envrouter uninstall [--yes] [--dry-run]`                       | Turns routing off everywhere, deletes the stored MCP secrets, `~/.envrouter` and the window's own data, and names the commands that remove the app and the CLI (see Uninstall below)                                                                     |
| `envrouter rpc`                                                 | Answers the window's commands as JSON lines, one per line each way, so another program (later, a window managing a WSL distro) can drive this machine                                                                                                    |

`--tool` defaults to `claude`; pass `--tool copilot` for Copilot CLI or `--tool codex` for Codex CLI. `--shell` defaults to your
login shell. Add `--json` to any command for machine-readable output.

The window and the CLI can both change the config while the window is open. When the window
saves, it keeps whatever else changed in `config.json` meanwhile, and asks first only when the
same profile or server changed in both places.

### 📝 Without the window

On a server or in a WSL distro, write `~/.envrouter/config.json` yourself and run
`envrouter apply`. A profile names its trigger folders, a config folder per agent and the
library servers it loads; a value kept in the secret store is written `{ "secret": "<ID>" }`,
with an ID of uppercase hex:

```json
{
  "version": 7,
  "profiles": [
    {
      "id": "work",
      "name": "Work",
      "triggerPaths": ["~/dev/work"],
      "tools": {
        "claude": { "envVar": "CLAUDE_CONFIG_DIR", "path": "~/.claude-work" },
        "copilot": { "envVar": "COPILOT_HOME", "path": "~/.copilot-work" }
      },
      "mcpServers": { "github": { "disabledTools": [] } }
    }
  ],
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": { "secret": "A1" } }
    }
  }
}
```

```sh
envrouter apply                 # validates it, fills in what each agent needs, renders the MCP files
envrouter secret set A1         # paste the token, then Return (or: … secret set A1 < token.txt)
envrouter explain ~/dev/work    # Work: CLAUDE_CONFIG_DIR=~/.claude-work, with MCP servers github
```

Each profile needs its own `id`: it names the folder the profile's MCP files are rendered into,
so `apply` refuses two profiles with the same one. Once a profile uses a server, its id may hold
only letters, digits, `-` and `_`. A copied profile block needs a new id as well as a new name.

A hand-written config doesn't need the `agents` section: `apply` adds each agent's MCP and
editor details to it, and `install` and `editor` use them without saving. The CLI fills in
agents the config doesn't name yet, and adds the newest rules for runs that take no injected
servers to the ones it does; it leaves the rest of an agent as it is, and where the app is
installed it leaves the app's own shim and helper in place.

## 🪟 Using EnvRouter in WSL

A WSL 2 distro is a Linux machine: install EnvRouter inside it, not on the Windows side.

1. **Install inside the distro:** the CLI (`brew install pixel-perfect-software/tap/envrouter-cli`,
   or the release archive), then `envrouter install` and `envrouter shell on bash` (or your
   shell), and set up profiles [without the window](#-without-the-window). The `.deb` works too;
   its window opens on your Windows desktop through WSLg.
2. **Secrets go to the Windows Credential Manager.** A distro usually has no keyring of its own,
   so EnvRouter's Windows helper (`~/.envrouter/bin/envrouter-keychain.exe`, installed with the
   rest) keeps them on the Windows side, per distro. It needs WSL's Windows interop, which is on
   by default. Store one with `envrouter secret set <ID>`, or in the window. The distro's name
   comes from `WSL_DISTRO_NAME`, which WSL sets in its terminals; the first time one of them uses
   the store, EnvRouter notes the name in `~/.envrouter/wsl-distro`, so a process started without
   the variable finds the same secrets. Until then such a process can't tell which distro it
   is and says so; run `envrouter secret list` once in a WSL terminal.
3. **VS Code on Windows, connected to the distro,** runs the Claude Code extension inside WSL.
   Route it with `envrouter editor on remote-code` (or **Editors…** › **VS Code Server**), which
   sets the wrapper in the distro's server settings.
4. **Keep repositories in the Linux filesystem** (`~/…`), not under `/mnt/c`: Windows drives are
   slow to resolve from WSL, and their folder names aren't case-sensitive.

## ⚙️ How it works

EnvRouter uses shims, like [mise](https://mise.jdx.dev) or [Volta](https://volta.sh).

- `~/.envrouter/shims/<tool>` is a symlink to `~/.envrouter/bin/envrouter-shim`, a small Rust
  binary.
- A marked block at the end of your shell startup file puts `~/.envrouter/shims` first on `PATH`.
- Each time you run a tool, the shim reads `~/.envrouter/config.json`, finds the profile for the
  current folder, sets that tool's variable, adds that profile's MCP servers to the command
  line, and `exec`s the real tool found later on `PATH`.
- When you save, the app writes each profile's MCP server files in each agent's own format, so
  servers keep working with the app closed. A server the agent runs as a command and that needs a
  secret is written to run through a small helper, `envrouter-keychain exec`, which reads the
  secret from the system's store as the agent starts the server and runs the server's command
  with it. For a remote server, the shim asks the helper to read the secret and passes it to the
  agent in its environment, where the agent puts it into the server's headers.
- An editor extension that runs its own copy of the agent runs it through the shim instead
  (`envrouter-shim <its binary> <args>`, or `<interpreter> <script> <args>` for a build that
  ships a script), so the same routing applies there.

**The most specific folder wins outright.** The deepest trigger folder containing the current
folder picks the profile. If that profile doesn't set the tool you're running, the tool runs
with its default config; it does not fall back to a profile further up. Folders are compared
after resolving symlinks and letter case, and a trigger covers its whole subtree.

### 📁 Files EnvRouter creates

| Where                                                                                                                                                    | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/.envrouter/config.json`                                                                                                                               | Your profiles and server library                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `~/.envrouter/bin/`                                                                                                                                      | The shim and the secrets helper, which also starts the command servers that need a secret (on Linux also its Windows build, for WSL), and the CLI if you installed it from a release archive; updated by the app when it starts                                                                                                                                                                                                                                                                                                      |
| `~/.envrouter/shims/`                                                                                                                                    | One symlink per routed command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `~/.envrouter/mcp/`                                                                                                                                      | Rendered MCP server files per profile and agent (readable only by you). For a command server that needs a secret, `stdio/<server>.json` holds what the helper starts it from: the server's command, with each secret as a reference to the store, never the value. A server you remove stays there for ten minutes, since a running agent may start it again                                                                                                                                                                         |
| `~/.envrouter/mcp-tools.json`                                                                                                                            | Tool lists from server checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `~/.envrouter/last-folder.json`                                                                                                                          | The folder you last checked, for the menu bar's **Check Last Folder**                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `~/.envrouter/wsl-distro`                                                                                                                                | In WSL only: the distro's name, noted the first time a terminal uses the secret store. The Credential Manager item is keyed by it, and a process the distro starts without `WSL_DISTRO_NAME` (a systemd user unit, cron, an agent that passes a bare environment) reads it here                                                                                                                                                                                                                                                      |
| `~/.envrouter/checked-once`                                                                                                                              | Made the first time a folder check finds an agent routed, so first-run's last step is not shown again. Also made when you update from a release up to 0.7.2 that was already set up (a profile, a shell turned on)                                                                                                                                                                                                                                                                                                                   |
| `~/Library/Application Support/ca.pixel-perfect.envrouter/.window-state.json` (macOS), `~/.config/ca.pixel-perfect.envrouter/.window-state.json` (Linux) | The window's size and position, written when the app quits. The view it was left on is kept in the window's own web storage. Releases up to 0.7.2 kept these under another bundle identifier; the first launch copies the window's size and position over and deletes that identifier's folders (the window's storage and caches, which can't move: the system keys them by identifier). The view you left on is reset once. If an older copy of the app is still running, the folders are cleared at a later launch, after it quits |
| "EnvRouter MCP secrets" in the system's store                                                                                                            | Secret values you've entered, once there are any: in the login Keychain on macOS, the keyring on Linux, the Windows Credential Manager from WSL                                                                                                                                                                                                                                                                                                                                                                                      |
| Shell startup files                                                                                                                                      | A block between `# >>> envrouter >>>` and `# <<< envrouter <<<` in `~/.zshrc` (or `$ZDOTDIR/.zshrc`); for bash, `~/.bashrc` on a Linux desktop, or the login file (and `~/.bashrc`) on macOS and in WSL; or fish's `config.fish`                                                                                                                                                                                                                                                                                                     |
| An editor's settings                                                                                                                                     | `claudeCode.claudeProcessWrapper`, once you turn the editor on in **Editors…**                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Your agents' own config folders are yours; EnvRouter only creates missing ones.

### 🔒 Privacy and security

EnvRouter has no account, no telemetry and no background process. It makes network requests
only when you check an MCP server (a remote one, or an `npx` one npm has to download) or look up
a package's version, which runs your own npm. Secret values never appear in `config.json` or in
a rendered file, and the window never reads them back once they're saved. Where they go depends
on the server:

- **A server the agent runs as a command** gets its secrets from EnvRouter's helper, which reads
  them from the system's store as the server starts and puts them in that server's own
  environment. They are not in the agent's environment, so not in anything else the agent runs.
  The helper also removes any `ENVROUTER_SECRET_*` variable it inherited before it starts the
  server, so a server never gets the secrets of the agent's remote servers.
- **A remote server's header secrets are still in the agent's environment**, as
  `ENVROUTER_SECRET_<ID>`, for as long as the agent runs: the agent expands them into the headers
  it sends, so it has to have them. Claude Code passes its environment on to the commands it runs
  for you, its hooks, and its command servers that need no secret, so those can read them.
- **A secret in an argument** is on that server's command line while it runs, where other
  programs you run can read it; one in an environment variable or a header isn't.
- **Under Codex, every unlocked value is on Codex's command line.** Codex takes a server as an
  argument, so a plain environment variable, header or argument of a server is in `codex`'s argument list for as long as it runs, visible to other programs you run.
  Credential-looking values start out locked, and the editor warns about plain ones. A remote
  server's locked headers are in Codex's environment, as for Claude Code.
- **Any program that runs as you can run the helper** and ask it for the secrets, the same as it
  could before: the system's store is what stops it (on macOS, the Keychain asks the first time
  and each time the helper changes; choose **Always Allow**). The protection is against
  accidental exposure, such as the agent's environment, its logs and the commands it runs, not
  against another program you run.
- **An allowlist that matches a server's exact command** sees `envrouter-keychain exec <file>`
  instead of that command, for a server that needs a secret. An administrator who keeps such a
  list has to allow the helper (the server's real command is then not checked), or the server's
  value has to stay plain, unlocked, in `config.json`. A server with no secret keeps its own
  command.

## 🩺 Troubleshooting

| Problem                                                                                                                   | Try                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent ignores the profile                                                                                             | Check the folder in the app (⌘O, Ctrl+O) or with `envrouter check`. It names what's in the way: the shell block is off, an alias or function, another copy earlier on `PATH`, or a prompt hook (mise, direnv) moving one ahead. Remember to open a new terminal window after turning a shell on.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| You want to see what the shim would do                                                                                    | `ENVROUTER_EXPLAIN=1 claude` (or `copilot`, `codex`) prints the profile, variable, MCP servers and real binary as JSON, without running the tool.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| You want one run without EnvRouter's MCP servers                                                                          | `ENVROUTER_MCP=0 claude`, or pass `--strict-mcp-config` to `claude`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Claude Code exits at startup with `You cannot dynamically configure MCP servers when an enterprise MCP config is present` | Your organization manages MCP servers on this machine (`managed-mcp.json` in `/Library/Application Support/ClaudeCode/` or `/etc/claude-code/`). EnvRouter leaves its servers off wherever that file exists and says so when `claude` starts; the folder still gets its profile's config.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| An MCP server doesn't show in `claude mcp list` or `copilot mcp list`                                                     | Expected: those commands don't list servers passed on the command line. Use `/mcp` inside the agent. `codex mcp list` does show them, unmarked, along with the ones in Codex's own config.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Every `codex` command in a folder fails with `url is not supported for stdio` (or the reverse)                            | A profile's server and one in Codex's `config.toml` (or a trusted project's `.codex/config.toml`) share a name but not a transport, and Codex merges the two. EnvRouter warns when you save, and Check Folder shows it as "codex won't start here" with the file to open; `envrouter check` prints it and exits 1. Rename one, or run `ENVROUTER_MCP=0 codex` to skip EnvRouter's servers for that run.                                                                                                                                                                                                                                                                                                                                                  |
| Codex has no shared background server in a folder                                                                         | Expected where the profile has MCP servers: Codex runs without it when given any configuration override. Folders with no servers, and `codex queue`, `archive`, `unarchive`, `delete` and `remote-control` everywhere, are unaffected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Saving a secret fails on Linux with "there's no Secret Service"                                                           | Install and start GNOME Keyring or KWallet, then save again. Until then a remote server that needs a secret is left out, and a command server that needs one doesn't start (the agent shows it as failed); the rest still load.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A server fails with `envrouter: … is gone, so EnvRouter no longer starts the MCP server …`                                | The profile no longer has that server, and the agent session began before you removed it. Restart the agent. EnvRouter keeps a removed server's file for ten minutes, so a session can still reconnect to it for a while.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A server fails with `envrouter: couldn't read the secrets the MCP server … needs`                                         | The store refused, or didn't answer within 20 seconds. On macOS a Keychain prompt for `envrouter-keychain` may be waiting behind another window; choose **Always Allow**, then restart the agent or reconnect the server. The store's own reason is in the parentheses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A server fails with `usage: envrouter-keychain read [ID...]`                                                              | The helper in `~/.envrouter/bin` is older than the files that name it, which happens when an older app starts after a newer CLI and puts its own helper back. Update the app and the CLI together, then save once in the app or run `envrouter apply`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A command server that needs a secret is blocked by your organization's MCP allowlist                                      | The agent runs `~/.envrouter/bin/envrouter-keychain exec <file>`, not the server's command (see [Privacy and security](#-privacy-and-security)). Ask for the helper to be allowed, or unlock the value so the server keeps its own command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Saving a secret fails in WSL with "couldn't reach the Windows Credential Manager"                                         | Run `envrouter install` so `~/.envrouter/bin/envrouter-keychain.exe` is there, and check that WSL interop is on (`[interop] enabled` isn't `false` in `/etc/wsl.conf`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The window says it can't read `config.json`                                                                               | It isn't valid JSON, usually a hand edit that stopped halfway. **Open config.json** (or **Reveal**) lets you fix it, and the window reads it again. **Back Up and Start Over…** copies the file to `~/.envrouter/config.json.bak` (`config.json.bak-2`, … if one is already there; earlier backups are never replaced) and starts with no profiles or servers. It offers nothing for a file from a newer EnvRouter or one it can't read at all. Your MCP secrets, shims and agents' config folders stay as they were, and the secrets the backup names stay in the store for as long as the backup is there, so putting it back (`mv config.json.bak config.json`) brings its servers' secrets with it. Agents keep running without a profile meanwhile. |
| macOS says EnvRouter can't be opened                                                                                      | The app is signed ad hoc, not notarized. Homebrew's cask clears the quarantine flag that triggers this; for a copy you downloaded or built elsewhere, run `xattr -dr com.apple.quarantine /Applications/EnvRouter.app`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 🔄 Updating

With Homebrew, `brew upgrade --cask envrouter` for the macOS app (it quits EnvRouter first; open
it again afterwards), and `brew upgrade envrouter-cli` for the CLI, followed by `envrouter
install` where the CLI is what installed the shim. On Linux, install the new `.deb` or AppImage
over the old one. From source, pull the latest code,
quit EnvRouter, and run the build and install commands again. When a new version of the app
starts, it updates the shim and helpers in `~/.envrouter/bin` itself, and renders the MCP files
again so they match. `envrouter install` does the same when it installs something new.

Update the app and the CLI together. The helper in `~/.envrouter/bin` is whichever one was
installed last, and the MCP files of servers that need a secret depend on it: if an older app
starts after a newer CLI, it puts its older helper back without rendering anything, and those
servers fail with a usage line until you save once in the app or run `envrouter apply`. Files
rendered before this change keep working with the new shim and helper, with the secrets read as
before, until the next time they're rendered.

## 🗑️ Uninstall

One action leaves the machine as if EnvRouter had never been installed, except for the app and the
CLI, which can't remove themselves. Do it before you remove them: **Uninstall EnvRouter…** (at the
bottom of the toolbar's **Shells** panel, and in the menu bar icon's menu on macOS), which asks first, or

```sh
envrouter uninstall            # shows what it will do, then asks
envrouter uninstall --dry-run  # shows it and changes nothing
envrouter uninstall --yes      # doesn't ask; required without a terminal
```

It does five things, in this order:

1. Turns routing off in every shell: it removes the marked block from every startup file that has
   one, whether or not that shell is on now.
2. Clears `claudeCode.claudeProcessWrapper` in every VS Code-family editor's settings and in the
   remote servers' machine settings, when it names EnvRouter's shim. A wrapper someone else set is
   left alone.
3. Deletes any MCP secrets EnvRouter kept in the system's store (the "EnvRouter MCP secrets" item).
4. Deletes `~/.envrouter`, with your profiles and MCP servers. If it is a link, only the link goes
   and the folder it points at is named and left.
5. Deletes the folders the window's webview keeps for itself (page data and caches). On macOS:
   `~/Library/WebKit/ca.pixel-perfect.envrouter`, `~/Library/Caches/ca.pixel-perfect.envrouter` and
   `~/Library/Application Support/ca.pixel-perfect.envrouter` (where the window's size and position
   are kept) and `~/Library/Preferences/ca.pixel-perfect.envrouter.plist` (asking the system to forget those
   preferences first, with `defaults delete`, so it can't write them back), plus `HTTPStorages` and
   `Saved Application State` entries of that name, if the system made any. On Linux:
   `~/.local/share/ca.pixel-perfect.envrouter` (Tauri's local data folder, which holds the webview's
   storage and cache both) and `~/.config/ca.pixel-perfect.envrouter` (the window's size and position).
   It clears the same folders under the bundle identifier of releases up to 0.7.2 too, should any
   remain (the app deletes them itself at its first launch after updating). The command does this itself, since it only runs while the window is
   closed. The window's own uninstall can't while its webview is using them, so it deletes them as it
   quits, once everything else has finished. This step never fails the uninstall: a folder it can't
   delete is named ("Uninstalled, but this is left behind"), and so is one outside your home folder,
   which it won't touch (`XDG_DATA_HOME` or `XDG_CONFIG_HOME` pointing elsewhere on Linux).

If anything in steps 1 and 2 can't be done (a settings file you can't write, or one it can't read
that names the shim), it does the rest of those two steps and stops before step 3, so no editor is
ever left pointing at a shim that's gone. `envrouter uninstall` won't start while the EnvRouter window
is open (the window would put `~/.envrouter` back the next time you switch to it): it says to quit
EnvRouter first and changes nothing. The window's own uninstall waits a few seconds for anything it
is still doing, such as checking an MCP server, and says so if that doesn't finish. While it runs the window says "Uninstalling EnvRouter…";
if it stops, "Uninstall stopped" shows the reason with Try Again; the command prints it and exits 1. Fix it, then run it again: every step skips what is
already done. If the store can't be reached at all (no Secret Service, WSL without interop), it
goes on and says any secrets are still there; if it can be reached but refuses the delete, it
stops before step 4.

When it finishes, the window shows what to run next and quits (if it can't, it says EnvRouter is
uninstalled and asks you to quit it yourself), and the command prints it. Opening
the app again sets EnvRouter up again, so remove the app next:

| Installed with                 | Remove it with                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The macOS cask                 | `brew uninstall --zap --cask envrouter` (the `--zap` also clears the window's data, caches and preferences, should any come back), or quit the app and delete `/Applications/EnvRouter.app` |
| The Linux `.deb`               | `sudo apt remove env-router`                                                                                                                                                                |
| The AppImage                   | Delete the file                                                                                                                                                                             |
| The CLI from Homebrew          | `brew uninstall envrouter-cli`                                                                                                                                                              |
| The CLI from a release archive | Delete `envrouter` and the helpers beside it                                                                                                                                                |

Your agents' config folders are left alone.

**By hand**, if neither is available:

1. Turn every shell off, from the toolbar's shell status or with `envrouter shell off <shell>`.
   This removes the marked block from each startup file. You can also delete the lines between
   `# >>> envrouter >>>` and `# <<< envrouter <<<` by hand.
2. If you turned on an editor, turn it off (**Editors…**, or `envrouter editor off <editor>`).
   This removes `claudeCode.claudeProcessWrapper` from that editor's settings.
3. If you stored MCP secrets, delete them from the store:
   - macOS: the "EnvRouter MCP secrets" item in Keychain Access, or
     `security delete-generic-password -s "EnvRouter MCP secrets"`
   - Linux: `secret-tool clear service "EnvRouter MCP secrets"`
   - WSL: in Windows, the "EnvRouter MCP secrets:wsl:…" entries under Windows Credentials in
     Credential Manager (`cmdkey /list` shows them; `cmdkey /delete:<name>` removes one)
4. Delete `~/.envrouter`, and the window's data folders from step 5 above.
5. Remove the app and the CLI as in the table above (on macOS, `brew uninstall --zap --cask
   envrouter` also does step 4).

## 🤝 Contributing

Contributions are welcome. EnvRouter is built with Tauri 2, Rust and React; see the
[contributing guide](docs/contributing.md) for setup, the development commands, how to review the
UI safely in a browser, and the project layout.

## 💸 Support this project

<a href="https://www.buymeacoffee.com/tylernrobertson" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" height="50" width="217" /></a>

## 📝 License

Copyright © 2026 [Tyler Robertson](https://github.com/TylerNRobertson) and [Pixel Perfect Software Inc.](https://github.com/pixel-perfect-software)

EnvRouter is free software under the [GNU General Public License v3.0 or later](LICENSE). You can
use, study, change and share it. If you distribute it, changed or not, you must share its
source under the same licence, so nobody can ship a closed-source copy. Releases up to v0.4.0
were published under the MIT licence.
