---
name: Veritas
description: A wall of generated Los Santos key art for a FiveM admin panel read at 2am beside a running game.
colors:
  asphalt-ground: "#0D0C0B"
  asphalt-surface: "#171614"
  asphalt-surface-2: "#211F1C"
  asphalt-surface-3: "#2B2825"
  asphalt-border: "#262320"
  asphalt-border-strong: "#3A3631"
  bone: "#EDE9E1"
  bone-muted: "#B3ACA3"
  bone-faint: "#918A80"
  signal-live: "#48E08A"
  signal-unknown: "#F5A623"
  signal-debit: "#F0503C"
  chrome-focus: "#FFFFFF"
  sky-dusk-zenith: "#2B1B4D"
  sky-dusk-horizon: "#7B2D6B"
  sky-sodium-zenith: "#3A1F0C"
  sky-sodium-horizon: "#B4551A"
  sky-palm-zenith: "#06342E"
  sky-palm-horizon: "#1E8F76"
  sky-smog-zenith: "#3B2430"
  sky-smog-horizon: "#A3596B"
  sky-ocean-zenith: "#08243F"
  sky-ocean-horizon: "#1C6C9E"
  sky-vinewood-zenith: "#2A0E20"
  sky-vinewood-horizon: "#8E2B4B"
  sky-chaparral-zenith: "#2E2A10"
  sky-chaparral-horizon: "#8A7A22"
  sky-storm-zenith: "#1A2030"
  sky-storm-horizon: "#4A5C78"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(2.25rem, 5.4vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 78"
  headline:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.75rem, 3.6vw, 3.25rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 78"
  title:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 100"
  wordmark:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "0.16em"
    fontVariation: "'wdth' 70"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
    fontVariation: "'wdth' 100"
  body-small:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.14em"
    fontVariation: "'wdth' 105"
  measure:
    fontFamily: "'Spline Sans Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
rounded:
  tile: "5px"
  control: "5px"
  panel: "8px"
  inner: "4px"
  pill: "999px"
spacing:
  s-1: "0.25rem"
  s-2: "0.5rem"
  s-3: "0.75rem"
  s-4: "1rem"
  s-5: "1.5rem"
  s-6: "2rem"
  s-7: "3rem"
  s-8: "4rem"
  gutter: "clamp(1rem, 3.2vw, 2.75rem)"
  rail-gap: "0.625rem"
components:
  home-wordmark:
    typography: "Archivo 800, wdth 70, uppercase, tracking 0.1em"
    fontSize: "clamp(2.5rem, 6vw, 4.5rem)"
    textColor: "{colors.bone}"
  home-chip:
    backgroundColor: "rgba(13, 12, 11, 0.66)"
    borderColor: "{colors.asphalt-border-strong}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 0.75rem"
    typography: "{typography.body-small}"
  destination-row:
    backgroundColor: "{colors.asphalt-surface}"
    borderColor: "{colors.asphalt-border}"
    padding: "1rem"
    maxWidth: "56rem"
  section-tab:
    textColor: "{colors.bone-faint}"
    typography: "{typography.micro-caps}"
    padding: "0.75rem 0.75rem calc(0.75rem - 2px)"
    borderBottom: "2px solid transparent"
  section-tab-active:
    textColor: "{colors.bone}"
    borderBottom: "2px solid {colors.focus-white}"
  section-tab-live:
    dotColor: "{colors.live-green}"
    dotSize: "0.4375rem"
  button-default:
    backgroundColor: "{colors.asphalt-surface-3}"
    textColor: "{colors.bone}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "2.5rem"
    typography: "{typography.body}"
  button-default-hover:
    backgroundColor: "#36322C"
    textColor: "{colors.bone}"
  button-primary:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.asphalt-ground}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.chrome-focus}"
    textColor: "{colors.asphalt-ground}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.bone-muted}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "2.5rem"
  button-ghost-hover:
    backgroundColor: "{colors.asphalt-surface-2}"
    textColor: "{colors.bone}"
  button-disabled:
    backgroundColor: "{colors.asphalt-surface}"
    textColor: "{colors.bone-faint}"
  button-small:
    height: "2.125rem"
    padding: "0 0.75rem"
    typography: "{typography.body-small}"
  input-text:
    backgroundColor: "{colors.asphalt-surface-2}"
    textColor: "{colors.bone}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2.5rem"
  input-text-disabled:
    backgroundColor: "{colors.asphalt-surface}"
    textColor: "{colors.bone-faint}"
  panel:
    backgroundColor: "{colors.asphalt-surface}"
    textColor: "{colors.bone}"
    rounded: "{rounded.panel}"
    padding: "1rem"
  tile:
    backgroundColor: "{colors.asphalt-surface-2}"
    textColor: "{colors.bone}"
    rounded: "{rounded.tile}"
    width: "11.5rem"
  pill-live:
    backgroundColor: "rgba(72, 224, 138, 0.13)"
    textColor: "{colors.signal-live}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.75rem"
    typography: "{typography.label}"
  pill-unknown:
    backgroundColor: "rgba(245, 166, 35, 0.12)"
    textColor: "{colors.signal-unknown}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.75rem"
    typography: "{typography.label}"
  segment-selected:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.asphalt-ground}"
    rounded: "{rounded.inner}"
    height: "2rem"
  segment-selected-debit:
    backgroundColor: "{colors.signal-debit}"
    textColor: "#1A0704"
    rounded: "{rounded.inner}"
    height: "2rem"
