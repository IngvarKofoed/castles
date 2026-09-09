# Watchtowers: a den within 24 tiles reads in tenths while a watcher stands inside

The Watchtower is a 1×1 slot building costing 4 planks whose whole output is
knowledge. While its watcher is *inside*, every monster whose **lair** sits
within `WATCH_RANGE` (24, Chebyshev) drops the seeded rhythm error and buckets
in tenths instead of fifths — the inspector bar, the ribbon meter and the
verbal captions all sharpen through `rhythm()` alone, still in words and
segments, never digits. Unstaffing blurs the picture back the same frame.
`SAVE_VERSION` is 9. Implements `docs/specs/2026-09-09-watchtowers.md`
(step 4b).

## Detail

**Coverage is lair-anchored, and that is the design, not a shortcut.** A
schedule is a property of the den, so a prowler wandering past the tower
sharpens nothing and siting a tower is the question *which dens do I want to
understand?* Rejected position-based coverage — precision would flicker as
monsters wander, and it answers the wrong question. Also rejected: a tower
with a recipe that "produces" watch-reports (knowledge is not an item), and
banked knowledge where a once-watched den stays sharp (it deletes the running
labour price that makes information infrastructure).

**Manned or nothing, gated exactly as production is** — `worker` set, the
worker's `slot` still this building, and `inside`. Two consequences are
accepted texture rather than bugs waiting to be filed: the watcher takes meals
like any slot worker, so **coverage pauses for lunch** (an eater has left the
building, so `inside` is 0 for the same reason production stops); and nothing
requires a tower to stand inside the walls, so a forward watcher commutes to
bread through the wilds every game-day.

**The whole sim surface is one function.** `rhythm()` drops the error to zero
and returns `WATCH_BUCKETS` (10); `threat()` and `when()` already read
`buckets` from it and needed no edit, which the browser pass confirmed — the
ribbon's meter went to ten segments with no HUD change. `Rhythm` gained
`watched: boolean` so the panel keys its wording off a fact rather than a
bucket-count comparison. **The homeward branch is deliberately untouched**:
`GoingHome` ends on arrival and not on a clock, so there is no timer for a
watcher to read more finely — it keeps its fixed five-bucket shape while
still reporting `watched` honestly.

**The monster inspector needed two named edits and would have been subtly
broken without the first.** Its rebuild signature now carries `buckets` and
`watched`; before, a staff/unstaff flip whose bucket value happened to
coincide redrew nothing, leaving a stale ten-segment bar and defeating
"returns to fifths the same frame". The hardcoded hours note now keys off
`watched`: **"a watcher knows its hours"** rather than "its hours are read off
the map, never exactly". A *watcher*, not a tower — the price is the pair of
hands.

**`Inspection.watching` is staffing-blind on purpose** (−1 for non-towers).
It counts dens in range whether or not anybody is in the tower, so an
unstaffed tower's panel can honestly say what it *would* watch. The panel's
note is what carries the difference, and it is keyed off the **worker state,
never `staffed`**, so it cannot lie: `watching 3 dens` only while the watcher
is inside, `3 dens in reach — the watcher is away` while they walk or eat,
`3 dens in reach — no watcher` when unstaffed, and `the watcher sees no dens
from here` when nothing is in range (which outranks all three).

**The range overlay is a square because the predicate tests a square.** A
circle of radius 24 would exclude covered diagonal dens — the picture denying
knowledge the player has paid for. Outline only, no interior wash: 49 tiles
across, a wash would tint the world rather than mark a limit. Shown while the
tower tool is held (every tower on the map plus the ghost) or a tower is
selected (its own), never permanently. The ghost's square is queued **first**
so a starved layer can never drop the one being aimed with, and every tower
counts blueprint-or-standing — a boundary that vanished the instant the ghost
was committed would flinch at exactly the moment it is being used.

**`SAVE_VERSION` 9 is an identity rung, and it is for the older build.** No
store field was added; coverage is derived per read like the population cap.
Without the bump an old build would load a kind-7 save cleanly and then crash
on its first frame (`defOf` of an unknown kind is `undefined`), which is the
"loads garbage" ARCHITECTURE.md's versioning policy forbids — so a new
`BuildingKind` rides the future-version refusal that already ships. **No
pinned fixture hash moved**, which is what an identity rung is supposed to
look like.

