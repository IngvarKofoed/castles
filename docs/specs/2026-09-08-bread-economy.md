# The bread economy: farms, hunger, and the tightened gate

Step 5b: the first three-step chain — Farm → grain, Mill → flour,
Oven → bread — built entirely as slot workshops on the existing recipe
machinery; colonists who eat one meal a game-day by walking to bread and
eating it; hunger that slows work and never kills; and the wanderer gate
tightened from beds alone to beds *plus* a bread surplus. Three more
slots against the same pool is CONCEPT's labour trap at full depth, and
farmland is the first building that makes enclosed ground itself scarce.

## Outcome

**What you get:**

- The first deep chain: Farm (grain, from nothing, slowly), Mill
  (grain → flour) and Oven (flour → bread, stone-priced) as ordinary
  slot workshops — hauling, filters, ceilings, stall notes and the
  produce-until row all work on all three goods from day one.
- Colonists eat: one meal a game-day, walked to and taken from wherever
  bread sits; a breadless colony slows to 60% and nothing worse ever
  happens.
- Growth costs food: wanderers arrive only while the colony holds a
  loaf for everyone plus the newcomer, on top of the beds gate.
- A provisioned start: fresh colonies and migrated saves alike hold
  ~3 loaves per settled head, so hunger never bites before the player
  could possibly act.

**How to verify:**

- Build and staff the chain: grain leaves the farm, flour the mill,
  bread the oven, all through stockpiles; the Farm panel shows a
  one-sided chain chip ("→ Grain") and a working produce-until row;
  the ribbon's goods cluster shows all seven goods.
- Let bread run out: the ribbon quietly reads "· N hungry", folk
  visibly slow, and work continues; bake again and both signs clear.
  Nobody dies, nothing alerts.
- With beds free but bread below settled + 1, no wanderer comes; bake
  past the bar and the arrival countdown resumes.
- A House panel reads `Beds 2` with the note "raises the cap by 2",
  and the readout item is gone from `docs/CLAUDE_TODO.md`.
- Load a v7 save: it plays unchanged plus ~3 granted loaves per settled
  colonist; fixtures v1–v7 keep loading; the golden drift tests pass
  (pins re-record across the scripted runs — meals move timings, so
  the ripple is wider than the store shape); tests and lint pass.

## Key decisions

- **Farm, Mill and Oven are slot workshops off `BUILDING_DEFS`**
  (extends). `BuildingKind` appends Farm = 4, Mill = 5, Oven = 6. Mill
  (grain → flour) and Oven (flour → bread) are the Mason move repeated —
  one def row each, zero new machinery: hauling, ceilings, stall notes,
  panel rows and the produce-until control all come off `recipeOf()`.
  The Farm is 3×3 — deliberately the biggest footprint in the game, a
  nudge toward land pressure. Honestly stated: the real outward pull
  this step is the **Oven's block cost** (stone wants outcrops);
  acreage-hungry farming that genuinely forces expansion is later
  tuning, not 5b.
- **The Farm's recipe consumes nothing: `per: 0`, `inputCap: 0`**
  (extends `Recipe`). The representation is pinned so two builds can't
  diverge: `input` keeps its required type (a dummy — set it to
  `Grain`; never nullable, which would ripple a type change through
  every consumer), and `per: 0` with `inputCap: 0` is the no-input
  convention. Most consumers then need **no edit at all**:
  `stepWorkshop`'s batch gathering takes an empty slice and passes,
  and `freeCapacity` / `generateHaulToInput` go inert off
  `inputCap: 0`. The real edits are presentation: `inspect`'s chain
  chip renders one-sided ("→ Grain"), its input row is suppressed, and
  its stall ladder must never say "waiting for" on a `per: 0` recipe —
  "at limit" or "output full" only.
  Ceilings apply unchanged — the Farm is a recipe workshop, so
  production control's "any workshop with a `recipeOf()`" promise is
  cashed, and grain never needed the raw-good exclusion.
