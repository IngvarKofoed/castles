# Bread: the first deep chain, colonists who eat, and a gate that wants food

Farm → grain, Mill → flour, Oven → bread are three ordinary slot workshops, and
colonists now walk to a loaf and eat it once a game-day. No bread anywhere slows
the colony to 60% and does nothing else — ever. Wanderers arrive only while the
colony holds a loaf per head plus the newcomer, so growth costs a working food
chain as well as beds. Every colony, fresh or loaded, opens with three loaves a
head. `SAVE_VERSION` is 8. Implements `docs/specs/2026-09-08-bread-economy.md`.

## Detail

**The Farm is the first workshop that consumes nothing, and `per: 0` with
`inputCap: 0` is the pinned convention for that** (`Recipe`). Its `input` names
its own output good — a dummy nobody reads — rather than becoming nullable,
which would have rippled a type change through every consumer for one row.
Almost nothing had to learn: `stepWorkshop`'s batch gathering takes an empty
slice and passes, and `generateHaulToInput` goes inert because `freeCapacity`
answers 0. The one real edit is `freeCapacity` itself, which without a
`consumes()` guard would have gone **negative** as the farm's own grain filled
the buffer its dummy input names. The rest is presentation: a one-sided chain
chip (`→ Grain`), no `Input` row, and a stall ladder that can never say "waiting
for" about a recipe with no input.

**A meal is physical and it is a self-errand, not a task.** Priority is
flee > meal > work, checked in `stepColonists` before the pool/slot split. A
colonist due one finishes the stint in hand — a pool worker's claimed task, a
slot worker's running batch, never abandoned — then walks to the nearest *free*
loaf by `sourceForSite`, the same rule a construction site sources by, and takes
it off the map. `Colonist.eating` marks the errand so a slot worker walking to
lunch is not re-routed to its station and a pool worker does not claim work on
top of it.

**"Free" means unreserved, and that quietly makes stockpiles the canteen.**
`generateHaulToStore` claims every loose loaf for tidying before anybody is
hungry, so ground bread feeds people only while no stockpile wants it. Measured
on a fresh colony: the fifteen opening loaves are all reserved by tick 169, all
delivered and free again in the pile by 471, and the colony eats out of the pile
from day two on. An eater must never bypass a reservation — the haul task's item
would vanish, and an *unclaimed* task whose item is gone is never claimed again,
so its `reservedIncoming` on the destination leaks for good.

