# Sheep: wool, cheese, and the first equipment

A sheep-fictioned production chain built entirely on the one-output
recipe discipline — Pasture (no input → wool), Dairy (grain → cheese),
Weaver (wool → cloth), Tailor (cloth → clothes) — plus the game's first
**equipment**: colonists dress themselves the way they feed themselves,
and a clothed colonist works 25% faster until the clothes wear out
(~10 game-days). Cheese joins bread as a meal. Shoes (walk speed) are
the recorded next rung of the same ladder, deliberately not built now.

## Outcome

**What you get:**

- The second deep chain: Pasture → wool, Dairy (grain-fed) → cheese,
  Weaver → cloth, Tailor → clothes — four workshops and four goods with
  ceilings, filters, Stores rows and panels working from day one.
- Equipment: colonists dress themselves as they feed themselves, a
  clothed colonist works 25% faster for ~10 game-days, and worn-out
  clothes make them a tailor's customer again — continuous demand, not
  a checkbox.
- A second food: cheese feeds colonists and opens the wanderer gate
  exactly as bread does, so the larder has two roads.
- Grain matters twice: ovens and dairies compete for the same fields.

**How to verify:**

- Build and staff the four: wool reaches the weaver, cloth the tailor,
  clothes a stockpile; an unclothed colonist walks there, visibly
  changes tunic, and measurably out-works an unclothed peer; about ten
  game-days later they revert and re-dress while stock allows.
- Let bread run out with cheese in store: colonists eat cheese, nobody
  slows, and wanderers keep arriving while **total food** (bread +
  cheese) ≥ settled + 1.
- Every new good shows its Stores row, its ceiling row on its
  workshop, and its stockpile filter toggle; the Pasture's chain chip
  reads "→ Wool" with no input row.
- Load a v9 save: it plays unchanged plus the new buildings being
  buildable; fixtures v1–v9 keep loading; the golden drift tests pass
  (pins re-record for the store shape, per the ladder). At 768px
  window height the rail scrolls gracefully and never overlaps Stores;
  the console is clean.

## Key decisions

- **Four def rows, zero engine changes** (reuses — the Mason move, the
  Farm move, twice each). `BuildingKind` appends Pasture = 8, Dairy = 9,
  Weaver = 10, Tailor = 11. Pasture is the Farm's `per: 0` no-input
  recipe with a big fenced footprint (3×3, cost 4 planks) → Wool;
  Dairy (2×2, 4 planks) is **grain → cheese**, deliberately grain-fed
  so the new chain pulls the farms the bread chain already pulls — one
  more customer for grain deepens the labour trap instead of standing
  beside it; Weaver (2×2, 4 planks) wool → cloth; Tailor (2×2,
  4 planks) cloth → clothes. Multi-output recipes were considered and
  rejected (Alternatives) — the ceiling semantics alone aren't worth
  it for one building's fiction. Honestly stated against CONCEPT's
  pillar 3: the wool line is now the game's deepest chain and pulls
  **nothing** from the deep map — the whole outward pull here is the
  dairy's grain demand and 21 tiles of flat footprint. Stone-pricing a
  link (the Oven move) is the available tuning if that dilution starts
  to matter; recorded rather than smuggled.
- **Four goods, by the rituals** (extends). `ItemType` appends
  Wool = 7, Cloth = 8, Clothes = 9, Cheese = 10 — each with its `GOODS`
  row, its `accept` field stamped 1 on every saved building, its `-1`
  appended to `limits`, its `GOOD_VAR` and `GOOD_GROUP` entries
  (`GOOD_GROUP`'s union widens deliberately: wool, cloth and clothes
  join a new **"cloth"** group; cheese joins **food**), and its
  styleguide colour token. All four get ceilings, filters, Stores rows
  and stall wording by existing. `SAVE_VERSION` 10.
- **Cheese is a meal** (extends the meal loop). The meal errand
  generalizes from "nearest free bread" to "nearest free **food**" — a
  `FOODS` list in `sim/goods.ts` (Bread, Cheese; nearest wins, no
  preference order) — and the wanderer gate counts any food:
  `foodCount ≥ settled + 1`, settled-0 waiver unchanged. Nothing else
  about hunger moves.
