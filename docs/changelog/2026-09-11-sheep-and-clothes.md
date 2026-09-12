# Sheep, cheese, and colonists who dress themselves

Pasture → wool → cloth → clothes is the game's deepest chain, and the Dairy
turns grain into cheese, so ovens and dairies now want the same fields.
Colonists **dress themselves** as they feed themselves and work 25% faster
until the garment wears out in ten game-days — the game's first equipment, so
demand for it is standing rather than a checkbox. Cheese feeds them and opens
the wanderer gate exactly as bread does. `SAVE_VERSION` is 10. Implements
`docs/specs/2026-09-10-sheep-and-clothes.md`.

## Detail

**The composed work cadence is the one number worth not rediscovering.**
`worksThisTick` is gone; `workTicks(sim, c)` answers **0, 1 or 2** and every
work accumulator adds what it returns (`labour/hunger.ts`). Hungry stays ×0.6;
clothed is ×1.25, granted as one extra tick every fourth — and the extra tick
is given **only on a tick the hunger gate already lets through**, so hungry and
clothed together is exactly **×0.75**. 4 and 5 are coprime, so the bonus lands
on a surviving tick exactly three times in every twenty at *every* phase
offset: 0.6 + 3/20. Granting it unconditionally would have shipped **×0.85**
while still matching the words "one extra tick every fourth", which is why the
spec pinned it and why `hunger.test.ts` checks all twenty offsets. **At the
repair site the gate is per *tick*, never per point**: a clothed repairer's
extra tick buys the whole `REPAIR_HP_PER_SECOND` increment, so clothes are
worth the same there as at the other seven sites.

**`clothes` stores ticks *remaining*, a stated deviation from the store's
damage-not-remaining precedent** (`wallDamageMap`). There the argument was that
0 = pristine costs no write; here it is that 0 = unclothed comes free, and
unclothed is the default and permanent state of anybody the colony never
dresses. The accepted cost is the mirror image: **retuning
`CLOTHES_WEAR_TICKS` never reaches clothes already on somebody's back.** Wear
counts down every tick, worn — not gated by `dest` the way hunger is, because a
wanderer's is 0 by construction.

**The dressing errand inherits the meal loop rather than restating it** —
per-tick seek, `sourceForSite` with ties by id, no item reservation, the same
arrival rule, a stint in hand finished first, a slot worker out through its own
door and back by `stepSlotWorker`. Donning **consumes the item**: no worn-item
entity exists, which was rejected in the spec because it doubles every item
consumer's location model for a read the player never does.

**At most one errand flag is ever set, and that is a decision.** Priority is
flee > meal > dress > work, and a meal coming due mid-fitting takes the
colonist over — `startMeal` clears `dressing` **by name** rather than leaving
both set. Leaving both would have made `workerState` and `readout().idle` pick
between two live errands; clearing it costs nothing, because the fitting
self-heals (`clothes` is still 0 after lunch, so the seek runs again next tick).
`flee` clears both, also by name.

**Three consumers were taught by name, and a fourth was found in the browser.**
`Inspection.worker` gained `"dressing"`, `readout().idle` excludes a dressing
colonist as it excludes an eater (`2026-09-09-idle-means-available`), and the
stall gate treats both errands as "not a stall". The fourth is `millNote`,
which had a line for `eating` and none for `dressing` — so a Pasture whose
shepherd was at a fitting read **"working" with nobody in it**, the exact panel
lie the `eating` state exists to prevent. Caught by clicking the Pasture in the
v10 fixture, not by reading the code. It now says *"gone for clothes — back
shortly"*, and `millNote` is exported so `hud.test.ts` can pin the rule that it
may claim neither work nor a stall for a worker who is simply away.

**The unclothed/clothed read is one tint decision in `drawColonists`, with no
bake anywhere.** Colonists are per-frame movers, so a garment donned or worn
out shows on the next frame with nothing to invalidate. Unclothed draws the new
single `PROP.drab`; clothed draws the *existing* three-colour tunic rotation —
so dressing the colony literally brings colour to it and the difference reads
at map distance. Deliberately **no clothed readout**: no ribbon count, no
per-colonist panel, per the calm doctrine — the Stores panel's Clothes row is
the stock signal and the map is the rest.

