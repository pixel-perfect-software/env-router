---
version: alpha
name: EnvRouter Design System
description: A quiet, precise Mac utility in two places, Profiles and Servers, where each profile is a card holding the folders it owns.
colors:
  window-ground: "#eceef3"
  card-surface: "#ffffff"
  card-muted: "#f5f6f9"
  raised-surface: "#ffffff"
  field-surface: "#ffffff"
  button-surface: "#ffffff"
  hairline-border: "rgb(16 24 48 / 0.1)"
  rule: "#e3e6ec"
  field-edge: "#7f848e"
  track: "rgb(16 24 48 / 0.07)"
  well: "#f1f3f7"
  ink-primary: "#1b1d22"
  ink-secondary: "#5b5f69"
  ink-tertiary: "#959aa5"
  system-accent: "#0a64d8"
  accent-ink: "#0a64d8"
  on-accent: "#ffffff"
  accent-tint: "color-mix(in srgb, #0a64d8 9%, #ffffff)"
  status-ok: "#24a148"
  status-warn: "#c47f00"
  status-problem: "#c9332a"
  window-ground-dark: "#14161b"
  card-surface-dark: "#20232a"
  card-muted-dark: "#1a1d23"
  raised-surface-dark: "#272b33"
  field-surface-dark: "#171a1f"
  button-surface-dark: "#3a3f4a"
  hairline-border-dark: "rgb(255 255 255 / 0.09)"
  rule-dark: "#30343c"
  field-edge-dark: "#808693"
  track-dark: "rgb(0 0 0 / 0.32)"
  well-dark: "#31353e"
  ink-primary-dark: "#eef0f4"
  ink-secondary-dark: "#a9aeb9"
  ink-tertiary-dark: "#6c717c"
  system-accent-dark: "#2a6fd9"
  accent-ink-dark: "#5aa2ff"
  accent-tint-dark: "color-mix(in srgb, #3d8af7 18%, #20232a)"
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
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 22px
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
  app-name:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, sans-serif"
    fontSize: 13px
    fontWeight: 700
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
  checkbox: 4px
  segment: 5px
  control: 6px
  row: 7px
  tile: 8px
  card: 12px
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
  button-primary-large:
    backgroundColor: "{colors.system-accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: 0 16px
    height: 28px
  button-toolbar:
    backgroundColor: "{colors.button-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: 0 14px
    height: 34px
  button-toolbar-icon:
    backgroundColor: "{colors.button-surface}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.pill}"
    size: 34px
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
  sealed-well:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.small}"
    rounded: "{rounded.control}"
    height: 28px
  checkbox:
    backgroundColor: "{colors.field-surface}"
    rounded: "{rounded.checkbox}"
    size: 14px
  checkbox-on:
    backgroundColor: "{colors.system-accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.checkbox}"
    size: 14px
  switch-on:
    backgroundColor: "{colors.system-accent}"
    rounded: "{rounded.pill}"
    width: 28px
    height: 16px
  segmented-track:
    backgroundColor: "{colors.track}"
    rounded: "{rounded.row}"
    padding: 2px
  segmented-selected:
    backgroundColor: "{colors.button-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.small}"
    rounded: "{rounded.segment}"
    height: 22px
    padding: 0 10px
  segmented-toolbar-track:
    backgroundColor: "{colors.track}"
    rounded: "{rounded.pill}"
    padding: 2px
  segmented-toolbar-selected:
    backgroundColor: "{colors.button-surface}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: 30px
    padding: 0 14px
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
  status-badge:
    backgroundColor: "{colors.status-ok}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    size: 16px
  health-line:
    textColor: "{colors.ink-primary}"
    typography: "{typography.small}"
    height: 20px
  health-banner:
    backgroundColor: "{colors.card-surface}"
    rounded: "{rounded.card}"
    padding: 12px
  welcome:
    textColor: "{colors.ink-primary}"
    typography: "{typography.display}"
    width: 440px
  welcome-art:
    size: 136px
  library-art:
    size: 112px
  server-ways-list:
    backgroundColor: "{colors.well}"
    rounded: 10px
    width: 420px
  server-way-tile:
    backgroundColor: "{colors.button-surface}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.row}"
    size: 28px
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
  server-list:
    backgroundColor: "{colors.card-surface}"
    rounded: "{rounded.card}"
    width: 232px
  server-row:
    textColor: "{colors.ink-primary}"
    typography: "{typography.mono}"
    rounded: "{rounded.row}"
    padding: 6px 8px
  server-row-selected:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.system-accent}"
    rounded: "{rounded.row}"
  server-detail:
    backgroundColor: "{colors.card-surface}"
    rounded: "{rounded.card}"
    padding: 16px 20px 20px
  server-detail-footer:
    backgroundColor: "{colors.card-muted}"
    padding: 12px 20px
  server-mark:
    size: 28px
    rounded: "{rounded.row}"
  server-mark-monogram:
    backgroundColor: "{colors.track}"
    textColor: "{colors.ink-secondary}"
    size: 28px
    rounded: "{rounded.row}"
  used-by-chip:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: 0 12px 0 10px
    height: 28px
  used-by-chip-on:
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.pill}"
  tools-list:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.tile}"
    padding: 6px 12px
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

EnvRouter is a native-feeling Mac utility, opened occasionally to set up profiles, to manage the MCP servers its agents load, or to find out why a folder didn't route. It is quiet, precise and dense in the way System Settings is: 13px system type, 26px controls, nothing decorative. Its materials and controls follow current macOS (macOS 27, measured natively): a 52px unified toolbar of 34px capsules, 12px card corners and soft two-step card shadows, while form buttons stay 26px and fields 28px on purpose, denser than the system default. The structure carries the product's one rule. Each profile is a card that holds the folders it owns, and a nested folder owned by another profile sits inside its parent's card as a carve-out tagged with the owner's colour, so "the most specific folder wins" is something you see.

The window is two places under one titlebar switch. **Profiles** is the map: the Sorting Frame, a post-office pigeonhole frame rendered as layered modern-Mac cards. **Servers** is the workbench: a master-detail split (in the manner of Mail or Notes) with every server in a list card and the chosen one's editor in a card beside it. Assignment between them is editable from both sides and visible on the cards. The user overrode an earlier flat, hairline-ruled sheet ("it's hard to tell between surfaces"), so depth is structural: a window ground through which macOS vibrancy shows faintly, opaque cards on it, and raised surfaces above those. Neutrals lean a few percent toward the app icon's signal-box navy, so the window belongs to its mark. The system accent follows the user's macOS accent colour and is spent on the one action that matters, selection, focus and the filed slip. Status always pairs colour with shape. Mono appears only where the text is a path, a name or a value worth copying.

The product's mark, "Points", carries the same idea into system chrome: a Finder-blue folder on a dark navy tile whose track forks to two accounts and lights the one it uses. In the menu bar it becomes a solid template folder with the fork cut through it. The mark is drawn as SVG and rendered by hand into every raster; it has its own fixed palette and does not theme. The window shows it once, in the titlebar; two illustrations drawn from it open it up for the first-run welcome and the empty server library.

Rejected, by the user: a web-app look, the System Settings sidebar-and-switches default, the flat ruled sheet, an inline profile editor in the grid, a slide-over drill-down three levels deep, and a sidebar app that would hide the map.

**Key Characteristics:**
- Two views, Profiles and Servers, under one segmented switch in the titlebar (⌘1, ⌘2).
- Three surface layers (window ground, card, raised), each visibly distinct in light and dark; the ground lets macOS vibrancy through, cards stay opaque.
- Neutrals tinted toward the icon's navy.
- One accent button per window state.
- Status is shape plus colour, in a tinted tile, or a solid badge on a one-line status.
- Toolbar controls are 34px capsules, as macOS 27 draws them; form controls stay 26px rounded rectangles.
- Working routing is a quiet line on the ground; only a state that needs attention gets a card.
- Id-keyed profile colours drawn from a status-free palette, washing each profile card's header.
- Servers wear their own logo in a brand-tinted tile; brand colour stays in the tile.
- System sans for everything; mono only for paths, names and values.
- Focus rings and field edges hold 3:1.
- Damped motion around 140 to 300ms on one settle curve; reduced motion keeps the fades and drops the movement.
- One mark in two cuts (the regular cut above 64 px, the small cut at 64 px and under) plus an alpha-only menu bar template.

