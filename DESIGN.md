---
name: Narrately
description: Your editor, terminal and Git activity, recorded on chart paper and written up as the day's log.
colors:
  paper: "#F6F7F2"
  paper-2: "#ECEFE7"
  sheet: "#FFFFFF"
  grid: "#E1EADF"
  grid-2: "#BED3C1"
  print-green: "#346B47"
  ink: "#171A1C"
  ink-2: "#444A4E"
  ink-3: "#5C6368"
  ink-4: "#747B80"
  ink-5: "#868D92"
  rule: "rgba(23,26,28,.13)"
  rule-2: "rgba(23,26,28,.3)"
  recorder-red: "#C41E26"
  red-ink: "#FFFFFF"
  red-soft: "rgba(211,34,42,.08)"
  pen-blue: "#1E4FD0"
  pen-violet: "#7A3CC6"
  pen-green: "#0F7040"
  pen-brown: "#96570F"
  pen-teal: "#0D7684"
  pen-magenta: "#A8306B"
  bad: "#C2272F"
  chassis: "#1C1F22"
  chassis-2: "#2A2E32"
  chassis-3: "#3B4045"
  engrave: "#E6E9E3"
  engrave-2: "#A7AEA8"
  paper-dark: "#121513"
  paper-2-dark: "#1B1F1C"
  sheet-dark: "#191D1A"
  grid-dark: "#1C221E"
  grid-2-dark: "#2D3831"
  print-green-dark: "#7FB592"
  ink-dark: "#E8ECE6"
  ink-2-dark: "#B4BCB5"
  ink-3-dark: "#8F9891"
  ink-4-dark: "#737C75"
  ink-5-dark: "#5F6861"
  recorder-red-dark: "#FF5B4F"
  red-ink-dark: "#1A0503"
  pen-blue-dark: "#7D9DFF"
  pen-violet-dark: "#BA92FF"
  pen-green-dark: "#47C380"
  pen-brown-dark: "#E3A24A"
  pen-teal-dark: "#4CC3D0"
  pen-magenta-dark: "#F07FB4"
  bad-dark: "#FF6B5E"
  chassis-dark: "#0B0D0C"
  chassis-2-dark: "#161A18"
  chassis-3-dark: "#262C29"
  engrave-dark: "#DDE2DC"
  engrave-2-dark: "#8F978F"
typography:
  display:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', 'Arial Narrow', sans-serif"
    fontSize: "clamp(3.5rem, 7.6vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.028em"
  headline:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', 'Arial Narrow', sans-serif"
    fontSize: "clamp(2.1rem, 3.7vw, 3.3rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.015em"
  view-title:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', 'Arial Narrow', sans-serif"
    fontSize: "clamp(36px, 4.2vw, 56px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', 'Arial Narrow', sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  title:
    fontFamily: "'Barlow', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "'Barlow', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  body-tool:
    fontFamily: "'Barlow', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "'Barlow Semi Condensed', 'Barlow', 'Arial Narrow', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  mono:
    fontFamily: "'Overpass Mono', ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  plate: "2px"
  control: "3px"
  dot: "50%"
spacing:
  2xs: "6px"
  xs: "10px"
  sm: "14px"
  md: "18px"
  lg: "22px"
  xl: "36px"
  2xl: "64px"
  fold: "120px"
components:
  button-primary:
    backgroundColor: "{colors.recorder-red}"
    textColor: "{colors.red-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-ghost:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  chassis-key:
    backgroundColor: "{colors.chassis-2}"
    textColor: "{colors.engrave}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  chassis-key-hover:
    backgroundColor: "{colors.chassis-3}"
  nav-plate:
    backgroundColor: "{colors.chassis-2}"
    textColor: "{colors.engrave-2}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "8px 11px 7px"
  nav-plate-active:
    textColor: "{colors.engrave}"
  install-command:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    height: "52px"
  chip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "1px 7px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-tool}"
    rounded: "{rounded.control}"
    padding: "0 6px 0 12px"
  panel:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "0 18px 18px"
  kpi-strip:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.figure}"
    padding: "14px 16px 10px"
  tooltip:
    backgroundColor: "{colors.chassis}"
    textColor: "{colors.engrave}"
    rounded: "{rounded.plate}"
    padding: "9px 11px"