- **Equipment is the meal pattern, applied to a slower clock** (new —
  the one genuinely new mechanic). `Colonist` gains `clothes: number`
  (wear ticks remaining; 0 = unclothed) and `dressing: 0 | 1` (the
  errand flag, `eating`'s mirror). An **unclothed** colonist between
  stints seeks the nearest free Clothes by the meal loop's exact
  machinery — per-tick scan, `sourceForSite`, the same pinned arrival
  rule, no reservation, flee clears the errand, wanderers abstain —
  at priority **flee > meal > dress > work** (a colonist due both eats
  first; hunger is the sharper clock). Donning **consumes the item**
  and sets `clothes = CLOTHES_WEAR_TICKS` (10 game-days); no worn-item
  entity exists. Wear ticks down every tick, worn always; at 0 they are
  unclothed again and the tailor has a customer — the wear clock is
  what keeps the chain an economy instead of a one-shot.
- **The buff: +25% work while clothed, walk untouched** (extends the
  slowdown machinery). `CLOTHED_FACTOR = 1.25` applies at the same
  three work accumulators `HUNGRY_FACTOR` already touches (`c.work`,
  `b.progress`, `b.millProgress` keyed off the worker), on a
  deterministic cadence — one extra work tick every fourth, never
  fractional floats, mirroring the hunger mechanism's Bresenham gate.
  Composition is **pinned, because two readings ship different
  numbers**: the extra tick is granted *only on a tick the hunger gate
  lets through*, so clothed = 1.25, hungry = 0.6, and both = exactly
  0.75 (the periods are coprime; the intersection is 3/20 at every
  phase offset) — granting the extra tick unconditionally would ship
  0.85 while still "following the spec". At the repair site, where a
  gated tick adds `REPAIR_HP_PER_SECOND` rather than 1, an extra tick
  doubles that whole increment: the gate is per-tick, never per-point.
  Walk speed is **shoes**, the user-named later step — recorded as a
  non-goal, not designed.
- **No clothed readout** (reuses the calm doctrine). No ribbon count,
  no per-colonist panel: the Stores panel's Clothes row is the stock
  signal, and clothed colonists read on the map. The mechanism is
  **not** a re-bake — colonists are per-frame movers redrawn by
  `drawColonists`, with no bake and no dirty machinery — so clothed
  state is one tint decision in that draw. The visual is pinned so it
  reads at map distance: an **unclothed** colonist wears a single drab
  tone; a **clothed** one gets the existing three-colour tunic
  rotation (`tunic` / `wool` / `smock` by id) — dressing the colony
  literally brings colour to it.
- **The left edge outgrows its no-scroll floor, and this spec says so**
  (extends the HUD-refit arithmetic honestly). Four Build tools take
  the rail to ~465px and four Stores rows plus a group head take Stores
  to ~372px: the scroll-free floor moves from ~750px to ~900px of
  window height. At 768 the rail scrolls by about **four rows** (the
  deficit is ~140px) — gracefully, inside the flex column the refit
  built for exactly this.
  Accepted for now; the repair when it hurts is a three-column rail or
  collapsible Stores groups, deferred with this sentence as its
  record.

## Goals

- The second deep chain exists, sharing the first's roots: grain feeds
  ovens *and* dairies, wool runs three steps to clothes, and staffing
  it all is four more slots against the same pool.
- Colonists gain their first per-person economy: dressing the colony is
  continuous demand, not a checkbox, and a clothed colony visibly
  out-works a ragged one.
- Food gains variety without new rules: cheese is bread by another
  road, and the gate and meals treat them alike.

## Non-goals

- No shoes, no walk-speed equipment — the named later step; the
  `clothes` field's shape (`shod` beside it) is the prepared ground.
- No sheep entities: the Pasture's sheep are decorative render props on
  its footprint (the mockup's wander machine reborn as flavour), never
  sim state.
- No multi-output recipes, no equipment slots or inventory UI, no
  per-colonist panel.
- No warmth, weather, or seasons — clothes mean work speed, nothing
  else.

## Design

### Defs, goods, migration

The four def rows and four goods per Key decisions; recipes and costs
in `tuning.ts` (defaults, all tunable: `WOOL_TICKS` 6 s, `DAIRY_TICKS`
5 s at 1 grain → 1 cheese, `WEAVE_TICKS` 4 s at 1:1, `TAILOR_TICKS`
6 s at 1:1, `CLOTHES_WEAR_TICKS` = 10 × `DAY_TICKS`,
`CLOTHED_FACTOR` 1.25). One tailor at 6 s/garment covers a colony of
~15 (demand ≈ 1.5/day) with room to spare — the real price is four
slots and the wool logistics. The v10 rung: `clothes` and `dressing`
defaulted 0 on every colonist, four accept flags stamped 1 on every
saved building, four `-1`s appended to `limits`. Fixtures v1–v9 keep
loading; a v10 fixture joins. Two register notes: `clothes` stores
**remaining** ticks — a stated deviation from the store's
damage-not-remaining precedent (`wallDamageMap`), chosen because
0 = unclothed comes free; the accepted cost is that retuning
`CLOTHES_WEAR_TICKS` never reaches clothes already worn. And one named
class of comment truth-ups rides along (the HUD-refit precedent):
everything that calls bread the only food — `store.ts`'s ItemType
note, `tableSet`'s and `Inspection.tableShort`'s docs, the MEAL notes
in `hunger.ts` / `tuning.ts`, `stepEater`'s block — now says food.

### The dress errand

In `stepColonists`, directly after the meal check and under the same
between-stints condition: a colonist with `clothes === 0` and
`dressing`-eligible seeks the nearest free Clothes
(`nearestFreeItem` + `sourceForSite`, ties by id), sets `dressing = 1`,
walks, and on route exhaustion applies the meal loop's arrival rule
(lowest-id free Clothes on the own or an adjacent tile, or in an
adjacent building): consume, `clothes = CLOTHES_WEAR_TICKS`,
`dressing = 0`, back to work. Nothing-there logic, re-seek cadence,
flee behaviour, and the no-reservation race all copy the meal loop
verbatim — where the meal loop's spec pinned a rule, this errand
inherits it rather than restating it. "Dressing-eligible" means:
settled (`dest < 0`), `clothes === 0`, not already dressing. A
colonist due a meal *and* clothes runs the meal first — and a meal
coming due **mid**-dress-errand preempts it: a dress errand is not a
stint, and the clobbered errand self-heals by re-seek.

Three consumers the meal errand had to teach get the same lesson by
name, not by inference: `workerState` gains `"dressing"` and the
panel's worker row and stall gate carry it ("waiting for wool" while
the weaver is at a fitting would be the panel lying, the exact bug the
`eating` state exists to prevent); `readout().idle` excludes a
dressing colonist exactly as it excludes an eating one (idle means
*available*, per `2026-09-09-idle-means-available`); and `flee` clears
both errand flags by name. Stated cost the meal loop never paid:
unclothed is the default, permanent state, so this scan runs for every
colonist from tick 0 in a colony that never builds the chain —
O(items) per tick, no PRNG, no route planned when nothing is free,
accepted at this scale. The first garment out of the tailor draws
every unclothed colonist at once; the provision-pile precedent covers
it — id order wins, losers re-seek.

### The buff

Applied exactly where the hunger slowdown is applied, as its inverse:
the deterministic work cadence gains one extra tick every fourth for a
clothed worker, at all three accumulator sites; the walk budget is
untouched. The hungry and clothed cadences stack by composition (both
active ≈ ×0.75), and the golden hash stays integral because no
fractional work exists.

### HUD and rendering

The rail's Build section gains four buttons (icons hand-drawn into
`ICONS`; cost captions off the defs) — twelve Build tools, six grid
rows. The Stores panel gains the cloth group and the cheese row by
table. Panels are standard: the Pasture's chain chip is one-sided
("→ Wool"), the Dairy/Weaver/Tailor chips two-sided, stall notes
generic. The Pasture bakes with a fence and a few **static grazing
sheep** on its footprint — the mockup's wander machine stays retired;
renderer-owned animation state is a door this spec does not open.
Clothed colonists are handled in `drawColonists`, the per-frame mover
draw (no bake, no dirty machinery): unclothed draws the single drab
tone, clothed the existing three-colour tunic rotation. The Stores
panel's group order gains **cloth after food** (wood / stone / food /
cloth). Styleguide: four good tokens, the cloth group and its order,
and the clothed/unclothed colonist reading land with the change.

