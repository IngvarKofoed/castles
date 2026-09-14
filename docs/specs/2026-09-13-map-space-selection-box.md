# The area-tool drag box becomes a square on the map

The four area tools — Chop, Mine, Raze and Level — currently drag a
screen-space marquee: a DOM rectangle, resolved on release by projecting every
candidate tile and testing whether its base lands inside. This replaces that
with a **tile rectangle**: the box is two picked tiles, it draws on the ground
as a gold outline over a faint fill that steps over terrain, and selection is a
scan of the tiles between the corners. The wall tool's L-drag is a different
gesture and is untouched.

## Outcome

**What you get:**

- Chop, Mine, Raze and Level drag an axis-aligned tile rectangle on the ground
  instead of a screen rectangle, and its outline sits at each tile's own ground
  height — so it steps over a rise rather than cutting through it.
- The box covers the same ground from any camera angle, and tiles hidden behind
  terrain are included: a tree behind a ridge no longer escapes a box drawn
  over it.
- Releasing a box reports what it took — "47 trees" — in the rail's caption
  strip, which is the only feedback that works when the marks are behind a rise.
- `docs/STYLEGUIDE.md` states the world-space grammar, so the next area tool
  copies it instead of inventing one.

**How to verify:**

- With Chop active, drag a box over a wood running up a hillside: the outline
  steps over the rise, and on release every tree between the two corners is
  marked — including any the crest was hiding — and the rail caption reports
  how many were taken.
- Orbit roughly 90° and drag over the same patch again: the same tiles are
  marked.
- Drag a box covering most of the map: the outline is complete on all four
  sides, and interior shading is the only thing that may stop part-way.
- Press Escape mid-drag, then check the tiles rather than the overlay: nothing
  is marked. The same holds for Mine, Raze and Level.

## Key decisions

- **The box is two picked tiles, not two screen points** (extends). Press and
  cursor both go through `tileFrom` (`src/app/main.ts:177`), which raycasts the
  real terrain mesh — exactly what the wall tool already does for
  `runFrom`/`runTo`. `main.ts` grows `boxFrom`/`boxTo` alongside them.
- **Selection becomes a rectangle scan** (breaking). `tilesInRect` in
  `src/render/pick.ts` loses its projection loop and its `camera` / `canvas` /
  `Rect` parameters; it iterates the tiles between the corners and applies the
  same four per-tool predicates, unchanged. This **reverses**
  `docs/changelog/2026-09-01-drag-box-designation.md`, which chose projection
  over "unprojecting the box onto the ground plane" — see Alternatives.
- **A fourth overlay region, in gold** (extends). `selFill` / `selKeyline` /
  `selEdge` join the mark, ghost, enclosure and watch layers in
  `src/render/movers.ts`, drawn by a new `drawSelection` built from the
  existing `plate()` and `edgeBar()`. Gold because gold is player intent; the
  ghost's sage and rust mean validity and would be a lie here — the box makes
  no claim about whether anything in it can be worked.
- **Outline complete, fill partial past the budget** (diverges). The enclosure
  wash's treatment, and deliberately *not* `drawWatchRange`'s refuse-the-square-
  whole rule: a watch square that draws short claims less reach than the tower
  has, which is a false statement, whereas a box whose interior stops shading
  is merely less pretty. The two budgets are the enclosure wash's own —
  `MAX_INSIDE` (16,384) for the fill, `MAX_BOUNDARY` (4,096) for the outline —
  which are sized for this exact shape of overlay, and at this world size the
  outline cannot truncate anyway (see Design).
- **The screen marquee is removed, not kept** (breaking). The `.marquee`
  element, `showMarquee` / `hideMarquee` (`src/ui/hud.ts:393`), the CSS block at
  `src/ui/hud.css:711`, and the grammar at `docs/STYLEGUIDE.md:248` all go.
  Leaving the screen box available for "some future tool" is how two grammars
  for one gesture survive.
