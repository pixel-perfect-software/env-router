---
version: alpha
name: EnvRouter Design System
description: A quiet, precise Mac utility where each profile is a card holding the folders it owns.
colors:
  window-ground: "#eeeef1"
  card-surface: "#ffffff"
  card-muted: "#f6f6f8"
  raised-surface: "#ffffff"
  field-surface: "#ffffff"
  button-surface: "#ffffff"
  hairline-border: "rgb(0 0 0 / 0.09)"
  rule: "#e6e6ea"
  ink-primary: "#1d1d1f"
  ink-secondary: "#66666c"
  ink-tertiary: "#9a9aa0"
  system-accent: "#0a64d8"
  on-accent: "#ffffff"
  accent-tint: "color-mix(in srgb, #0a64d8 9%, #ffffff)"
  status-ok: "#24a148"
  status-warn: "#c47f00"
  status-problem: "#d4372c"
  window-ground-dark: "#18181a"
  card-surface-dark: "#252527"
  card-muted-dark: "#1f1f21"
  raised-surface-dark: "#2c2c2f"
  field-surface-dark: "#1c1c1e"
  button-surface-dark: "#3a3a3d"
  hairline-border-dark: "rgb(255 255 255 / 0.09)"
  rule-dark: "#343437"
  ink-primary-dark: "#f2f2f4"
  ink-secondary-dark: "#a3a3a9"
  ink-tertiary-dark: "#6f6f75"
  system-accent-dark: "#3d8af7"
  accent-tint-dark: "color-mix(in srgb, #3d8af7 18%, #252527)"
  status-ok-dark: "#3ec46d"
  status-warn-dark: "#e5a83a"
  status-problem-dark: "#ff6b61"
  profile-cobalt: "#4f7cf0"
  profile-orchid: "#c45ab8"
  profile-lagoon: "#1f9fbf"
  profile-violet: "#7a5af0"
  profile-slate: "#6577a8"
  profile-sky: "#4aa3e8"
  profile-amethyst: "#a35bdb"
  profile-graphite: "#8a8f99"
  mark-plate-top: "#202b42"
  mark-plate-bottom: "#0d1320"
  mark-plate-glow: "#9fb6ff"
  mark-folder-back: "#2b7be0"
  mark-folder-front-top: "#72b8fb"
  mark-folder-front-bottom: "#3d8ff0"
  mark-lit: "#4aa3e8"
  mark-lit-coin-top: "#6cbcf6"
  mark-lit-coin-bottom: "#3d93e0"
  mark-idle: "#3a4560"
  mark-idle-small: "#56627f"
  mark-pivot: "#e9eef8"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 19px
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
  body-strong:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  small:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 14px
  mono:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    fontFeature: '"calt" 0, "tnum" 1'
rounded:
  control: 6px
  tile: 8px
  card: 10px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
components:
  button-push:
    backgroundColor: "{colors.button-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 0 12px
    height: 26px
  button-primary:
    backgroundColor: "{colors.system-accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.control}"
    padding: 0 12px
    height: 26px
  button-plain:
    textColor: "{colors.system-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 0 8px
    height: 26px
  button-plain-hover:
    backgroundColor: "{colors.accent-tint}"
  icon-button:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    size: 26px
  text-field:
    backgroundColor: "{colors.field-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 0 8px
    height: 28px
  text-field-mono:
    backgroundColor: "{colors.field-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: 0 8px
    height: 28px
  switch-on:
    backgroundColor: "{colors.system-accent}"
    rounded: "{rounded.pill}"
    width: 28px
    height: 16px
  profile-card:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.card}"
  profile-card-targeted:
    backgroundColor: "{colors.accent-tint}"
  everywhere-else-card:
    backgroundColor: "{colors.card-muted}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.card}"
  new-profile-card:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.card}"
  status-tile:
    rounded: "{rounded.tile}"
    size: 32px
  health-banner:
    backgroundColor: "{colors.card-surface}"
    rounded: "{rounded.card}"
    padding: 12px
  docket-result:
    backgroundColor: "{colors.raised-surface}"
    rounded: "{rounded.card}"
    padding: 12px 16px
  docket-idle:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.card}"
    padding: 12px 16px
  slip-row:
    backgroundColor: "{colors.accent-tint}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: 4px 6px
  inspector:
    backgroundColor: "{colors.raised-surface}"
    width: min(440px, calc(100% - 40px))
    padding: 20px
  inspector-footer:
    backgroundColor: "{colors.card-muted}"
    padding: 12px 20px
  shells-popover:
    backgroundColor: "{colors.raised-surface}"
    rounded: "{rounded.card}"
    padding: 6px
    width: min(440px, calc(100vw - 32px))
  chip-login-shell:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.system-accent}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 1px 6px
  segmented-selected:
    backgroundColor: "{colors.button-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.small}"
    height: 22px
    padding: 0 10px
  app-icon:
    backgroundColor: "{colors.mark-plate-top}"
    size: 824px
  app-icon-small:
    backgroundColor: "{colors.mark-plate-top}"
    size: 824px
  menu-bar-glyph:
    height: 18pt
    size: 36px
