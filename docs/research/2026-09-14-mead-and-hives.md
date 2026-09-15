# Research: mead, honey and hives

## What I was asked

Decision to unblock: whether to spec **mead** as the colony's first drink, and
in which shape the code actually supports — where hives can go and what
"meadow" would have to be, whether a hive needs a slot worker, how mead is
consumed, and what a "cup a head speeds arrivals" hook costs. Hypothesis under
test: honey comes from hives on meadow ground *outside* the wall (the first
chain whose raw input lives in the Wilds), a Meadery turns it into mead, and
mead's effect is on **who comes**, not work speed — because work speed is owned
by clothes, hunger by bread and cheese, and walk speed is reserved for shoes.

1. How does the wanderer clock work, and where would a rate modifier hook in
   deterministically?
2. Which terrain types exist; is there anything like meadow; how is "outside
   the wall" readable?
3. Does anything produce without a slot worker? What happens to a slot worker
   whose workshop stands outside the wall when a monster prowls?
4. How are the meal and dressing errands structured and clocked, so the spec
   can choose between a drink errand and consumption-on-arrival?
5. What do two new goods cost, measured against sheep-and-clothes?
6. Has anything already decided drink, honey, bees, meadow, arrival rate or
   morale?

Out of scope: beer (a possible later tier), a tavern building, any work-speed
or morale effect.

## Answer

Every piece the hypothesis needs exists as a pattern, and none exists as the
thing itself. The clock is one field with two deterministic hook points; the
"loaf a head" gate is a ten-line function to copy; a hive **must** be a slot
workshop, because nothing in the game produces without a worker standing
inside (a slotless hive is new machinery at the heart of the tick); and
"meadow" does not exist — terrain is a pure function of height and is
re-derived when ground is levelled, so a meadow would have to be a *layer*
like trees, not a terrain value. The surprise is the risk model: a colonist
**inside a building is uncatchable wherever it stands**, so an outside hive is
a bunker for its keeper and the danger falls on the haulers — and on the
keeper's own meals, which walk them out the door on a tick the flee check has
already passed.

## Key findings

**Q1 — the clock.** `stepSettlers` (`src/sim/settlers.ts:126–170`) runs the
countdown only while nobody is in transit, the colony is under cap, the table
is set and an active House exists; it decrements `sim.wandererTimer` by one per
tick at `:156` `[verified]`. `restart` (`:342–346`) draws
`WANDERER_INTERVAL ± WANDERER_JITTER` from the store PRNG — 300 ± 120 ticks,
30 s ± 12 s at 1× (`tuning.ts:381–382`, `DAY_TICKS = 600` at `:27`)
`[verified]`. Two deterministic hook points for "faster while a cup a head is
held": the per-tick decrement (`:156`), or the interval drawn at `:345`.
`tableSet` (`:104–124`) is the threshold pattern to copy: every food anywhere,
`≥ settled + 1`, exempt when nobody is left `[verified]`; the House panel's
`tableShort` (`know/index.ts:501`) is its readout. **The gate is evaluated at
spawn, not arrival** — a wanderer already walking settles whatever happens to
the surplus meanwhile, and the timer *pauses* rather than banks while the gate
is shut (`:146–158`). `stepSettlers` runs after monsters and before workshops
(`tick.ts:47–53`).

**Q2 — terrain and "outside".** `Terrain` is `Water | Sand | Grass | Rock`
(`world/world.ts:12–17`), a **pure function of height** (`terrainFor`,
`:83–86`), and **re-derived on terraform** (`ground.ts:144`) `[verified]` — a
meadow *terrain value* would be erased by levelling. Trees show what a meadow
would have to be: a separate `Uint8Array` layer on `World`, generated on Grass
outside `SPAWN_CLEAR_RADIUS` by noise clump plus hash scatter (`world.ts:127–134`),
cleared on chop (`colonists.ts:819, 867`), never regrowing (searched
`treeMap[…] =` and `regrow` across `src/sim`, non-test). `canPlace`
(`buildings.ts:485–505`) checks bounds, flat footprint, Grass or Sand, no tree,
no building, no lair, no ground item, and a work tile for slot buildings —
**nothing about the wall** `[verified]`; placing outside is legal today, and
`insideMap` is read nowhere in `buildings.ts`, `commands.ts` or
`labour/tasks.ts`. "Outside" is readable through `insideLayer`
(`know/index.ts:290–296`); the wanderer landing already requires it
(`settlers.ts:267`). An outward gradient exists to reuse: lairs scale by
`hypot(x−c, y−c) / (size/2)` with `OUTER_BAND = 2/3` and no protected radius
beyond `LAIR_CLEAR_RADIUS = 10` (`threats/lairs.ts:174–183`, `tuning.ts:243–259`).