**Cheese is bread by another road, with no new rules.** The meal errand seeks
the nearest free **food** — a `FOODS` list in `sim/goods.ts`, Bread and Cheese,
**nearest wins with no preference order** — and `tableSet` counts every food,
so the gate is `foodCount ≥ settled + 1` with the settled-0 waiver unchanged.
`nearestFreeItem` took a `readonly number[]` for it rather than being called
once per food and the winners compared afterwards: comparing per-type winners
breaks the id tie-break across two equally near goods.

**Four def rows, zero engine changes.** `BuildingKind` += Pasture 8, Dairy 9,
Weaver 10, Tailor 11, all 4 planks, all slot workshops. The Pasture is the
Farm's `per: 0` / `inputCap: 0` no-input convention — now two users, so the
convention is no longer a one-off — on a second 3×3 footprint, making 18 tiles
of level ground the price of running both raw goods. **Honestly against
CONCEPT's third pillar: the wool line is the game's deepest chain and pulls
nothing from the deep map.** The whole outward pull here is the Dairy's grain
demand and the acreage; stone-pricing a link (the Oven's move) is the tuning
available if that dilution starts to matter. Recorded rather than smuggled.
Multi-output recipes (one Pasture yielding wool *and* cheese) were rejected in
the spec — the engine cost lands in ceilings, `outputFull` and haul-to-store
for one building's fiction. Mutton was rejected too: the game has no kill
mechanic anywhere, on purpose.

**Four goods by the rituals.** `ItemType` += Wool 7, Cloth 8, Clothes 9,
Cheese 10, each with its `GOODS` row, its `accept` field, its `-1` in `limits`,
its `GOOD_VAR`/`GOOD_GROUP` entry and its styleguide token. `GOOD_GROUP`'s
union widened: wool, cloth and clothes are a new **cloth** group emitted after
food, and **cheese joins food** — a good's group is what a colonist does with
it, never which building made it. Cheese is also the case the fixed
`GROUP_ORDER` exists for, having actually happened: newest in the enum, filed
at the foot of Food, between Bread and Wool.

**The v10 rung stamps and appends, and owes nothing.** Two colonist fields at
0, four accept flags at 1 on **every saved building** (the v2 precedent — a
missing flag refuses that good forever while the weaver jams at output cap),
four `-1`s appended to `limits`. Unlike the bread rung it grants no provisions:
clothes are a buff, not a floor, so a migrated colony arrives paying exactly
what it was already paying.

**Every pinned hash moved for *shape only*, and that was proved rather than
argued.** With the two colonist fields, the four accept flags and the four
`limits` slots stripped back out, all four scripted runs and all nine fixture
decodes hash to their old numbers exactly. It could not be otherwise — no
existing script builds a Tailor, so no garment exists and `workTicks` pays
every tick what the old boolean gate paid. The labour pin `04f53ac6` →
`cb721faa`, the bread chain `dacffdb6` → `077aabf8`, the settling run
`2cecf74f` → `3d64cb83`, the death run `3050f53e` → `78fd60d6`, the encounter
`4e86c393` → `88d00a73`; fixtures v1 `bd689ee3` → `a6bb93fd`, v2 → `b8453d4a`,
v3 → `884c1dad`, v4 → `a184703c`, v5 → `b1027097`, v6 → `a71f09d4`, v7 →
`1783d54e`, v8 → `74af149c`, and **v9 → `8467d2f9`, whose pin moves for the
first time** — v9 was an identity rung, v10 is not. The files themselves are
untouched and stay frozen.

**`v10.castles` joins them, on seed 20261126** (woods seven tiles out, nearest
den forty-eight — the whole chain is plank-priced, so the log chain has to run
and keep running, and a 4250-tick recipe on a seed with a near den loses the
colony it is meant to freeze). It carries what no earlier file could: **all
seven buildings standing**, **all four new goods in the colony at the same
instant**, **three colonists on three different wear clocks** — so `clothes` is
a live countdown in the file rather than a flag — and **two more caught
mid-fitting** with routes in flight, which is the id-order race for the
tailor's output frozen on camera. **The staffing schedule is the recipe**: five
pairs of hands, seven buildings, never more than three slots at once, and the
Dairy staffed early on purpose so cheese lands before the opening provisions
run out — otherwise the colony crawls at `HUNGRY_FACTOR` through the whole
middle and the chain never finishes inside the recipe.

**The left edge outgrew its no-scroll floor, and this entry says so.** Twelve
Build tools take the rail to ~465px and eleven Stores rows to ~372px, so the
scroll-free floor moved from ~750px of window height to **~900px**. Measured at
1280×768: rail 62..391, Stores 403..756, a **12px gap** — they still cannot
overlap, which is what the flex split was built for — with 144px (about four
rows) scrolling inside the rail and the caption strip outside the scroller and
never clipped. At 1280×720 the rail scrolls 192px, same gap, no page scroll.
Accepted for now; the repair when it hurts is a three-column rail or
collapsible Stores groups, neither of which is built.

**Known limits, none of them repaired.**

- **The Dairy, Weaver and Tailor share the timber-workshop prop** with the
  Sawmill, Mason and Mill — six buildings, one silhouette. The Mill set that
  precedent (`2026-09-08-bread-economy`) and the spec's render scope named only
  the Pasture. The Pasture has its own prop: grazed turf inside a rail fence
  with **three static sheep** baked in beside the fence. The mockup's wander
  machine stays retired — renderer-owned animation state is a door this step
  does not open — and nothing in the sim knows the sheep exist.
- **`millNote` fabricates plurals off `GoodDef.name`**, and the new goods make
  it visibly wrong: "nowhere to put the **clothess**" and "the **wools**". This
  is the existing item on `docs/CLAUDE_TODO.md` (it wants `GoodDef.label`, plus
  an `inputType` on `Inspection` for the input half), newly exposed rather than
  newly caused. Left alone, per the not-a-work-queue rule.
- **A clothed worker can lose one work tick to rounding at the terraform
  site**, where the accumulator is reset to 0 on each height step: the bonus
  tick can carry `c.work` one past `TERRAFORM_TICKS` and the overshoot is
  discarded. One tick in thirty, only when the bonus lands exactly on the
  boundary. The other six `c.work` sites clear on task completion, and so do
  `Building.progress` and `Building.millProgress`, where the overshoot was
  already discarded — so a clothed slot worker's real cadence at a workshop is
  a hair under ×1.25, about one batch in four losing a single tick.
- **The full ten-game-day wear is not played end to end.** The tunable is
  pinned (`CLOTHES_WEAR_TICKS === 10 × DAY_TICKS`), the decrement is pinned
  against the tick loop, and revert-and-re-dress is pinned on a *short* clock;
  a 6000-tick run to watch one garment expire would be the suite's most
  expensive test for no extra coverage.
- **Nothing exercises two Pastures, two Tailors, or a garment that wears out
  while its owner is fleeing.** The dress errand's flee-clears path is pinned by
  the flag alone, not by a run with an orc in it.
- **The wanderer gate's cheese half is pinned at the predicate, not at an
  arrival.** `tableSet` is asserted to open on a bread-and-cheese mixture, but
  no run lands a settler on a cheese-only larder — `stepSettlers` is unchanged
  and its own two golden runs still pin the arrival. The ×0.75 composition is
  likewise unit-tested only, which is unavoidable: it is the one number in this
  change a screenshot could never show.
- **The dress errand's scan runs for every settled colonist from tick 0**, in a
  colony that never builds a tailor — O(items), no PRNG, no route planned when
  nothing is free. The same price a breadless colony pays for its meal scan,
  accepted for the same reason. Measured cost of the whole change to the suite:
  ~34s → ~46s wall, with the encounter still the worst file at 13s and no
  single test near the 120s ceiling.

Verified in the browser (seed 20261126 via the committed `v10.castles`, the
committed `v9.castles` imported through the menu, and a fresh colony): the
Stores panel's four groups with all eleven pips tellable apart — cheese pale
yellow, fleece cream, bolt blue, garment deep blue; the rail's twelve Build
tools with `Pasture / 4 planks`, `Dairy`, `Weaver`, `Tailor` captions; a 3×3
sage placement ghost. `v10.castles` logged `load — tick 4250, hashSim
e61faaff` — the number the fixture test pins — with the Pasture drawn as a
fenced run with sheep in it, two **drab** figures standing beside a blue one
and an orange one, the Pasture panel reading `→ Wool` with no Input row,
`Worker dressing` and *gone for clothes — back shortly*, the Weaver
`Wool → Cloth` also at a fitting, the Tailor `Cloth → Clothes`, the Dairy
`Grain → Cheese` with `Cheese in colony − 7 / unlimited +`, and the stockpile's
eleven filter toggles all on. The migrated `v9.castles` logged `8467d2f9` —
the re-recorded pin — then took a Pasture placed by hand, built it, and had
`Wool 5` in Stores with the panel reading *working*. Console clean (0 errors,
0 warnings) throughout. 427 tests, lint, `tsc`, production build.