---

# Design System: Narrately

## Overview

**Creative North Star: "The Strip-Chart Recorder"**

Narrately is drawn as an instrument, not a dashboard. Every surface is a sheet of white chart paper printed with a cool green grid, written on by recorder pens at full strength, and held in a dark enamel chassis that carries the controls as engraved plates. The landing page is one roll of that paper fed by the visitor's scroll; the docs are the same paper with a printed margin; the local dashboard and the team portal are the instrument's readout, with the chassis as their sidebar or app bar.

Density follows mode. The landing (Persuade) and docs (Read) run large, ruled and spacious, with folds of 120px and a 17px reading body. The dashboard and portal (Operate) tighten to 15px body, 34-36px controls and ruled instrument strips of figures. Hierarchy comes from scale, rules and the grid, never from card chrome or tinted surfaces. Depth exists only where one sheet physically overlaps another.

Rejected outright, and confirmed in the build: shadows, blur, colour gradients (hard-stop gradients only print the grid), glow, pastel washes, and the dark dev-tool hero with a glowing screenshot over a bento grid. The previous identity ("Ink & Signal": near-black, acid lime, serif italic accents) is retired and nothing from it carries over.

**Key Characteristics:**
- White chart paper with a green grid (major line every fifth) as the ground; recorder pens as the only saturated colour.
- A dark enamel chassis band carrying navigation as engraved, bordered plates.
- Condensed DIN-like display numerals and headings, plain humanist body, mono only for machine text.
- Selected is a solid pen line; alternatives are dashed.
- Focus is a double keyline: ink outline, paper gap, red ring.
- Depth only by an offset sheet behind a sheet.
- Light and dark sets, one shared preference key.

## Colors

Paper neutrals and a green printed grid carry the surface; full-strength pen inks carry meaning, and recorder red is the one voice for action and narrative.

### Primary
- **Recorder Red** (`recorder-red` / `recorder-red-dark`): the primary action (Copy, Get started, Send, Sign in), the narrative pen, the selected underline and glider, the outer focus ring, timestamps on notes, today's column, list markers, and text selection. Text on red is `red-ink` (white in light, near-black in dark). `red-soft` is a faint wash used only behind a drop target, a setup banner or a removed diff line.

### Secondary
- **Pen inks** (`pen-blue`, `pen-violet`, `pen-green`, `pen-brown`): one pen per source on the recorder. Blue is the editor, violet is debug, brown-black is shell, green is git. Green doubles as success (`.copied`, additions, positive deltas). On the landing they are named `--blue/--violet/--green/--brown` and aliased as `--s-editor/--s-debug/--s-git/--s-shell`.
- **Extended pens** (`pen-teal`, `pen-magenta`): only in the dashboard and portal's seven-colour series palette, for data with more categories than sources.

### Tertiary
- **Print Green** (`print-green` / `print-green-dark`): the colour the chart paper's own printing is in. Time-scale figures, the date line, chart axis labels, group headings in palettes, the facts label plate, and "example" marks on synthetic demos. It is the paper talking, never a pen.
- **Bad** (`bad` / `bad-dark`): deletions, errors, destructive hover. A separate, slightly cooler red than recorder red so an error never reads as the primary action.

### Neutral
- **Paper** (`paper`): page ground. **Paper 2** (`paper-2`): the offset under-sheet, inline code, selected palette rows, user chat bubbles. **Sheet** (`sheet`): the raised sheet, panels, inputs on the chassis side, modals.
- **Grid** (`grid`) and **Grid 2** (`grid-2`): the minor and major chart rulings, chart tracks, empty bars, dashed alternatives on paper.
- **Ink** (`ink`), **Ink 2** (`ink-2`), **Ink 3** (`ink-3`): text in three strengths; ink also draws heavy 1.5px rules and primary hover fills.
- **Rule** (`rule`) and **Rule 2** (`rule-2`): translucent ink hairlines for row dividers and sheet borders.
- **Chassis** (`chassis`, `chassis-2`, `chassis-3`) with **Engrave** (`engrave`, `engrave-2`): the enamel band, its plates and their engraved lettering; also tooltips and toasts. The chassis is dark in both themes.