---

# Design System: Veritas

## Overview

**Creative North Star: "The Night Wall of Los Santos"**

Veritas is a catalog of people, read the way its admin reads everything else on the second monitor at 2am: a wall of horizontally scrolling rails of poster tiles on warm asphalt, where the tile under the cursor swells and tells you what it is while the rest of the wall steps back. The ground is deliberately warm near-black (#0D0C0B), not the blue-black the streaming skin defaults to, and the chrome carries no hue at all. Every saturated colour on screen comes from somewhere else: the generated key art. Characters in this product have no artwork, so the artwork is computed from the citizen ID — one deterministic Los Santos sky per record, the same one forever — which makes the image a recognisable property of the data rather than decoration.

The density is operational, not editorial. Controls stand 40px tall because they are clicked mid-session with a game running behind them; the type ramp holds seven fixed steps and admits no in-between sizes; the page never scrolls sideways, only the rails do. Depth is real: an offset-and-blur shadow under the focused tile, a hairline shadow under panels, never a zero-offset halo pretending to be light. Motion is rationed to one authored moment (focus expansion) and it is switched off entirely under `prefers-reduced-motion` and on touch, where no hover exists to carry it.

The system's discipline is that colour and wording never bluff. Three signals exist and no more, each stated in words before it is stated in hue, because the product's load-bearing distinction — "not on the server" versus "we cannot verify" — must survive a colourblind reader and a monochrome screenshot.

**Key Characteristics:**
- Warm asphalt ground (#0D0C0B), dark-only, chosen from the 2am use scene rather than category habit.
- All saturation lives in the generated plates; the chrome is achromatic bone with one pure-white accent.
- Exactly three semantic signals, each worded first and hued second.
- Archivo run across its width axis (78 / 100 / 105 / 70) instead of across a second typeface.
- Spline Sans Mono strictly for measurement: IDs, amounts, timestamps, counts.
- 2:3 poster tiles on rails; one authored motion moment; everything else still.

## Colors

A monochrome warm-grey instrument panel with three signal lamps, hung in front of a wall of saturated generated skies.

### Primary
- **Bone** (`{colors.bone}`): every heading, body line and record value; the fill of the primary button and of the selected state in the segment control and grade ladder, where it inverts to asphalt text. Bone, not white — white is reserved.
- **Chrome White** (`{colors.chrome-focus}`): the single chrome accent. The 2px inset ring on a selected tile, the 2px focus-visible outline, the border of a focused field, and the primary button's hover. Nothing else in the chrome is pure white.

### Secondary
The three semantic signals. Each appears as a full-strength text/border hue, a ~0.13 alpha fill and a ~0.42 alpha line; the frontmatter carries the full-strength value and the soft pair is derived from it.
- **Live Green** (`{colors.signal-live}`): "On the server now" — the online rail heading and its pulse, the LIVE tile badge, the bridge pill when the link is up, the success note, an upward money preview, a live write in the session ledger. Also the caret and form `accent-color`.
- **Unverified Amber** (`{colors.signal-unknown}`): the bridge unreachable, the "Unverified" tile badge, the "Status unverified" pill, the warn note, an offline write in the ledger. Never used for "offline".
- **Debit Red** (`{colors.signal-debit}`): the pressed Remove segment (on near-black #1A0704 text), a downward money preview, the error note. It marks money leaving and failures, nothing else.

### Tertiary
- **The Sky Palette** (eight duotones, `{colors.sky-*}`): dusk, sodium, palm, smog, ocean, vinewood, chaparral, storm. Each is a zenith→horizon gradient plus a light colour and a land silhouette, selected by hashing the citizen ID. This is where the product's colour actually comes from; it is part of the system, not per-image art direction. Sky colours never appear in chrome, and chrome colours never appear in a plate.

### Neutral
- **Asphalt Ground** (`{colors.asphalt-ground}`): the page, the topbar at 0.92 alpha over a 14px blur, the scrim gradients, the `theme-color` meta.
- **Asphalt Surface / 2 / 3** (`{colors.asphalt-surface}`, `{colors.asphalt-surface-2}`, `{colors.asphalt-surface-3}`): panel body; field, ladder, segment and preview wells plus the tile's art placeholder; default button fill, scrollbar thumb and ladder hover.
- **Border / Border Strong** (`{colors.asphalt-border}`, `{colors.asphalt-border-strong}`): internal hairlines between panel head, body and foot; the stronger line for anything the user can touch (fields, ladder, segment, pills, balance cards).
- **Bone Muted** (`{colors.bone-muted}`): secondary copy, field labels, ladder rest state, the `<select>` caret.
- **Bone Faint** (`{colors.bone-faint}`): hints, placeholders, timestamps, counts and disabled text. Raised to #918A80 so it clears 4.5:1 on the panel surface.

### Named Rules
**The Colour Lives in the Picture Rule.** Saturation belongs to the generated plates and to the three signals. Running prose, record data and every chrome surface stay achromatic. If a new surface needs a colour to be interesting, it needs a plate, not a hue.

**The Word Before the Hue Rule.** No state is carried by colour alone. Green is always accompanied by "On the server now" or "Applied live"; amber always by "Status unverified" or "Unverified"; red always by a written direction or failure. A screenshot in greyscale must still read correctly.

**The Three Lamps Rule.** There are exactly three signal hues. "Not on the server" is a *neutral* state and gets bone, never amber — amber means unverified, and collapsing the two would erase the product's core distinction.

**The Reserved White Rule.** Pure white appears only where the system says "this one, right now": selection ring, focus ring, focused field border, primary hover. It is never a text or surface colour.

## Typography

**Display Font:** Archivo Variable, self-hosted (with system-ui, -apple-system, Segoe UI)
**Body Font:** Archivo Variable, same family at `wdth` 100
**Label/Mono Font:** Spline Sans Mono Variable, self-hosted (with ui-monospace, Cascadia Mono, Consolas)

**Character:** One grotesque, driven across its width axis instead of across a second typeface — condensed heavy caps for names and titles, normal width for interface copy, slightly extended for tracked micro-caps. The mono is an instrument face, not a costume: it appears only where a value is being measured. Both families ship from `/public/fonts` as subset woff2 because the panel often runs on a LAN with no internet, where a CDN font would be silently replaced by system-ui.

### Hierarchy
- **Display** (800, `clamp(2.25rem, 5.4vw, 4.25rem)`, 1.08, `wdth` 78, uppercase): the selected citizen's name on the billboard. One per screen.
- **Headline** (800, `clamp(1.75rem, 3.6vw, 3.25rem)`, 1.08, `wdth` 78, uppercase): the idle billboard's single statement of what the panel is.
- **Wordmark** (800, 1.0625rem, `wdth` 70, tracked 0.16em, uppercase): the Veritas lockup beside the mark. This width step exists for the wordmark alone.
- **Title** (700, 1rem, -0.01em): panel headings.
- **Tile name** (800, 0.9375rem, 1.12, `wdth` 78, uppercase, clamped to 2 lines): the display voice at catalog scale.
- **Body** (400, 0.875rem, 1.55): the interface baseline, set on the 8px grid. Secondary text drops to 0.8125rem; prose is capped at 62–72ch.
- **Label** (700, 0.6875rem, 0.14em, uppercase, `wdth` 105): rail headings, field labels, balance keys, ledger mode, tile money keys.
- **Measure** (Spline Sans Mono, tabular): balances at 2rem/500/-0.02em; citizen IDs, timestamps, page and rail counts at the surrounding size.

### Named Rules
**The Width-Axis Rule.** Emphasis is made by moving Archivo's `wdth` axis (78 display, 100 interface, 105 micro-caps, 70 wordmark), not by adding a family. A second display face is a system change, not a styling choice.

**The Mono Is Measurement Rule.** Spline Sans Mono is permitted only for values that are read digit by digit: citizen IDs, currency, times, counts, server IDs, phone numbers. It never sets a label, a heading, or a sentence.

**The Seven Steps Rule.** The ramp has seven declared steps (11 / 13 / 14 / 16 / 22 / 32 / display clamp) and each carries one role. Body copy uses no intermediate value.

## Layout

A two-row app grid: a fixed topbar (4rem desktop, auto on phone) over exactly one vertically scrolling stage. The page never scrolls horizontally — `overflow-x: hidden` on the body is a hard requirement — and horizontal movement happens only inside rail tracks, which scroll internally with `scroll-snap-type: x proximity` and hidden scrollbars.

Horizontal rhythm is one fluid gutter, `clamp(1rem, 3.2vw, 2.75rem)`, applied to topbar, billboard, module grid, rail heads and rail tracks so every element shares one left edge. Vertical rhythm is an 8px-based scale of eight steps (0.25–4rem). Rail tracks carry asymmetric vertical padding (0.875rem top, 1.75rem bottom) so the scaled tile and its shadow are not clipped by the scrolling box.

The stage stacks billboard → modules → wall. Modules are an auto-fit grid of `minmax(21rem, 1fr)` panels: new capabilities (inventory, vehicles) dock in as another `.panel` and place themselves without renegotiating the shell. Tiles are a fixed 11.5rem wide with a 0.625rem gutter, reflowing to 8.75rem below 900px and 7.75rem below 560px.

Two breakpoints only. At **900px** the topbar wraps to three rows with search on its own line, the billboard shortens, and the idle billboard flattens so the first rail is visible without scrolling. At **560px** the billboard scrim is pulled deeper so the smallest type never sits on the busiest part of the plate, the ledger row wraps, and tile focus-expansion is disabled — as it also is at any `hover: none` pointer.

### Named Rules
**The Page Never Pans Rule.** Only rails scroll sideways. If a new surface needs horizontal room, it becomes a rail or a reflowing grid; it never widens the page.

**The One Gutter Rule.** Every full-width band uses the same `--gutter` clamp. Section-specific horizontal padding is drift.

## Elevation & Depth

Depth is built from three stacked devices: tonal layering (ground → surface → surface-2 → surface-3), hairline borders, and real shadows with genuine offset and blur. There is no glow, no zero-offset halo, and no elevation implied by colour alone. The scrim gradients over the generated plates are depth too — they push the picture back so bone text can sit on it — and a 140px SVG noise field at 0.17–0.2 opacity, `mix-blend-mode: overlay`, gives both plate crops a film-grain surface instead of a flat vector look. Backdrop blur appears only on surfaces that float over a plate or over the scrolling stage: topbar (14px), balance cards, session ledger, tile badge (4–8px).

### Shadow Vocabulary
- **Panel hairline** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45)`): module panels at rest — a seam, not a lift.
- **Focused tile** (`box-shadow: 0 20px 38px -14px rgba(0,0,0,0.9), 0 4px 10px -4px rgba(0,0,0,0.6)`): the only heavy shadow in the system, and only while a tile is hovered or focused.
- **Rail lift** (`box-shadow: 0 10px 24px -10px rgba(0,0,0,0.8)`): the declared shadow for a lifted rail band.
- **Selection ring** (`box-shadow: inset 0 0 0 2px #FFFFFF`) and **tile edge** (`inset 0 0 0 1px rgba(255,255,255,0.06)`): inset strokes that define an edge without casting.

### Named Rules
**The Flat-Until-Touched Rule.** Every surface rests flat on its tone. A cast shadow is a response to hover, focus or selection, never a decoration at rest.

**The Real Light Rule.** Shadows have offset and blur. A zero-offset dark halo is not permitted anywhere in this world.

## Shapes

Small, consistent radii on a rectangular world. Five values only: tiles and controls at 5px, the inner elements of a segmented well or ladder at 4px, panels and floating cards at 8px, pills fully round (999px), and dots/pulses as true circles. Tiles are strict 2:3 posters (`aspect-ratio: 2 / 3`) and the billboard's wide crop is 16:9-ish (400×225) generated in its own composition — never a poster cropped down, which would leave only a centre strip.

Borders are 1px, single-weight, in two tones: a quiet hairline inside panels and a stronger line around anything the user can touch. Nested controls (grade ladder, segment control) are wells: 1px border, 3px padding, 2px gap, children on the inner radius, which reads as a physical track holding its items. The brand mark is the same geometry as the wall: a poster tile (rx 3.5) with a V cut out of it as negative space, the right stroke breaking past the tile edge into a solid.

### Named Rules
**The Poster Rule.** Every citizen tile is 2:3, always. A crop ratio is never varied to fit a layout; the layout changes the tile width instead.

## Components

### Buttons
- **Shape:** softly squared corners (5px), full-height 40px (`--ctrl-h`), 0 1rem padding, weight 600, icon and label in a 0.5rem inline-flex.
- **Default:** surface-3 fill, bone text; hover lightens to #36322C.
- **Primary:** bone fill, asphalt text; hover goes pure white. Used for the one committing action in a panel foot.
- **Ghost:** transparent with a strong border and muted text; hover fills to surface-2 and brightens text. Used for rail nav and pagination.
- **Small / Icon:** 2.125rem tall (square when icon-only), body-small type.
- **Press:** all buttons have honest travel — `translateY(1px) scale(0.995)` over 0.08s.
- **Disabled:** flattens into the surface (surface fill, quiet border, faint text, `not-allowed`) rather than fading out at reduced opacity.
- **Focus:** a 2px pure-white `:focus-visible` outline at 2px offset, inherited from the global rule.

### Start page

- **Reached by:** the wordmark in the top bar, as on any other site. It is deliberately *not* a third button in the area switch — that switch is for the two places work happens, and a third entry there would imply home was one of them.
- **Not the default on load.** The panel still opens on Citizens, because the load-bearing task is a repair measured in seconds and a home page would add a click to every session. One line in `Workspace` changes that if the owner prefers otherwise.
- **Hero:** the mark at 44px beside the wordmark at display scale over a generated wide plate, seeded `veritas-home` so it is the same picture every time — the one place in the panel where the product introduces itself.
- **Chips, not a dashboard.** Two at most: the bridge state with the count it actually reported, and the signed-in role. Nothing appears here that would still be shown if its check had failed; there is no uptime, no session count, no "all systems healthy".
- **On the server now:** the same `Rail` component the citizen wall uses, exported rather than re-implemented. Selecting a tile opens that citizen and moves to the Citizens area.
- **The paging gap is named.** The roster is paged, so the bridge usually counts more connected citizens than the loaded page holds. The difference is spelled out in a line under the rail instead of being smoothed over — the same honesty rule as "offline" versus "unverified".
- **Destinations are a list, not a card grid:** rows of icon, name, one line of what actually stands behind it, and a chevron; capped at 56rem so the chevron stays near its label. Only destinations the role may enter are offered.

### Section tabs
- **Job:** the citizen workspace carries up to thirteen panels. They are grouped into five sections — Identity, Money, Assets, Session, Enforcement — and only the active section is mounted, so an admin reads three panels instead of thirteen.
- **Style:** micro-caps at width-axis 105, faint by default, bone when active, with a 2px pure-white bottom border on the active tab. That white is the same single chrome accent the poster tile's focus ring uses; the tabs introduce no new colour.
- **Position:** sticky to the top of the scrolling stage, so the section stays reachable while a long panel (Vehicles, Bans) runs past the fold.
- **Live dot:** the Session tab carries a live-green dot only when the citizen is on the server *and* the bridge is reachable — never when status is merely unverified.
- **Availability:** a section whose panels are all hidden by permissions is not offered, and the active section falls back to the first available one if a right is withdrawn mid-session.
- **Narrow screens:** below 560px the inactive tabs drop their labels to icons and the active one keeps its word, so all five hold one row without scrolling.
- **Keyboard:** a real `tablist` — arrow keys move between tabs and carry focus with them; each panel container is the labelled `tabpanel`.
- **Persistence:** the chosen section survives switching citizens, because correcting ten balances in a row should not mean re-selecting Money ten times.

### Inputs / Fields
- **Style:** 40px tall, surface-2 fill, 1px strong border, 5px radius, bone text, faint placeholder. A field is a stacked group: micro-caps label, control, optional faint hint.
- **Focus:** border goes pure white with a 35%-white 2px outline at zero offset — a doubled edge, not a glow.
- **Select:** native appearance removed; the caret is the same chevron as the authored icon set, inlined as a data URI at stroke-width 1.75 with round caps, so one icon language holds across the screen.
- **Disabled:** same flattening as buttons.

### Cards / Containers
- **Panel:** 8px radius, surface fill, hairline border, panel-hairline shadow; a bordered head (icon + title + hint), a 1rem body with 1rem gaps, and a foot on a 22%-black wash with actions right-aligned and status text pushed left.
- **Balance card:** 8px radius over the plate — 66%-black fill, 8px backdrop blur, strong border; micro-caps key with a 14px icon over a 2rem mono value.

### Navigation
- **Topbar:** mark + wordmark, centred search as the primary control (max 34rem), bridge status at the right. Translucent ground with a 14px blur and a hairline bottom border. No user menu exists, because no authentication does.
- **Rail nav:** ghost icon buttons at the right of each rail heading, each disabled when there is nothing further in that direction — measured live from scroll position, so short rails never show dead arrows.
- **Pagination:** ghost Previous/Next flanking a mono page readout; Next disables when the returned page is short.

### Poster Tile (signature)
A semantic `<button>` with `aria-pressed`, never a clickable div. Full-bleed generated plate under a grain layer and a bottom-up scrim; a LIVE or UNVERIFIED badge top-left; a caption of display-voice name over a muted job line. Both caption lines reserve two lines of height (`min-height: 2.24em` / `2.7em`, clamped to two lines) so names share a baseline across a rail regardless of wrap. Selection is the inset 2px white ring.

**Focus expansion — the one authored motion moment.** On hover or `:focus-visible`: the tile scales to 1.11 with the heavy tile shadow, the caption rides up 4.75rem, the scrim deepens, and a reveal panel opens from `grid-template-rows: 0fr` to `1fr` (animating a grid track, not `max-height`, so no layout recalculation) exposing citizen ID, cash and bank. Its rail lifts 2px while sibling rails drop to 0.55 opacity via `:has(.tile:hover)`. All of it runs on `cubic-bezier(0.16, 1, 0.3, 1)` in 0.36s, and all of it is disabled under `prefers-reduced-motion`, on `hover: none` pointers, and below 560px.

### Billboard
Two states over a full-bleed wide-crop plate with grain and a long two-axis scrim. **Idle:** 17rem tall, one headline statement and a paragraph of what the panel does. **Selected:** 23rem tall, display-scale name, a meta line of status pill, mono citizen ID, job and rank (spaced, no separator dots, so a wrap never strands a bullet), and cash/bank balance cards. Text over art always carries a soft shadow (`0 2px 20px rgba(0,0,0,0.55)`) as a second legibility guarantee behind the scrim.

### Grade Ladder
A scrolling well (max 15rem) listing every rank of the selected job rather than hiding them in a native dropdown, so the distance between two ranks is visible. Each step is a button: level number at 0.75 opacity, name, and — on the current rank — a "Now" marker. The active step inverts to bone-on-asphalt at weight 600; hover fills surface-3; press travels 1px.

### Segment Control
A 3px-padded well of equal buttons at 2rem, switched by `aria-pressed`. The pressed state inverts to bone-on-asphalt, except the debit direction, which presses to debit red on near-black — the only place a signal hue fills a control.

### Session Ledger
Completed writes stay on the record instead of vanishing into a toast: a blurred, bordered list over the plate with a micro-caps heading and a plain Clear link. Each row is icon + achromatic description + a micro-caps mode ("Applied live" / "Saved to database") + a mono timestamp; the row's hue (live green or unverified amber) marks which path the write took while the description itself stays bone.

### Bridge Status Pill
A rounded pill in the topbar reporting the link as a broadcast status: green fill and border with "Live link · N on server", amber with "Link down · status unverified". Both use the authored link / link-off icons.

### StatusNote
Inline feedback with `role="status"` that replaces `alert()`. A two-column grid (17px tone icon + text), 5px radius, surface-2 by default, and for success/warn/error a signal border over the matching ~0.13 alpha wash, with the icon in the signal hue and the title and detail in bone. It persists until the next operation replaces it.

### Empty & Loading States
Empty states are centred: a 26px faint icon, a 1rem title and a faint 38ch line naming the next action. Loading is a skeleton rail — eight 2:3 blocks with a 1.5s tonal shimmer. A refetch never blanks the wall: the previous result stays, dropped to 0.4 opacity and `saturate(0.4)`, marked `aria-busy`.

### Icons
One authored set: a single 24px grid, `stroke-width: 1.75`, round caps and joins, `fill: none`, `currentColor`, default 18px (14–17px inline, 26px in empty states). No icon font, no Unicode glyph (⌕, ✓, ⚠) substitutes anywhere, including the `<select>` caret.

## Do's and Don'ts

### Do:
- **Do** put every saturated colour in a generated plate, and keep chrome achromatic bone on warm asphalt (#0D0C0B).
- **Do** state a status in words before you state it in hue; the three signals are green #48E08A live, amber #F5A623 unverified, red #F0503C debit.
- **Do** derive a citizen's key art from their ID through `getPlate()`, so the same record always shows the same sky.
- **Do** generate a new crop shape when a new aspect is needed, instead of cropping the 200×300 poster.
- **Do** reach for Archivo's width axis (78 / 100 / 105) for emphasis, and keep Spline Sans Mono for measured values only.
- **Do** reserve two lines of caption height on any card in a rail so names share a baseline across the row.
- **Do** keep controls at 40px with honest 1px press travel, and flatten disabled states into the surface.
- **Do** keep the accessibility floor: semantic buttons, labelled controls, pure-white `:focus-visible` rings, `role="status"` inline feedback, themed `::selection`/caret/scrollbars, and motion disabled under `prefers-reduced-motion`.
- **Do** dock new capabilities as another `.panel` in the module grid, or as another rail in the same grammar.

### Don't:
- **Don't** render "offline" and "unverified" in the same colour or the same words; unknown state stays amber and explicitly unknown.
- **Don't** use pure white for text or surfaces — it belongs to selection, focus and primary hover.
- **Don't** tint running prose or record values with a signal hue; the hue goes on the badge, border, wash or marker beside them.
- **Don't** cast a zero-offset halo or a glow for elevation; shadows in this world have offset and blur.
- **Don't** add a second display typeface or an icon font; the width axis and the authored 24px/1.75 set cover both jobs.
- **Don't** let the page scroll horizontally — only rail tracks do.
- **Don't** add motion beyond the focus expansion, the 2.6s live pulse and the skeleton shimmer; stillness is what makes the one moment read.
- **Don't** replace persistent inline feedback with a toast or an `alert()`; completed writes stay visible on the record for the session.
- **Don't** design UI implying authentication, permission tiers or an audit trail — none exist.
- **Don't** invent counts, uptime figures or testimonials on any surface.
