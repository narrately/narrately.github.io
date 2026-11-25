---
version: 1
slug: "website-index-html"
primary_target: "website/index.html"
related_targets: ["website/docs.html","src/web/dashboard.html","cloud/dashboard/index.html"]
---

# Landing (website/index.html)

Mode: Persuade. Replacement world for all four web surfaces; docs, local dashboard and team portal inherit it in their own modes.

Audience: developers who must report what they did (standups, timesheets, reviews). Action: copy `npm install -g narrately` (working copy button in the first viewport), secondary: docs. Proof: real commands and output shapes, privacy mechanisms backed by code, synthetic demo day clearly labeled as an example. Constraints: static HTML, no build, self-hosted assets, no invented claims or price.

Memorable moment: the page is one roll of chart paper and the visitor's scroll is the paper feed. A recorder draws one synthetic workday down the margin while you read, and at the bottom that same day comes out as a written log.

## Direction contract

THESIS: Narrately is a recorder, not a dashboard. The page is one strip-chart roll: pens trace a workday down the margin as the visitor scrolls, and the roll ends in the written log of that day. It refuses the dark dev-tool hero with a glowing screenshot over a bento grid.

OWN-WORLD: White chart paper printed with a cool green grid (major line every fifth). Pen inks at full strength: recorder red (narrative + primary action), blue (editor), violet (debug), brown-black (shell), green (git). A dark enamel chassis band carries nav and engraved label plates. Bahnschrift/DIN numerals and headings, plain system body, mono timestamps. Fold perforations divide sections. No shadows, blur, gradients or glow; depth only by sheets overlapping. Selected = solid pen line, unselected = dashed. Focus = a double keyline.

STORY: Visitors see that their day becomes prose without effort, believe it because every mark is a real event and the paper never leaves the machine, then copy the install command.

FIRST VIEWPORT: The chassis band runs across the top (wordmark, nav plates, Get started). Below it, chart paper. A left trace column (time scale 09:00→, five pen lanes) starts drawing. The right two-thirds is the printed title block: a huge DIN headline "Your day, already written.", the lede, the install command with a copy button as the primary action, and Read the docs. A chart label plate carries "Free · MIT · Windows, macOS, Linux".

FORM: grounded candidate 4 of 7 (strip-chart recorder); seed:b7869734794feba1. Raises: nixie counter: figures sit in fixed tabular digit positions and a changed value is a visible event. Type specimen: hierarchy from scale and grid alone, no card chrome. Sewing pattern: committed choice drawn solid, alternatives dashed. Łowicz papercut: depth only by overlap, never by shadow or tone. Highlife sleeve: inks at full strength, never pastel washes. Wildstyle blackbook: the active control takes a second offset keyline, and motion is a pen stroke drawn in sequence.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: the scroll-linked trace. Sections are pinned to times of day (09:00 hero → 18:40 close), each with an event tick and timestamp on the trace. Reduced motion shows the full trace at once.
