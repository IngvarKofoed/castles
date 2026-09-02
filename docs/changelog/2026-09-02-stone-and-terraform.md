# The stone tier: quarrying, the mason, stone walls, and levelling ground

The expansion loop is complete. Rock outcrops can be quarried — for stone
*and* for the flat ground they leave — a mason cuts two rock into a block,
and stone walls and gates rise on the 3a machinery at one block a segment.
Pool workers also level ground now, paid for in people-hours alone. Two slot
workshops against five colonists makes staffing a real decision. `SAVE_VERSION`
is 3. Implements `docs/specs/2026-09-02-stone-and-terraform.md` (step 3b).

## Detail

**Every serialized enum appended, and the wall layer stopped hand-writing its
predicates.** `ItemType` += `Rock`/`Block`, `BuildingKind` += `Mason`,
`TaskKind` += `Mine`/`Terraform`, `WallState` += the four stone states — the
append-only rule `2026-09-02-palisade-walls` set, for the same reason: the
numbers are in every save. The five wall predicates became lookups into one
`WALL_DEFS` table, so the four states cost one row each instead of five
functions each needing to remember them. **Not one consumer was edited**,
which is that folder's rule earning its keep — `state === WallState.None` is
the single comparison the renderer and pickers are still allowed.

**A goods table, because the fourth good would have been the fourth copy.**
`sim/goods.ts` holds each good's name, ribbon label and stockpile flag;
`isLoose`, `sourceForSite`, `generateHaulToInput` and the old
`sawmillOutputFull` are now recipe- and table-driven, and so are the ribbon's
readouts (`Readout.goods` indexed by type, replacing named `logs`/`planks`
fields — the old `else planks++` was already wrong for a third good) and the
stockpile panel's rows. A workshop **is** its recipe: `BuildingDef.recipe`
carries input, output, ratio, ticks and caps, so the mason is a table row and
`economy/workshop.ts` names neither building.

**SAVE_VERSION 3's load-bearing half is the accept flags, not the layers.** The
rung zero-fills `mineMap`/`terraformMap` *and* stamps `acceptRock`/`acceptBlock`
= 1 on every building in the file. Without that, a migrated stockpile's flags
read `undefined`, every stockpile refuses rock and blocks **forever**, and the
mason jams at output cap with nothing in the game able to explain why — no
error, just a colony that stops working. The v1 and v2 pinned decode hashes
moved (`507f1746` → `cf8c3fd7`, `680d0d2e` → `02dba047`) for exactly that rung;
both files are untouched and stay frozen.

**The v3 fixture has its own seed, 20260904**, because the default fixture
seed's nearest outcrop is ~47 tiles from the colony and a command-only recipe
would spend thousands of ticks walking before one block existed. A fixture
carries the format's state, not a particular map.

**One grid walk for four designation layers.** `generateChop`/`Mine`/`Raze`/
`Terraform` merged into `generateDesignations`: the walk *is* the cost at 256²,
and five scans a tick measured ~7× more expensive per tick than two in the test
runner (the suite was timing out on 1500-tick runs). Their relative order is
immaterial **because none of the four reserves an item** — claim order is
`TASK_PRIORITY`, unchanged in kind. A future designation kind that *does*
reserve something must not join this pass; it belongs at its own place in the
priority run. This is the cheap half of the indexing
`2026-09-02-palisade-walls` called for.

**Quarrying needs no eviction; levelling does.** A mined tile drops to its
**lowest** orthogonal land neighbour (clamped 2–6), so the result is always
step-reachable from that neighbour and can never strand anybody in a pit. A
levelled tile can, so `stepOffTile` walks whoever is standing there off it
first — `escapePath` cannot do that job, because it only fires for a walker
whose tile is *impassable* and a tile about to be lowered is perfectly
passable. The cost is that their errand is handed back and any carried log
drops, the same charge a finishing wall segment already makes. The upper clamp
is what guarantees worked ground never re-derives to rock, so **the map's
outcrops are the colony's whole stone budget** — deliberately (CONCEPT: finite
resources are what pull expansion outward).

**And the ground genuinely waits for the tile to clear.** `stepOffTile` hands
out a *route*, and a route is walked on the following tick, so lowering the
tile the same tick it was issued is what strands people: one step down turns a
neighbour at +1 into a neighbour at +2, and a colonist whose only legal
neighbours were the high ones is then in a pit `findPath` cannot get them out
of — permanently, since every later step of the same job digs it deeper. So
`stepOffTile` reports whether anybody is still standing there *with a way off*,
and the height step is deferred until they are gone. Somebody with no route at
all is already stuck, so the work is not held for them and cannot livelock on
one.