### Themes
The landing and docs default to light and switch to dark through `data-theme="dark"` on `<html>`. The dashboard and portal follow `prefers-color-scheme` unless `data-theme` is set to `light` or `dark`. All four read and write the same `localStorage` key, `narrately.theme`, in an inline head script before first paint.

### Legacy aliases (dashboard and portal)
The dashboard and portal scripts colour data by token name, so they keep the old names as aliases of the pens: `--text`, `--text-2`, `--text-3` = ink tones; `--line`, `--line-2` = rules (alpha .12/.28 light); `--chart-1` = blue; `--violet` = violet; `--coral` = recorder red; `--sky` = green; `--amber` = brown; `--mint` = teal; `--pink` = magenta; `--good` = green; `--bad` = bad; `--warn` (portal) = brown. New code on these surfaces uses the alias names they already use; new code on the site uses `--ink*`, `--rule*`, `--red`, `--blue`.

### Named Rules
**The One Meaning Per Hue Rule.** On any one page a hue means one thing. In the portal, members own the pen colours (the seven-pen `PALETTE`) and projects are drawn in ink tones (`INKS`: ink, ink 2, ink 3, ink 4, with any remainder grouped as "Other" in ink 5), so a colour never names both a person and a project. Every data ink clears 3:1 against paper in both themes; grid, rule and print greens never draw data.

**The Full-Strength Ink Rule.** Pens are used at full strength as lines, dots, bars and text. They are never lightened into pastel fills or tinted backgrounds; the only washes are the 7-10% red and green softs behind diffs, drop targets and the setup banner.

**The Paper Prints Green Rule.** Anything the paper itself would carry pre-printed (scales, axis figures, date lines, group headings, label plates) is print green. Anything an event wrote is a pen.

## Typography

**Display Font:** Barlow Semi Condensed 500/600/700 (with Barlow, Arial Narrow)
**Body Font:** Barlow 400/500/600 (with system-ui)
**Label/Mono Font:** Overpass Mono, variable 300-700 (with ui-monospace, Cascadia Mono, Menlo, Consolas)

**Character:** A condensed DIN-like grotesque for numerals, headings and engraved labels, set tight and heavy like an instrument face, over a plain humanist body that stays out of the way. All self-hosted woff2 per surface folder; licenses in `brand/FONTS.md`.

### Hierarchy
- **Display** (700, clamp(3.5rem, 7.6vw, 6rem), 0.9): the landing headline only. Docs welcome uses the same voice at clamp(3rem, 5.6vw, 4.6rem)/.92; the portal auth panel at clamp(44px, 5vw, 72px)/.92. Max about 12ch.
- **Headline** (600, clamp(2.1rem, 3.7vw, 3.3rem), 1): fold titles on the landing, max 21ch; docs section headings at 700 2.15rem/1.05.
- **View title** (700, clamp(36px, 4.2vw, 56px), 1): the dashboard and portal hero line ("6h 12m today"), tabular digits, secondary clause in 600 ink 3.
- **Figure** (700, 30px, 1.05, tabular): KPI values. Larger single figures go to 40-44px at the same weight.
- **Title** (Barlow 600, 20px, 1.25): item headings in ledgers, steps and specs (17-19px variants).
- **Body** (Barlow 400, 17px, 1.55 site; 1.65 in docs): reading copy, measure 40-68ch. Ledes at 19-21px in ink 2.
- **Body tool** (Barlow 400, 15px, 1.55): dashboard and portal base.
- **Label** (Barlow Semi Condensed 600, 12-14px, 0.06-0.08em, uppercase): buttons, nav plates, panel heads, table headers, chips, KPI labels. This is the engraved-plate voice.
- **Mono** (Overpass Mono 400-500, 10.5-16px): commands, code, timestamps, paths, file names, durations, axis figures, counts.

### Named Rules
**The Machine Text Rule.** Monospace is reserved for what a machine emits: code, commands, timestamps, paths and figures in tables. Headings, labels and prose are never mono.

**The Fixed Digit Rule.** Body text runs with `font-variant-numeric: tabular-nums` on every surface, so figures sit in fixed positions and a changed value reads as an event, not a reflow.

## Layout

