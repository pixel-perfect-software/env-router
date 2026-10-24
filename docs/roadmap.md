# Roadmap

This is the full plan behind the GitHub milestones. Each milestone below has the same block as
its GitHub description (Goal, Size, Scope, Done when), followed by the issues under it. It comes
from an audit of v0.6.0 on 2026-10-23: the Rust crates, the window and its bundle, the build and
release pipeline, and the agents and platforms EnvRouter depends on. Every finding names the
file and line it was read from; the ones marked **verified** were reproduced with a build or
read in the vendor's own documentation.

The eight milestones are on GitHub as
[milestones](https://github.com/pixel-perfect-software/env-router/milestones). M0 to M3 have
their issues there (17 to 54 for M0 to M2, and 111 to 125 for M3, in the order listed here, then
later findings at the end of their milestone, such as #107); M4 to M7 keep theirs in this file
until each is next. A new finding goes into its milestone here first, then into an issue. PRs
are assigned to the milestone they advance.

**Status (2026-10-24):** M0, M1 and M2 are done. M0's 12 issues were merged in PRs #55 to #66 and
M1's 13 in PRs #72 to #90; both shipped in 0.7.1 except M1's last four PRs (#87 to #90), which
change only CI, the Homebrew templates and docs. M2's 15 issues were fixed in PRs #92 to #108,
except #49, closed as accepted, and shipped in 0.7.2. M3 is next: its 16 issues were checked
against `main` at 0.7.2 and filed on 2026-10-24.

Order: M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7. The first three are small and make the next
release trustworthy. M4 (agents) is what brings users and can start as soon as M0 lands, since
it's mostly data and one new dialect. M7 can start after M3, which carries the Windows prep.

| Milestone | Goal | Size |
|---|---|---|
| M0: Correctness floor (done) | Fix every verified bug that loses data, crosses profiles or blocks the tool | small |
| M1: Release integrity (done) | A release can only ship what CI tested, and every shipped target is checked for advisories | small |
| M2: Lean and fast (done) | Ship only what each platform needs, and keep the shim's overhead flat as configs grow | small |
| M3: Every state has a way out | No dead ends in the window, no silent losses, and the files the app touches are one click away | medium |
| M4: More agents, moving ecosystem | Add agents as data, starting with Codex, and keep the MCP side current with the spec and the registry | medium |
| M5: Headless parity | Everything the window does, the CLI and rpc do too, with tests | medium |
| M6: Update and reach | Users get new versions without a manual reinstall, on every Mac and Linux channel we ship | medium |
| M7: Native Windows | The app, CLI and shim run on Windows without WSL | large |

---

## M0: Correctness floor

**Status:** done 2026-10-23. Every issue below was fixed with a regression test and merged (PRs
#55 to #66). Verified with stand-ins rather than on a real machine: `claude daemon status`
signed in, a real managed-MCP workstation, and ⌘Q in the built app.

**Goal:** fix every verified bug that loses data, crosses profiles or blocks the tool. **Size:** small.

**Scope:** a window save after `config.json` vanished refuses instead of wiping the library;
duplicate profile ids are rejected; the shim skips injection under Claude's `managed-mcp.json`
and ahead of `claude daemon`; the secrets pipe can't stall; atomic writes use unique temp names
and keep symlinks; secrets are pruned after the config is written; CLI saves carry a base; an
alias that still reaches the shim isn't reported as blocked; unsaved edits are never dropped
silently; the README describes the config format it ships.

**Done when:** each fix has a regression test; `cargo test --workspace` and `pnpm test` are
green; `claude daemon status` and a managed-MCP workstation run through the shim; a save after
the file disappeared is refused; closing the window with unsaved edits asks first.

### Issues

1. **A window save after config.json disappears wipes every untouched profile and server.**
   `crates/ops/src/commands.rs:69-79` maps a missing file with a base to
   `Changed { config: default }`; `src/lib/merge.ts` treats an absent unit as deleted, so every
   profile the edit didn't touch is dropped, and a save that adds a profile has no conflict and
   goes through silently (`src/App.tsx:369-386`). Fix: a missing file when `base` is given is an
   error, as the unreadable case already is, or a distinct outcome the window shows.
2. **Duplicate profile ids pass validation and one profile's MCP servers land in the other's folders** (verified).
   `crates/core/src/config.rs:495-496` skips the shared-folder check when `other.id == profile.id`,
   and `mcp::render` writes both profiles into `mcp/<id>/`, the second winning. Reproduced with
   `envrouter apply`: `explain` names Work's server while `launch.json` injects Personal's, with
   its secrets. README's hand-written example uses `"id": "work"`, which invites the copy-paste.
   Fix: reject duplicate or empty ids (with `is_file_name`) before the trigger loop.
3. **Claude exits at startup under `managed-mcp.json` when the shim injects `--mcp-config`** (verified in Claude's docs).
   "On a workstation, Claude Code exits at startup with `You cannot dynamically configure MCP
   servers when an enterprise MCP config is present`"; `--strict-mcp-config` exits too. Paths:
   `/Library/Application Support/ClaudeCode/managed-mcp.json` (macOS),
   `/etc/claude-code/managed-mcp.json` (Linux and WSL). Fix: an agent-data field
   (`mcp.skipIfPresent`) listing those paths; the shim skips injection with one warning and
   explain mode reports it; `check_folder` says so.
4. **A leading `--mcp-config=` stops `claude daemon …` from running** (verified in Claude's docs).
   "With any other flag ahead of `daemon`, the subcommand doesn't run." `skipSubcommands` holds
   only `plugin`. Fix: add `daemon`, then sweep the other subcommands on a current release
   (`agents`, `attach`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`, `logs`,
   `mcp`, `purge`, `remote-control`, `respawn`, `rm`, `self-hosted-runner`, `setup-token`,
   `stop`, `kill`, `ultrareview`, `update`) and record which need skipping; a test pins the list.
5. **The shim stalls 20 s when the secrets helper's answer exceeds the pipe buffer** (verified).
   `crates/shim/src/main.rs:229-242` polls `try_wait` before reading stdout; a 65,600-byte answer
   blocks for the full timeout and the server is dropped with "didn't answer within 20 seconds".
   Also: explain mode aborts on a non-UTF-8 real path (`main.rs:109-116`, `json!` unwrap under
   `panic = "abort"`). Fix: read stdout on a thread with a timeout, drop the 5 ms poll loop, and
   use `to_string_lossy`.
6. **Atomic writes share one fixed temp name, so two writers can truncate the shim binary.**
   `crates/core/src/config.rs:330-331` uses `<path>.envrouter-tmp`; the CLI's `install` racing
   the app's `install_bundled` shares an inode, the second `O_TRUNC` truncates the first, and a
   truncated shim breaks every agent launch. Fix: `NamedTempFile::new_in(parent)` + `persist`.
7. **Saving replaces a symlinked `config.json`, and a dangling symlinked `settings.json`, with regular files** (verified for editors).
   `config.rs:275-279` renames over the link; `crates/ops/src/editors.rs:166` has
   `canonicalize(&file).unwrap_or(file)` and `envrouter editor on code` replaced a dotfiles link.
   `shell.rs:295-308` already refuses the same case. Fix: write through links as `shell.rs` does;
   refuse dangling ones.
8. **Secrets are pruned before the config is written.** `commands.rs:97-107` calls
   `envrouter_keychain::update` before `config::save`, so a failure in save, `mcp::sync` or
   `shims::sync` leaves the old config referencing pruned secrets, and the window's base goes
   stale after a save that actually committed. Fix: store new secrets, write the config, sync,
   then prune; check shim-link conflicts before writing.
9. **CLI `apply` and `secret set` save without a base and overwrite a window save.**
   `crates/cli/src/main.rs:251-252` and `364-375` read outside the lock. Fix: pass the read
   config as `base`, retry on `Changed`, and say what happened.
10. **An alias that still reaches the shim is reported as blocked** (verified).
    `alias claude='claude --model opus'` routes (`ENVROUTER_EXPLAIN=1` answers), yet
    `envrouter check` printed "Blocked: a alias named claude" and exited 1
    (`crates/ops/src/shell.rs:531-537`). Fix: run the tool through the shell with
    `ENVROUTER_EXPLAIN=1` and report routed-via-alias when the shim answers.
11. **Unsaved edits are dropped silently.** Linux close, ⌘Q and the tray's Quit
    (`src-tauri/src/lib.rs:244-249`, `tray.rs:36`) skip the frontend; a server editor keyed on
    the saved definition remounts when a refocus reloads a changed `config.json`, dropping a dirty
    draft (`src/components/Servers.tsx:197`, `App.tsx:212-216`). Fix: intercept
    `CloseRequested`/`ExitRequested` and let the window confirm; don't remount a dirty editor,
    surface a conflict instead.
12. **The README describes a config that isn't the one shipped.** The hand-written example says
    `"version": 3` (now 4) and uses an id that collides with the one `envrouter apply` would
    accept twice (issue 2). "Never on a command line" doesn't hold: `validate` allows secrets in
    args and the probe puts them in argv (`config.rs:92`, `mcp_probe.rs:144`). Fix: correct the
    example, say what the args rule really is, and point the Copilot note at env or headers.

---

## M1: Release integrity

**Status:** done 2026-10-23. All 13 issues were fixed and merged (PRs #72 to #90), and 0.7.1 was
the first release through the new checks: its `check` job waited for CI on the tagged commit,
the Linux builds ran in the pinned CI image, and every asset has a provenance attestation that
`gh attestation verify --signer-workflow …/release.yml` accepts. Beyond the plan: the Linux CI and
release jobs run in a prebuilt image (`.github/ci/Containerfile`) instead of installing packages
from Ubuntu's mirror, which caused every stalled job; main's CI runs are grouped by commit
(#87); and the release's CLI build is split into macOS and Linux jobs. Not verified on a real
machine: an Intel Mac hitting the formula's arm64-only error, and the AppImage built without
`libxdo-dev` running on a desktop.

**Goal:** a release can only ship what CI tested, and every target we ship is checked for
advisories. **Size:** small.

**Scope:** `deny.toml` checks all four shipped triples with a weekly scheduled advisory scan;
Dependabot security updates, secret scanning and push protection on; the Linux app crate and the
Windows helper link in CI; the release `check` job requires green CI on the SHA and cancels
in-progress runs only for pull requests; one workspace version; build provenance attestations;
Homebrew templates linted in CI; the 22.04 runners replaced before their 2027 retirement; a CLI
upgrade never leaves an older shim reading a newer config.

**Done when:** `cargo deny check` passes for every shipped target in CI and weekly; the release
refuses a SHA without a green `linux` and `macos` check; a Linux-only compile error fails a
pull request; each release asset has a provenance attestation; `envrouter apply` from a newer
CLI over an older shim leaves agents routed.

### Issues

1. **Advisories are checked only for macOS, and the Linux graph fails today** (verified).
   `deny.toml:1-5` lists `aarch64-apple-darwin` alone (its comment predates Linux). Against
   `x86_64-unknown-linux-gnu` the check fails: RUSTSEC-2026-0385 in `ctutils 0.4.3` via
   `secret-service`, the helper the shim runs, plus unmaintained `proc-macro-error` (gtk-rs) and
   `zvariant`/`zbus_names`/`zvariant_derive` (zbus 5). 142 crates go unchecked across the
   non-mac targets. Fix: the four triples from `packaging/notices/about.toml`; time-boxed
   `[advisories] ignore` entries with reasons; bump `ctutils` when 0.4.4 publishes.
2. **No scheduled advisory scan.** A new advisory against a shipped release is seen on the next
   code PR, and docs-only changes skip `deny` entirely. Fix: a weekly `schedule:` job running
   `cargo deny check advisories` and `pnpm audit --prod`.
3. **Dependabot security updates, secret scanning and push protection are off, and Dependabot
   covers only GitHub Actions** (`.github/dependabot.yml:4-11`). Fix: turn the three repo
   settings on; add a `cargo` ecosystem entry that ignores `tauri*` (which must move with the npm
   packages); npm stays with always-up-to-date.
4. **The app crate is never compiled on Linux in CI, and the Windows helper is only type-checked.**
   `ci.yml:113-114` runs clippy and tests on the five non-app crates; `tauri.linux.conf.json`
   and the GTK paths are first built by `release.yml`. `ci.yml:121` only runs clippy for
   `x86_64-pc-windows-gnu`. Fix: `cargo clippy -p envrouter` on ubuntu-22.04 with
   `libwebkit2gtk-4.1-dev`; `cargo build` the helper with mingw.
5. **v0.6.0 was published from a SHA whose main CI run was cancelled** (verified from run
   39824077245 and release run 39824215919). `ci.yml:14-16` has `cancel-in-progress: true` on
   main, and the release `check` job never asks CI. Fix:
   `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`; `check` requires
   successful `linux` and `macos` check runs for `$GITHUB_SHA`.
6. **Every release job has `contents: write`** (`release.yml:15-16`), including build jobs that
   run third-party actions. Fix: top-level `contents: read`, `write` in `publish` only.
7. **The version lives in nine files and the release checks one.** `tauri.conf.json:4`,
   `package.json:4` and seven `Cargo.toml`s; `release.yml:37` compares only `tauri.conf.json`,
   while the formula's `test do` reads `envrouter --version` from `crates/cli`. Fix:
   `[workspace.package] version` with `version.workspace = true`; drop `version` from
   `tauri.conf.json` (the schema falls back to Cargo.toml; verify); `check` reads
   `cargo metadata` and `package.json`.
8. **No provenance, SBOM or signed checksums.** Fix: `actions/attest-build-provenance` in
   `publish` (`id-token: write`, `attestations: write`); optionally `cargo auditable` or a
   CycloneDX SBOM as a release asset.
9. **Homebrew templates and the containers are untested, with nits.** `ci.yml:47-48` skips
   `packaging/homebrew/**`; the formula has a redundant `version`, no `livecheck` and no Intel
   URL; the cask's `zap` misses `~/Library/Preferences/com.tylerrobertson.envrouter.plist`.
   Fix: a CI step that renders with dummy sums and runs `brew style`; fix the nits.
10. **The rust job's apt step takes up to nine minutes, and `libxdo-dev` isn't needed.**
    `ci.yml:106` measured 532 s, 356 s, 193 s across recent runs against a 20-minute timeout;
    `cargo tree` has no `libxdo-sys`. Fix: cache apt or add `-o Acquire::Retries=3` with a step
    timeout; drop `libxdo-dev` from `release.yml:120` and the Containerfile after checking the
    AppImage still builds.
11. **ubuntu-22.04 runners retire on 2027-04-17, with brownouts from 2027-03-23.** The release
    uses them for an older glibc. Fix: build in an `ubuntu:22.04` container on a 24.04 runner
    (or `cargo-zigbuild` with a glibc target) before March 2027. Related: CI's `ubuntu-latest`
    jobs move to Ubuntu 26 from 2026-10-19 (GitHub's notice on every run), so pin the image the
    CI jobs run on too.
12. **Release notes and doc drift.** `--generate-notes` is the only source; add
    `.github/release.yml` categories by label. `.tool-versions` says Node 24.22.1 while
    CLAUDE.md, project-structure.md and the Containerfile say 24.21.0; project-structure.md says
    TypeScript 6 (it's 7). Fix both.
13. **A CLI upgrade that writes a newer config leaves every agent unrouted until
    `envrouter install`** (verified, #67). A CLI save installs its own shim only where none is
    (`commands::save_from_cli`), so after `brew upgrade envrouter-cli` the old shim stays in
    `~/.envrouter/bin`; when the new CLI writes a newer `CONFIG_VERSION` (the next release writes 5), the old
    shim refuses it and every run goes "without a profile". Only the formula's caveat guards it.
    Fix: before writing a version the installed shim can't read, install the bundled one or refuse
    and say to run `envrouter install`. Found while verifying M0's #19.

---

## M2: Lean and fast

**Status:** done 2026-10-24. 14 of the 15 issues below were fixed and merged (PRs #92 to #108);
#49 was closed as accepted, with the measurements in its closing comment. Against the Done when:
the app binary went from 11,239,888 bytes before #43 to 9,840,032 after #41 (−12.5%), and the
window's JS from 462.13 KB to 452.86 KB (#48); CI's `shim-timing` job fails a launch over 1.8
times a bare exec, against 1.58 to 1.67 measured after #50 and #51; the AppImage carries
`envrouter-keychain.exe` and the release checks that both Linux bundles do (#44); a dropped
server's file stays 10 minutes after the save that drops it (#52). Not verified on a real
machine: a WSL user storing a secret from the AppImage, and desktops filing the app under
Development (#45). Found while verifying #41 and #42, and filed on M3: the traffic lights sit
about 4 pt above the titlebar's centre line, in 0.7.1 too (#107).

**Goal:** ship only what each platform needs, and keep the shim's launch overhead flat as
configs grow. **Size:** small.

**Scope:** drop the `image-png` and `macos-private-api` features; `removeUnusedCommands` and
thin LTO; the AppImage carries the WSL helper; bundle metadata and a `.desktop` category; local
builds carry LICENSE and notices; the Windows helper built once and reproducibly; a smaller icon
module; the shim prefilters triggers and PATH entries, keeps the previous MCP generation during
a save, and has a timing gate in CI.

**Done when:** the measured sizes below drop; with 60 triggers and 8 PATH entries ahead of the
tool, a launch through the shim takes at most 1.8 times a bare exec's on CI's Linux runner, and CI
enforces it; a WSL user on the AppImage can store a secret; a save during an agent launch can't
hand it a deleted file.

The shim target was first "under 0.5 ms median overhead". Restated on 2026-10-24 (#96): GitHub's
macOS runners swing 16 times between identical runs, and its Linux machines differ by 40% in
speed (a bare exec took 0.68 to 0.97 ms across three), so no millisecond limit both holds and
catches a regression. The ratio does: 1.58 to 1.67 after #50 and #51, 1.94 to 2.08 before. About
0.39 ms of any Rust shim's overhead is Rust starting up, which no routing change removes.

The bundle is already close to minimal: the shim links only libSystem, TLS is rustls with no
OpenSSL, the dev mock isn't in `dist/`, and the icon packages are tree-shaken. The items below
are the free wins the audit measured, one decision (the AppImage), and the shim's hot path, which
is where "optimized" matters most.

Measured on v0.6.0 (M-series Mac, 2026-10-23):

| Artifact | Size |
|---|---|
| `EnvRouter-0.6.0-arm64.zip` | 5.07 MB (app binary 11.07 MB, shim 555 KB, helper 389 KB) |
| `.deb` amd64 | 6.70 MB (app 13.2 MB, Linux helper 2.17 MB, shim 617 KB, `envrouter-keychain.exe` 338 KB) |
| AppImage amd64 | 84.6 MB (271 MB unpacked; `libwebkit2gtk` alone 90 MB) |
| Frontend `dist/` | 532 KB; JS 460 KB (147 KB gzip) |
| Shim overhead | +0.37 ms median over a bare exec with one profile; +1.4 ms with 61 triggers |

### Issues

1. **Tray icon pulls the `image` stack.** `tauri`'s `image-png` feature exists only for
   `Image::from_bytes` at `src-tauri/src/tray.rs:23`; it brings `image`, `moxcms`, `pxfm` (5
   crates, ~30 s CPU). Measured with `include_image!("icons/tray.png")`: −152 KB. Fix: switch
   and check the tray renders as a template at 18 pt.
2. **`macos-private-api` is a no-op** since Tauri 2.12.1 ("the APIs are always enabled now");
   the lockfile has 2.12.1. Fix: drop the feature and `macOSPrivateApi`, confirm the translucent
   ground still works, and update CLAUDE.md.
3. **Cheap size wins to measure in:** `build.removeUnusedCommands` (Tauri 2.4+);
   `lto = "thin"` for `release` (measured −320 KB at the same build time, one run).
4. **The AppImage has no Windows helper** (verified from the asset). `release.yml:146` adds
   `envrouter-keychain.exe` through `linux.deb.files` only, so WSL users on the AppImage lose the
   Credential Manager. Fix: `appimage.files` too. Decision alongside it: the AppImage is 12× the
   `.deb` because it carries WebKitGTK; keep it, document why, or replace it with an `.rpm`.
5. **Bundle metadata is empty.** The `.desktop` has `Categories=` (filed under Other),
   `Description` is `(none)`, no Homepage, `Maintainer` has no email, `Info.plist` has no
   category or copyright (`tauri.conf.json:33-43`, `src-tauri/Cargo.toml:5`). Linux gets
   `128x128@2x.png` in a 512 px slot. Fix: `category: DeveloperTool`, `longDescription`,
   `homepage`, `copyright`, author email, `deb.recommends: ["gnome-keyring"]`, a `256x256.png`.
6. **Local builds ship no LICENSE or notices.** Only `release.yml:88-89,145` adds
   `bundle.resources`; a `pnpm tauri build` from the README and `linux-bundle.sh` leave them out.
   Fix: move `resources` into `tauri.conf.json` and render the notices in `beforeBuildCommand`.
7. **The Windows helper is built four times per release and isn't reproducible.** The `.exe` in
   the `.deb` and the CLI tarball differ (PE timestamp). Fix: one job, an artifact, and
   `--no-insert-timestamp`.
8. **Frontend trims.** The 64 `simple-icons` carry 11.6 KB of unused metadata (a generated
   `{ path, hex }` module saves ~12 KB); the titlebar's 12.5 KB SVG shows at 22 px (svgo or a
   44 px PNG); `vite.config.ts` has no `build.target`. Also `minimumSystemVersion: "11.0"`
   while Tailwind 4 and `color-mix()` need Safari 16.4's WebKit: document "Big Sur with Safari
   16.4 or later" or raise the floor.
9. **The Linux helper is 2.17 MB against 371 KB on macOS** because `secret-service` brings 99
   crates (zbus 5 is 66). Investigate a lighter Secret Service path; accept if none.
10. **Per-trigger `canonicalize` dominates the shim's launch cost** (measured: 0.145M
    instructions per trigger; 61 triggers add 1.4 ms, 100 servers add almost nothing).
    `crates/core/src/resolve.rs:55-58` canonicalizes every trigger of every profile on every
    launch, and a trigger on an unreachable network mount stalls every agent launch for the mount
    timeout. Fix: prefilter triggers that can't contain the folder; or precompute canonical
    triggers at save time into a rendered routing table the shim reads, keeping `config.json` as
    typed.
11. **Avoidable work on the PATH scan and manifest.** `crates/shim/src/main.rs:327`
    canonicalizes every PATH entry up to the hit (0.13M instructions per dir); `launch.json` is
    opened even when the profile has no servers. Fix: compare entries as text against the shims
    dir first, stat the candidate before canonicalizing, skip the manifest when there's nothing
    to inject.
12. **A save deletes the previous MCP generation while a shim may hold the old manifest.**
    `crates/core/src/mcp.rs:199-203` `remove_except` deletes files the old `launch.json` named;
    the agent then starts with `--mcp-config=<deleted file>`. Fix: generation directories with a
    grace period, or render into a new dir and swap.
13. **A shim timing gate in CI.** `hyperfine -N` the helpers-profile shim against an exec-only
    wrapper with a 60-trigger config; fail over a ratio of the bare exec, on Linux (see Done when).
14. **Small stale-state bugs.** `mcp-tools.json` is read-modify-written without a lock while the
    UI allows parallel checks, and deleted servers are never pruned
    (`crates/ops/src/mcp_probe.rs:354-366`); `login_path` is cached for the app's lifetime
    (`shell.rs:423-468`). Fix: lock the cache, prune on save, invalidate the PATH cache on focus.
15. **The `linux-bundle` dev container fails to build the AppImage** with `Permission denied`
    (#101, found 2026-10-24). Podman's machine runs SELinux and labels each container apart, and
    the AppImage tooling copies `glib-2.0/schemas` with its label, so the next container can't
    remove the AppDir the last one left. Fixed in #106: the dev containers run with
    `label=disable`, and `linux-bundle.sh` starts from an empty bundle folder.

---

## M3: Every state has a way out

**Goal:** no dead ends in the window, no silent losses, and the files the app touches are one
click away. **Size:** medium.

**Scope:** health and accent arbitration move out of `App.tsx` into a tested module; component
tests exist; the one-accent rule holds with the inspector open; focus never falls to the body;
every failure and verdict has an action; Reveal for `config.json`, `~/.envrouter` and the
rendered MCP files from the tray and from focusable folder rows; an Uninstall flow; dropping a
folder onto the open inspector adds it; a server-list filter; keyboard parity; platform strings
and paths come from the backend; long names truncate; copy is consistent; the Editors popover
explains the VS Code wrapper's side effect.

**Done when:** component tests cover the state machine and the one-accent rule; every verdict and
error has at least one action; the app can uninstall itself; Reveal is keyboard-reachable; the
browser mock's scenarios cover each new state; a `review-suite:design-review` pass on the mock
reports no WCAG 2.2 AA failures.

### Issues

1. **Extract the health state machine and split `App.tsx`.** `App.tsx` (700 lines) holds the
   9-state `healthOf` and accent arbitration, unexported and untested. Fix: `lib/health.ts` with
   tests; `useConfigStore` (load, commit, merge loop), `useFolderCheck`, `useShortcuts`;
   `Chrome.tsx` into Titlebar, Health and Popovers; `ServerEditor.tsx` into fields and
   `VersionRow`. Dedupe the five pluralisers, three list joiners and four confirm-discard copies.
2. **Component tests.** There are none (vitest runs in node). Fix: happy-dom + Testing Library;
   cover focus management, the one-accent rule, dirty tracking; unit tests for `paths.ts`,
   `platform.ts`, `tools.ts`, `profileColors`, the missing `verdict.ts` cases.
3. **A dead ⌘2 hint.** The inspector says "Add them in MCP Servers (⌘2)" while ⌘2 is disabled
   with it open. Fix: make the hint a button that closes the inspector and switches view. The
   audit also found the banner's action left accent-filled under the inspector; checked on
   2026-10-24, the inspector covers it and the page behind is `inert`, so no one sees or
   reaches two accents.
4. **Focus falls to the body.** After deleting a profile or server, and after the first save
   from Welcome (`App.tsx:188-198`, `Servers.tsx:223-229`); shell and editor switches disable
   natively during the call (`ui.tsx:105`, `Chrome.tsx:559, 604`). Fix: fallback focus targets;
   `aria-disabled` like `Button`'s `busy`.
5. **Failure states without an action.** "Something went wrong" has no Try Again
   (`Chrome.tsx:270-283`); an unreadable config with `canOpen=false` has none
   (`Chrome.tsx:285-307`); "Couldn't check this folder" has no retry with one shell and agent
   (`Docket.tsx:97-109`); "Owned by X", "No profile sets claude yet" and "claude isn't installed"
   have none (`verdict.ts:60-130`); the lock is offered with no secret store and the save fails
   afterwards (`ServerEditor.tsx:519-527`). Fix: Try Again, Reveal, Back Up and Start Over, Check
   Again, Edit X, New Profile, an install hint; `secretStoreAvailable` in `SetupStatus` disables
   the lock with a reason.
6. **Reveal the files the app writes.** `config.json` is offered only when broken. Fix: Reveal
   `config.json`, `~/.envrouter` and `mcp/<profile>` from the tray and from focusable folder rows
   with a "…" menu (which gives Reveal and Check This Folder a keyboard route, `Frame.tsx:176`).
7. **Uninstall from the app and `envrouter uninstall`.** README's uninstall is five manual steps;
   skipping the editor step then `brew uninstall --zap` leaves VS Code's wrapper pointing at a
   deleted shim (a competitor's issue shows Claude Code then fails to start). Fix: turn off
   shells and editors, remove shims and `bin`, delete the secret item, then the folder.
8. **Dropping a folder onto the open inspector does nothing.** The window lights up during the
   drag, then `App.tsx:337` drops it. Fix: add it as a trigger.
9. **The server list has no filter.** The catalog has search and filters already, but the
   list of added servers doesn't, and Import can add dozens at once. Fix: a filter field; a context menu on server rows (Duplicate,
   Delete, Check) for parity with profile cards.
10. **Keyboard and screen-reader parity.** No arrow keys in lists, no ⌘S, ⌘N always means New
    Profile; errors can't be selected (`Chrome.tsx:200`, `ui.tsx:60`); the tools `aria-live`
    wraps the whole section (`ServerTools.tsx:87`); Used-by dots are colour-only with `slice(0, 4)`
    and sky at 2.73:1 (`Servers.tsx:142-148`). Fix: list navigation, ⌘S, contextual ⌘N,
    `select-text`, a live region on the headline only, initials or "+N", a darker sky token.
11. **Show the machine's truth in more places.** Which agents are installed (the inspector offers
    both regardless); window frame and last view remembered (`tauri-plugin-window-state`); tray
    recent folders or Check Last Folder; a version line in the tray.
12. **Platform strings and paths built in the window.** `main.tsx:10`, `App.tsx:479`,
    `ServerEditor.tsx:489`, `Chrome.tsx:53, 57` check the platform inline; `App.tsx:570, 630`
    and `Chrome.tsx:316` build `~/.envrouter/...` by hand; `Chrome.tsx:426-436` duplicates the
    Rust `Editor` enum; `icons.tsx:79` keys marks by agent name. Fix: `revealLabel`,
    `sealedLabel`, `ownsTitlebar` on `PlatformInfo`; `configPath` and `shimPath` in
    `SetupStatus`; editor labels from the backend; a `mark` slug in `agents.json`. (Windows prep.)
13. **Long names overflow.** A carve-out owner (`Frame.tsx:187-190`) and a 64-character server
    name (`ProfileInspector.tsx:319`) are `shrink-0`; chips, import rows and startup files don't
    truncate or lack a title. Fix: `min-w-0 truncate` and titles.
14. **Copy inconsistencies.** "zsh and bash and fish" (`Chrome.tsx:344, 362`, use `listOf`);
    "a alias" (`cli/src/main.rs:593`); tray "Routing on in zsh, bash" vs window "Routing is on in
    zsh and bash" (`tray.rs:181`); "Reinstall" vs "Reinstall Shim"; "Add Server" vs "Add by
    Hand…"; command names in sans prose vs labels. Fix: one `listOf`, one wording table, commands
    in mono.
15. **Settings and help.** Decision: no Preferences window yet (principle 1); ⌘, opens the
    Shells popover. Add help links (docs, report an issue) with a scoped
    `opener:allow-open-url`. In Editors…, say that `claudeCode.claudeProcessWrapper` forces the
    "default" permission mode on tabs that don't pick one (anthropics/claude-code#99263).
16. **The traffic lights sit about 4 pt above the titlebar's centre line** (#107, found while
    verifying M2's #41 and #42). `trafficLightPosition` y 24 centred them at 26.5 pt on
    2026-10-20 (1e7f731); the same y now centres them at 21.75 pt, in 0.7.1 too, with tao
    unchanged. Cause not yet traced. Fix: find what moves them, then place them by their centre
    rather than by an offset AppKit's layout can change.

---

## M4: More agents, moving ecosystem

**Goal:** add agents as data, starting with Codex, and keep the MCP side current with the spec
and the registry. **Size:** medium.

**Scope:** Codex CLI, then OpenCode (MCP-only), then Qwen Code; the descriptor model grows to
inject through an env var, after a subcommand, and as TOML; rmcp 3.7; SSE marked deprecated and
`ws` recognised; a decision on how secrets reach a server; the catalog refreshes from the
official MCP Registry; the OAuth-clients shelf closes; a decision on the features every
competitor has.

**Done when:** Codex routes and injects on a current release with tests; the editor flags SSE;
the catalog can refresh from the registry behind the curated layer; PRODUCT.md records the
decisions.

Why this comes right after the floor: Codex CLI is the most-used CLI agent by npm downloads
(13.2M a week against Claude Code's 6.4M), six of the eight competing account switchers support
it, and `CODEX_HOME` moves config, auth, logs and sessions in one variable. Gemini CLI stopped
serving individual accounts on 2026-06-18 (replaced by the closed Antigravity CLI, which has no
config-dir variable or injection path), so it drops out of the order; Roo Code is archived.

### Issues

1. **Codex CLI.** `CODEX_HOME` moves config, auth, logs and sessions; inject with
   `-c mcp_servers.<name>.<key>=<TOML>` (`env_vars`, `bearer_token_env_var`,
   `enabled_tools`/`disabled_tools`). Needs a TOML `-c` dialect and a check on a current release
   that `-c` can define a brand-new server. Blocker to document: MCP OAuth keyring entries are
   keyed by server, so OAuth servers are shared across homes.
2. **OpenCode, MCP-only.** No variable moves login, but `OPENCODE_CONFIG_CONTENT` (inline JSON,
   merged above project config, `{env:VAR}` secrets) is the cleanest injection of any agent.
   Needs a descriptor kind that sets an env var instead of adding arguments.
3. **Qwen Code.** `QWEN_HOME` holds credentials and settings; injection is
   `QWEN_CODE_SYSTEM_DEFAULTS_PATH`, which replaces any admin file; verify how `mcpServers`
   merge and how tools are excluded.
4. **Descriptor model extensions.** Inject via env var (OpenCode, Qwen, Gemini-family); arguments
   after a subcommand (Goose `--with-extension`, Warp `oz agent run --mcp`); TOML values (Codex);
   `skipIfPresent` paths (from M0). Keep `crates/core` rendering dialects, not agents.
5. **MCP spec 2026-07-28.** Move the probe to rmcp 3.7 (speaks 2026-07-28, compatible with
   2025-11-25 and earlier, still no legacy SSE client); mark SSE deprecated in the editor and
   catalog (12-month removal window); add Claude's `"type": "ws"` to the dialect and report it
   `unsupported` in the probe; close the OAuth-clients shelf, since CIMD is the default
   registration and both agents register themselves.
6. **Narrow where secrets are visible.** A server's secret travels as `ENVROUTER_SECRET_<ID>` in
   the agent's environment (`crates/shim/src/main.rs:123-127`), so every command and hook the
   agent runs can read every secret of that profile, and one prompt-injected `env` reveals them
   all. Alternatives to weigh: a per-launch rendered file with the value inline, `0600`, removed
   after the agent exits (Claude reads the file, so the secret is never in the environment);
   `headersHelper` for HTTP servers; or keep env and document it. Decide, then implement or
   document under Privacy and security.
7. **Catalog from the official MCP Registry.** Its v0.1 API is frozen (still "preview", no
   uptime guarantee; aggregators scrape hourly). `server.json` maps onto the model: `isSecret` →
   the store, `runtimeHint: npx` → `--prefix`, `version` → an exact pin, `remotes[]` → HTTP with
   `{var}` templates. Fix: a bundled snapshot plus an on-demand refresh in Rust, filtered to
   `active` and `isLatest`, under the curated catalog.
8. **Copilot specifics.** Org allowlists and `deniedMcpServers`-style policy can block injected
   servers; `copilot mcp enable/disable` exists; workspace `.mcp.json` and `.github/mcp.json`
   are trust-gated; `GH_TOKEN`/`GITHUB_TOKEN` silently override the folder's account, so the
   check could warn. Update the import's `mcpFiles` and the docs.
9. **Decide on the features every competitor has.** Across eight switchers: usage and quota
   display (8 of 8), more agents (6), failover at a rate limit (5), provider routing via
   `ANTHROPIC_BASE_URL` (4), adopting an existing login into a new config dir plus
   import/export (5). Proposed: adopt-a-login (copy credentials into a new config folder) and
   export/import of profiles fit the product; usage display is a maybe; failover and provider
   routing are out of scope. Record the decision in PRODUCT.md.

---

## M5: Headless parity

**Goal:** everything the window does, the CLI and rpc do too, with tests. **Size:** medium.

**Scope:** CLI commands for servers (check, tools, import, add from JSON, pin) and profiles
(add, edit, remove, folders, servers); rpc serves secrets and install and handles requests
concurrently; the CLI gets a test suite; the window can install the CLI and shows whether a
secret is really stored; WSL and Windows store edge cases; documented launch paths that bypass
PATH.

**Done when:** the parity table has no empty cell except `open_in_editor`; CLI tests run in CI;
a WSL user can set up profiles and servers without hand-editing JSON.

| Capability | Window | rpc | CLI today |
|---|---|---|---|
| Profiles, servers, assignments, tool filters | yes | raw `save_config` | hand-edit + `apply` |
| Check a server, tool lists, import, paste, pin | yes | yes | none |
| Which secrets are actually stored | no | no | `secret list` |
| Install the CLI into `~/.envrouter/bin` | no | no | `install` |
| Preview from an unsaved config | yes | yes | saved config only |

### Issues

1. **Server commands.** `envrouter server check <name>`, `server tools <name>`,
   `server import [--agent]`, `server add --json <file|->`, `server pin <name>`, with `--json`.
2. **Profile commands.** `profile add|edit|rm`, `profile folder add|rm`, `profile server on|off`,
   `profile tool off|on`, so a server or WSL user never hand-edits JSON.
3. **rpc gaps.** It doesn't serve `secret list` or `install`, and handles one request at a time
   (`cli/src/main.rs:479-489`), so a 45 s check blocks a remote window. Fix: serve both; run
   requests concurrently with ids.
4. **The CLI has no tests.** Untested: `read_secret` newline and empty-value handling, `Echo`
   restoring the terminal, `editor` with 0, 1 or several hooks, `check`'s exit code, `apply`
   filling agents, `install` copying, every `--json` shape, the rpc loop on blank lines, invalid
   UTF-8 and EOF.
5. **The window can't install the CLI the rpc bridge depends on** (`paths.rs:31-35`), and shows
   "In Keychain" from the reference alone (`ServerEditor.tsx:489`). Fix: an Install CLI action;
   `secret list` data in `SetupStatus` or the editor. Also: `envrouter install` copies the CLI
   into `~/.envrouter/bin` unconditionally (`cli:341`), so a Homebrew install goes stale after
   `brew upgrade`; skip the copy when run from a keg.
6. **Store edge cases.** WSL keys the item by `WSL_DISTRO_NAME`, so systemd user units and cron
   look up `wsl::<home>` and drop servers (`wsl.rs:16-19`); Windows multi-part writes aren't
   atomic (`windows.rs:107-120`). Fix: record the distro at first save; a generation header with
   retry on read.
7. **Backend test gaps.** `commands::save` (refusing an unused secret, pruning, tool folders only
   inside home, `save_from_cli`, a failure midway), `open_in_editor` escaping home,
   `check_http` entirely (401, bad header, timeout), `shims::sync` replacing a foreign link,
   `editors` with a `[]` root, `resolve` with `/` or `~` triggers.
8. **Document the launch paths that bypass PATH, and the undocumented behaviours.** Claude's
   background service, agent view, respawns, Remote Control, agent teams and update relaunches
   start from the binary path and carry the original `--mcp-config` (its
   `CLAUDE_CODE_PROCESS_WRAPPER` forbids adding arguments, so it can't carry MCP); the Desktop
   Code tab and Cowork run a bundled binary; VS Code's Copilot sessions use an auto-installed CLI
   with VS Code's auth; Zed launches agents over ACP. `check_folder` can confirm a route with
   `claude auth status`'s `configDirectory` (v2.1.268+). Also document that `status`, `explain`
   and `editor` create `config.json`, and the file modes EnvRouter uses.

---

## M6: Update and reach

**Goal:** users get new versions without a manual reinstall, on every Mac and Linux channel we
ship. **Size:** medium.

**Scope:** the Tauri updater (or an opt-in check as the fallback decision); a universal macOS
build; an apt repository and an evaluation of rpm, AUR and Nix; release-note categories.

**Done when:** an update path exists per platform and the cask declares it; an Intel Mac installs
from the cask; `.deb` users get updates without visiting the release page.

### Issues

1. **Auto-update.** `tauri-plugin-updater` 2.14: a Tauri signing keypair, `createUpdaterArtifacts`,
   `latest.json` as a release asset, `auto_updates true` in the cask. Updater 2.10+ covers
   `.deb` and `.rpm` as well as AppImage (a `.deb` update needs root). It should work with ad hoc
   signing and the download isn't quarantined, but that's unverified; each update changes the
   code hash, so `ask_keychain_access` runs again. Alternative if the updater doesn't fit: an
   opt-in "check for updates" (needs a `connect-src` change in the CSP, or the check in Rust).
2. **Intel macOS.** `src-tauri/build.rs:18-20` stages helpers per target; a universal build
   needs `lipo` into `-universal-apple-darwin` names, deny/about targets, and the cask's
   `depends_on arch`. The formula also needs an `on_intel` URL.
3. **Linux channels.** No apt repo, rpm, AUR or Nix, so `.deb` users never get updates. Fix: an
   apt repository on GitHub Pages signed in the release; evaluate `.rpm` (Tauri bundles it),
   AUR and a Nix package; write down why not Flatpak (its sandbox can't edit shell files or put
   shims on PATH).
4. **Tauri and platform housekeeping.** Tauri 2.12.0 fixed tray left-click on macOS 27 (we're on
   2.12.1); the translucent window's GPU cost on macOS 26.5+ is an open upstream issue
   (tauri-apps/tauri#15471), so measure idle power with and without `transparent`. Homebrew 7's
   `postflight_steps` is already used; keep install docs fully qualified (tap trust covers only
   the named item).

---

## M7: Native Windows

**Goal:** the app, CLI and shim run on Windows without WSL. **Size:** large.

**Scope:** the shim spawns, waits and forwards the exit code and Ctrl-C under a Job Object
instead of `exec`; `.exe` copies or hard links instead of symlinks; `PATHEXT` and `.cmd` lookup
(`npx.cmd`, `npm.cmd`); `USERPROFILE`; a PowerShell profile block and the user PATH; ACLs instead
of `0600`/`0700`; `nix` and `os::unix` behind `cfg(unix)` in ops and cli; `mcp::sync` on
Windows; `\\?\` verbatim paths in `resolve`; `.exe` names in `paths.rs`, `build-support` and
`src-tauri/build.rs`; the NSIS installer with the WebView2 bootstrapper; a Windows CI job; shim
tests that don't need symlinks or `/bin/sh`.

**Done when:** `cargo test --workspace` passes on `windows-latest`; an NSIS installer is in the
release; `envrouter install` and `envrouter shell on pwsh` route `claude.exe` in a new Windows
Terminal tab.

### Issues

1. **Won't compile natively yet.** `shim/src/main.rs:19-20, 132` (`os::unix`, `exec`);
   `shims.rs:5` (symlink); `shell.rs:6`; `mcp_probe.rs:18-35, 153-156` (nix signals, process
   group); `cli/src/main.rs:421-469` (termios); `mcp.rs:184-227` is `cfg(unix)` but
   `commands.rs:106` calls it unconditionally; `config.rs:317` `write_private`.
2. **Compiles but wrong.** `config.rs:598` validates default dirs against `/`, which isn't
   absolute on Windows, so every save fails; `expand_home` and the glob suffixes split on `/`
   only (`config.rs:418-437`); argv0 yields `claude.exe` (`shim:47-50`); `find_real` has no
   `PATHEXT` (`shim:324-329`); executability by `0o111` (`shim:345`, `shell.rs:688`); HOME from
   `HOME` only (`shim:44`, `cli:146`, `keychain/src/main.rs:67`); `npx`/`npm` matched by name
   (`mcp.rs:242-244`, `npm.rs:76-86`); `resolve.rs:58` compares a lexical trigger with a `\\?\`
   path.
3. **Shell integration for PowerShell** (and the user PATH in HKCU): `shell.rs:26-95` is POSIX
   and fish only; `platform.rs:39-41` says Windows terminals start login shells.
4. **Packaging and CI.** `.exe` names for `externalBin`; NSIS target with `downloadBootstrapper`;
   a `windows-latest` job running the workspace tests; `deny.toml`/`about.toml` already list the
   gnu target, add msvc if used.

---

## Parked

Looked at and left out on purpose, with the reason, so they aren't re-litigated:

- **Profile colours and ordering.** Colours are hash-keyed with 8 hues (a 9th repeats); choosing
  would need a `CONFIG_VERSION` bump; precedence is by folder depth, so order is cosmetic.
- **Launch at login, notifications, a dark/light override, per-profile notes, onboarding.**
  Principle 1 (invisible when it works) and DESIGN.md (follow the system).
- **A default or fallback profile toggle.** No fallback is the product's one rule; a `~` trigger
  already gives a default. Everywhere else can hint at that.
- **Per-profile env vars, OAuth clients.** Shelved earlier; CIMD makes the OAuth shelf moot.
- **Failover at a rate limit and provider routing.** Common in competitors, not this product.