- **Tiles hidden behind terrain are selected, and the release says how many**
  (new). A tile inside the rectangle is inside the box whether or not the camera
  can see it — today a tree behind a ridge escapes a box drawn over it, and
  after this it does not. Because that cuts both ways, the release reports its
  count in the rail's caption strip: see *Saying what the box took*.
- **The box's outline is heavier than a designation mark's** (reuses). `0.11`,
  the weight the enclosure boundary (`INSIDE_LINE`) and the ghost border
  (`BORDER`) already use, against the marks' `MARK_LINE` of `0.08`. The box now
  shares a hue and a primitive family with the marks it draws over, so weight is
  what keeps "the region I am selecting" from reading as "more marks".
- **The click slop stays in screen pixels, in one form** (breaking). Six pixels
  of travel still separates a click from a drag, but `main.ts:307` already
  expresses that test inline as `Math.hypot(…) > CLICK_SLOP`, and with the
  marquee gone that becomes its only expression. So `Rect`, `rectFrom` and
  `rectSpan` lose their last callers and go, along with their tests — the box's
  own "has the drag started" check uses the same inline hypot. The single-tile
  click paths are untouched.

## Goals

- A drag box that means the same thing at every camera angle and over any
  terrain: the ground it covers is the ground it takes.
- One gesture grammar across all four area tools, written down where the next
  area tool will find it.
- Remove the projection pass and its behind-the-camera edge case rather than
  carry both models.

## Non-goals

- The wall and gate tools. Their left-drag is a wall run and stays an L.
- Any change to what each tool considers eligible. The four predicates —
  unmarked trees, unmarked walls including blueprints, `canMine` outcrops,
  `canTerraform` ground off the target height — are lifted across as they are.
- Subtractive or toggling boxes. The marquee only ever adds; taking a mark back
  is still a click, per `2026-09-01-drag-box-designation`.
- Rotated or non-rectangular selection. The box is axis-aligned to the world
  grid, not to the screen.
- Previewing *which* tiles the box will take. The held box draws the region and
  nothing else — the gold marks appearing on release are what say what was
  caught, as they do today, and the release's count says how many. A live
  per-tile highlight is also precisely what would blow the fill budget on a
  large box. Worth revisiting once someone has dragged a few.

## Design

### The gesture

On `pointerdown` with an area tool active, `boxFrom = tileFrom(e)`. On
`pointermove`, `boxTo = tileFrom(e) ?? boxTo` — the wall run's rule, so a cursor
that slides off the terrain onto **sky** holds the last good corner rather than
collapsing the box or clamping to the map edge. The box freezes at its last
valid extent until the cursor comes back over ground, which is what makes the
wall drag and the area drag feel like one gesture.

Sky is the only thing that returns null: `pickTargets`
(`src/render/chunks.ts:48`) raycasts the terrain meshes alone, and those mesh
every tile including the seabed under water, so the sea is pickable ground as
far as this gesture is concerned. A box may therefore extend out over water,
where the four predicates select nothing — it draws and then takes nothing,
which is the honest picture. Its plates sit below the water surface
(`WATER_SURFACE_OFFSET` is 0.13, well above the overlay offsets below), so the
part of the box over sea reads as submerged rather than floating. The box only becomes live once the pointer has travelled
past `CLICK_SLOP`, which is measured in screen pixels exactly as it is today; a
press under it is still the single-tile toggle, and `boxFrom === boxTo` is a
legal one-tile box for a drag that stayed inside its tile.

A press that starts off the terrain leaves `boxFrom` null and the gesture is
dropped, matching `wallRun`'s "a drag starting off-map is empty".

Cancelling is unchanged in shape but must reach the new state:
`cancelDrag` in `main.ts` clears `boxFrom`/`boxTo` the way it already clears
`runFrom`/`runTo`, and right-click and Escape keep working through it. Per
`2026-09-01-drag-box-designation`, a cancel has to be checked on the **effect**
— whether the command fired — not on whether the overlay disappeared.