The landing is one roll: a fixed-width left rail (372px at full width; 318px under 1280px; 206px under 1100px with notes hidden; 46px lanes-only under 860px) holds the strip chart, and the remaining width is chart paper with a 96px grid where folds sit. Folds pad 120px top, 128px bottom and 64px sides (52, 44, 22px as the viewport narrows), content capped at 1000px. Folds are divided by a 1.5px dashed perforation in grid 2 that runs across the rail.

Docs use a 272px sidebar printed with a 12px grid and a reading column up to 980px, padded 64px, with a printed tick margin down its left edge. The sidebar becomes an off-canvas sheet with a scrim under 900px.

The dashboard is a 236px chassis sidebar plus a main column padded 36px, a 60px sticky topbar on paper, a six-up KPI strip (three-up under 1320px, two-up under 860px) and a 12-column panel grid with 20px gaps that collapses to one column under 1120px. Under 860px the sidebar becomes a bottom tab bar. The portal uses a 60px chassis app bar, a 1240px content column padded 32px, a four-up KPI strip and the same 12-column grid; auth is a two-column split (chassis panel and gridded paper with a 410px form sheet) that stacks under 960px.

Spacing is rhythm-based rather than a strict scale: 6, 10, 14, 18, 22, 36, 64 and 120px recur. Rows inside sheets pad 9-14px vertically; sheet heads 10-12px by 16-18px.

## Elevation & Depth

The system is flat. There are no shadows, no blur, no colour gradients and no glow anywhere; `box-shadow` appears only as the focus ring, and `linear-gradient` appears only as the hard-stop 1px technique that prints the chart grid and scale ticks, never as a blend. Depth is conveyed in exactly one way: a sheet sits on an offset under-sheet. The `.slip` (landing) and `.code-float` (docs) draw a `::before` sheet in paper 2 with the same 1px rule 2 border, translated 6px right and 6px down, behind the main sheet. Overlays (modal, palette, menu) are separated by a 1.5px ink border and, for modal and palette, a flat 50-55% near-black scrim, never by lift.

### Named Rules
**The Overlapping Sheets Rule.** If something must look raised, put a second sheet behind it, offset 6px by 6px. Never a shadow, never a tonal lift.

**The Double Keyline Rule.** Focus is `outline: 1.5px solid ink; outline-offset: 2px` plus `box-shadow: 0 0 0 4px paper, 0 0 0 5.5px red`. Composite fields (input wrappers, chat bar, composer, docs filter) carry the same ring on `:focus-within` at 3px/4.5px and suppress it on the inner input.

## Shapes

Corners are nearly square: 2px for plates, chips, tooltips and toasts; 3px for buttons, keys, inputs and the install command; sheets, panels, modals and KPI strips are square. Circles appear only as pen dots (7-8px event and record dots, 10-11px carriage tip and pipeline packet) and avatars. Rules do the structural work: 1px hairlines between rows, 1.5px ink for the top rule of a ledger, table or KPI strip and for heavy control borders, 1.5px grid 2 for chart frames.

### Named Rules
**The Solid Choice Rule.** The committed choice is drawn solid; alternatives are dashed. Tabs and range selectors carry a 1.5px dashed underline in rule 2 and the active one a 2px solid red underline (a sliding glider in the dashboard range and portal tabs). Toggles, context chips and suggestion buttons are dashed until on or hovered, then solid.

## Components

### Buttons
Square, engraved, decisive.
- **Shape:** gently squared (3px).
- **Primary:** recorder red fill, red-ink label in the uppercase label face; 48px tall with 20px sides on the landing, 34-36px tall with 13-14px sides in the tools, 44px full-width in the auth form.
- **Hover / Focus:** fills with ink and paper text (a red key on the chassis instead turns engrave with chassis text). Arrows nudge 3px right. Focus is the double keyline. Disabled holds the red at 45-55% opacity.
- **Ghost:** 1-1.5px ink border on sheet or transparent, ink label; hover fills ink.
- **Quiet:** no border, ink 3 label; hover to ink, or to bad for destructive actions.
- **Chassis key:** chassis 2 fill, 1px chassis 3 border, engrave label, 36px; hover chassis 3.

