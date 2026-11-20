---
version: 1
slug: "src-tauri-icons"
primary_target: "src-tauri/icons"
related_targets: ["src-tauri/src/tray.rs","src-tauri/tauri.conf.json"]
---

# App icon and menu bar glyph

**Scope:** EnvRouter's macOS app icon (Dock, Finder, ⌘-Tab, About) and its menu bar template glyph. Mode: Operate: the marks live in system chrome, where recognition and native fit outrank expression.

**Audience and job:** developers with several coding-agent accounts. They should recognize EnvRouter at a glance and read its idea: the folder decides which account a command uses.

**Constraints:** the user asked for clear and creative, never loud or abstract. Standard 824 squircle on the 1024 grid; rendered from SVG with only the command line tools (no Icon Composer); the menu glyph is a monochrome template image whose cutouts are real transparency, and Tauri's tray-icon draws it 18 pt tall, so its viewBox hugs the glyph.

## Direction contract

THESIS: The folder throws the switch. EnvRouter's mark is a Finder folder whose track forks to two accounts and lights the one it uses. It refuses the category's terminal prompt or config gear, and the generic folder-with-badge.

OWN-WORLD: A night signal-box plate (navy #202b42 to #0d1320) under a native Finder-blue folder (back #2b7be0, front #72b8fb to #3d8ff0). Round-capped track at 34/1024, the idle branch #3a4560, the lit branch #4aa3e8 with a pale rail sheen, a white points pivot, and the accounts as avatar coins. The menu glyph is a solid folder with the fork cut through it.

STORY: Seen in the Dock or menu bar, it says "a folder picks your account", and it's the one blue folder on a dark tile among the user's apps.

FIRST VIEWPORT: Folder top centre, 400/1024 wide; the track leaves from under it, pivots at y≈598 and ends in two coins at y≈790, idle left and lit right. Sizes of 64 px and under use a bolder cut: thicker track, solid coins, no figures.

FORM: Points, position 6 of 7 on the ranked list; seed key dd71be7d.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