---

# Design System: EnvRouter

## Overview

**Creative North Star: "The Sorting Frame"**

EnvRouter is a native-feeling Mac utility, opened occasionally to set up profiles or to find out why a folder didn't route. It is quiet, precise and dense in the way System Settings is: 13px system type, 26px controls, nothing decorative. The structure carries the product's one rule. Each profile is a card that holds the folders it owns, and a nested folder owned by another profile sits inside its parent's card as a carve-out tagged with the owner's colour, so "the most specific folder wins" is something you see.

The world is a post-office pigeonhole frame rendered as layered modern-Mac cards. The user overrode an earlier flat, hairline-ruled sheet ("it's hard to tell between surfaces"), so depth is now structural: a soft window ground, cards on it, and raised surfaces above those. The system accent follows the user's macOS accent colour and is spent on the one action that matters, selection, and the filed slip. Status always pairs colour with shape. Mono appears only where the text is a path or a value worth copying.

The product's mark, "Points", carries the same idea into system chrome: a Finder-blue folder on a dark navy tile whose track forks to two accounts and lights the one it uses. In the menu bar it becomes a solid template folder with the fork cut through it. The mark is drawn as SVG and rendered by hand into every raster; it has its own fixed palette and does not theme.

Rejected, by the user: a web-app look, the System Settings sidebar-and-switches default, the flat ruled sheet, and an inline profile editor in the grid.

**Key Characteristics:**
- Three surface layers (window ground, card, raised), each visibly distinct in light and dark.
- One accent button per window state.
- Status is shape plus colour, in a tinted tile.
- Id-keyed profile colours drawn from a status-free palette.
- System sans for everything; mono only for paths and values.
- Damped motion around 140 to 300ms on one settle curve; reduced motion respected.
- One mark in two cuts (128 px and up, 64 px and under) plus an alpha-only menu bar template.

## Colors

A near-neutral grey ground with white (dark: graphite) cards, one system accent, three status hues, and eight profile hues that never borrow from status.

**How theming is applied.** Light and dark follow the system through a `prefers-color-scheme: dark` media query that redefines the `--er-*` custom properties on `:root` (`color-scheme: light dark` is set, so native controls and scrollbars follow too). There is no in-app toggle and no class or stored preference. Where WebKit supports it (`@supports (color: AccentColor)`), the accent becomes the `AccentColor` system keyword and on-accent text becomes `AccentColorText`, so the accent tracks the user's macOS accent; `system-accent` and `system-accent-dark` are the fallbacks. A reviewer checks both themes by switching macOS appearance, and should check at least one non-blue system accent.

### Primary
- **System Accent** (`system-accent`, AccentColor at runtime): the window's single primary button, focus rings (50% mix, 3px outline, 1px offset), selection and drop-target outlines, the switch's on track, the current setup step, the caret, text selection (30% mix), plain buttons, and the filed slip.
- **Accent Tint** (`accent-tint`, 9% accent over card; 18% in dark): the wash behind a drop-targeted card, the filed slip, the hovering docket, plain-button hover, and the login-shell chip.

### Status
- **Routed Green** (`status-ok`): routing on, a passing check, completed setup steps, an installed shell's dot.
- **Caution Amber** (`status-warn`): routing off, or a folder owned by a profile that doesn't set this agent.
- **Problem Red** (`status-problem`): blocked routing, a missing shim, errors, inline save errors.

### Profile colours
Eight hues (`profile-cobalt` through `profile-graphite`): blues, purples, cyans and greys only. Each profile's dot appears on its card header, in carve-outs that point to it, and in the inspector header.