**Q3 — production, and the keeper's risk.**
- **No slotless production, anywhere.** `stepWorkshop` returns before any
  progress unless `b.worker ≥ 0` *and* that colonist is bound to this building
  *and* `inside` (`economy/workshop.ts:38, 42`) `[verified]`. Each tick of
  progress is then paid by `workTicks(sim, worker)` (`labour/hunger.ts:73–77`).
  The Farm and Pasture (`per: 0, inputCap: 0`, `buildings.ts:196–207,
  296–307`) are ordinary workshops whose batch-start consumes an empty list;
  the seven non-test item-creation sites are `spawnItem`, starting provisions,
  the workshop output at `workshop.ts:82`, chop, mine, the raze refund and a
  migration backfill. A hive without a keeper is new machinery at the tick's
  core, not a def row.
- **`inside` is immunity, not a render flag.** `threatNear` returns null for an
  indoor colonist (`threats/flee.ts:50`) and `noticeable` returns false
  (`threats/monsters.ts:185`) `[verified]` — never noticed, never chased, an
  existing chase breaks on entering. The monsters spec calls an outside
  workshop "a bunker for its slot worker, quirky but harmless"
  (`docs/specs/2026-09-04-monsters.md:289–290`; changelog `2026-09-05:70–72`
  `[verified]`), harmless because the *haulers* feeding it have no shelter.
- **The bunker leaks on every meal.** Both errands call `leaveBuilding` and
  plan-and-walk on the **same tick** (`colonists.ts:229–244` meal, `:363–375`
  dress) `[verified]`; the flee check at `:111` ran earlier that tick and
  returned null *because* they were inside; colonists step before monsters
  (`tick.ts:50–51`) `[verified]`, so a prowler adjacent after its move kills
  them that tick. The window is `millProgress < 0` — between batches — and a
  Watchtower's is permanent. Recorded as untested at
  `docs/changelog/2026-09-09-watchtowers.md:126–128`. The monsters spec
  predates both errands.
- **Monsters attack wall tiles only.** `nearestDamageable` scans `wallMap`
  through `isDamageable` (`threats/damage.ts:102–111`) `[verified]`; finished
  buildings are indestructible *and* impassable, so a cluster of hives can box
  a monster in, which then waits (`monsters.ts:272`).
- **A gate tile reads as outside.** `insideMap` is 0 on any tile carrying a
  wall, so a hauler in their own closed gateway with a prowler within
  `FLEE_RANGE = 6` beyond it abandons, retreats and re-claims for the whole
  prowl — a recorded, unrepaired bug whose prescribed fix is a third state
  (`docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md:74–86`)
  `[verified]`. Every outside-hive commute crosses a gate. `ORC_NOTICE = 8 >
  FLEE_RANGE = 6` (`tuning.ts:287, 323`): an orc has committed before anyone
  runs.

**Q4 — the errands.** Both run before the pool/slot split, so both apply to
slot workers; the documented order is flee > meal > dress > work
(`colonists.ts:123–132`). Meal: `hunger` climbs to `MEAL_TICKS = 600`, the
colonist walks to the nearest free food (`FOODS = [Bread, Cheese]`,
`goods.ts:71`; `nearestFreeItem` + `sourceForSite`), `eatHere` removes the item
and zeroes `hunger` (`:302–304`); from `HUNGRY_TICKS = 900` `workTicks` drops
40% of ticks and nothing else. Dress: `clothes` counts down from
`CLOTHES_WEAR_TICKS = 6000`; at 0 — the default state — the same seek runs
**every tick for every settled colonist** even with no tailor (`:350`), which
is what cost the suite ~12 s of wall in sheep-and-clothes. Neither reserves
its item; a stint in hand finishes first (`:221, :355`). **Settling consumes
nothing**: `resolve` (`settlers.ts:177–193`) sets `dest = −1`, `patience = 0`;
`arrive` (`:308–338`) lands them unfed and unclothed.

