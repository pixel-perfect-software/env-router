# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Developers on a Mac who keep separate coding-agent accounts or configs side by side (work and
personal, or one per client) and switch between them many times a day. Today they get it wrong
by hand: the wrong account in the wrong repo, or an alias they forget to run. They want the
right one picked automatically from the folder they're in, and then to forget the tool exists.

## Product Purpose
EnvRouter sets a per-agent environment variable based on the folder a command runs in: Claude
Code (`CLAUDE_CONFIG_DIR`), Codex (`CODEX_HOME`), Copilot CLI (`COPILOT_HOME`) and Gemini CLI
(`GEMINI_CLI_HOME`). Users define **profiles**, each mapping **trigger folders** to a config
folder per agent. Success means typing `claude` or `codex` anywhere uses the right account, with no
aliases, wrappers or reloading. The user opens the app to set up or change profiles, and to
find out why a folder isn't routing as expected.

## Positioning
EnvRouter works through a shim on PATH rather than shell hooks or per-project dotfiles. It
covers every shell and scripts, never writes into the user's repositories, applies edits
without reloading any terminal, and can show exactly what a new terminal window would do in
any folder. It's specific to developer CLIs and their account or config separation, not a
general env-var manager like direnv or mise.

## Operating Context
- **A macOS desktop app** (Tauri v2: a native window around a web view; React frontend). It's opened occasionally, not kept running. The real usage happens in the terminal.
- **Typical session:** first-run setup (create a profile, enable shell integration for the login shell, check a folder), then rare edits when a new client or repo appears, or a diagnosis when a folder doesn't route.
- **Terms the UI uses:** profile, trigger folder, tool, shell integration (the block added to `.zshrc` and similar files), shim, check a folder.
- **Diagnosis results:** routed (profile, variable, value, real binary); blocked by a shell alias or function; blocked by another copy earlier on PATH; integration off in that shell; not found; tool not installed; shim failed.

## Capabilities and Constraints
- Profiles: a name, trigger folders (the native folder picker; a trigger covers its whole subtree), and per-tool settings. The agents offered come from a registry (`src/lib/tools.ts`). An agent qualifies only if one variable separates its whole account, logins included. opencode (logins kept outside its config dir) and Aider (API keys) don't qualify. GUI apps such as Cursor can't be routed this way.
- The most specific trigger's profile wins outright. A profile that doesn't configure a tool leaves it unrouted in its folders.
- A folder can belong to only one profile. Save errors come back as user-readable strings to show inline.
- Shell integration for zsh, bash and fish, by adding or removing a marked block in the shell's startup files. The app shows which files it edits.
- Folder check (real shell, slow, up to ~15s) and instant preview (from the config alone).
- No OAuth, logins or credential handling. A new agent config folder starts logged out; the user signs in from the terminal themselves.
- macOS only (11 or later). Distributed as source that each user builds: no paid Apple Developer ID, so no notarized downloads.

## Brand Commitments
Name: EnvRouter. The app icon is "Points": a Finder-blue folder on a dark navy tile whose track
forks to two accounts and lights the one it uses; the menu bar glyph is that folder with the
fork cut through it. It says the product's one idea: the folder decides. No established voice
yet. The user's direction: a quiet, precise, native-feeling Mac utility; the icon should be
clear and creative, never loud or abstract.

## Evidence on Hand
No users, testimonials, metrics or press yet. Don't invent any. Free and open source, with
releases on GitHub. There's no pricing, account, license or telemetry to show.

## Product Principles
1. **Invisible when it works.** The app exists for setup and diagnosis. Daily use happens in the terminal, so never demand attention there.
2. **Show the truth, not the intent.** Report what a real new terminal would do (the folder check), not what the config says should happen. Explain every failure in terms of what to change.
3. **Never surprise the user's machine.** Edit only marked, removable blocks in files the app names. Never break the tool when the config is missing or broken.
4. **One rule, stated plainly.** The most specific folder's profile wins outright. Every screen should make that rule obvious.