### Mark
The app icon's own fixed palette, used only in `src-tauri/icons/`. It never enters the window and never follows the theme, the system accent or a profile.
- **Signal-Box Navy** (`mark-plate-top` to `mark-plate-bottom`, top to bottom): the 824 squircle plate. A radial glow of `mark-plate-glow` at 5% opacity falls from the top centre, and the same colour at 18% draws a 3px rim on the plate's edge.
- **Finder Blue** (`mark-folder-back`; front `mark-folder-front-top` to `mark-folder-front-bottom`): the folder. The back carries the tab; the front panel has a 5px white 50% highlight along its top edge and a 14px black 10% band where it overlaps the back.
- **Lit Route** (`mark-lit`): the branch the folder uses, drawn from the folder down through the pivot to the right-hand coin. In the regular cut it carries a pale rail sheen (#cfe8ff at 55%, 8.2 units wide). Its coin fills `mark-lit-coin-top` to `mark-lit-coin-bottom` with a 4px rim of #e6f3ff fading from 90% to nothing at 60% height. This hex is the same as `profile-sky`; in the mark it means "the route taken", not a profile.
- **Idle Route** (`mark-idle`; `mark-idle-small` in the small cut): the branch not taken and its coin. The idle coin is a gradient a step lighter than its track (#46526d to #333d55 regular, #5e6a87 to #4e5a76 small), so it stays visible on the navy plate.
- **Points Pivot** (`mark-pivot`): the single near-white disc where the track forks.
- **Account figures** (regular cut only): an avatar head and shoulders clipped inside each coin, #1a2236 on the idle coin and `mark-plate-bottom` on the lit one.

### Neutral
- **Window Ground** (`window-ground`): the window background and titlebar band.
- **Card Surface** (`card-surface`): profile cards, the health banner, setup steps, the inspector's folder list.
- **Muted Card** (`card-muted`): Everywhere else, the inspector footer, the loading banner placeholder.
- **Raised Surface** (`raised-surface`): the shells popover, the inspector panel, the docket's check result. In light it equals the card colour and is separated by shadow alone; in dark it is a step lighter (`raised-surface-dark`).
- **Field and Button Surfaces** (`field-surface`, `button-surface`): text fields and push buttons. In dark, buttons lift to a lighter grey and fields sink below the card.
- **Hairline Border** (`hairline-border`): the 0.5px ring baked into card and raised shadows.
- **Rule** (`rule`): hairlines between card body and footer, carve-out indents, the text-field stroke, the outline of New Profile and Everywhere else. Hairlines are 1px, or 0.5px on 2x displays.
- **Primary Ink** (`ink-primary`): all reading text and folder leaf names.
- **Secondary Ink** (`ink-secondary`): supporting text, parent path segments, labels, placeholders, inactive segments and icons.
- **Tertiary Ink** (`ink-tertiary`): non-text strokes only. Used for the empty Everywhere else dot, an off shell's dot, and the idle docket's dashed border at 45%.

### Named Rules
**The One Accent Rule.** At most one accent-filled button is visible per window state. The health banner's action outranks the check result's action, which outranks Check Folder… in the titlebar; whichever loses renders as a push button. With the inspector open, Save takes the accent and Check Folder… stands down.

**The Status-Free Palette Rule.** Profile colours never use red, amber or green, which belong to status, so a profile tag can't read as a verdict. Colours are keyed by profile id, so they survive renames and reordering, and a profile moves off its preferred colour only when another profile on screen already holds it.

**The Fixed Mark Rule.** The mark's palette is fixed in its SVGs. It is not recoloured for a profile, the system accent or dark mode; below the folder, the lit branch is the only blue and the idle branch stays grey.

**The Readable Ink Rule.** `ink-tertiary` is never used for text that must be read. Its contrast is for strokes and empty-state marks only; readable secondary text uses `ink-secondary`.

## Typography

**Body Font:** the macOS system font (-apple-system, SF Pro Text, with Helvetica Neue and sans-serif fallbacks)
**Mono Font:** ui-monospace (SF Mono, with Menlo fallback), contextual alternates off and tabular figures on

**Character:** Native Mac metrics at the scale of System Settings. Hierarchy comes from weight (400, 500, 600) and ink step, not size; the whole ramp spans 11 to 14px.

### Hierarchy
- **Title** (600, 14px, 19px): the app name in the titlebar, profile card names, the inspector heading, Everywhere else.
- **Body** (400 or 500, 13px, 18px): the base size. Banner titles, setup heading, button labels and shell names use 500; the docket headline uses 600 at body size.
- **Small** (400, 12px, 16px): banner detail, verdict notes, empty-state lines, card footers, segmented controls, carve-outs.
- **Label** (500, 12px, 16px, `ink-secondary`, sentence case): form labels and fieldset legends in the inspector.
- **Caption** (400, 11px, 14px): agent variable names, field notes, the login-shell chip, setup step numerals, ⌘ shortcut hints.
- **Mono** (400, 12px, 16px): paths, environment variables and values. Paths split into a secondary-ink parent and a primary-ink leaf so the folder name reads first.

### Named Rules
**The Mono-for-Values Rule.** Mono is only for paths and values (folder paths, `NAME=value` pairs, binary locations, startup files, variable names). Labels, headings and prose stay in the system sans. Mono text is selectable; the rest of the window is not.

**The Quiet Default Rule.** A default or fallback state ("Every agent uses its default config", placeholders) is set in italic secondary ink, so it reads as absence rather than content.

## Layout

A single native window with an overlay titlebar. Top to bottom: a 52px titlebar band (draggable; the traffic lights are centred on it at `trafficLightPosition` x 18, y 28, and its content starts at an 86px inset), the health banner card or the three-step setup card, a scrolling profile grid, and the docket along the bottom. The window body does not scroll; only the grid does, with a soft fade mask at its top (10px) and bottom (18px) edges.

- **Gutters:** 16px window gutter for banner, grid and docket; 12px gap between cards; 20px padding inside the inspector with 24px between its sections.
- **Grid:** `repeat(auto-fill, minmax(240px, 1fr))`. Cards have a 176px minimum height and stretch to their row.
- **Card interior:** header 10px vertical, 14px left; folder rows 4px by 6px; footer 8px by 14px under a hairline.
- **Overlays:** the inspector slides in from the right edge at `min(440px, 100% − 40px)`, full window height, with its body scrolling and Save pinned in a footer. The grid stays in place behind a scrim (black 15%, 35% in dark). The shells popover anchors under the titlebar at the right, `min(440px, 100vw − 32px)`.
- **Docket:** at least 60px tall. The verdict keeps a 300px minimum and the actions wrap underneath it in a narrow window rather than squeezing it.

**Viewports that matter** (instead of 390 / 768 / 1440):
- **900 × 620**, the default window: a three-column grid.
- **680 × 460**, the minimum window: a two-column grid; the docket's actions wrap below the verdict, and the inspector still fits at full height.
- Check both in light and dark.

**The mark's grid.** Both icon cuts sit on a 1024 grid with the plate as a continuous-corner squircle 824 wide (100 to 924 on both axes), centred, leaving the standard macOS margin for the system shadow.
- **Regular cut** (`app-icon.svg`): folder 400 wide (x 312 to 712, y 186 to 486), top centre. The track leaves from under it at y 470, runs down to the pivot (r 22) at y 598, and curves out to two coins (r 58) centred at y 790, idle at x 330 and lit at x 694. Track width 34, round caps.
- **Small cut** (`app-icon-small.svg`): the same composition drawn bolder. Folder 500 wide (x 262 to 762, y 150 to 530), track 72 wide from y 500, pivot r 40 at y 650, coins r 96 at y 800 (x 312 and 712). No account figures and no rail sheen.
- **Menu bar glyph** (`tray.svg`): an 18 × 18 viewBox (origin 2, 2.15) that hugs the folder, because tray-icon draws the image 18 pt tall whatever its size. Rendered at 36 × 36 px (2x).

## Elevation & Depth

Layered. Depth is structural and tells the surfaces apart: the window ground is flat, cards sit on it with a hairline plus a soft 1px shadow, and raised surfaces (popover, inspector, check result) float with a deep, diffuse shadow. Every shadow carries a 0.5px hairline ring so edges stay crisp on both themes. The app icon has its own three-step depth, drawn as SVG drop shadows in black: the plate lifts (0 10, blur 12, 28%), the folder and pivot drop above the track (0 10, blur 14, 45%), and the track and coins sit in contact with the plate (0 6, blur 7, 45%). The menu bar glyph has no depth; it is a flat template. Inset 1px rule-coloured rings, not shadows, mark the flatter containers (Everywhere else, New Profile, text fields).

### Shadow Vocabulary
- **Card** (`0 1px 2px rgb(0 0 0 / 0.05), 0 0 0 0.5px hairline`; dark `0 1px 2px rgb(0 0 0 / 0.3), …`): profile cards, the health banner, setup card, the inspector's folder list, the New Profile plus disc.
- **Raised** (`0 10px 30px -6px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.06), 0 0 0 0.5px hairline`; dark `0 12px 32px -6px rgb(0 0 0 / 0.55), …`): the shells popover, the inspector, the docket's check result.
- **Push control** (`0 0 0 0.5px rgb(0 0 0 / 0.14), 0 1px 2px rgb(0 0 0 / 0.08)`): push buttons. Primary buttons carry `0 1px 2px rgb(0 0 0 / 0.18)`; the switch knob and selected segment carry a small 0.5px-offset contact shadow.

### Named Rules
**The Three Layers Rule.** Every surface belongs to one of three layers: window ground, card, or raised. New surfaces pick a layer; they don't invent a fourth shadow.

**The Outline Selection Rule.** Selection and drop-target states on cards use an outline (2px accent, 2px offset), never a box-shadow, because a card's own shadow utility would override a shadow ring. A drop target adds the accent tint behind the outline.

## Shapes

Gently rounded, concentric corners. Cards, banners, the docket and the popover use 10px; status tiles use 8px; buttons, fields, icon buttons and folder rows use 6px. Inside a 10px container, nested rows step down (popover rows and the segmented track at 7px, segments at 5px). Profile dots, shell dots, step numerals, the switch and the login-shell chip are full circles or pills. The inspector panel is square-cornered because it is flush to the window edge.

The mark's plate is a continuous-corner squircle, not a rounded rectangle; its corners follow the macOS app-icon shape. Inside it everything is rounded: a Finder folder with a curved tab, a round-capped track, round coins and a round pivot. The menu bar folder uses 1.6-unit corner radii on its 18-unit grid.

Carve-outs and slips indent 13px under their parent folder with a hairline left rule. The idle docket is the one dashed shape in the system (1.5px dashed). Icons are drawn on a 16px grid with a 1.5px round-capped stroke (14px and 12px variants for folders, branches and chevrons), always inline SVG.

## Components

### Buttons
Native push buttons, small and tactile.
- **Shape:** gently rounded (6px), 26px tall, 12px horizontal padding, 6px icon gap.
- **Push:** button surface with the push-control shadow; hover darkens slightly (brightness 0.97), active to 0.9. A push button held open (Shells… while its popover is open) stays at 0.9.
- **Primary:** system accent with on-accent text at 500 weight; hover brightens (1.05). Only one per window state (see The One Accent Rule).
- **Plain:** accent text with no fill, 8px padding pulled back into the margin; hover shows the accent tint. Used for in-row actions such as Undo.
- **Icon button:** 26px square, borderless, secondary ink; hover adds an 8% ink wash and primary ink. Always carries an accessible label and tooltip.
- **Disabled:** 45% opacity, no pointer events.

### Chips
- **Login shell:** an accent-tinted pill with accent caption text, beside the default shell's name in the shells popover. It's the only chip.

### Cards / Containers
- **Profile card:** card surface, 10px, card shadow, 176px minimum. Header: profile dot, name (title), pencil icon button; when the profile is in the inspector the pencil becomes an accent "Editing" label and the card takes the selection outline. Body: folder rows (folder icon, mono path, parent secondary and leaf primary), each followed by its carve-outs. Footer under a hairline: agent name in secondary ink, config path in mono.
- **Carve-out:** small secondary text indented 13px with a hairline left rule: branch icon, relative path in mono, then the owning profile's dot and name aligned right.
- **New Profile:** a flat placeholder (inset 1.5px rule ring, no fill) with a 36px card-surface plus disc, label and ⌘N hint. Hover fills it with card surface and turns it accent; while creating, it shows the accent tint with a 2px accent ring.
- **Everywhere else:** muted card with an inset rule ring and no shadow, an empty circle dot, and title in secondary ink. It always sits last.
- **Health banner:** card surface, 12px padding: status tile, a one-line body-strong title, optional small detail, at most one action. While loading, a muted pulsing placeholder 58px tall holds its place.
- **Setup card:** the banner's first-run form: "Set up EnvRouter" over three numbered steps (done: green with a check; current: accent; upcoming: rule ring) and the current step's single primary action.

### Inputs / Fields
- **Style:** field surface, 6px, 28px tall, 8px padding, inset 1px rule stroke; placeholders in italic secondary ink. A mono variant holds paths at 12px.
- **Focus:** the stroke becomes a 1.5px inset accent ring (no outer focus outline).
- **Error:** shown inline as small problem-red text in the inspector footer, never as a modal.
- **Switch:** 28 × 16 pill, accent when on, 18% ink when off, with a white 13px knob that slides 12px over 150ms on the settle curve.
- **Segmented:** a 7% ink track with 2px padding; the selected segment is a button-surface chip with a contact shadow, the others secondary ink.

### Navigation
There is no navigation. The titlebar holds the app icon (the small cut at 18px, 8px before the name) and the app name, shell status (a green dot when on, an empty tertiary ring when off, a red cross when blocked, each with a hidden text state), Shells…, and Check Folder… (⌘O).

### Status Tile
The shared status mark for the banner (32px) and the check result (28px): an 8px-rounded tile washed with 14% of the status colour, holding a 1.8px stroke glyph whose shape states the result. Check is ok, bang is warn, cross is problem, dash is neutral (no profile owns the folder), and a dashed circle pulsing at 1.1s is pending. A new verdict stamps in (scale 1.35 to 1, 180ms).

### Docket
The floating check result along the bottom, one complete state at a time, never a log.
- **Idle:** a dashed drop zone (1.5px dashed, tertiary ink at 45%) with the drop icon and a one-line instruction in secondary ink.
- **Hovering a drag:** accent tint, accent text and a 1.5px accent ring: "Release to check" plus the path.
- **Result:** raised surface, rises in over 180ms: status tile, headline and folder path, then a note and `label value` pairs in mono, then the verdict's single action, Agent and Shell segmented controls, and Dismiss.
- **Copy:** from `src/lib/verdict.ts`. One terse headline ("Routed to Work", "Another claude comes first on PATH"), an optional plain sentence that says what to change, the values behind it (`sets`, `via`, `runs`, `instead of`, `defined in`), and at most one fixing action labelled as a verb ("Turn On zsh", "Open ~/.zshrc", "Reinstall Shim").

### Slip
The signature interaction. A checked folder becomes a slip filed in the owning card (or Everywhere else): accent-tinted row with a 40% accent inset ring, a state mark (filled accent dot when routed, red cross on a problem) and the mono path. It animates from the drop point into its slot over 300ms on the settle curve, the card it will land in lights up with the drop-target outline before release, and then the status tile stamps.

### Profile Inspector
The only profile editor: a raised panel sliding in from the right (220ms), over a scrim that keeps the grid visible. Header: profile dot (12px), name, close. Body: Name field (32px, title size), Trigger folders as a card list with remove buttons that strike rows through (Undo) until saved, Add Folder…, then one mono path field per agent with its variable name and Choose…. Footer on muted card: Delete…, inline error, Cancel, and Save as the accent button. Escape cancels.

### Shells Popover
A raised panel under the titlebar that opens with a 4px drop (140ms): one row per shell with its name, login-shell chip, startup files in mono, and a switch; unavailable shells show "Not installed" at 60% opacity. A hairline footer states what the app edits, or the error.

### The Mark
The app icon and menu bar glyph, drawn by hand as SVG in `src-tauri/icons/` and rendered into every raster at its exact pixel size with a transparent background.
- **Regular cut** (`app-icon.svg`): 128 px and up: `128x128.png`, `128x128@2x.png` (256), `icon.png` (512), and the 128 to 1024 px members of `icon.icns`.
- **Small cut** (`app-icon-small.svg`): 64 px and under: `32x32.png` and the 16, 32 and 64 px members of `icon.icns`, assembled through an `iconutil` iconset.
- **Menu bar glyph** (`tray.svg` to `tray.png`, 36 × 36): loaded by `tray.rs` with `icon_as_template(true)`. A solid black folder masked by the fork: the lit branch (stem, curve) and a 1.8-radius coin are cut fully through (mask #000, alpha 0); the idle branch is half cut (mask #808080, alpha 0.5) and has no coin. Branch strokes are 1.6 wide with round caps.
- **In the window:** the small cut, imported straight from `app-icon-small.svg`, at 18px before the app name in the titlebar, centred with the traffic lights. It's the only place the window shows the mark.
- **Provenance:** every top-level PNG carries a `impeccable:prompt` text chunk naming its SVG source and size.

**The Two Cuts Rule.** The mark is drawn twice on one grid. Sizes of 64 px and under use the small cut (thicker track, solid coins, no figures); 128 px and up use the regular cut. Never downscale the regular cut into a small slot.

**The Alpha-Only Rule.** The menu bar glyph is a template image: macOS reads only its alpha and paints it for the menu bar's appearance. Every inner shape is a mask cutout, full for the lit route and half for the idle one; colour inside the glyph means nothing.

**The Rendered-From-Source Rule.** Rasters are outputs of the SVGs, rendered one size at a time. They are never edited by hand and never regenerated from a single source.

## Do's and Don'ts

### Do:
- **Do** keep exactly one accent button per window state, ranked banner action, then the check result's action, then Check Folder…; every other action is a push or plain button.
- **Do** pair every status with a shape as well as a colour: check (ok), bang (warn), cross (problem), dash (neutral), dashed ring (pending).
- **Do** give each profile an id-keyed colour from the eight profile hues, shifting it only when two profiles on screen clash.
- **Do** set paths, variables and values in mono and keep them selectable; everything else stays system sans and unselectable.
- **Do** edit profiles in the right-side inspector, with the grid visible behind it and the edited card outlined.
- **Do** mark card selection and drop targets with a 2px accent outline at 2px offset (plus the tint for a drop target).
- **Do** draw icons as inline SVG on the 16px, 1.5px-stroke grid.
- **Do** show the idle docket as a dashed drop zone, and the result as a single raised card.
- **Do** keep motion on the settle curve (`cubic-bezier(0.16, 1, 0.3, 1)`) between 140 and 300ms, and let reduced motion collapse it.
- **Do** verify both themes and a non-blue system accent at 900 × 620 and 680 × 460.
- **Do** render each icon raster from its SVG at its exact pixel size: the small cut for 64 px and under, the regular cut for 128 px and up, and `tray.svg` at 36 px.
- **Do** make every inner shape of the menu bar glyph a mask cutout: full for the lit branch and its coin, half (alpha 0.5) for the idle branch.
- **Do** check the mark at 16 and 32 px and the glyph in a light and a dark menu bar after any change.

### Don't:
- **Don't** use red, amber or green for a profile colour; those belong to status.
- **Don't** signal status with colour alone.
- **Don't** use mono for labels, headings or prose.
- **Don't** edit a profile inline in the grid; the user rejected it because the editor got hidden.
- **Don't** use a box-shadow ring for card selection or drop target; the card's own shadow overrides it.
- **Don't** use Unicode glyphs (✓, ✗, ⚠, →) as icons. ⌘ shortcut notation in a `kbd` is text, not an icon, and is fine.
- **Don't** use `ink-tertiary` for any text that must be read.
- **Don't** put a second accent-filled button on screen.
- **Don't** return to the flat, hairline-ruled sheet or to a System Settings sidebar-and-switches layout; surfaces must stay visibly layered.
- **Don't** add help paragraphs; a verdict is one headline, one note, its values and one action.
- **Don't** run `tauri icon`: it rebuilds every size from one source, losing the small cut and the provenance, and recreates the Windows tiles.
- **Don't** draw the menu bar glyph's cutouts with white fills; a template reads only alpha, so white paint renders as solid.
- **Don't** recolour the mark per profile, per system accent or per theme, or use the profile palette as a set in it.
- **Don't** make the mark a terminal prompt, a config gear or a generic folder with a badge.
- **Don't** size `tray.svg`'s viewBox with padding around the glyph; tray-icon scales the whole image to 18 pt, so padding shrinks the folder.

### Known drift (not intent)
- The New Profile card's creating state, the hovering docket, and the whole-window drag ring use inset or outer box-shadow rings rather than outlines. They don't sit under a card shadow, so they render, but they predate The Outline Selection Rule.
- The inspector's Name field overrides the field height and size with `!important` (32px, title size); it's a one-off, not a second field size.