**`v9.castles` is on its own seed, 20261035, and the seed choice was
measured.** It needs a wood near the centre (a tower costs planks) *and* a den
inside `WATCH_RANGE` — and most seeds with a den that near lose the colony to
it inside two thousand ticks. Twenty-five candidates were run; this one keeps
all five folk and no graves. Caught at 1750 with the tower manned, watching one
den eighteen tiles out, and loaves still in the colony. Two gaps it does not
vouch for: the tower watches **one** den, so the plural wording is pinned by
unit test only; and the recipe builds no food chain, so a few hundred ticks
past the capture the provisions run out — the same kind of trade `v4.castles`
made with its empty `graveMap`.

**The def is the first of two firsts.** It is the game's first 1×1 footprint
and its first slot building with `recipe: null` — `stepWorkshops` skips it,
`generateHaulToInput` never orders it anything, `freeCapacity` gives it no
room, and staffing, eviction and the labour meter all work by table. The
inspector's workshop branch grew one guard: with no recipe it renders the
worker row and the staff/unstaff action, and drops the chain chip, the input
*and output* rows, the produce-until row and the stall note.

**A 1×1 building may not overhang its own tile, and that is a new rule.**
Every other prop overhangs a little — a shed roof is `b.w + 0.16` — and pays
nothing for it, because a 2×2 still has interior tiles whose top face picks
correctly. A 1×1 has none: the cap *is* the tile, so a rim hanging over the
neighbour makes `Picker.tileAt` (which floors the hit position) resolve a
click on the tower's most clickable surface to the tile next door. Measured,
not reasoned: before the trim, six probes around the tower at the opening
zoom selected nothing; after it, forty positions in the same band select it.
The platform and cap now stay inside 1.0 and the taper is unchanged.

**A watch square is refused whole or drawn whole.** `put` drops instances one
at a time and `drawWatchRange` lays its four runs interleaved, so a square
that merely ran out of layer budget rendered as an open box stopping short on
all four sides — a boundary claiming *less* ground than the predicate covers,
which is the one thing this overlay may never do. `drawWatchRange` now checks
`SQUARE_BARS` against the remaining budget before writing anything. Since the
ghost is queued first, what a full layer refuses is always a distant tower.
A tower standing on the hovered tile is skipped for the same family of
reason: two 0.85-alpha outlines in the same place blend to near-opaque, and
the boundary would read heavier over the one tile the tool refuses to build
on.

**Two styleguide recipes landed with the change** (`docs/STYLEGUIDE.md`): the
meters no longer pin a fixed five segments — under a watcher both go to ten,
same rust, same trough, still no digit anywhere — and the watch-range overlay
got its paragraph in the in-world grammar. The rail's tool count went fifteen
to sixteen; the Watchtower fills the Build grid's empty eighth cell, so the
rail's height does not move.

**Not covered.** Nothing exercises two towers with overlapping ranges, or a
tower outside the walls whose watcher is caught commuting. The coarsening for
lunch is reasoned from `leaveBuilding` (an eater has left the building, so
`inside` is 0) rather than played. The 24/25 boundary, the diagonal, the
unstaffed and blueprint cases, the homeward branch and the panel's four
wordings are unit tests; the browser pass proved the ribbon meter at ten
segments, the monster inspector at ten segments with "a watcher knows its
hours", the same monster back to five with the old note after unstaffing, the
tower panel across staff and unstaff, the range square appearing for the tool
(ghost plus standing tower) and for a selection and vanishing on Escape, the
tower's pick, and a pre-tower v8 manual save loading to its own pinned hash
(`0a941d36`) and playing on. `movers.ts` still has no test file, so the
enclosure boundary's re-route through the shared `edgeBar` rests on that
browser pass alone. The range line reads as a dark-green hairline at far zoom
rather than as bright sage — the enclosure boundary's own behaviour, since it
shares the weight, the layers and the keyline, and it was not re-dialed here.
