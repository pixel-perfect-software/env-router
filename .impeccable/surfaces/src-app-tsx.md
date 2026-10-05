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
Mac developers with separate coding-agent accounts. Jobs, by frequency: first-run setup (profile, then shell, then check); "why didn't this folder route?"; adding a folder or profile. Health first. Avoid: a web-app look, help paragraphs, toy personality, hidden mechanics (always show which files are edited, which path wins, the real binary). Light and dark follow the system. Menu bar icon plus a window; closing the window keeps the app in the menu bar.

## Chosen direction
The Sorting Frame (roll, seed 9c112fdb), code-led. On 2026-10-05 the user overrode the original "no cards, hairline grid" rendering: "make the UI feel more like a modern app UI… it's hard to tell between surfaces." The topology stays (one container per profile, folders filed inside, carve-outs, Everywhere else, a check docket); the materials are now layered modern-Mac cards.

## Unresolved
App icon and tray glyph are first-pass. Agents offered: Claude Code, Codex, Copilot CLI, Gemini CLI (src/lib/tools.ts); saving creates missing agent folders inside home. opencode and Aider are excluded because their variables don't separate logins.

## Direction contract
THESIS: Each profile is a card that holds the folders it owns, so "the most specific folder wins" is visible structure: a nested folder sits as a carve-out inside its parent's card, tagged with the owning profile's colour. It refuses both the System Settings sidebar-and-switches default and the flat ruled sheet the user rejected.
OWN-WORLD: Three surface layers: a soft window ground, white (dark: raised grey) cards with a 10px radius and hairline-plus-soft shadow, and raised surfaces (popover, editor, check result) with deeper shadow. Each profile has a stable colour dot. Status uses semantic colour plus shape (green check, amber bang, red cross) in a tinted tile. The system accent is for the primary action, selection, and the filed slip. System sans; mono only for paths and values.
STORY: You see at once whether routing works (health banner). You read which folders go to which account. You drop a folder and get the truth from a real shell. You fix problems with the one action each verdict names.
FIRST VIEWPORT: The titlebar holds the traffic lights, shell status dots, Shells… and the primary Check Folder…. Below it is the health banner card (status tile, one-line title, one action), or the three-step setup on first run. Profile cards fill a responsive grid (min 240px): colour dot and name, folder rows with icons, carve-outs, and agent paths in a footer. Then a New Profile placeholder card and a muted Everywhere else card. A floating check card (or a dashed drop zone when idle) sits along the bottom.
FORM: The Sorting Frame (post-office pigeonhole frame), position 7 of 7, seed key 9c112fdb, rendered as modern layered cards at the user's request. Signature interaction: drag a folder from Finder, the owning card lights up before release, the slip slides into it, then the real-shell check stamps the floating result. Motion is damped at about 160–300ms, and reduced motion is respected.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