- **Meals are physical, and a meal break is a self-errand** (new — the
  one genuinely new colonist behaviour). Priority: flee > meal > work.
  A colonist due a meal finishes the stint in hand (a pool worker's
  claimed task, a slot worker's running batch), then — instead of the
  next claim or batch — walks to the **nearest free bread** by the same
  sourcing rule construction sites use (`sourceForSite`: ground,
  stockpile, or a workshop's output buffer). "Free" means unreserved
  (`isFree`), and that makes **stockpiles the canteen in practice**:
  `generateHaulToStore` reserves loose bread for tidying before
  colonists step, so ground loaves and the oven's buffer feed anyone
  only while no stockpile wants them. Eaters never bypass a
  reservation — an eaten reserved loaf would strand its haul task and
  a unit of the stockpile's `reservedIncoming` forever. The arrival
  rule, pinned: with `eating = 1` and the route exhausted, consume the
  lowest-id free bread on the colonist's own or an adjacent tile, or
  stored in a building whose footprint is adjacent; else re-seek — the
  rule a save mid-meal resumes through. A slot worker steps out
  through the existing `leaveBuilding` and walks back via
  `stepSlotWorker`, untouched. No item reservation for meals: a lost
  race to the last loaf simply re-seeks next tick — including the one
  synchronized moment, day two, when every starting clock comes due at
  once over the provision pile, resolved in id order like everything
  else. One stated cost of honoring reservations: the tick the first
  stockpile activates, tidy-hauls reserve the whole provision pile at
  once, and the loaves become eatable again only as each lands —
  roughly half a game-day of possibly missed meals, accepted because
  hunger only plateaus, and because exempting bread from tidying would
  jam the oven's two-slot buffer instead.
- **Hunger plateaus, never spirals** (reuses CONCEPT's no-spiral law).
  `Colonist.hunger` counts ticks since the last meal. At `MEAL_TICKS`
  (one game-day) they seek bread; at `HUNGRY_TICKS` (1.5 days) with
  none found they keep working at `HUNGRY_FACTOR` (60%) walk and work
  speed — and that is the whole penalty. Nobody dies, nobody stops,
  nothing alerts. No bread anywhere means a slower colony, exactly as a
  starved workshop means a flat output. **Fleeing is exempt**: a hungry
  colonist runs at full speed, because threat-vs-flee speed is
  CONCEPT's central difficulty dial and an empty larder must never
  quietly raise the death rate — the plateau slows work, never escape.
- **The starting five arrive provisioned** (new — the cold-start rule).
  `PROVISION_BREAD` (3 loaves per head) spawns as ground items in the
  spawn clearing at `createSim`, and the v8 migration grants the same
  3 × settled colonists to old saves — otherwise a fresh colony (or a
  loaded one) is hungry by day two with no counter, which would be
  imposed risk. The runway is ~3 days: enough to see the loop and build
  toward a farm, short enough that the chain is the first priority.
- **The gate tightens: beds and a loaf for the newcomer** (extends the
  housing gate). `stepSettlers`' spawn guard adds: bread in the colony
  ≥ settled + 1 — the table is set for everyone plus the one arriving.
  Checked where the cap check lives, so the countdown pauses while the
  surplus is missing, exactly as it pauses at cap. Growth now costs
  placement *and* a working food chain. **One floor: at settled = 0
  the bread bar is waived** — with everyone dead there is nobody to
  farm, so an unwaived bar would make a wipe permanent and delete the
  recovery the housing spec names as its whole point. A wiped colony
  gets one pair of hands back on the ordinary countdown; the second
  arrival is priced in bread again.
- **Three goods appended, by the documented rituals** (extends).
  `ItemType` appends Grain = 4, Flour = 5, Bread = 6. Each lands with
  its `GOODS` row, its `accept` field on `Building` (stamped 1 on
  **every saved building** by the migration — the v2 rung precedent,
  and `inspect` asks `stockpileAccepts` of every kind), and its
  `-1` appended to `limits` in the same rung (per the production-control
  spec's append ritual). The ribbon, stockpile filters, ceilings and
  panel rows pick all three up by existing. `SAVE_VERSION` 8.
- **Two colonist fields, no new commands** (extends). `Colonist` gains
  `hunger` and `eating` (0/1 — marks the meal errand so a slot worker
  mid-walk to bread isn't re-routed to station; named fields, never a
  pun on `work`, per the housing amendment's lesson). Placement and
  staffing of all three buildings ride the existing commands; 5b adds
  **zero** command kinds.
- **House panel says what beds do** (drains the CLAUDE_TODO item). The
  House panel's beds row reads `Beds 2`, with the faint italic note
  *raises the cap by 2* beneath it — the 246 px label/value cluster
  cannot carry the sentence as one row, and the note row is the house
  voice's home. Six houses and "folk 6 / 17" finally connect. The
  build deletes the readout item from `docs/CLAUDE_TODO.md`.

## Goals

- The deep chain exists: three workshops, three slot workers, and the
  labour trap at full strength — staffing the food chain visibly costs
  hauling and construction.
- Population growth is paid for in food: no surplus, no newcomers.
- Hunger is felt and calm: a breadless colony slows, explains itself,
  and recovers the moment loaves exist again.
- Farmland pulls outward: feeding more mouths means enclosing more
  flat ground.

## Non-goals

- No food variety, no spoilage, no seasons, no water or drink — bread
  is the one food, eaten at one rate.
- No per-colonist needs UI, no mood, no morale — hunger is a speed
  factor, not a feeling.
- No emigration or starvation deaths: the plateau is the whole penalty.
- No field visuals beyond the Farm's own footprint — crop growth stages
  are renderer polish for later.

## Design

### Store, defs, migration

`ItemType` + 3 (Grain, Flour, Bread), each with a `GOODS` row, an
`acceptGrain`/`acceptFlour`/`acceptBread` field on `Building`, and a
`-1` appended to `limits`. `BuildingKind` + 3; defs (all costs and
ticks in `tuning.ts`, all tunable):

- **Farm** 3×3, cost 4 logs, slot, recipe `{per: 0, output: Grain,
  ticks: FARM_TICKS = 5 s}` — ~12 grain/day from one farmer.
- **Mill** 2×2, cost 4 logs, slot, recipe `{input: Grain, per: 1,
  output: Flour, ticks: MILL_TICKS_5B = 4 s}`.
- **Oven** 2×2, cost 4 blocks — the first *stone* building, the mason's
  first customer beyond the wall — slot, recipe `{input: Flour, per: 1,
  output: Bread, ticks: OVEN_TICKS = 5 s}`.

One fully-staffed chain feeds ~12 folk; past that the player adds a
second farm (more land) and eventually a second oven. `Colonist` gains
`hunger: number` (ticks since last meal, unbounded) and `eating: 0 | 1`.
The v8 rung defaults both to 0, stamps the three accept flags to 1 on
every saved building, appends three `-1`s to `limits`, and drops
3 × settled loaves at the colony (the existing drop spiral, anchored on
the lowest-id building, or the map centre when there are none). The
grant runs live drop code inside a migration, so it is guarded per the
v3 precedent — `decode` may only ever throw `SaveError` — and
`dropTile` returning null on congested ground is accepted: a shorted
grant means hungry sooner, which only plateaus. Fixtures v1–v7 keep
loading; a v8 fixture joins.

### The meal loop

In `stepColonists`, after the flee check and the wanderer branch: a
colonist with `hunger ≥ MEAL_TICKS` and no stint in hand (pool: task
< 0; slot: `millProgress < 0`, stepping out via `leaveBuilding`) seeks
the nearest free bread (`nearestFreeItem` with `sourceForSite` — both
exported from `labour/tasks` for this, ties by id as everywhere), sets
`eating = 1`, and walks. On route exhaustion the arrival rule in Key
decisions decides what may be eaten (lowest-id free bread on the own
or an adjacent tile, or in an adjacent building): consume it,
`hunger = 0`, `eating = 0`, back to work — the slot worker's own logic
walks them home. Nothing eatable there (the loaf moved, or none
exists): back to work, re-seeking with a **per-tick scan** — O(items),
no PRNG, and no route planned when nothing is free, so a breadless
colony pays almost nothing and a hungry one eats promptly. A cooldown
rhythm was rejected here: a pool worker holds `task < 0` for exactly
one tick between tasks, so any gated window defers the meal by another
whole task almost every time — measured as game-days of hunger beside
a stocked larder. The accepted residual: while free bread exists but
is unreachable, the seeker pays one A* per tick until a route opens.
Until a meal is found they work on, slowed past `HUNGRY_TICKS`. A flee
clears `eating` and drops the errand — safety first, the meal re-seeks
after. The errand has **no inside/outside filter**: a loaf lying
outside can pull an eater through the gate, deliberately —
`generateHaulToStore` already sends tidiers to any loose item
anywhere, and meals keep that parity. Wanderers (`dest ≥ 0`) neither
eat nor hunger: their clock starts at settling. Eating consumes no
PRNG and no reservation; determinism rides id-order stepping as
everywhere else.

### The slowdown

`HUNGRY_FACTOR = 0.6` applies to the walk budget (`WALK_TILES_PER_TICK
× 0.6`) — **except while fleeing**, which always runs at full speed —
and to **all three work accumulators**: `c.work` (chop, mine,
terraform, build-wall, repair), `b.progress` (a hungry builder builds
slower), and `b.millProgress` (the workshop cadence keyed off its slot
worker's hunger — the food chain's own workers are not immune).
Implemented on a deterministic cadence (e.g. skip every kth work
tick), never by fractional work floats, so the golden hash stays
integral. The renderer needs nothing: slower walk shows in the
existing interpolation.

### The gate

`stepSettlers` adds one guard beside the cap check:
`countItems(sim, Bread) >= settled(sim) + 1`, with the same
clock-pausing semantics — waived entirely at `settled === 0`, so a
wiped colony can seed its recovery with one arrival (Key decisions). Two readability duties land on the House
panel, both in the house voice: the beds row reads `Beds 2` with the
note *raises the cap by 2* (the TODO ride-along), and while the bread
gate — not the cap — is what holds arrivals, a quiet note says so
("no one will come while the table is short"). That note is load-bearing, not
polish: this gate can stand for days, it is player-caused, and one
interplay makes silence dangerous — a bread ceiling set at or below
settled caps `countItems` under the bar and holds the gate shut
indefinitely. Legal, but never unexplained.

### HUD

The build rail gains Farm, Mill and Oven buttons off their defs (cost
captions already read `costType`). The ribbon's goods cluster grows to
seven — mostly by existing, but not quite: `GOOD_VAR` and the
styleguide palette need three new good tokens (grain, flour, bread),
added to `docs/STYLEGUIDE.md` in the same change per the
production-control precedent — and the full-width ribbon deserves a
width check at narrow viewports, seven goods beside the threat meter.
The folk cluster gains a quiet "· N hungry" suffix only while N > 0,
where **N counts the slowed set** (hunger ≥ `HUNGRY_TICKS`) — counting
everyone past mealtime would flicker "· 1 hungry" at every lunch
walk — ink-dim, never a colour change: the plateau's one honest
signal, arriving as the slowdown does. A slot worker out at a meal
must not read as a stall: the panel's worker row gains an **"eating"**
state and the stall note is gated on it — the panel never lies, and
"waiting for grain" while the miller is at lunch would be one.
Workshop panels for all three are the standard anatomy; the Farm's
chain chip is one-sided and its produce-until row works day one.

### Determinism and tests

The chain gets its **own scripted run on a selected seed** (the stone
and encounter precedent): grain → flour → bread, the gate held shut by
missing surplus and opened by baking. It cannot ride the main golden —
that seed's nearest outcrop is ~50 tiles out and its script builds no
House, so forcing the block-priced Oven and the gate in would triple
the script; the main golden covers the meal loop by existing, since
its colony opens on fifteen loaves. Unit: the `per: 0` recipe guards;
gate math (bread = settled blocks, settled + 1 admits, the settled-0
waiver); slowdown cadence; provisions in `createSim` and the v8 grant;
the three append rituals. Meals move timings colony-wide, so the
re-record ripples: existing scripted runs re-pin, some for behaviour
rather than shape (an arrival stream that starves mid-run needs a
test-fed larder; a chase seed may need re-picking), and every
fixture's decode hash moves. The determinism claim is each drift
test's two identical runs; the pins are just addresses.

## Alternatives considered

- **Fields as recurring designations** worked by pool workers — fits
  the designation grammar but needs a growth grid layer and recurring
  semantics no designation has, leaves grain outside the ceiling
  system (a door production control left open for designation-grown
  crops — recipe-grown grain gets ceilings for free instead), and adds
  no slot pressure. Rejected.
- **Abstract meals** (decrement a loaf at mealtime, no walking) —
  cheapest build, but bread becomes the one good in the game that
  teleports, and the canteen-placement gameplay disappears. Rejected.
- **Starvation deaths or emigration** — violates the no-spiral law
  outright; the plateau is the design. Rejected.
- **A hunger bar per colonist** — needs a colonist panel that doesn't
  exist; the ribbon's aggregate is the calm-scale version. Deferred,
  not designed.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread through shared state: the goods
  and defs, the migration, the meal loop and the slowdown all touch the
  same store and the same colonist step — parallel streams would
  collide in `labour/colonists.ts` alone.
- Natural order: the three append rituals + defs + v8 migration and
  fixture first (unit-testable alone), then the `per: 0` recipe with
  its guards, then the meal errand and slowdown (the design-risk core —
  build it against the arrival rule and the flee exemption verbatim),
  then the gate, then HUD + the styleguide's three good tokens.
- The change that lands this **deletes the population-cap readout item
  from `docs/CLAUDE_TODO.md`** — the House panel beds row completes it,
  per the Owed follow-ups convention in `CLAUDE.md`.

## Amendments

- 2026-09-08 — Six build findings folded back (implemented in
  `docs/changelog/2026-09-08-bread-economy.md`), all spec defects, the
  build ratified as-is: meal re-seek is a per-tick scan (the
  claim-cooldown rhythm deferred meals almost every time, since a pool
  worker holds `task < 0` for one tick); the bread bar is waived at
  settled = 0 so a wipe stays recoverable per the housing spec's
  promise; the chain golden runs on its own selected seed rather than
  inside the main script; the re-record ripple is stated honestly
  (several pins, some for behaviour); the beds copy split into
  row + note per the 246 px cluster rule; and the provision-pile
  reservation transient (~half a game-day) is stated and accepted.