### Chips
- **Style:** 1px rule 2 border, 2px corners, uppercase label face at 11px, ink 2. Status chips take the pen colour as border and text (green for signal, brown for warn, red for owner role).
- **State:** context chips are dashed and mono at 13px; the active one becomes a 1.5px solid ink border.

### Cards / Containers
- **Corner Style:** square.
- **Background:** sheet on paper.
- **Shadow Strategy:** none; see Overlapping Sheets.
- **Border:** 1px rule 2 (`--line-2` in the tools).
- **Internal Padding:** panels 0 18px 18px with a full-bleed head row (12px by 18px, 1px rule under, uppercase label heading).

### Inputs / Fields
- **Style:** paper or sheet fill, 1px rule 2 border, 3px corners; mono text for short machine fields (dates, URLs), body for prose.
- **Focus:** border turns ink and the double keyline ring appears on the wrapper.
- **Error / Disabled:** messages in bad below the field; the auth card shakes once on failure. A drop target turns 1.5px dashed red over red soft.

### Navigation
- **Landing and docs:** a 58px sticky chassis band with the lockup (28px mark, 22px display wordmark) and nav as engraved plates (uppercase 13px, engrave 2 on chassis 2, 1px chassis 3 border). Hover lifts to engrave; the current plate takes an engrave border and a 2px red underline. Under 860px plates hide and a red mono clock appears in the band.
- **Dashboard:** a 236px chassis sidebar of uppercase rows; a 1.5px engrave-2 outline pill slides to the active row and the active icon turns red. Becomes a bottom bar under 860px.
- **Portal:** a 60px chassis app bar with the team pill (red initial square), a week stepper with a mono label, and an engrave avatar.

### KPI Strip
One ruled instrument strip, not cards: a 1.5px ink top rule, 1px bottom rule, cells divided by hairlines, each with an uppercase label, a 30px tabular figure (good/bad tinted when meaningful), a mono delta and a 30px sparkline drawn on a 10px grid.

### Charts
Bars and stacks rise on a 20px vertical grid with dashed grid 2 gridlines and print-green mono axis figures; today's column is red. Hovering a column dims the others to 35%. Tooltips are chassis plates with engrave text and mono values. Donuts use a grid-coloured track with 14px pen segments.

### Strip-Chart Rail (signature, landing only)
The scroll-linked recorder: `#rail` holds a print-green time scale (09:00 to 18:40), five pen lanes under a vertical label head, the `#trace` SVG drawing each pen's line as the visitor scrolls, `#notes` that wipe in left-to-right with a red timestamp and dot per event, and a fixed `#carriage` (ink hairline, red mono `#clock`) marking the current time. Under 860px the rail shrinks to lanes only and `#clockTop` in the chassis band carries the time. Reduced motion draws the full trace at once.

### Motion
One easing, `cubic-bezier(.16, 1, .3, 1)`, at 150-400ms for state, up to 700-1000ms for drawn strokes and bar growth with 24-90ms per-item stagger. Motion is a pen stroke drawn in sequence: notes wipe in with `clip-path`, bars grow from the baseline, the thinking indicator is a short red line being written. Every surface collapses all animation under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** set every surface on paper with a green grid, and put navigation on the dark chassis as engraved plates.
- **Do** use recorder red for the one primary action per view and for the selected state; hover primaries to ink.
- **Do** draw the selected option solid (2px red underline or glider) and its alternatives dashed (1.5px rule 2).
- **Do** use the double keyline for focus: 1.5px ink outline, 2px offset, 4px paper gap, 1.5px red ring.
- **Do** raise a sheet only by putting an offset sheet behind it (6px, 6px, paper 2, same border).
- **Do** keep monospace for code, commands, timestamps, paths and figures, and keep digits tabular.
- **Do** give members pen colours and projects ink tones when both appear on one page.
- **Do** support light and dark through `data-theme` and the shared `narrately.theme` key.

### Don't:
- **Don't** use shadows, blur, gradients as colour, or glow for depth or emphasis.
- **Don't** lighten pens into pastel fills or tinted backgrounds.
- **Don't** let one hue mean two things on the same page.
- **Don't** set headings, labels or prose in monospace.
- **Don't** round sheets or panels; corners stop at 2-3px on controls.
- **Don't** bring back the retired near-black, acid lime and serif italic look.