Level's `levelTarget` capture is already `tileFrom` at `pointerdown` and needs
nothing: the press tile it reads is now the same press tile the box starts from,
which it previously only coincidentally was.

### What gets selected

`tilesInRect` becomes a double loop from `min` to `max` on each axis, pushing
`tileIndex(x, y, size)` for every tile the predicate accepts. The four callers
lose their `camera` and `canvas` arguments and pass the two corners instead.
Both corners come from `tileFrom`, so both are already on the map and no
clamping is needed.

The cost moves the right way: today's pass is `size²` predicate tests plus a
projection per accepted tile, however small the box (`src/render/pick.ts:122`
runs `include` first and projects only what passes); after this it is `w × h`
predicate tests and no projection at all, so a small box is cheap.
A map-wide box is 65,536 predicate tests on pointer-release only, which is the
same order as the scan the terraform path already runs.

The commands are unchanged — one `designateChop` / `designateMine` /
`designateRaze` / `designateTerraform` per gesture, carrying a tile-index list.
Nothing about the command log, the save format or the golden replay changes
shape.

### Saying what the box took

On release, the number of tiles the command carried goes to the rail's caption
strip — `railCaption` (`src/ui/hud.ts:186`), the fixed-height strip that already
names what the active tool will do and already has a precedence ladder. It
outranks the active-tool caption and holds until anything else claims the strip:
a rail hover, a tool change, or the next gesture. No timer, so it stays a pure
function of its inputs and its test can pin the precedence.

**This is the feedback that survives occlusion**, which is why it is in scope
when a live per-tile preview is not. A box drawn across a ridge designates the
far slope too, and `src/sim/labour/tasks.ts` has no enclosure gate — those marks
dispatch colonists, possibly outside the wall — while the gold marks that would
show it are themselves behind the crest. A count is the one signal that reaches
the player regardless of what the camera can see, and it costs nothing against
the fill budget. Canopy tinting already softens this for Chop; Mine, Raze and
Level marks are all ground-level and have no equivalent.

### Drawing the box

`sync` takes one more argument, the live box or null, and `drawSelection` runs
after the enclosure and before the ghost. `top` is the tile's ground height
**+0.025**, passed to both the fill and the outline exactly as `drawEnclosure`
passes one value to `plate` and `boundary`; `edgeBar`'s own internal `+0.01`
then puts the gold edge at +0.035. That clears every overlay it can share a
frame with — the enclosure wash at +0.015 and the designation marks at +0.02 —
which matters because Raze is in both `isMarqueeTool` and `isWallTool`, so the
sage wash and a gold box genuinely do draw together. For each tile in the
rectangle, `plate(this.selFill, x, y, top)` at that height; for each tile
on the rectangle's border, `edgeBar(this.selKeyline, this.selEdge, …)` on its
outward faces, with the four corners getting a bar on each of their two outward
faces — the `drawWatchRange` pattern, which exists for precisely this shape.
`edgeBar` takes its thickness from `INSIDE_LINE`'s `0.11`, which is the heavier
weight this box wants anyway.
Because every tile is placed at its own height, the box steps over a rise
instead of cutting through it.

**The outline cannot truncate at this world size.** A `w × h` box costs
`2w + 2h` bars — the corners are double-visited *inside* the four runs, exactly
as `SQUARE_BARS = 4 * (2 * WATCH_RANGE + 1)` already counts them, so there is no
separate corner term — which peaks at 1,024 for a box covering the whole 256²
map, comfortably inside `MAX_BOUNDARY`'s 4,096. The fill costs `w × h` plates
against `MAX_INSIDE`'s 16,384 and so goes partial above roughly 128×128, exactly
as the enclosure wash does and for the same documented reason. So "outline complete, fill partial" is
a guarantee here rather than a hope, which is what makes diverging from the
watch range's refuse-whole rule safe.