**Hunger plateaus, and the slowdown is a cadence over whole ticks.** Every work
accumulator in the game is an integer against an integer target, so a hungry
worker's tick is either whole or skipped — a Bresenham pattern that passes
exactly `HUNGRY_FACTOR` of them (`labour/hunger.ts`), offset by colonist id so a
hungry colony does not stop and start in unison. Fractional work would have put
non-integers into the store and therefore into the golden hash. It reaches three
accumulators plus the walk: `c.work`, `b.progress` (a hungry builder builds
slower) and `b.millProgress` (keyed off the workshop's own slot worker, so the
food chain's workers are not immune to the food chain being empty).

**Fleeing is exempt and passes the full budget explicitly.** Threat speed against
a fleeing worker is CONCEPT's central difficulty dial: an empty larder may cost
the colony its output and may never quietly raise its death rate.

**The provision pile lies under the *last* opening tile, not the middle of the
clearing.** A ground item refuses a footprint (`canPlace`), and the centre is
where a player's first building goes — the frozen v1 and v2 fixture recipes place
a stockpile at exactly (128, 128) and proved it. `createSim` writes the item
literals by hand rather than calling `spawnItem`, because `items.ts` reaches
`path.ts` → `walls/` → `buildings.ts`, whose module body reads `ItemType` from
`store.ts`: importing the drop spiral there would evaluate that table before this
module's enums exist, in whichever order a bundler happened to load them. With no
buildings and no walls yet, the spiral's answer *is* the first standable tile.

**Three append rituals, one rung.** `ItemType` += Grain/Flour/Bread with their
`GOODS` rows, their `accept` fields on `Building` and their `-1`s appended to
`limits`; `BuildingKind` += Farm/Mill/Oven. The 7 → 8 rung stamps the three
accept flags on **every saved building** (the v2 precedent: a flag left
`undefined` refuses that good forever while the oven jams at output cap and
nothing can say why), appends exactly its own three `limits` slots, defaults
`hunger` and `eating` to 0, and **grants three loaves per settled colonist** so a
loaded colony gets the same three-day runway a fresh one does. The grant runs
live drop code inside a migration, so it is guarded like the v3 lair pass —
`decode` may only ever throw `SaveError` — and a `dropTile` that returns null on
congested ground is accepted: a shorted grant means hungry sooner, and hungry
only plateaus.

**The gate is exempt when the colony is empty, and that is not a softening.**
With nobody settled, `settled + 1` is unsatisfiable by construction — there is
nobody left to staff a farm — so the arrival loop would stop for good and take
the recovery the housing step exists for with it ("a death frees room, so the
colony can always recover"). A colony wiped to zero therefore gets one pair of
hands back on the ordinary countdown, and the *second* arrival is priced in
bread like everybody else's. Found by review, on a traced state a real colony
reaches: five folk lost to orcs on a push, on day four, with the provisions
gone.

**The tightened gate stops an unfed colony growing, which the housing runs had to
be fed to survive.** `settlers.test.ts`' two pinned runs produced no arrival at
all once the opening provisions ran out three days in, so both now top a larder
up on a fixed cadence — the walk is what that file is for, and the chain has its
own run. The **death-en-route seed had to be re-picked**: on 20260912 the orc now
misses the wanderer entirely, because meals move every timing by a few seconds
and an interception is decided in seconds. 20260918 is the same scenario found
the same way, and a better one — caught early, with the replacement already on
the road.

**The encounter's two wall placements moved (400 → 150, 1650 → 1700) for the same
reason**: meals left the first line half built when the orc arrived, and a
half-built line is a different scenario. Its obituary assertion also changed, and
this one is a correction rather than a retiming: `colonists + graves === 5` was
never an invariant — a grave is a per-tile marker and a second death on a tile
shares it (`2026-09-05-monsters-and-the-hours-they-keep`). This run is exactly
that case, three builders caught at the one segment a monster is camping, so what
is asserted now is that no marker exists without a death behind it.

**Hashes, all re-recorded and all explained in place:** the labour pin
`ade08d30` → `04f53ac6` (shape, plus the meal loop inside the pin), the settling
run `e3cf9525` → `2cecf74f`, the death run `70cb202a` → `3050f53e` (a different
colony — new seed, 30 ticks longer), the encounter `fe31cb4d` → `4e86c393`, and
every fixture's decode: v1 `d01e0770` → `bd689ee3`, v2 → `16ca8dd6`, v3 →
`e8452d51`, v4 → `87af28e4`, v5 → `c38bcff9`, v6 → `251bfc06`, and **v7
`0ca62ff1` → `3d554ddf`, which is no longer a native file** — it walks the bread
rung like every other old save. The files themselves are untouched and stay
frozen.

**`v8.castles` joins them**, on its own seed (20260931: nearest outcrop five
tiles, nearest den ninety-one — the Oven costs blocks, and a 1930-tick recipe on
a seed with a near den can lose the colony it is meant to freeze). It carries
what no earlier file could: the three workshops standing and staffed, grain,
flour and bread in the colony, five hunger clocks at five different readings, and
a colonist **caught mid-meal** with a route to a particular loaf in flight.

**The chain's own scripted run is a third golden run** (`economy/bread.test.ts`),
on that same seed, for the reason `walls/stone.test.ts` exists: the labour pin's
seed has its stone fifty tiles out, so the Oven can never be built inside it.
`tick.test.ts` keeps its seed and gains the meal loop by existing — its colony
opens with fifteen loaves and everybody breaks off to eat.

**Numbers, all tune-by-eye firsts.** `FARM_TICKS` 5 s (~12 grain a day),
`MILL_TICKS_5B` 4 s, `OVEN_TICKS` 5 s, `MEAL_TICKS` one game-day, `HUNGRY_TICKS`
one and a half, `HUNGRY_FACTOR` 0.6, `PROVISION_BREAD` 3. One fully staffed chain
feeds about twelve mouths; at five colonists, staffing all three plus a mason
leaves one pair of hands to carry everything between them, which is the labour
trap arriving on its own.

**A building's stored goods ride at its own model's height now** (`BUFFER_Y` in
`render/props.ts`), not at one shared constant. That constant was the sawmill's
roofline applied to "anything with a recipe" — true while every workshop was a
shed, and a lie the moment one was a flat field and another a dome: the farm's
grain and the oven's bread drew a metre above both. The table has a row per kind
so the next building cannot silently inherit a shed's roof. Found by review's gap
sweep, and the sawmill's and mason's numbers are unchanged.

**The v8 rung guards its buildings per *entry*, not just per array.** The rung
deliberately passes a non-object building through for `assertSim` to refuse, and
`occupancy` reading `.y` off a `null` would have thrown a raw TypeError straight
past `decode`'s "a whole store or a `SaveError`, never anything else" — the exact
promise the guard block exists to keep, one level down. Found by review, on both
risk-flagged slices independently.

**Two more repairs came out of the commit review.** `inspect`'s `inputCount`
was `held(recipe.input)` unconditionally — and a no-input recipe's `input` is a
dummy naming its own *output*, so the Farm reported the grain in its output
buffer as an input count, a number with no buffer behind it. Invisible in the
HUD only because the panel hides that row on `inputCap > 0`, which is exactly
the kind of accident that outlives the reason for it. Gated on `consumes()`, as
`freeCapacity` already was. The Farm's furrow loop also stopped computing a row
it then skipped.

**Known limits, none of them repaired.**

- A hungry colonist whose only free loaf is **unreachable** pays one A\* per tick
  until something changes. The alternative was to sleep the errand on the claim
  cooldown's rhythm, and that cannot coexist with eating promptly: a pool worker
  is idle for exactly one tick between tasks, so a one-in-twenty seek window
  pushes the meal out by a whole task each time it misses. Bounded by there being
  no free bread to find in a breadless colony, which is the common case.
- **The Mill draws as a sawmill**, sharing the timber-workshop prop with the
  Mason exactly as the Mason shares it with the Sawmill. The Farm (a fenced plot
  of worked earth with a hut) and the Oven (a stone dome with a mouth and a
  chimney) have props of their own, because a 3×3 sawmill and a stone-priced
  sawmill would both be lies.
- **Crop growth stages are not drawn** — the Farm's furrows are static, per the
  spec's non-goal.
- Nothing exercises **two farms**, or a second oven, and no run has ever had a
  second one to choose between.
- **A colonist at a meal counts in the ribbon's `idle`.** That readout means
  "holds no task", and an eater holds none — so day two, when every starting
  clock comes due at once, reads `5 idle` with nobody idle. It is the same class
  of over-reading the workshop panel's new `eating` state exists to prevent, but
  the repair is a decision about what `idle` *means* (no task, or available for
  work) that this step never made, so the number is left alone and the question
  is owed. Found by the commit review.
- **A ground pile draws at most eight goods** (`lattice` wraps at `n % 8`), and
  the opening provisions are fifteen loaves on one tile, so for the ~170 ticks
  before they are stockpiled the pile reads as eight. Cosmetic, and the first
  pile in the game big enough to reach the wrap.
- **The suite is dearer**: the chain's run and the provision runout add ~60 s of
  CPU. `threats/encounter.test.ts` remains the worst file — four 2400-tick runs,
  ~90 s on its own, and it timed out once during this build on a machine loaded
  with review agents. Meals cost that run about 5% per tick (measured); the rest
  is pre-existing, and it is still the file to look at first if the 120 s ceiling
  fires again.
- The worker row's **`eating` state and the meal errand surviving a save** are
  pinned by test rather than driven in the browser; so is the flee exemption's
  full-speed run.

Verified in the browser (seed 20260931 plus three fixtures imported through the
menu): all seven goods on the ribbon with the three new pips tellable apart, the
rail's `Farm / 4 logs`, `Mill / 4 logs`, `Oven / 4 blocks`, a 3×3 sage placement
ghost, and the ribbon wrapping to a second line at 900px with the clock still
right-aligned. `v8.castles` logged `load — tick 1930, hashSim 0a941d36` — the
number the fixture test pins — with the Farm panel reading `→ Grain` on one side
of the arrow, no `Input` row, `Grain in colony − 2 / unlimited +` and *working*;
the Mill `Grain → Flour`; the Oven `Flour → Bread`; the Mason still two-sided.
The farm plot and the stone oven read as themselves from across the map. The
migrated `v6` opened holding 18 loaves (3 × 6 settled) with its House panel
reading `Beds 2` / *raises the cap by 2*; run to day 11 at ×4 the bread ran out
and the ribbon read `7 / 7 FOLK · 7 HUNGRY` in ink-dim, with folk visibly slower
and nobody dead. The migrated `v5`, under cap with an empty larder, added the
second note: *no one will come while the table is short*. Console clean (0
errors, 0 warnings) throughout, and the farm's grain and the oven's flour
re-checked resting on the plot and on the dome after the review's buffer-height
fix. 367 tests, lint, `tsc`, production build.

**Drains the population-cap readout item from `docs/CLAUDE_TODO.md`**, which the
House panel's note completes.
