---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src-tauri/src/tray.rs"]
---

# Main window and menu bar

## Scope and mode
Operate. EnvRouter's only window, plus its menu bar menu. Opened occasionally to set up, to edit profiles, and to diagnose a folder.

## Audience, job, constraints
Mac developers with separate coding-agent accounts and per-project MCP servers. Two jobs share one rule (the folder decides): which account an agent uses, and which MCP servers it loads. Jobs, by frequency: first-run setup (profile, then shell, then check); "why didn't this folder route?"; adding a folder or profile. Health first. Avoid: a web-app look, help paragraphs, toy personality, hidden mechanics (always show which files are edited, which path wins, the real binary). Light and dark follow the system. Menu bar icon plus a window; closing the window keeps the app in the menu bar.

## Chosen direction
The Sorting Frame (roll, seed 9c112fdb), code-led. On 2026-10-05 the user overrode the original "no cards, hairline grid" rendering: "make the UI feel more like a modern app UI… it's hard to tell between surfaces." The topology stays (one container per profile, folders filed inside, carve-outs, Everywhere else, a check docket); the materials are now layered modern-Mac cards.

## MCP servers (2026-10-19)
Two views under one titlebar switch: Profiles (the Sorting Frame, below) and Servers (a list beside the server editor, with Catalog and Import in the same detail area). Assignment works from both sides: a profile's MCP checklist and tool filter, and a server's Used by toggles. Card footers link each server name to its editor; the check result lists the servers a run gets.

## Native-current refinement (2026-10-20)
The user asked for a design and UI/UX pass ("native support is always our goal but a touch of refinement", CleanMyMac and other modern desktop apps as inspiration) and chose native-current polish over expressive moments. Measured against macOS 27.2: 34pt capsule toolbar items in the 52pt band, the shell status merged into the Shells control, Editors… icon-only, a sliding-thumb view switch, popovers that hang from their button, 12px cards. Working routing is a quiet line on the ground with the map's counts; only states that need attention get a card. First run greets with the mark ("The folder decides") instead of an empty grid, and an empty server library starts from the mark too. Rejected in review: a floating inset inspector (macOS 27 runs inspectors edge to edge) and raised keycaps (shortcuts stay plain text). Both heroes then got illustrations drawn from the mark's own SVG (`src/assets/welcome.svg`, `src/assets/servers-library.svg`), at the user's request, rather than generated art.

## Unresolved
App icon and tray glyph are decided (see the src-tauri-icons brief); the titlebar shows the icon's small cut before the app name. Agents offered: Claude Code and Copilot CLI (src/lib/agents.json); Codex and Gemini CLI are future add-ons. Saving creates missing agent folders inside home. opencode and Aider are excluded because their variables don't separate logins.

## Direction contract
THESIS: Each profile is a card that holds the folders it owns, so "the most specific folder wins" is visible structure: a nested folder sits as a carve-out inside its parent's card, tagged with the owning profile's colour. It refuses both the System Settings sidebar-and-switches default and the flat ruled sheet the user rejected.
OWN-WORLD: Three surface layers: a soft window ground, white (dark: raised grey) cards with a 10px radius and hairline-plus-soft shadow, and raised surfaces (popover, editor, check result) with deeper shadow. Each profile has a stable colour dot. Status uses semantic colour plus shape (green check, amber bang, red cross) in a tinted tile. The system accent is for the primary action, selection, and the filed slip. System sans; mono only for paths and values.
STORY: You see at once whether routing works (health banner). You read which folders go to which account. You drop a folder and get the truth from a real shell. You fix problems with the one action each verdict names.
FIRST VIEWPORT: The titlebar holds the traffic lights, shell status dots, Shells… and the primary Check Folder…. Below it is the health banner card (status tile, one-line title, one action), or the three-step setup on first run. Profile cards fill a responsive grid (min 240px): colour dot and name, folder rows with icons, carve-outs, and agent paths in a footer. Then a New Profile placeholder card and a muted Everywhere else card. A floating check card (or a dashed drop zone when idle) sits along the bottom.
FORM: The Sorting Frame (post-office pigeonhole frame), position 7 of 7, seed key 9c112fdb, rendered as modern layered cards at the user's request. Signature interaction: drag a folder from Finder, the owning card lights up before release, the slip slides into it, then the real-shell check stamps the floating result. Motion is damped at about 160–300ms, and reduced motion is respected.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Direction contract: Profiles | Servers (adopted 2026-10-19)
The Sorting Frame contract above still governs the Profiles view; this one governs the window as a whole and the Servers view. The user adopted it from a prototype, together with native macOS vibrancy behind a translucent window ground.
THESIS: Two places under one rule. Profiles is the map of what each folder gets; Servers is the workbench where servers are made, checked and handed to profiles. Assignment is editable from both sides and visible on the card. Refuses a slide-over drill-down three levels deep, and refuses a sidebar app that would hide the map.
OWN-WORLD: The same three layers over macOS under-window vibrancy (the ground translucent, cards opaque), with neutrals tinted a few percent toward the icon's signal-box navy; a profile card's header carries a light wash of its colour; servers wear their own logo in a brand-tinted tile (monogram tile when none), monochrome everywhere else. Focus rings and field edges at 3:1.
STORY: You switch to Servers, see every server with its logo, transport and tool count, pick one and edit it beside the list, check it, and switch on the profiles that should load it. Back on Profiles, each card says which servers it hands out, and a server name takes you to it.
FIRST VIEWPORT: Titlebar: icon and name, a Profiles | Servers segmented switch, shell status, Shells…, Check Folder…. Servers view: a list column (~260px) on card surface with a header holding Add, Catalog and Import; the selected server's editor fills the rest on a card, Save the one accent; Catalog and Import open in that same detail area. Nothing selected: an empty detail naming the three ways to add a server.
FORM: Master-detail split (Mail, Notes), extension of the Sorting Frame world, no roll (precise request). Signature interaction: Used by toggles light the profile's colour as you switch them on, and a card's server name opens that server.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