## Colors

A cool, navy-tinted grey ground with white (dark: navy graphite) cards, one system accent, three status hues, eight profile hues that never borrow from status, and server brand colours confined to their logo tiles.

**How theming is applied.** Light and dark follow the system through a `prefers-color-scheme: dark` media query that redefines the `--er-*` custom properties on `:root` (`color-scheme: light dark` is set, so native controls and scrollbars follow too). There is no in-app toggle and no class or stored preference. The accent is derived from the `AccentColor` system keyword, so it tracks the user's macOS accent, but held to contrast, since system accents are bright (blue under white text is 4.0:1, yellow far less). Where WebKit has relative colour (`@supports (color: oklch(from AccentColor min(l, 0.5) c h))`), the accent's OKLCH lightness is clamped, keeping its hue: the fill (`system-accent`) at most 0.5 under white on-accent text, and the ink (`accent-ink`) at most 0.48 in light and at least 0.82 in dark. Measured across every macOS accent, that holds 5.2:1 for text on the fill and 4.5:1 for ink on the card, the tint and the well. Older WebKit mixes `AccentColor` instead (the fill 15% toward black with `AccentColorText` on it, the ink 20% toward black in light and 35% toward white in dark), which holds for blue but not the lightest accents. `system-accent`, `system-accent-dark`, `accent-ink` and `accent-ink-dark` are the fallbacks without `AccentColor`. A reviewer checks both themes by switching macOS appearance, and should check at least one non-blue system accent.

**How vibrancy is applied.** The Tauri window is transparent with macOS's `underWindowBackground` effect (following the window's active state). Only inside the app (`main.tsx` sets `data-vibrant` on `<html>` when Tauri is present) the body ground becomes `window-ground` at 76% over the vibrancy, and the titlebar band (`data-titlebar`) `window-ground` at 90%, so text on the ground keeps its contrast over any wallpaper. Cards, raised surfaces and fields stay opaque. In the browser preview there is no `data-vibrant` and the ground is solid.

### Primary
- **System Accent** (`system-accent`, from AccentColor at runtime): the fill. The window's single primary button, a checked checkbox, the switch's on track, the current setup step and text selection (30% mix). On-accent text holds 4.5:1 on it.
- **Accent Ink** (`accent-ink`, from AccentColor at runtime): the accent as a line or text. The focus ring (solid, 2px, 2px offset), selection and drop-target outlines, the caret, plain buttons, the selected server's name, hovered server links, the login-shell chip, a pressed icon button, and the filed slip. It holds 4.5:1 on the card, the accent tint and the well in both themes.
- **Accent Tint** (`accent-tint`, 9% accent over card; 18% in dark): the wash behind a drop-targeted card, the selected server row, the filed slip, the hovering docket, plain-button hover, an active Keychain lock, and the login-shell chip.

### Status
- **Routed Green** (`status-ok`): routing on, a passing check, a server that answered, completed setup steps, an installed shell's dot, the working-routing badge.
- **Caution Amber** (`status-warn`): routing off, a folder owned by a profile that doesn't set this agent, a server that needs a sign-in.
- **Problem Red** (`status-problem`): blocked routing, a missing shim, a server that didn't answer, errors, inline save errors.

### Profile colours
Eight hues (`profile-cobalt` through `profile-graphite`): blues, purples, cyans and greys only. Each profile's colour appears as its dot (card header, carve-outs that point to it, inspector header, server rows, Used by chips, "off in" marks), as a light wash across its card header (7% of the colour over the card; 12% in dark), and as the fill and 1.5px ring of a Used by chip that's on (16% over the card).

### Server brand colours
A server whose name, URL host or package names a known brand (Simple Icons, `src/lib/serverLogo.ts`) wears that brand's logo in its own colour on a tile of 13% of the colour over the card. A near-black or near-white brand (luminance under 0.2 or over 0.85) takes the ink colour instead, so it reads in both themes. A server without a brand gets a monogram: its first letter, semibold, in secondary ink on the `track` colour.

