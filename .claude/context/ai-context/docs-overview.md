# Documentation Registry

Tier 1 is project-wide and always relevant. Tier 2 and 3 files load on their own when you
work under their directory; this list exists so you can find them _before_ you start.

## Tier 1 — Foundational

- `CLAUDE.md` — what EnvRouter is, how shims route, the UI direction, constraints, conventions, testing and UI-review gotchas
- `.claude/context/ai-context/project-structure.md` — tree, stack, commands. Read before adding a directory.
- `DESIGN.md` — design system: tokens (light/dark), components, rules. Read for UI work and design review.
- `PRODUCT.md` — product truth (users, purpose, principles). Read before any UI or copy work.
- `docs/roadmap.md` — the plan: milestones M0 to M7 with their issues, mirrored as GitHub milestones. Read before planning or opening issues.
- `README.md` and `docs/contributing.md` — the user and contributor docs. Update them when a change is visible to users or changes a development command.

## Tier 2 — Area docs

- `crates/core/CLAUDE.md` — how MCP servers reach an agent (rendering, flags, secrets, probing, import, pinning) and how routing resolves. Read when changing `mcp.rs`, `resolve.rs` or config validation.
- `crates/ops/CLAUDE.md` — adding a window command and rpc, uninstall, shell startup files, setup status, `check_folder`. Read when changing `crates/ops`.
- `src-tauri/CLAUDE.md` — shim and helper staging in the build, icons, ad hoc signing. Read when changing `src-tauri/build.rs`, icons or bundle signing.
- `.github/CLAUDE.md` — workflow action pinning, dependabot and the CI image. Read when changing a workflow.
