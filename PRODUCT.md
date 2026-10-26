# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Developers on macOS or Linux (WSL 2 included) who keep separate coding-agent accounts or configs side by side (work and
personal, or one per client) and switch between them many times a day. Today they get it wrong
by hand: the wrong account in the wrong repo, or an alias they forget to run. They want the
right one picked automatically from the folder they're in, and then to forget the tool exists.

## Product Purpose
EnvRouter sets a per-agent environment variable based on the folder a command runs in: Claude
Code (`CLAUDE_CONFIG_DIR`), Copilot CLI (`COPILOT_HOME`) and Codex CLI (`CODEX_HOME`). Users define **profiles**, each mapping **trigger folders** to a config
folder per agent. Success means typing `claude` or `copilot` anywhere uses the right account, with no
aliases, wrappers or reloading. The same profiles also choose which **MCP servers** an agent loads in their folders, from a
server library the user keeps in the app, so the right tools come with the right account. The
user opens the app to set up or change profiles and servers, and to find out why a folder isn't
routing as expected.

## Positioning
EnvRouter works through a shim on PATH rather than shell hooks or per-project dotfiles. It
covers every shell and scripts, never writes into the user's repositories, applies edits
without reloading any terminal, and can show exactly what a new terminal window would do in
any folder. It's specific to developer CLIs and their account or config separation, not a
general env-var manager like direnv or mise. Nor is it a control panel for agent accounts: usage
and quota display, failover at a rate limit, provider routing and adopting an existing login are
out of scope. Its features are about the user's local configs (profiles, config folders, MCP
servers), such as exporting and importing profiles.

## Operating Context
- **A desktop app for macOS and Linux** (Tauri v2: a native window around a web view; React frontend), plus the `envrouter` CLI for machines without a desktop (servers, WSL distros). The app is opened occasionally, not kept running. The real usage happens in the terminal.
- **Typical session:** first-run setup (create a profile, enable shell integration for the login shell, check a folder), then rare edits when a new client or repo appears, or a diagnosis when a folder doesn't route.
- **Terms the UI uses:** profile, trigger folder, tool, shell integration (the block added to `.zshrc` and similar files), shim, check a folder, MCP server, server library.
- **Diagnosis results:** routed (profile, variable, value, real binary); blocked by a shell alias or function; blocked by another copy earlier on PATH; integration off in that shell; not found; tool not installed; shim failed.

## Capabilities and Constraints
- Profiles: a name, trigger folders (the native folder picker; a trigger covers its whole subtree), and per-tool settings. The agents offered come from a registry (`src/lib/agents.json`, read by the window and the CLI alike). An agent qualifies only if one variable separates its whole account, logins included. opencode (logins kept outside its config dir) and Aider (API keys) don't qualify; OpenCode comes in as a full agent once a variable moves its logins (`OPENCODE_HOME` is requested upstream), not as an MCP-only one. Codex CLI does (`CODEX_HOME`), though its MCP sign-ins are shared across homes; Qwen Code would; Gemini CLI would, and may come back as an add-on. An agent's editor extension that runs its own copy of the agent (Claude Code for VS Code, Cursor, Windsurf) is routed through its process-wrapper setting, including over VS Code Remote into WSL; GUI apps without such a setting can't be routed.
- The most specific trigger's profile wins outright. A profile that doesn't configure a tool leaves it unrouted in its folders.
- A folder can belong to only one profile. Save errors come back as user-readable strings to show inline.
- Shell integration for zsh, bash and fish, by adding or removing a marked block in the shell's startup files. The app shows which files it edits.
- Folder check (real shell, slow, up to ~15s) and instant preview (from the config alone).
- No OAuth or logins. A new agent config folder starts logged out, and remote MCP servers sign in through the agent (`/mcp`); the user does both from the terminal. There are no pre-registered OAuth clients: both agents register themselves with a server that allows it (Client ID Metadata Documents or dynamic registration), and neither takes a client secret from EnvRouter. The only credentials EnvRouter holds are MCP secret values the user enters, in the platform's secret store: the macOS Keychain, the Linux keyring (Secret Service), or, inside WSL, the Windows Credential Manager.
- MCP secret values go only where they're used: a server the agent starts as a command runs through EnvRouter's secrets helper, which reads its values at each start and hands them to that server alone; a remote server's values are in the agent's environment, since the agent sends the headers. Accepted cost: an allowlist matching a server's exact command sees the helper, for servers that need a secret.
- Codex takes its servers as `--config` arguments, one inline table each, so a value the user hasn't kept in the store is on Codex's command line. Accepted cost, with the editor flagging plain credential-looking values; and in a folder with servers Codex runs without its shared background server, which is also accepted.
- MCP servers reach the agent through the shim at launch, with no background process: the app only needs to run when servers or profiles change.
- macOS 11 or later on Apple Silicon, and Linux (x86_64, aarch64), WSL 2 included; native Windows is planned. No paid Apple Developer ID, so the macOS app is signed ad hoc and not notarized: users install it through a Homebrew cask (pixel-perfect-software/homebrew-tap), which clears the quarantine flag. Linux users install a `.deb` or AppImage from the release; the CLI comes from the same tap as a formula. Building from source works everywhere.

## Brand Commitments
Name: EnvRouter. The app icon is "Points": a Finder-blue folder on a dark navy tile whose track
forks to two accounts and lights the one it uses; the menu bar glyph is that folder with the
fork cut through it. It says the product's one idea: the folder decides. No established voice
yet. The user's direction: a quiet, precise, native-feeling utility (a Mac utility on macOS; on Linux the same world under the system's own title bar and conventions); the icon should be
clear and creative, never loud or abstract.

## Evidence on Hand
No users, testimonials, metrics or press yet. Don't invent any. Free and open source, with
releases on GitHub. There's no pricing, account, license or telemetry to show.

## Product Principles
1. **Invisible when it works.** The app exists for setup and diagnosis. Daily use happens in the terminal, so never demand attention there.
2. **Show the truth, not the intent.** Report what a real new terminal would do (the folder check), not what the config says should happen. Explain every failure in terms of what to change.
3. **Never surprise the user's machine.** Edit only marked, removable blocks in files the app names. Never break the tool when the config is missing or broken.
4. **One rule, stated plainly.** The most specific folder's profile wins outright. Every screen should make that rule obvious.
