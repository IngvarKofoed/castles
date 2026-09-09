# Goods leave the ribbon for a Stores panel; the rail is a 96px icon grid

Every good is now named and counted in a **Stores** panel in the
bottom-left, grouped wood / stone / food — so the ribbon carries colony
facts only and is one line at 1280×720 however many goods later steps
add. The rail is 96px of icon-only buttons two to a row, with a caption
strip at its foot naming the hovered, focused or active tool; all
fifteen tools fit at 768px of window height. Implements
`docs/specs/2026-09-08-hud-refit.md`.

## Detail

**1280×720 is now the minimum supported viewport**, named by this change
and recorded in `docs/STYLEGUIDE.md`. Nothing is designed narrower or
shorter, and the guide's Layout regions were rewritten to match the
screen: the ribbon's "wraps rather than scrolling" sentence is gone
along with the 62px captioned rail.

**Rail and Stores share one left-edge flex column** rather than being
pinned separately to top and bottom — the rail is the item that gives
(`flex: 0 1 auto`, scrolling inside itself), Stores keeps its height
beneath it. That is what makes them unable to overlap at any window
size, with no `calc()` against a stores height that an eighth good
would invalidate. Measured: rail 403px, Stores 249px, so nothing
scrolls from 768px of window height up. **At 720 the rail does scroll,
about 20px, and that is the design** — never an overlap, and the
Outcome bullet was written knowing it. What scrolls is the tool
sections, in a scroller inside the rail: the caption strip sits outside
it, pinned to the rail's foot, because with the strip inside the
scrolled box those 20px clipped the cost line — the rail hiding exactly
the words its icon-only buttons gave up, at the viewport this change
names as the minimum.

**Grouping is UI-side, in `GOOD_GROUP` beside `GOOD_VAR`**, and the
groups are emitted in a fixed `GROUP_ORDER`, never off enum order:
`ItemType` is append-only, so a future wood good lands after Bread and
an emit-a-head-on-change walk would file it under Food. Rejected
putting `group` on `GoodDef` in `sim/goods.ts` — grouping is
presentation, and the sim's table deliberately knows nothing about
painting.

**The caption strip's gold is spent on the active tool only**, and
"active" is read as *the tool the strip is naming is the held one* — so
hovering the tool you already hold keeps the gold rather than dropping
to ink under the pointer. Hover and focus previews of any other tool
are plain ink, because hover is not intent. Keyboard focus is gated on
`:focus-visible`, so a click that already set the tool does not leave
the strip naming a button the mouse merely focused.

**Comments naming the ribbon as the goods' home were truthed up inside
`src/ui/` and the styleguide, and left alone outside it** — `GoodDef.label`
in `sim/goods.ts`, and the good-colour table's rationale in
`render/palette.ts` and `render/movers.ts`, all still say "the ribbon".
The spec's carve-out for comment edits across the boundary named only
`Readout`'s doc in `know/index.ts` when this landed, and the renderer
was explicitly out of scope; `2026-09-08-caption-gold-and-guide-copy`
widened the carve-out to the whole class afterwards, without moving
these. Left on `docs/CLAUDE_TODO.md`.