**Why the box gets a fill where the watch range does not.** `drawWatchRange`
argues against an interior wash on a large square, and the argument is sound
for what it describes: a permanent-ish overlay 49 tiles across would simply tint
the world. The selection box is different on both counts — it exists only while
the drag is held, and its fill is doing the enclosure's job of saying which side
of the line the selected ground is on. `docs/STYLEGUIDE.md` already grants the
marquee a lighter fill than the designation marks "since it can cover half the
screen"; that reasoning survives the move to the ground, and the fill stays at
the lighter value.

**The strongest argument against it, and why the fill stays anyway.** A
rectangle's interior is entirely implied by its border, where an enclosure's
arbitrary shape is not — so the wash's precedent is at its weakest here, and the
fill is the only thing in this design that needs a budget at all. It stays
because the box is drawn over ground that may already be marked, and a border
alone leaves "inside the box" and "outside it" distinguished by nothing but a
line the terrain can partly hide. Recorded here because the question has now
been asked twice; the answer is not that the argument is wrong, but that
legibility over marked ground outweighs one layer.

### What goes away

The `.marquee` DOM element and its CSS block, `showMarquee` / `hideMarquee` and
their callers, the `marqueeing` flag in `main.ts` (replaced by `boxFrom`), the
`Rect` type and its two helpers, and the projection body of `tilesInRect`
including its `PROJECT` vector and behind-the-camera guard.

`src/render/pick.test.ts` goes with them: its `canvasStub` and `topDownCamera`
helpers and the four selection `describe` blocks all pass a camera and a canvas
that no longer exist, so they are rewritten against the two-corner signature
rather than adapted. That rewrite **retires a limitation recorded twice** — both
`2026-09-01-drag-box-designation` and `2026-09-02-wall-l-drags` close by noting
that nothing tests the gesture against a rotated or tilted camera, because
`pick.test.ts` uses a top-down orthographic one. After this, selection does not
read the camera at all, so the gap those entries flagged stops existing rather
than staying untested.

`docs/STYLEGUIDE.md:248` is rewritten from a screen-space rule to the
world-space one: gold keylined outline traced per tile on the ground, faint gold
fill, square corners, solid lines, alive only while the drag is held, fill
degrades before the outline does. `isMarqueeTool` keeps its name or takes a
better one, but the set it names does not change.

The changelog entry for this work must cite both
`2026-09-01-drag-box-designation` (whose projection decision it reverses) and
`2026-09-01-marquee-grammar` (whose grammar it replaces), so the chain stays
greppable.

## Alternatives considered

- **Extending the `Ghost` union** with an area kind. Saves a `sync` argument,
  but the ghost layers are sage and rust — validity colours a selection box has
  no business wearing — so it would need new layers regardless; `MAX_RUN` is
  sized for a wall L rather than an area; and `Ghost` would stop meaning "what
  the placement tool is aiming at".
- **Map-space selection with a screen-space box**: take the tile rect from the
  two picked corners but keep drawing a projected quad in the DOM. Smallest
  diff and no instance budget at all, but the quad cuts through a rise rather
  than stepping over it — and the drawing is the half the player actually sees.
- **Keeping the projection pass.** `2026-09-01-drag-box-designation` rejected
  unprojection because "a flat-plane unprojection would not stay correct over
  uneven terrain." That objection was aimed at unprojecting the box's corners
  onto a ground plane, and it stands. It does not apply here: the corners come
  from a raycast against the real terrain mesh, which is exact at any height,
  and the wall tool has been getting its tiles that way since
  `2026-09-02-wall-l-drags`.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** Seven or eight files, but one thread: the gesture
  runs `main.ts` → `pick.ts` → `movers.ts`, the signature change on the four
  selection functions cascades through all of them, and the release path that
  sends the command is the same one that sets the caption count. Split two ways
  and both agents live in `main.ts`.
- Opus rather than Sonnet because the `(new)` and `(breaking)` decisions have to
  be *interpreted* — what the overlay's draw order and offsets have to clear,
  where the caption's precedence sits — not transcribed.
- Not ultracode: no command shape, save format or golden-hash change, so if this
  proves wrong it is a revert rather than a migration.