**Q5 — the cost of two goods.** Fourteen append sites for any new good, nine of
them compile-forced by `Record<ItemTypeValue, …>` tables: the enum
(`store.ts:21–53`), `GoodDef.accept` union (`goods.ts:28–39`), the `Building`
field (`store.ts:388–398`), the `GOODS` row (`goods.ts:42–59`), the `place()`
default (`commands.ts:414–448`), a `limits` slot (`store.ts:527–529`, fresh
sims only), the migration rung (`migrations.ts:313–364` is the v10 model),
`SAVE_VERSION` (`codec.ts:38`), `PROP`/`GOOD_HEX` colours (`palette.ts`),
`GOOD_VAR` and the CSS variable (`hud.ts:111–123`, `hud.css`), `GOOD_GROUP`
(`hud.ts:150–164`), a styleguide table row, and `FOODS` if edible. `GOOD_LIST`
and every readout derive from the enum (`goods.ts:79`) `[verified]`. **Not
compile-forced and silent when missed**: the rung's accept-flag stamp (a
building that comes through without it refuses the good forever while its
workshop jams at output cap — `migrations.ts:325–332` `[verified]`) and the
`limits` append. A new `BuildingKind` alone forces a bump: rung 8 is an
identity that exists so an older build refuses the save instead of crashing on
an unknown kind (`migrations.ts:294–311`) `[verified]`. Sheep-and-clothes was
**33 files, +2,206 / −184** (`git show --stat 66a0258`) `[verified]`, and every
pinned hash moved for shape; the per-good sites are a modest fraction — the
bulk was the dress errand, four workshops and a 428-line test. `SAVE_VERSION`
is **10** on the current tree `[verified]`; `tick.test.ts:39`'s `GOLDEN_V11`
is a name, not a version — the uncommitted stockpile change bumped nothing.

**Q6 — prior decisions.** Word-boundary grep of all 41 changelog entries, 13
specs, CONCEPT, ARCHITECTURE and STYLEGUIDE for honey, bee(s), hive(s), mead,
meadow, flowers, drink, beer, tavern, brewery, morale: three hits. The bread
economy lists "no water or drink" and "no mood, no morale — hunger is a speed
factor, not a feeling" as **non-goals** (`docs/specs/2026-09-08-bread-economy.md:163–166`);
the concept reframe **rejected** mourning/morale systems
(`docs/changelog/2026-09-01-concept-reframe.md:14`). Nothing on bees, honey,
hives or meadow. Two adjacent decisions bind: multi-output recipes were
rejected — no hive yielding honey *and* wax (`2026-09-11-sheep-and-clothes.md:88–90`)
`[verified]` — and the wool chain is on record as "pulling nothing from the
deep map, honestly against CONCEPT's third pillar" (`:84`), which is the
tension a hive is positioned to answer.

## Constraints and invariants

- A producing building has a slot worker inside, or it produces nothing.
- `inside` is immunity on both sides of the threat model; the risk of an
  outside workshop is borne by haulers and by the keeper's errands.
- Placement and task generation know nothing of enclosure; nothing today
  stops or prices an outside building, and nothing shelters the pool workers
  sent to it.
- Terrain is height; any new ground quality is a layer, saved with `World`,
  moving every fixture and golden hash for shape.
- Two goods plus one building is a v11 rung stamping two accept flags and two
  `limits` slots, and every pinned hash moves for shape. A new kind forces the
  bump on its own.
- `GOOD_GROUP` is "what a colonist does with the good, never which building
  made it"; a new group widens a deliberately closed union.
- A new `BuildingKind` with no prop of its own falls through to the shared
  timber-workshop silhouette (`render/props.ts:207`), already an owed item in
  `docs/CLAUDE_TODO.md` — a hive outside the wall is the one building the
  player most needs to read at map distance.
- The gate-tile stall is open and every outside commute crosses a gate.
- The working tree carries the uncommitted stockpile change: new piles refuse
  everything, `2` is the clearing state, `setAllFilters` exists. A v11 rung's
  default for existing piles is now a real question (below).

## Prior art and options

**A. What makes honey an *outside* good.**
1. *Hive on any grass.* No layer, no rule. Repeats the wool chain's recorded
   failure to pull outward.
2. *A meadow layer*, generated like trees — noise clump on Grass, biased
   outward by the lair-band gradient — that hives must sit on. Terraform-safe,
   visible (a layer can be drawn), and the pull is literal: the meadow is
   *there*. Costs a `World` field, generation, rendering, and a shape move on
   every hash.
3. *Distance-priced.* Honey rate scales with the lair band. No layer, but the
   player cannot see why one hive outproduces another unless the panel says so.
4. *Outside-only.* A hive works only while `insideMap` is 0 under it. Cheap
   and readable through the enclosure wash — but it punishes the very
   expansion the pillar asks for: wall the hives in and the honey stops.