**Items on a levelled tile ride the height change; they do not cancel the
job.** Ground items are eligibility at *designation* only (`canTerraform`);
what is re-asked at every step is `keepsTerraforming` — terrain, height band,
trees, walls, buildings. Asking the whole designation test each step meant the
tier defeated itself: `stepOffTile` drops a carrying bystander's cargo through
the spiral, the spiral starts *on* the tile (unlike a finished wall segment, a
levelled tile is perfectly droppable), and the arriving log then read as
"no longer levellable" — a half-finished shelf and a silently cleared
designation, with nothing in the game able to say why.

**The walker's per-step gate now checks height, not just passability**
(`canStepTo`, exported from `path.ts` so one rule has one home). Ground-changing
labour can raise a cliff across a route already planned; without this a
colonist walks up a four-block wall of earth. Same repath-don't-abandon
behaviour `2026-09-02-stale-route-repath` established.

**A corner gate connects nothing.** Movement is 4-neighbour, so a gate on a
ring's corner has both its inward neighbours occupied by the two wall runs
meeting there: the ring encloses, and everyone inside is trapped. Found while
writing the loop test, where the trapped colonists then starved the build tasks
by claiming and failing them on cooldown. A property of the grid rather than of
this tier, but it is the kind of thing that reads as a bug in the hand.

**Golden hash `11a997a8` → `430213d1`**, both shape and behaviour, deliberately:
the store gained two layers and two flags per building, and the scripted log
gained a mason placed and staffed, three outcrops marked, a stone L-drag and a
3×3 levelling area. The plank assertion still passes with *two* workshops
staffed and three colonists in the pool, which is what says the number moved
for the tier and not for something quiet.

**Verified in the browser** (seed 20260904, whose outcrops are close): a
marqueed outcrop quarried away to flat ground carpeted in its own rubble, 144
rock from 36 tiles; the marked rock's top face measured +13 red / −42 blue
against an untouched neighbour at 0; the mason's `Rock → Block` panel, 2:1
consumption, and both workshops reporting *output full — nowhere to put the
blocks* with the labour meter at 3 pool / 2 slots; a stone segment built inside
a palisade ring reading as coursed masonry beside it; the enclosed count 12 →
11 the instant a stone line was drawn on enclosed ground and back to 12 when it
was razed, with the block refunded; a palisade segment razed returning its log
and opening the ring to 0; a levelling marquee marking only the tiles that
differ — rock, water and already-level tiles all skipped — and the shelf flush
a minute later; and `v1.castles` imported through the menu logging `load — tick
400, hashSim cf8c3fd7`, the same number the fixture test pins, then taking a
stone line, a mason and a levelling area straight away. Console clean
throughout (0 errors, 0 warnings). 216 tests, lint, `tsc`, build.

**Not covered.** The full build-behind-then-raze loop — stone ring up, old
timber line down, enclosed count dipping without ever collapsing — is pinned by
`walls/stone.test.ts` and *not* reproduced whole in the browser; what the
browser showed was that loop one segment at a time. `MINE_TICKS`,
`MINE_ROCK`, `MASON_TICKS` and the stone build times are tune-by-eye first
values; nobody has checked that outcrop coverage × `MINE_ROCK` prices several
stone rings, which the spec's non-goals ask for once. The stone geometry is
tested for silhouette and solidity, not for its junctions (the palisade's arm
tests cover the shared structure). Nothing tests the new tools' DOM, as with
the rest of `src/ui/`. And the 3a limit that raze-then-place on one tile waits
for the log to be hauled away showed up in play again — it now also blocks
closing a gap with stone.

**Known: quarrying can leave a one-tile pocket nothing can reach.** Erosion
takes the *lowest* land neighbour clamped to `GROUND_MAX` = 6, and rock is
whatever stands at 7 or 8 — so an interior outcrop tile whose every land
neighbour sits at 8 comes down to 6, two steps below all of them. The rock it
dropped is then unreachable and its haul task retries on cooldown until a
neighbour is quarried down too, at which point the pocket heals. Left as is
deliberately: the upper clamp is the thing that keeps worked ground from
re-deriving to rock, and softening it to keep the tile step-reachable would
trade the finite stone budget for the edge case.
