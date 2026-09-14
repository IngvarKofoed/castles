# The area tools drag a box on the ground, not a rectangle on the screen

Chop, Mine, Raze and Level now drag a tile rectangle drawn per tile at each
tile's own ground height, and select by scanning between two picked corners —
so the ground the box covers is the ground it takes from any camera angle, and
a tree behind a ridge no longer escapes a box drawn over it. Releasing one says
what it took in the rail's caption strip, which is the only feedback that
survives a box laid across a crest. Implements
`docs/specs/2026-09-13-map-space-selection-box.md`.

## Detail

**This reverses `2026-09-01-drag-box-designation`'s projection decision and
replaces `2026-09-01-marquee-grammar`'s screen-space grammar.** That entry
rejected unprojection because "a flat-plane unprojection would not stay correct
over uneven terrain", and the objection stands — for unprojecting a box's
corners onto a ground plane. It does not apply here: both corners come from
`tileFrom`, a raycast against the real terrain mesh, exact at any height, which
is how the wall tool has picked its tiles since `2026-09-02-wall-l-drags`. The
screen marquee is gone rather than kept — the DOM element, its CSS, and
`showMarquee`/`hideMarquee` — because leaving it available "for some future
tool" is how two grammars for one gesture survive.

**`boxTo` is the "has the drag started" latch, which is why no third flag
replaced `marqueeing`.** It stays null until the pointer has travelled past
`CLICK_SLOP` and thereafter only ever moves, so a drag that wanders back inside
the slop is still a drag — the sticky behaviour the old flag had, preserved
deliberately rather than recomputed from the release position, which would have
turned an out-and-back drag into a single-tile click.

**Every released box reports its count, zero included — `no trees`, `no
tiles`.** The spec asks for "the number of tiles the command carried"; when the
command is not sent at all (nothing eligible, or a levelling drag whose press
tile named a height labour may not leave a tile at) the strip still says so,
because a box that caught nothing and a box whose marks are all behind a rise
look identical on screen, and silence is the one answer the player cannot act
on. The report is **gold** and it **outranks the active-tool caption**; a rail
preview *claims* the strip rather than merely outranking it, so the count does
not reappear when the pointer leaves the button again. A press clears it, which
is what "the next gesture" means. `RailCaption` became a union of a tool key
and a report string — a count belongs to no button.

**Both corners are clamped to the map, and drawing and selection share the
clamp.** `Picker.tileAt` really can name a tile one past the east or south
edge: the mesher emits a side face on the plane `x = size` for every border
column (`heightAt` reads off-map as height 0), and a hit on that face floors to
`size`. That is not a harmlessly out-of-range tile — `tileIndex(size, y, size)`
is tile `(0, y + 1)` — so an unclamped scan would have designated a column on
the far side of the map from the one the box drew, and the sim's own
`inBounds` guards would not have caught it because the wrapped index is
in bounds. `wallRun` has guarded the same pick since `2026-09-02-wall-l-drags`;
the projection pass this replaced was immune only because it never used the
corners as indices. `boxBounds` in `pick.ts` is now the one place that ordering
and clamp live, and `drawSelection` reads it too, so the box that draws and the
box that takes cannot disagree about where the map stops. Pinned by a test.

**`isMarqueeTool` is now `isAreaTool`.** The set it names is unchanged; the word
it was named after is gone.

**Outline complete, fill partial — a guarantee here, not a hope.** The box
reuses the enclosure wash's budgets: `MAX_BOUNDARY` for the outline,
`MAX_INSIDE` for the fill. A `w × h` box costs `2w + 2h` bars, peaking at 1,024
for a box over the whole map, so the outline cannot truncate at this world size;
the fill goes partial above roughly 128×128. That is a deliberate divergence
from `drawWatchRange`'s refuse-the-square-whole rule (`2026-09-09-watchtowers`):
a watch square drawn short claims less reach than the tower has, which is false,
whereas an unshaded interior is merely less pretty. The fill loop breaks a row
at a time once the layer is full, so a map-wide box does not pay 65k dropped
`put` calls every frame.

**Gold, and heavier than a mark.** The ghost's sage and rust mean *valid* and
*invalid*, and the box makes no claim about whether the ground in it can be
worked. Sharing a hue with the designation marks it is drawn over is what makes
the weight load-bearing: `0.11` against `MARK_LINE`'s `0.08`.

**`pick.test.ts`'s selection blocks take no camera, and that retires a
limitation recorded twice.** Both `2026-09-01-drag-box-designation` and
`2026-09-02-wall-l-drags` closed by noting nothing tested the gesture against a
rotated or tilted camera. Selection no longer reads a camera at all, so the gap
stops existing rather than staying untested; a test now throws a ridge across a
held box and asserts the result does not move.

**Left undone, and on `docs/CLAUDE_TODO.md`:** seven comments across five `sim/`
files still call this gesture a "marquee". `src/render/` and `src/ui/` were
truthed up here; the sim ones sit across the boundary and were out of scope,
the same split `2026-09-08-stores-panel-and-icon-rail` made for "the ribbon".

**Not covered.** A box dragged out over water is reasoned, not played: the
predicates select nothing there and the plates sit under `WATER_SURFACE_OFFSET`,
but no browser pass put one over the sea. **Nobody watched a specific
crest-hidden tree get marked**, either: that half of the claim rests on the
ridge-invariance unit test and on there being no camera left in the selection
path at all, not on a screenshot — counting tree bases by eye through a canopy
is what a browser check of it would have come down to. The two-angle equality
check was
landmark-pinned rather than exact — the same two den tiles at azimuths ~90°
apart both reported `103 trees`, with the game paused so neither drag could
pollute the other — and the exactness itself rests on the unit tests. Escape
mid-drag was checked on the **effect** for Chop, Mine and Raze (the following
uncancelled box found all 154 trees / 122 outcrops / 19 segments still unmarked,
and the ribbon's `idle` held at 5 through the chop case); for Level that control
cannot work, because `levelTilesInRect` deliberately returns already-marked
tiles, so its cancel is pinned by the caption reporting no count — all four
share one `cancelDrag`. At far zoom the gold outline reads as a hairline, the
enclosure boundary's own behaviour at that distance and not re-dialed here.
No command shape, save format or golden hash moved; `movers.ts` still has no
test file, so `drawSelection` rests on the browser pass alone.

Verified in the browser (seed 20260901, 1280×800): a box held across a rock
plateau with its outline stepping up the cliff and a visible faint gold fill,
released to 46 gold marks and `46 trees` in the caption; the count surviving a
rail hover as plain `Chop` and not coming back after it; a press under the slop
falling through to the single-tile click with the strip back on the tool name;
a ~150-tile box showing all four sides of its outline. Console clean (0 errors,
0 warnings). 435 tests, lint, `tsc`, production build.