**B. Production shape.** One option the code supports: a slot workshop on the
Farm's `per: 0` convention, `HIVE_TICKS` per honey — a beekeeper is a pair of
hands, which is CONCEPT's own price for infrastructure. The alternative,
production without a keeper, is new machinery in `stepWorkshop`'s two gates.

**C. How mead speeds arrivals** (given the "who comes" premise).
1. *Decrement by two* at `settlers.ts:156` while a `cupSet` threshold holds.
   Gradual, reversible mid-countdown, no PRNG change.
2. *Scale the interval* drawn at `:345`. Simpler arithmetic; applies only from
   the next countdown.
3. *A second gate* — no cup, no arrival. Strictly harsher than food's gate and
   turns mead from a lever into a tax.
4. *Honey or mead as a third `FOODS` entry.* Zero new mechanics; it is eaten
   and gates arrivals exactly as bread does. Cheapest, and it gives the drink
   no identity of its own.

**D. How mead is consumed** — a threshold that is never consumed is
build-once-forever, so something must drink it.
1. *On settle.* `resolve` consumes a cup when a wanderer settles: one field
   touched nowhere, no errand, no per-colonist clock, demand equals arrivals.
2. *A drink errand* on the meal pattern: two colonist fields, a rung stamping
   them, and the per-tick seek the dress errand already shows the cost of.
3. *Both* — settlers drink on arrival and the rate hook reads what is left.

**E. What a v11 rung stamps on existing piles.** The v10 precedent stamps `1`
("a v9 player never chose to exclude a good that did not exist"); the new
default-off says `0` (a curated pile should not sprout acceptance, and `all` is
one press). The two are now in genuine conflict.

## Open questions for the spec

- **Q:** Which of A makes honey outside? **Default:** A2, a meadow layer
  biased outward — it is the only option where the pull is something the
  player can see and walk to.
- **Q:** Consumption? **Default:** D1, consumed on settle. Cheapest thing that
  makes mead deplete, and it ties demand to the effect.
- **Q:** Rate hook? **Default:** C1, double decrement while the cup holds.
- **Q:** What does the v11 rung stamp on existing piles for honey and mead?
  **Default:** `0`, consistent with the default-off decision the tree now
  carries; the player opts in with one press.
- **Q:** Is honey itself a food? **Default:** no — honey is an input, mead is
  the drink; keeps `GOOD_GROUP`'s rule clean.
- **Q:** Does the hive get its own prop? **Default:** yes; it is the building
  whose safety the player reads at a glance.
- **Q:** Should the spec close the errand leak for outside slot workers (a
  `threatNear` check in `leaveBuilding`), or leave it as the price of an
  outside hive? **Default:** leave it and name it; fixing it is a threat-model
  change that moves the encounter hash and belongs to its own entry.

## Sources

Inline (this session): `src/sim/settlers.ts`, `src/sim/tuning.ts`,
`src/sim/world/world.ts`, `src/sim/ground.ts` (grep), `src/sim/buildings.ts`
(`BUILDING_DEFS`, `canPlace`), `src/sim/know/index.ts`, `src/sim/threats/lairs.ts`
(grep), `src/ui/hud.ts` (`GOOD_GROUP`), `src/render/props.ts` (grep),
`docs/specs/2026-09-07-housing-wanderers.md`, `docs/specs/2026-09-08-bread-economy.md`,
`docs/changelog/2026-09-01-concept-reframe.md`, `2026-09-05-monsters-and-the-hours-they-keep.md`,
`2026-09-11-sheep-and-clothes.md`, `2026-09-14-stockpile-default-and-clearing.md`.
Commands: `grep -rniw` over `docs/` for the Q6 terms; `git show --stat 66a0258`;
`git status --short`.

Delegated: one **Sonnet 5** inventory agent (Q5 — the append checklist, rung
mechanics, hash table, commit stat) and one **Opus 5** deep-dive (Q3 behaviour
and Q4 — `economy/workshop.ts`, `labour/colonists.ts`, `labour/hunger.ts`,
`threats/flee.ts`, `threats/monsters.ts`, `threats/damage.ts`, `tick.ts`,
`settlers.ts`; it ran `npx vitest run src/sim/economy/cloth.test.ts`, 20/20 on
the dirty tree). Every `[verified]` claim was re-read at its line here; the
Q4 errand table and the seven item-creation sites are the agent's, unverified
beyond spot checks.