### Mark
The app icon's own fixed palette, defined only in the SVGs in `src-tauri/icons/`. The window shows the mark only as those images and never takes a colour from it; the mark never follows the theme, the system accent or a profile.
- **Signal-Box Navy** (`mark-plate-top` to `mark-plate-bottom`, top to bottom): the 824 squircle plate. A radial glow of `mark-plate-glow` at 5% opacity falls from the top centre, and the same colour at 18% draws a 3px rim on the plate's edge.
- **Finder Blue** (`mark-folder-back`; front `mark-folder-front-top` to `mark-folder-front-bottom`): the folder. The back carries the tab; the front panel has a 5px white 50% highlight along its top edge and a 14px black 10% band where it overlaps the back.
- **Lit Route** (`mark-lit`): the branch the folder uses, drawn from the folder down through the pivot to the right-hand coin. In the regular cut it carries a pale rail sheen (#cfe8ff at 55%, 8.2 units wide). Its coin fills `mark-lit-coin-top` to `mark-lit-coin-bottom` with a 4px rim of #e6f3ff fading from 90% to nothing at 60% height. This hex is the same as `profile-sky`; in the mark it means "the route taken", not a profile.
- **Idle Route** (`mark-idle`; `mark-idle-small` in the small cut): the branch not taken and its coin. The idle coin is a gradient a step lighter than its track (#46526d to #333d55 regular, #5e6a87 to #4e5a76 small), so it stays visible on the navy plate.
- **Points Pivot** (`mark-pivot`): the single near-white disc where the track forks.
- **Account figures** (regular cut only): an avatar head and shoulders clipped inside each coin, #1a2236 on the idle coin and `mark-plate-bottom` on the lit one.

### Neutral
- **Window Ground** (`window-ground`): the window background and titlebar band; translucent over vibrancy in the app.
- **Card Surface** (`card-surface`): profile cards, the health banner, setup card, the server list and server detail, the inspector's folder and MCP lists, the catalog and import lists, and the icon tiles of the Servers empty state.
- **Muted Card** (`card-muted`): Everywhere else, the inspector and server editor footers.
- **Raised Surface** (`raised-surface`): the Shells and Editors popovers, the profile inspector, the docket's check result. In light it equals the card colour and is separated by shadow alone; in dark it is a step lighter (`raised-surface-dark`).
- **Field and Button Surfaces** (`field-surface`, `button-surface`): text fields, unchecked checkboxes, push buttons and the selected segment. In dark, buttons lift to a lighter grey and fields sink below the card.
- **Field Edge** (`field-edge`): the 1px inset stroke of every text field, chosen to hold 3:1 against both the field and the panel around it. It also rings an upcoming setup step.
- **Track** (`track`): the segmented control's track (the toolbar's capsule too), a server monogram's tile, the plug tile of the Servers empty state, and the loading line's bar. In dark it darkens (black 32%) rather than lightening.
- **Well** (`well`): sunken, read-only content inside a card: a sealed Keychain value, a server's tool list, the stderr log of a failed check, and the Servers empty state's list of ways to add one.
- **Hairline Border** (`hairline-border`, navy at 10% in light): the 0.5px ring baked into card and raised shadows.
- **Rule** (`rule`): hairlines between card body and footer, between list rows, under the server list header, carve-out indents, the outline of New Profile, Everywhere else and an unselected Used by chip. Hairlines are 1px, or 0.5px on 2x displays. Rule is not a field stroke.
- **Primary Ink** (`ink-primary`): all reading text and folder leaf names.
- **Secondary Ink** (`ink-secondary`): supporting text, parent path segments, labels, placeholders, inactive segments and icons, the health line's summary, and an off shell's ring and name in the Shells control.
- **Tertiary Ink** (`ink-tertiary`): non-text strokes only. Used for the empty Everywhere else dot and the idle docket's dashed border at 45%.

### Named Rules
**The One Accent Rule.** At most one accent-filled button is visible per window state. On Profiles, the health banner's action outranks the check result's action, which outranks Check Folder… in the titlebar; whichever loses renders as a push button. With the profile inspector open, Save takes the accent and Check Folder… stands down. On Servers, Check Folder… is always a push button, a health banner shown there renders its action as a push button too, and the detail's footer action (Save, or Import N Servers) holds the accent; Save is disabled while the editor is clean. Two exceptions: a blocked banner's Check Again stays a push button, because the fix lives in the check result (Open ~/.zshrc and the like); with the result dismissed, Check Folder… takes the accent. An error banner's Try Again and the docket's Check Again (after a check that couldn't run, or beside the install command) are push buttons too, since Check Folder… stays the way to start over. In the docket only an action that fixes a problem takes the accent (Turn On, Open a file, Reinstall Shim, Edit or New Profile… for an agent no profile sets); Edit on Owned by, New Profile… on No profile owns this folder and Check Again only describe or retry, so they stay push buttons and Check Folder… keeps the accent. An unreadable config.json takes the accent whichever of its actions it offers, so a disabled Check Folder… never holds it: Open config.json, with Reveal in Finder (Show in Files off macOS) and Back Up and Start Over… beside it as push buttons until opening fails, when Reveal, which needs no editor, takes the accent (a failed Reveal or a refused Start Over moves nothing); or Try Again when there's no home folder to open it from.

**The Status-Free Palette Rule.** Profile colours never use red, amber or green, which belong to status, so a profile tag can't read as a verdict. Colours are keyed by profile id, so they survive renames and reordering, and a profile moves off its preferred colour only when another profile on screen already holds it.

**The Logo Tile Rule.** A server's brand colour lives only inside its ServerMark tile. It never becomes a dot, a wash, a text colour or an outline, so a red brand can't read as a problem and a server can't pass for a profile.

**The Fixed Mark Rule.** The mark's palette is fixed in its SVGs. It is not recoloured for a profile, the system accent or dark mode; below the folder, the lit branch is the only blue and the idle branch stays grey.

**The Readable Ink Rule.** `ink-tertiary` is never used for text that must be read. Its contrast is for strokes and empty-state marks only; readable secondary text uses `ink-secondary`.

**The Three-to-One Rule.** Anything that marks where a control is or where focus sits holds 3:1 against what's around it: the focus ring is solid accent ink, a text field's edge is `field-edge` (which holds 3:1 on the well too), not `rule`, and an off switch carries the same edge.

## Typography

**Body Font:** the macOS system font (-apple-system, SF Pro Text, with Helvetica Neue and sans-serif fallbacks)
**Mono Font:** ui-monospace (SF Mono, with Menlo fallback), contextual alternates off and tabular figures on

**Character:** Native Mac metrics at the scale of System Settings. Hierarchy comes from weight (400, 500, 600) and ink step, not size; the working ramp spans 11 to 14px, and two larger sizes exist for hero moments only.

### Hierarchy
- **Display** (600, 22px, 28px, -0.01em tracking): the first-run welcome's heading, "The folder decides". Nowhere else.
- **Heading** (600, 17px, 22px): the Servers detail heading when nothing is selected ("Add your first server", "Add a server").
- **Title** (600, 14px, 19px): profile card names, the inspector heading, Everywhere else, the server list heading ("Servers" with its count in 400 secondary ink), the Catalog and Import headings, and the server editor's heading, which is a server name and so is set in mono at title size.
- **Body** (400 or 500, 13px, 18px): the base size. Banner titles, setup heading, primary button labels, shell names, catalog entry labels, the Servers empty state's way labels and the Tools headline use 500; the docket headline uses 600 at body size. The app name in the titlebar is body size at 700, as macOS 27 sets a toolbar title.
- **Small** (400, 12px, 16px): banner detail, verdict notes, empty-state lines, card footers, segmented controls, carve-outs, Used by chips, server names in lists, catalog descriptions, the health line (its "Routing is on" at 500) and summary, the Shells control's names, and the Servers empty state's descriptions.
- **Label** (500, 12px, 16px, `ink-secondary`, sentence case): form labels, fieldset legends and section headings (Used by, Name, Connects with, Tools) in the inspector and server editor.
- **Caption** (400, 11px, 14px): agent variable names, field notes, the login-shell chip, setup step numerals, ⌘ shortcut hints, a server row's transport and tool count, tool descriptions, "off in", tool names in a profile's tool filter.
- **Mono** (400, 12px, 16px): paths, environment variables, server and tool names, commands and URLs. Paths split into a secondary-ink parent and a primary-ink leaf so the folder name reads first.

### Named Rules
**The Mono-for-Values Rule.** Mono is only for paths and values (folder paths, `NAME=value` pairs, binary locations, startup files, variable names, server and tool names, commands, URLs). Labels, headings and prose stay in the system sans; a catalog entry's display label ("GitHub") is sans, the name it saves as is mono. Mono text is selectable; the rest of the window is not.

**The Quiet Default Rule.** A default, empty or fallback state ("Every agent uses its default config", "No servers yet", "Not checked yet", "All tools", "In Keychain", placeholders) is set in italic secondary ink, so it reads as absence rather than content.

**The Hero Moments Rule.** `heading` and `display` belong to a view with nothing else to show yet: the first-run welcome and the empty server detail. A working surface never sets type above title size.

## Layout

A single native window with an overlay titlebar. The 52px titlebar band is draggable; the traffic lights are centred on it at `trafficLightPosition` x 18, y 24 (Tauri's y isn't the centre: y 24 lands the lights at 26.5, level with the icon and the view switch), and its content starts at an 86px inset. Left to right: the app icon (22px) and name, then 12px on the Profiles | MCP Servers segmented switch, then, pushed right with 8px between them, the Shells control, Editors… and Check Folder… (⌘O), each a 34px toolbar capsule. Editors… appears only when an editor on the machine has an agent extension EnvRouter can route. ⌘1 and ⌘2 switch views; both stand down while the profile inspector is open. Switching view closes either popover, and opening one closes the other.

Everything under the titlebar starts 8px below its edge, in both views and every health state, matching the 9px the toolbar capsules leave inside the band.

**Profiles view**, top to bottom under the titlebar: the health line (a 20px line on the ground while routing works, a banner card for any state that needs attention, or the three-step setup card for steps 2 and 3), a scrolling profile grid, and the docket along the bottom. Before the first profile there is no banner and no grid: the Welcome fills the view, centred. The window body does not scroll; only the grid does, with a soft fade mask at its top (10px) and bottom (18px) edges.

**Servers view**: the banner only when routing needs attention (not when it's on, loading or in setup), then a two-card split with a 12px gap, 16px side and bottom gutters and 8px at the top. The list card is 232px wide, 264px from a 820px window up; the detail card fills the rest. Both cards run full height; the list and the editor body scroll inside their cards while headers and footers stay put. Catalog and Import open in the detail card, so nothing sits more than one level deep. Checking a folder (⌘O, a drop, the menu bar) switches to Profiles, where the answer files.

- **Gutters:** 16px window gutter for banner, grid, server split and docket; 12px gap between cards; 20px padding inside the inspector and server detail, with 24px between their sections.
- **Grid:** `repeat(auto-fill, minmax(240px, 1fr))`. Cards have a 176px minimum height and stretch to their row.
- **Card interior:** header 10px vertical, 14px left; folder rows 4px by 6px; footer 8px by 14px under a hairline.
- **Server list:** header 8px vertical, 14px left, hairline under; rows inside 6px padding with 1px between them.
- **Server detail:** header 16px top, 12px bottom, 20px sides, hairline under; footer 12px by 20px on muted card under a hairline.
- **Overlays:** the profile inspector slides in from the right edge at `min(440px, 100% − 40px)`, full window height, with its body scrolling and Save pinned in a footer. The view stays in place behind a scrim (black 15%, 35% in dark). The Shells and Editors popovers hang from their own button, right edges aligned and clamped to the 16px gutter, `min(440px, 100vw − 32px)` wide.
- **Docket:** at least 60px tall. The verdict keeps a 300px minimum and the actions wrap underneath it in a narrow window rather than squeezing it. Its headline wraps rather than truncating; the folder path beside it gives way first, dropping to its own line and ending in an ellipsis. In a window under 520px tall the note keeps to one line (the full text in its tooltip), so a row of cards stays in view; each value carries its full text as a tooltip. While config.json can't be read there's no docket, since there's nothing to check against. The grid's scroller keeps a stable gutter, so a scrollbar appearing never reflows the cards.
- **Narrow window:** under 900px the app name hides (kept for screen readers); with three shells, under 760px the Shells control's names hide and its dots stay (the names kept for screen readers and in the popover). When the toolbar is still too tight (a text-spacing override at the minimum window), the Shells control is what gives way: its names truncate before Check Folder… would clip. Editors… is icon-only at every width. Check Folder… and the view switch always keep their text. The window's 680px minimum fits it all.

**Viewports that matter** (instead of 390 / 768 / 1440):
- **900 × 620**, the default window: a three-column grid; a 264px server list.
- **680 × 460**, the minimum window: a two-column grid; a 232px server list; the docket's actions wrap below the verdict, and the inspector still fits at full height.
- Check both views at both sizes in light and dark.

**Platform chrome.** One visual world on every system; only the parts the system owns change. They follow `SetupStatus.platform` (the user agent stands in until it loads, so the first frame already uses the right modifier), through `usePlatform()` in `src/lib/platform.ts`. The browser mock shows Linux with `?platform=linux`.
- **macOS:** the 52px band is the title bar: traffic lights, an 86px inset, the app icon and name. The ground is translucent over vibrancy. Shortcuts use ⌘ and read `⌘O`. Secrets are "In Keychain"; folders "Reveal in Finder". Closing the window keeps EnvRouter in the menu bar.
- **Linux (and WSL through WSLg):** the system draws a normal title bar that already names the app, so the band is only the toolbar: a 16px inset (the window gutter), no icon or name (the name stays for screen readers). The window is opaque, with the solid ground. Shortcuts use Ctrl and read `Ctrl+O`. The secret store is the "keyring" ("In the keyring", "Saved to the keyring"); folders "Show in Files". Closing the window quits, because a Linux desktop may have no tray to return from. Fonts fall back to the desktop's own (`system-ui`, Cantarell, Ubuntu, Noto; DejaVu or Ubuntu Mono). The accent still follows the system's `AccentColor` where WebKitGTK reports one.

**The mark's grid.** Both icon cuts sit on a 1024 grid with the plate as a continuous-corner squircle 824 wide (100 to 924 on both axes), centred, leaving the standard macOS margin for the system shadow.
- **Regular cut** (`app-icon.svg`): folder 400 wide (x 312 to 712, y 186 to 486), top centre. The track leaves from under it at y 470, runs down to the pivot (r 22) at y 598, and curves out to two coins (r 58) centred at y 790, idle at x 330 and lit at x 694. Track width 34, round caps.
- **Small cut** (`app-icon-small.svg`): the same composition drawn bolder. Folder 500 wide (x 262 to 762, y 150 to 530), track 72 wide from y 500, pivot r 40 at y 650, coins r 96 at y 800 (x 312 and 712). No account figures and no rail sheen.
- **Menu bar glyph** (`tray.svg`): an 18 × 18 viewBox (origin 2, 2.15) that hugs the folder, because tray-icon draws the image 18 pt tall whatever its size. Rendered at 36 × 36 px (2x).

## Elevation & Depth

Layered. Depth is structural and tells the surfaces apart: the window ground is flat (and, in the app, translucent over macOS's under-window vibrancy), cards sit on it with a hairline, a 1px contact shadow and a soft spread beneath, and raised surfaces (popover, inspector, check result) float with a deep, diffuse shadow. In light, shadows are tinted toward the same navy as the neutrals (`rgb(16 24 48 / …)`); in dark they are black. Every shadow carries a 0.5px hairline ring so edges stay crisp on both themes. Inside a card, sunken read-only content sits in a well rather than on another shadow. The app icon has its own three-step depth, drawn as SVG drop shadows in black: the plate lifts (0 10, blur 12, 28%), the folder and pivot drop above the track (0 10, blur 14, 45%), and the track and coins sit in contact with the plate (0 6, blur 7, 45%). The menu bar glyph has no depth; it is a flat template. Inset 1px rings, not shadows, mark the flatter containers (Everywhere else, New Profile, text fields, unselected Used by chips).

### Shadow Vocabulary
- **Card** (`0 0 0 0.5px hairline, 0 1px 2px rgb(16 24 48 / 0.05), 0 3px 10px -4px rgb(16 24 48 / 0.08)`; dark `…, 0 1px 2px rgb(0 0 0 / 0.35), 0 3px 10px -4px rgb(0 0 0 / 0.3)`): profile cards, the health banner, setup card, the server list and detail cards, the inspector's lists, the New Profile plus disc.
- **Raised** (`0 10px 30px -6px rgb(16 24 48 / 0.2), 0 2px 6px rgb(16 24 48 / 0.06), 0 0 0 0.5px hairline`; dark `0 12px 32px -6px rgb(0 0 0 / 0.6), …`): the Shells and Editors popovers, the profile inspector, the docket's check result.
- **Push** (`shadow-push`: `0 0 0 0.5px rgb(0 0 0 / 0.14), 0 1px 2px rgb(0 0 0 / 0.08)`; dark `0 0 0 0.5px rgb(0 0 0 / 0.5), 0 1px 2px rgb(0 0 0 / 0.3), inset 0 0.5px 0 rgb(255 255 255 / 0.12)`): push buttons at every size, and the icon tiles of the Servers empty state.
- **Primary** (`shadow-primary`: `0 1px 2px rgb(0 0 0 / 0.18), inset 0 0.5px 0 rgb(255 255 255 / 0.18)`; dark `0 0 0 0.5px rgb(0 0 0 / 0.5), 0 1px 2px rgb(0 0 0 / 0.3), inset 0 0.5px 0 rgb(255 255 255 / 0.22)`): the accent button. The 0.5px lit top edge is a control's upper rim catching the light, as macOS controls show it; in light it rides only on the accent fill.
- **Contact:** the switch knob, the selected segment (the toolbar's sliding thumb too) and a checked checkbox carry a small 0.5px-offset contact shadow.

### Named Rules
**The Three Layers Rule.** Every surface belongs to one of three layers: window ground, card, or raised. New surfaces pick a layer; they don't invent a fourth shadow. Vibrancy belongs to the ground alone: cards and raised surfaces are always opaque.

**The Outline Selection Rule.** Selection and drop-target states on cards use an outline (2px accent, 2px offset), never a box-shadow, because a card's own shadow utility would override a shadow ring. A drop target adds the accent tint behind the outline. Rows inside a card select with the accent tint instead.

## Shapes

Gently rounded, concentric corners. Cards, banners, the docket and the popovers use 12px, and so does the 48px plug tile; status tiles and the tools well use 8px; regular buttons, fields, icon buttons, folder rows and sealed wells use 6px. The bigger controls are capsules, as macOS 26 and later draw them: every toolbar item (34px), the view switch's track and thumb, and the large hero button (28px). Inside a 12px container, nested shapes step down (the Servers empty state's list well at 10px; server rows, popover rows, the small segmented track and the way tiles at 7px; segments at 5px; checkboxes at 4px). A profile card's header wash follows the card's top corners. Profile dots, shell dots, step numerals, the switch, the status badge, Used by chips and the login-shell chip are full circles or pills. A ServerMark's corner is a quarter of its size, never under 5px (9px at 36, 7px at 28, 5px at 20). The inspector panel is square-cornered because it is flush to the window edge, as macOS 27 runs inspectors edge to edge. The focus ring draws with a 6px radius.

The mark's plate is a continuous-corner squircle, not a rounded rectangle; its corners follow the macOS app-icon shape. Inside it everything is rounded: a Finder folder with a curved tab, a round-capped track, round coins and a round pivot. The menu bar folder uses 1.6-unit corner radii on its 18-unit grid.

Carve-outs and slips indent 13px under their parent folder with a hairline left rule; a profile's tool filter indents the same way under its server. The idle docket is the one dashed shape in the system (1.5px dashed). Icons come from Lucide (`src/components/icons.tsx`), rendered as inline SVG at 16px with a true 1.5px stroke (`absoluteStrokeWidth`), so 14px, 12px and 11px variants (folders, the plug, branches, chevrons, locks, transports) keep the same line weight.

## Components

### Buttons
Native push buttons, small and tactile.
- **Sizes:** regular, the form control: gently rounded (6px), 26px tall, 12px horizontal padding, 6px icon gap. Large: a 28px capsule with 16px padding, for a hero's one action (the Welcome's New Profile). Toolbar: a 34px capsule with 14px padding, for the titlebar's controls. Plain buttons are always regular.
- **Push:** button surface with the push shadow; hover darkens slightly (brightness 0.97), active to 0.9. A push button held open (the Shells control or Editors… while its popover is open) stays at 0.9.
- **Primary:** system accent with on-accent text at 500 weight and the primary shadow's lit top edge; hover brightens (1.05). Only one per window state (see The One Accent Rule).
- **Plain:** accent text with no fill, 8px padding pulled back into the margin; hover shows the accent tint. Used for in-row actions such as Undo, Replace, All On and All Off (the last three at 22px).
- **Icon button:** 26px square, borderless, secondary ink; hover adds an 8% ink wash and primary ink. Pressed (`aria-pressed`, such as Add from Catalog while the Catalog is open) takes the accent tint and accent ink, the selected-row treatment. Always carries an accessible label and tooltip.
- **Disabled:** 45% opacity, no pointer events. A button that must keep focus while busy (Check Server while running, Save while saving) takes `busy`: `aria-disabled` at the same 45%, ignoring presses.

### Chips
- **Login shell:** an accent-tinted pill with accent caption text, beside the default shell's name in the shells popover.
- **Used by:** one pill per profile in the server editor, 28px tall, small text, the profile dot leading. Off: secondary ink inside a 1px rule ring, the dot at 70%, a 5% ink wash on hover. On: primary ink on 16% of the profile's colour over the card with a 1.5px ring of the colour. The change runs 150ms on the settle curve. This is the one place a profile colour fills a control.

### Cards / Containers
- **Profile card:** card surface, 12px, card shadow, 176px minimum. Header: a wash of the profile's colour (7% light, 12% dark), profile dot, name (title), pencil icon button; when the profile is in the inspector the pencil becomes an accent "Editing" label, holding the pencil's 26px so the card doesn't shift, and the card takes the selection outline. Body: folder rows (folder icon, mono path, parent secondary and leaf primary), each followed by its carve-outs. Footer under a hairline: see Card footers under Iconography.
- **Carve-out:** small secondary text indented 13px with a hairline left rule: branch icon, relative path in mono, then the owning profile's dot (8px) and name aligned right.
- **New Profile:** a flat placeholder (inset 1.5px rule ring, no fill) with a 36px card-surface plus disc, label and ⌘N hint. Hover fills it with card surface and turns it accent; while creating, it shows the accent tint with a 2px accent ring.
- **Everywhere else:** muted card with an inset rule ring, no shadow and no header wash, an empty circle dot, and title in secondary ink. It always sits last.
- **Health line:** working routing doesn't ask for attention, so it isn't a card: a 20px line on the ground, a 16px status badge, "Routing is on in zsh and bash" at 500, and, right-aligned in secondary ink with tabular figures, what the map holds ("4 profiles · 6 folders · 6 MCP servers", servers left out at 0). While loading, the same 20px line holds a 12px `track` bar, 192px wide, that pulses only when motion is allowed, since working routing is the likeliest answer. Every health state, line or card, renders inside one persistent `role="status"` region, and every docket state is one polite live region, so a change is announced in place rather than as a new region appearing.
- **Health banner:** every other state: card surface, 12px padding: status tile, a one-line body-strong title, optional small detail, at most one accent action. An unreadable config.json adds a push Reveal and, only when the file won't parse, a push Back Up and Start Over… (confirmed first by a native sheet) beside Open config.json; a file from a newer EnvRouter or one that can't be read gets no Start Over. The actions wrap under the text when the window is too narrow for both. An error's Try Again sits beside its Dismiss icon. A save that went through but left something undone (the secret store wouldn't drop a secret nothing uses) is a warn banner, "Saved, with a loose end", with the store's reason and a Dismiss icon only.
- **Setup card:** the banner's form for setup steps 2 and 3: "Set up EnvRouter" over the three `SetupSteps` (done: green with a check; current: accent; upcoming: a `field-edge` ring) and the current step's single primary action.
- **Welcome:** step 1, before any profile, replaces both the setup card and the grid: a centred column at most 440px wide that rises in (300ms), with the welcome illustration at 136px (96px in a window under 520px tall), "The folder decides" in display, one sentence in secondary ink stating the rule (the agent commands in mono), the same `SetupSteps` centred, and a large primary New Profile with its shortcut hanging beside it in plain caption text, out of the layout, so the button sits on the column's axis. While the inspector is open over it, New Profile stands down to a push button, so Save stays the one accent.

### Inputs / Fields
- **Text field:** field surface, 6px, 28px tall, 8px padding, an inset 1px `field-edge` stroke; overflowing text ends in an ellipsis; placeholders in italic secondary ink. A mono variant holds paths and values at 12px.
- **Focus:** the stroke becomes a 1.5px inset accent ring (no outer focus outline).
- **Error:** shown inline as small problem-red text in the footer, never as a modal. Empty, it's the footer's spacer; once it says something it takes its own full-width row above the buttons (`Footer` in `ui.tsx`), so a sentence never squeezes between them. A save keeps Save focused (`Button`'s `busy`: `aria-disabled`, not `disabled`), and a saved server's editor reopens with focus on its row in the list.
- **Checkbox:** a drawn 14px box (4px corners) for rows whose whole surface is the label of a hidden native checkbox: unchecked, field surface with a 1px `field-edge` ring; checked, accent with an on-accent check (1.6px stroke) and a contact shadow. The row shows the hidden control's focus as the standard ring around the row (`focus-within-ring`).
- **Switch:** 28 × 16 pill, accent when on, 18% ink inside a 1px `field-edge` ring when off, with a white 13px knob that slides 12px over 150ms on the settle curve.
- **Segmented:** a `track` well with 2px padding; the selected segment is button surface with a contact shadow, the others secondary ink, primary on hover. Small size (7px track, 22px segments at 5px, small text) in the docket and the server editor, where the chosen segment simply lifts. Toolbar size for the titlebar's view switch: a capsule track of 30px capsule segments (body text, 14px padding) and one raised thumb that slides to the chosen segment over 200ms on the settle curve, as macOS 27's tabs do; under reduced motion it jumps, and under forced colours it takes `Highlight`. Segments may lead with an icon.
- **Keychain value:** every value field in the server editor carries a lock icon button at its right edge, in secondary ink; on (accent tint and accent), the value is masked and goes to the Keychain on Save. A new value under a name like `API_KEY` or `Authorization` starts with it on. A value already in the Keychain renders as a sealed well (6px, 28px): a lock, italic "In Keychain", and a plain Replace button; it is never shown or read back. With no secret store (`SetupStatus.secretStoreProblem`, off macOS: no Secret Service running, no Windows helper in WSL) the lock is disabled and every value shows as plain text, including one the editor marked for the store (by name, import, catalog, duplicate or Replace): `serverOf` saves it as plain text, deciding once for every path, a credential-looking one gets the plain-credential caution naming config.json, and the legend gives the store's reason. A store that is merely slow to answer isn't "no store": the lock stays on.

### Navigation
- **View switch:** the titlebar's toolbar-size segmented control, a capsule, Profiles (folder icon) and MCP Servers (plug icon), right of the app name. ⌘1 and ⌘2.
- **Titlebar:** the app icon (the small cut at 22px, 8px before the name) and the app name in body at 700; the view switch; then three toolbar capsules. **Shells**: each shell's state lives in the control that changes it, one capsule of dots and names (a green dot when on, an empty secondary-ink ring when off, a red cross when blocked; on names in primary ink, off ones in secondary) and a disclosure chevron that opens the Shells popover. Its accessible name begins with the visible names and goes on with a hidden ", Shells: zsh on, bash off", so speech input matches what's on screen. **Editors…**: an icon-only 34px capsule, its name the label and tooltip. **Check Folder…** (⌘O): its icon and label. Check Folder… takes the accent only on Profiles and only when nothing outranks it; its label always reserves the accent's 500-weight width, so the toolbar doesn't shift as it stands down.
- **Server links:** a server name in a profile card's footer opens that server's editor in Servers.

### Iconography
One vocabulary, so a glance says what a row is:
- **Agents** wear their own marks (Simple Icons, CC0): Claude's starburst and the Copilot face, monochrome in ink colour, at 14px in card footers and the inspector and 12px in the docket's Agent segments. An agent without a mark gets Lucide's bot.
- **MCP** is the plug: the MCP Servers segment, a card footer's server line, and the Servers empty state's tile once the library has servers.
- **Servers** wear a ServerMark (below), never the plug, wherever one server is listed.
- **Transports**: a terminal for Command, a globe for HTTP, a radio tower for SSE, on server rows and catalog entries (11px) and the Connects with segments (12px).
- **Actions**: a down chevron closing the Shells control (it opens a popover), code brackets for Editors…, a folder with a lens for Check Folder…, a plus for Add Server, a package for the catalog, an import arrow for Import, a pulse for Check Server, a lock for the Keychain.
- **Card footers** are a two-column list: the mark, then the value in mono. Each agent line shows its config folder; the plug line lists the profile's servers, each name a link with a resting underline (28% ink, 3px offset) that turns accent on hover. More than three servers show the first two and "+N", which expands the list in place and moves focus to the first name it revealed. The label lives in the tooltip and for screen readers. A profile that routes no agent says so in quiet italic; above a plug line it starts in the value column.

### ServerMark
A server's face: its brand logo (Simple Icons path, 56% of the tile) in the brand colour on a tile of 13% of that colour over the card, or the ink colour for a near-black or near-white brand; a server with no brand gets its initial (46% of the tile, semibold, secondary ink) on the `track` colour. The protocol's own reference servers wear the MCP logo; a Docker command wears Docker's. Sizes: 36px in the server editor header, 28px in the server list, catalog and import, 20px in a profile's MCP checklist. An imported server already in the library fades its tile to 50%, never its text.

### Server List
The left card of the Servers view. Header: "Servers" (title) with its count in regular secondary ink, then Add Server, Add from Catalog, Import from Your Agents and Paste JSON as icon buttons. The last three open their view in the detail card and, pressed again, close it; leaving a view any way puts focus back on its button. Rows (7px): a 28px ServerMark, the name in mono small, and a caption line with the transport icon, its label and, once checked, "· N tools"; at the right, the dots (8px) of up to four profiles that load it. Hover is a 5% ink wash; the selected row takes the accent tint and its name turns accent. Empty: "No servers yet" in quiet italic.

### Server Editor
The detail card for one server, fading in over 160ms. Header under a hairline: a 36px ServerMark, the name in mono title and its command or URL in mono caption ("Not set up yet" until it has one). Body, in order:
- **Used by:** the profile chips, then a caption naming what they do. First, because it's the part people change most.
- **Name:** a mono field with a caption on the allowed characters.
- **Connects with:** a small segmented control (Command, HTTP, SSE) with transport icons.
- **Command, Arguments, Environment** (one mono field per argument; name/value rows for variables) or **URL, Headers**, each list with remove buttons and an Add push button; values carry the Keychain lock.
- **Lock legend:** a caption under the label of the first list that has values, before its rows: "Click [lock icon] to keep a value in the Keychain instead of config.json". The lock's native tooltip comes up too slowly to explain it. With no secret store it reads "The lock is off. The keyring can't keep a value: " and the store's own reason, then "Values are saved in config.json."
- **Caution rows:** tucked under the field they're about: a well (8px) with a 20px warn StatusTile, one line in small secondary ink, and at most one push button. Under Arguments, for a `docker run` or `podman run` without `--init` (Add `--init`); under Arguments or the URL, for a value that looks like a credential but would be saved as plain text (an `--api-key=` argument, a connection string with a password, a key in the URL's query), naming where and how to move it; under Arguments, for an `npx` package without one exact version (Pin Version, which reads Looking Up… while npm answers). A pinned package gets no caution: a line in small secondary ink, "Pinned to 1.2.3" with the version in mono primary ink, and a plain Check for Update; once npm has answered, "1.4.0 is out." with an Update to 1.4.0 push button, or ", the newest release." with no button. Import rows carry the same credential line in caption with a 14px warn tile. One caution row sits at the top of the server editor instead, about the whole server: while the editor holds unsaved edits and config.json changed or dropped that server underneath it (the CLI, a hand edit), "config.json changed this server after you started editing. Saving replaces that change; Revert shows it." (or "config.json no longer has this server. Saving adds it back."), announced as a status.
- **Tools:** see below.

Footer on muted card: Delete… and Duplicate (a saved server only; it opens a new server with the same definition, secrets kept by name but empty), inline error, Revert (Cancel for a new server) and Save as the accent button. Revert and Save are disabled while nothing has changed. Leaving with unsaved edits asks first.

### Tools Section
How the server answered. A 28px status tile and a body-strong headline: the tool count (ok), Needs a sign-in (warn), Didn't answer (problem), Not checked (neutral, for SSE), Can't check yet (problem, the form is incomplete), or Starting the server… (pending). The last good check's count shows with "from the last check" in small secondary ink until a new one runs. Then a Check Server (Check Again) push button. A message follows in small secondary ink; a failed server's last stderr lines sit in a well, mono caption, at most 120px tall. A disclosure ("Show all N tools" / "Hide tools", chevron rotating 90° over 150ms) opens the list; it starts open for eight tools or fewer and keeps the user's choice. The list is a well (8px) of rows at least 32px tall with hairlines between: the tool name in mono small, its description in caption, and at the right "off in" with the dots of the profiles that turn it off. Editing the form clears a fresh result.

### Catalog and Import
Shown in the server detail card, each with a header (title and a close button that takes focus on open, except in the Catalog, whose search does; Escape closes).
- **Catalog:** the header counts the entries shown. Under it, fixed while the list scrolls: a search field (search icon inset, italic placeholder) that takes focus on open, where Escape clears a search before it closes the view; then two small segmented filters, All · Hosted · Runs locally and All · No sign-in · Sign-in · Secret. The list sits on the sealed `well` (8px, hairline-ruled rows), never a card inside the detail card, sorted by label: a 28px ServerMark, the label at 500, then in caption where it runs (globe Hosted, the vendor runs it at a URL; laptop Runs locally, the agent starts it on this machine, even when it calls the vendor's cloud; a loopback URL counts as local) and what it needs (lock "Needs a secret", sign-in arrow "Sign in with /mcp" or "Signs in" for a vendor's own sign-in, open lock "No sign-in"), "In the library" when the same server is already there, a description in small secondary ink, and a chevron. No match: a well with italic "No servers match" and a plain Clear Filters button. Picking one opens the editor prefilled, its secret fields empty and masked, with the expected format as the placeholder.
- **Import:** a list on the `well`, like Catalog, of the servers the agents already define, one checkbox row each: the name in mono (with "`name` is taken" when it was renamed, `github-2`), its command or URL, "from" the file, and which values go to the Keychain. Ones already in the library fade their box and tile and read "In the library"; a value the library keeps in the secret store matches whatever the agent's file holds there, so a server imported once isn't offered again under a new name. Pasted servers have no "from" line. Footer on muted card: inline error, Cancel and "Import N Servers" as the accent button. Source files are never changed.
- **Paste JSON:** a server's config as a README or an agent's file writes it (`mcpServers`, VS Code's `servers`, a bare table, one unnamed server, comments allowed). A mono text area in the field style fills the body, its example in the italic placeholder, with a one-line caption on what it reads. The search-style rule applies: the area takes focus on open. Footer on muted card: inline error, Cancel and Continue as the accent button (⌘Return too). One server opens the editor prefilled, named from its host or package; several open the Import review titled "Import Pasted Servers", with a line naming any it left out. Either way, credential-looking values head for the Keychain and containers get `--init`.
- **Nothing selected:** a hero centred in the detail card, at most 420px wide, fading in over 160ms. An empty library starts from its illustration (112px; 64px under 520px tall), as first run does; with servers in the list, a 48px plug tile on `track`. Then a heading ("Add your first server" or "Add a server") and one small secondary line. Then the four ways as one list on the `well` (10px, hairlines between rows): a 28px button-surface icon tile (7px, push shadow), which lifts off the well in both themes, whose glyph turns primary on hover, the label at 500 (Add from Catalog…, Import from Your Agents…, Paste JSON…, Add by Hand…), a small secondary line on what it starts from, kept to one line at the minimum window, and a chevron. Rows wash with 4% ink on hover; focus draws inside the row. Under 520px tall the plug tile drops to 40px, the list's gap above it to 12px and each row's padding to 8px, so the four ways fit.

**The Both Sides Rule.** Which profiles load a server is editable from both ends: a profile's MCP checklist and tool filter in the inspector, and a server's Used by chips in the editor. Both write the same profile data; keep both doors, and keep the result visible on the cards (the footer's server links) and on the server rows (the profile dots).

### Status Tile
The shared status mark for the banner (32px) and the check result and Tools section (28px): an 8px-rounded tile washed with 14% of the status colour, holding a 1.8px stroke glyph whose shape states the result. Check is ok, bang is warn, cross is problem, dash is neutral (no profile owns the folder; a server not checked), and a dashed circle pulsing at 1.1s is pending. A new verdict stamps in (scale 1.35 to 1, 180ms). Under reduced motion the stamp is a fade, and the pending pulse holds still at 60% opacity. The badge variant is a solid disc of the status colour holding a white glyph in light and a `window-ground` glyph in dark, where the green is too pale for white (2.4px stroke, 62% of the disc), for a one-line status where a pale tile would wash out; the health line uses it at 16px. A done setup step's disc takes the same glyph colours. Under forced colours it takes a `CanvasText` border and glyph.

### Docket
The floating check result along the bottom of Profiles, one complete state at a time, never a log.
- **Idle:** a dashed drop zone (1.5px dashed, tertiary ink at 45%) with the drop icon and a one-line instruction in secondary ink.
- **Hovering a drag:** accent tint, accent text and a 1.5px accent ring: "Release to check" plus the path.
- **Result:** raised surface, rises in over 180ms: status tile, headline and folder path, then a note and `label value` pairs in mono, then the verdict's single action, Agent and Shell segmented controls, and Dismiss.
- **Copy:** from `src/lib/verdict.ts`. One terse headline ("Routed to Work", "Another claude comes first on PATH"), an optional plain sentence that says what to change, the values behind it (`sets`, `via`, `mcp`, `runs`, `instead of`, `defined in`), and at most one action labelled as a verb ("Turn On zsh", "Open ~/.zshrc", "Reinstall Shim", "Edit Work…", "New Profile…", "Check Again"). A profile's name in a label is truncated at 16rem and shown whole as the button's tooltip. "Edit Work…" and "New Profile…" open the inspector (the new one starts with the checked folder as its trigger); an agent that isn't installed gets Check Again and, as an `install` value in mono that can be selected and copied, the vendor's one-line installer from `agents.json`. A routed verdict has no action: when it works, it stays out of the way.

### Slip
The signature interaction of Profiles. A checked folder becomes a slip filed in the owning card (or Everywhere else): accent-tinted row with a 40% accent inset ring, a state mark (filled accent dot when routed, red cross on a problem) and the mono path. It animates from the drop point into its slot over 300ms on the settle curve, the card it will land in lights up with the drop-target outline before release, and then the status tile stamps.

### Profile Inspector
The only profile editor: a raised panel sliding in from the right (220ms), over a scrim that keeps the view visible. It's a modal dialog to assistive tech (`role="dialog"`, `aria-modal`), traps focus, and on close returns it to the pencil that opened it. Header: profile dot (12px), name, close. Body: Name field (32px, title size), Trigger folders as a card list with remove buttons that strike rows through (Undo) until saved, Add Folder…, then one mono path field per agent with its variable name and Choose…, then MCP servers.

**MCP checklist:** the library as a card list, one row per server: a hidden native checkbox labelled by the whole row, the drawn 14px box, a 20px ServerMark, the name in mono (primary ink when on, secondary when off) and its command or URL in mono caption, truncated. A caption under it names the agents that load them. With no servers, a quiet line points to Servers (⌘2).

**Tool filter:** under each checked server, aligned past its checkbox. When the server has been checked, a disclosure ("7 of 9 tools on", or "All 9 tools") opens a nested checklist indented on a hairline like a carve-out: 28px rows with the drawn box, the tool name in mono caption (struck through and secondary when off) and its description; All On and All Off sit as plain buttons beside the disclosure. Without a checked tool list it reads a quiet "All tools", or how many are off. Footer on muted card: Delete… and Duplicate (a saved profile only; it opens a new profile named "‹name› copy" with the same agents, servers and turned-off tools but no folders, since a folder belongs to one profile), inline error, Cancel, and Save as the accent button. A profile card's context menu offers Duplicate Profile… too. Escape cancels.

### Shells Popover
A raised panel hanging from the Shells control, right edges aligned, that opens with a 4px drop (140ms): one row per shell with its name, login-shell chip, startup files in mono, and a switch; an unavailable shell has no switch: its name steps down to secondary ink and "Not installed" (quiet italic) stands in for the startup files. Opening it, by pointer or keyboard, moves focus to its first control, as a native popover takes it; tabbing out past either end closes it, so focus never sits on a control the panel covers. Escape returns focus to the button that opened the popover. A hairline footer states what the app edits, or the error. The Editors popover behaves the same way.

### The Mark
The app icon and menu bar glyph, drawn by hand as SVG in `src-tauri/icons/` and rendered into every raster at its exact pixel size with a transparent background.
- **Regular cut** (`app-icon.svg`): 128 px and up: `128x128.png`, `256x256.png`, `icon.png` (512), and the 128 to 1024 px members of `icon.icns`.
- **Small cut** (`app-icon-small.svg`): 64 px and under: `32x32.png` and the 16, 32 and 64 px members of `icon.icns`, assembled through an `iconutil` iconset.
- **Menu bar glyph** (`tray.svg` to `tray.png`, 36 × 36): loaded by `tray.rs` with `icon_as_template(true)`. A solid black folder masked by the fork: the lit branch (stem, curve) and a 1.8-radius coin are cut fully through (mask #000, alpha 0); the idle branch is half cut (mask #808080, alpha 0.5) and has no coin. Branch strokes are 1.6 wide with round caps.
- **In the window:** the small cut, imported straight from `app-icon-small.svg`, at 22px before the app name in the titlebar, centred with the traffic lights. Nowhere else; the Welcome and the empty Servers detail use the illustrations below.
- **Provenance:** every top-level PNG carries a `impeccable:prompt` text chunk naming its SVG source and size.

**The Two Cuts Rule.** The mark is drawn twice on one grid. Sizes of 64 px and under use the small cut (thicker track, solid coins, no figures); 128 px and up use the regular cut. Never downscale the regular cut into a small slot.

### Illustrations
Two drawings in `src/assets/` open the mark up where the window has nothing else to show, imported as images at fixed sizes. Both are drawn on the mark's 1024 grid with its folder, track, pivot and coins copied from `app-icon.svg`, and without its plate, so they sit on a card or the ground in either theme.
- **Welcome** (`welcome.svg`, 136px): the folder, its track forking to two accounts with the right one lit, and a terminal window whose prompt is the lit route's blue: a command run there gets that account.
- **Empty library** (`servers-library.svg`, 112px): the folder, its track forking three ways (all lit) to three servers drawn as app-icon tiles holding Lucide's plug, terminal and globe in white.
- **Off the plate:** shadows are navy-tinted and lighter than the icon's (`#101830` at 24% for the drop, 28% for contact), since the icon's black ones are drawn for its dark plate. The near-white pivot takes a 6-unit ring of the lit route so it holds on a white card. The idle branch and coin take the small cut's lighter greys (#56627f; #5e6a87 to #4e5a76) so they read on the dark ground. Tiles and the terminal are a navy gradient (#2a3754 to #141c2e) with a 3-unit #9fb6ff rim at 30%, which separates them from a dark card; the terminal's window dots are a neutral grey, never red, amber and green, which would read as status.
- They never theme: one drawing serves light and dark, like the mark.

**The Alpha-Only Rule.** The menu bar glyph is a template image: macOS reads only its alpha and paints it for the menu bar's appearance. Every inner shape is a mask cutout, full for the lit route and half for the idle one; colour inside the glyph means nothing.

**The Rendered-From-Source Rule.** Rasters are outputs of the SVGs, rendered one size at a time. They are never edited by hand and never regenerated from a single source.

## Do's and Don'ts

### Do:
- **Do** keep exactly one accent button per window state: on Profiles, the banner action, then the check result's action, then Check Folder…; on Servers, the detail footer's Save or Import; every other action is a push or plain button.
- **Do** pair every status with a shape as well as a colour: check (ok), bang (warn), cross (problem), dash (neutral), dashed ring (pending).
- **Do** give each profile an id-keyed colour from the eight profile hues, shifting it only when two profiles on screen clash, and wash its card header with it (7% light, 12% dark).
- **Do** keep server brand colour inside its ServerMark tile, and give an unbranded server its monogram on the track colour.
- **Do** set paths, names, variables and values in mono and keep them selectable; everything else stays system sans and unselectable.
- **Do** draw the titlebar's controls as 34px toolbar capsules, keep form buttons at 26px and fields at 28px, and give a hero's one action the 28px large capsule.
- **Do** show working routing as the quiet 20px line on the ground; a card is for a state that needs attention.
- **Do** edit profiles in the right-side inspector, with the view visible behind it and the edited card outlined.
- **Do** edit servers in the Servers view's detail card beside the list, and open Catalog and Import in that same card.
- **Do** keep server assignment editable from both the profile inspector and the server's Used by chips.
- **Do** make a server name in a card footer a link to its editor.
- **Do** mark card selection and drop targets with a 2px accent outline at 2px offset (plus the tint for a drop target); select rows inside a card with the accent tint.
- **Do** use the solid 2px accent focus ring at 2px offset, and draw it around a row whose hidden native control has focus.
- **Do** stroke text fields with `field-edge` so they hold 3:1.
- **Do** put sunken read-only content (a sealed secret, a tool list, a server log) in a well, not on another card.
- **Do** keep cards and raised surfaces opaque; only the ground and titlebar band let vibrancy through.
- **Do** take icons from `src/components/icons.tsx` (Lucide at a true 1.5px stroke, agent marks from Simple Icons), and add a new one there rather than drawing it inline.
- **Do** show the idle docket as a dashed drop zone, and the result as a single raised card.
- **Do** keep motion on the settle curve (`cubic-bezier(0.16, 1, 0.3, 1)`) between 140 and 300ms. Under reduced motion keep the fades and drop the movement: the slide, drop, rise and stamp keyframes become fades, transitions skip transforms (a switch's knob and a chevron jump), scrolling is instant, and pending marks hold still.
- **Do** keep every edge and state visible under forced colours (`forced-colors: active`), where shadows and tints drop out: cards and raised surfaces get a 1px `CanvasText` outline, buttons and fields a `ButtonText` border, and a control whose state is a fill (a switch, the selected segment or the view switch's thumb, a checked box, an on shell's dot, the current setup step) takes `Highlight` with `forced-color-adjust: none`.
- **Do** verify both views in both themes and a non-blue system accent at 900 × 620 and 680 × 460, and check vibrancy in the real app window.
- **Do** render each icon raster from its SVG at its exact pixel size: the small cut for 64 px and under, the regular cut for 128 px and up, and `tray.svg` at 36 px.
- **Do** make every inner shape of the menu bar glyph a mask cutout: full for the lit branch and its coin, half (alpha 0.5) for the idle branch.
- **Do** check the mark at 16 and 32 px and the glyph in a light and a dark menu bar after any change.

### Don't:
- **Don't** use red, amber or green for a profile colour; those belong to status.
- **Don't** let a server's brand colour leave its tile as a dot, wash, text colour or outline.
- **Don't** signal status with colour alone.
- **Don't** use mono for labels, headings or prose.
- **Don't** edit a profile inline in the grid; the user rejected it because the editor got hidden.
- **Don't** bring back the MCP Servers… button or a slide-over library that drills down a level at a time; servers live in their own view.
- **Don't** turn the window into a sidebar app; Profiles keeps the whole map on screen.
- **Don't** use a box-shadow ring for card selection or drop target; the card's own shadow overrides it.
- **Don't** use a translucent focus ring or a `rule`-coloured field stroke; both fall under 3:1.
- **Don't** make cards or raised surfaces translucent.
- **Don't** use Unicode glyphs (✓, ✗, ⚠, →) as icons. ⌘ shortcut notation in a `kbd` is text, not an icon, and is fine.
- **Don't** use `ink-tertiary` for any text that must be read.
- **Don't** put a second accent-filled button on screen.
- **Don't** return to the flat, hairline-ruled sheet or to a System Settings sidebar-and-switches layout; surfaces must stay visibly layered.
- **Don't** set `heading` or `display` type on a working surface; they're for the welcome and an empty detail only.
- **Don't** add help paragraphs; a verdict is one headline, one note, its values and one action.
- **Don't** run `tauri icon`: it rebuilds every size from one source, losing the small cut and the provenance, and recreates the Windows tiles.
- **Don't** draw the menu bar glyph's cutouts with white fills; a template reads only alpha, so white paint renders as solid.
- **Don't** recolour the mark per profile, per system accent or per theme, or use the profile palette as a set in it.
- **Don't** make the mark a terminal prompt, a config gear or a generic folder with a badge.
- **Don't** size `tray.svg`'s viewBox with padding around the glyph; tray-icon scales the whole image to 18 pt, so padding shrinks the folder.

### Known drift (not intent)
- The New Profile card's creating state, the hovering docket, and the whole-window drag ring use inset or outer box-shadow rings rather than outlines. They don't sit under a card shadow, so they render, but they predate The Outline Selection Rule.
- The inspector's Name field overrides the field height and size with `!important` (32px, title size); it's a one-off, not a second field size.