### Verification

Build the chain and staff it: wool → cloth → clothes through
stockpiles; an unclothed colonist walks to the clothes and visibly
changes; their work measurably outpaces an unclothed peer's (unit
test on the cadence); ten game-days later they revert and re-dress
when stock allows. Cheese from the dairy feeds colonists and opens the
wanderer gate exactly as bread does. Ceilings and filters work on all
four goods. Fixtures v1–v9 load; the golden drift tests pass (pins
re-record for the store shape and any script extension, per the
ladder). Browser pass per `src/ui/CLAUDE.md`, including the rail at
768px window height scrolling gracefully, never overlapping Stores.

## Alternatives considered

- **Multi-output recipes** (one Pasture yielding wool + cheese) — the
  engine cost lands in the muddiest place: ceilings ("wool at limit,
  cheese wanted — does the batch start?"), `outputFull`, haul-to-store
  and the panel all extend for one building's fiction. Rejected; if
  byproducts accumulate real demand later, the evidence will justify
  the surface then.
- **Mutton as the food** (a butcher consuming... nothing killable
  exists) — the game has no kill mechanic anywhere, on purpose;
  grain-fed dairy reads calm and links chains. Rejected.
- **Clothes as a one-time upgrade** (no wear) — the chain dies once
  everyone is dressed; a one-shot economy isn't one. Rejected by
  sign-off.
- **A worn-item entity** (clothes stay an `Item` while worn) — doubles
  every item consumer's location model for no read the player ever
  does. Consumed on donning instead. Rejected.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread through shared state again: the
  goods and defs, the v10 migration, the dress errand, the composed
  work cadence and the FOODS generalization all touch the same store
  and colonist step. Opus because the cadence composition and the
  errand's consumer edits want interpreting against two prior specs,
  not transcribing.
- Natural order: the four append rituals + defs + v10 rung and fixture
  (with the comment truth-up class), then the FOODS generalization,
  then the dress errand and the pinned cadence composition (the
  design-risk core — build the 0.75 unit test first), then HUD, render
  and styleguide, then the browser pass including the 768px rail
  degradation.
