# Hives, flower fields and mead

Honey → mead is the colony's first drink, and its first chain whose whole
footprint is the player's to place. A **Hive** is a slot workshop on the Farm's
no-input pattern, making honey slowly on its own and faster for every **flower
field** — a passive 3×3 building — standing within its reach; a **Meadery**
turns honey into mead. Mead's effect is on *who comes*: while the colony holds a
cup a head and one for the newcomer, the wanderer countdown runs at double
speed, and a wanderer drinks one cup on settling. Because a hive may stand outside the wall, this also closes
the one hole in the keeper's shelter: an indoor slot worker no longer steps out
for a meal into a prowler's reach. Work speed stays clothes', hunger stays
bread's, and nothing here is a morale. Grounded in `docs/research/2026-09-14-mead-and-hives.md`.

## Outcome

**What you get:**

- Three buildings: a **Hive** (a keeper makes honey slowly alone and up to
  three times faster with flower fields in reach), **Flowers** (a passive 3×3
  plot), and a **Meadery** (honey → mead). All three go wherever a House goes,
  walled or not; a reach square shows while placing a hive or a field.
- Mead speeds arrivals: while the colony holds a cup a head and one for the
  newcomer, the wanderer countdown runs at double speed, and each wanderer
  drinks one cup on settling.
  Beds and food are still the only gates.
- An indoor slot worker no longer steps out for a meal or a fitting into a
  prowler's reach — at every slot building, not only hives.
- Honey and mead in a new `drink` group in Stores; saved piles refuse both
  until opted in.

**How to verify:**

- Build and staff a Hive with no fields: honey appears roughly every twenty
  seconds at 1×. Build three Flowers inside its reach square: the panel reads
  `Fields in reach  3 / 3` and batches complete about three times as fast.
- With a House standing, beds free and the table set, time two arrivals. Then
  hold at least folk plus one mead: the House panel reads `mead in the cellar
  — folk come sooner`, the next wanderer arrives in about half the time, and the
  colony's mead count drops by one when they settle.
- Staff a workshop outside the wall and let an orc prowl beside its work tile
  when the keeper is due a meal: the keeper stays inside until the orc leaves,
  then walks out to eat. Nobody dies at the door.
- Load a save made before this change: it loads; every stockpile shows honey
  and mead `off`; nothing behaves differently until a Hive is built.

## Key decisions

- **The Hive is a slot workshop on the Farm's `per: 0` convention** (reuses).
  Nothing in the game produces without a keeper inside (`economy/workshop.ts:38,
  42`), and the concept prices infrastructure in people — a beekeeper is the
  right cost. `recipe: { input: Honey, per: 0, output: Honey, ticks: HIVE_TICKS,
  inputCap: 0, outputCap: WORKSHOP_OUTPUT_CAP }`, exactly as the Farm and
  Pasture (`buildings.ts:196–207, 296–307`).
- **Flower fields are buildings, not ground** (reuses). A 3×3 def on the House's
  shape — `hasSlot: false, beds: 0, recipe: null` — placed with the ordinary
  ghost and built by the ordinary `Build` task. Their effect is **derived per
  read**, as `populationCap` sums beds: nothing on the Hive stores how many
  fields it has. The player decides where honey lives, inside the wall or out,
  which is "risk is chosen" applied to a resource — and it costs no world layer,
  no save-shape change for terrain, and no seeded rung.
- **The boost is a per-building batch length, evaluated at the completion
  compare** (extends). `stepWorkshop`'s one line `millProgress < recipe.ticks`
  (`workshop.ts:72`) becomes `millProgress < batchTicks(sim, b, recipe)`, which
  is `recipe.ticks` for every kind but the Hive and
  `HIVE_TICKS_BY_FIELDS[fieldsInReach(sim, b)]` for it. Reach is
  **footprint-to-footprint**: a field counts when the Chebyshev gap between the
  two plots is at most `HIVE_REACH` — `densInReach`'s loop (`know/index.ts:706`)
  with `besideFootprint`'s rectangle arithmetic in place of a point distance —
  capped at `HIVE_FIELDS_MAX`. Origin-to-origin, the tower's rule, was exact for
  1×1 footprints and lies at three of four edges for a 2×2 hive and 3×3 fields.
- **Mead speeds the countdown; it does not gate it** (extends). `stepSettlers`
  decrements `wandererTimer` by `cellarSet(sim) ? 2 : 1` at `settlers.ts:156`;
  `cellarSet` is `tableSet` (`:104–117`) with mead for food. Beds and food
  remain the only gates. A second gate was rejected: it turns a lever into a tax.
- **A wanderer drinks one cup on settling** (extends `resolve`,
  `settlers.ts:177–193`). The lowest-id **free** mead that is stored or on the
  ground is removed; a wanderer who settles into an empty cellar settles anyway,
  as one settles into a short table. Demand therefore equals arrivals, and a
  threshold that nothing consumed would have been build-once-forever.
- **Honey and mead file under a new Stores group, `drink`** (diverges).
  `GROUP_ORDER` gains a fifth entry and the closed `GoodGroup` union is widened
  on purpose (`hud.ts:136–164`) — the group is "what a colonist does with the
  good", and nobody eats these; honey rides with mead as grain rides with bread.
- **`SAVE_VERSION` 11, one rung** (reuses the ladder). Three new `BuildingKind`s
  (Hive 12, Flowers 13, Meadery 14) force the bump on their own — the rung-8
  reason (`migrations.ts:294–311`). The rung stamps `acceptHoney`/`acceptMead`
  **`0`** on every saved building — the default-off rule
  (`2026-09-14-stockpile-default-and-clearing`), deliberately not the v10
  rung's `1`: a curated pile must not sprout acceptance of goods that did not
  exist, and `all` is one press — and appends two `-1`s to `limits`; no
  colonist and no world field. Every pinned hash moves for shape.
- **An indoor slot worker does not step out into a prowler** (extends the
  threat model). `threatNear`'s scan becomes a point function,
  `prowlerNear(sim, x, y)`, and both self-errands ask it about the tile
  `leaveBuilding` would place the worker on *before* stepping out; a prowler
  there means no errand this tick, retried next tick like every errand. Closes
  the case `2026-09-09-watchtowers` recorded as untested and narrows the
  "bunker" claim in `docs/specs/2026-09-04-monsters.md:289–290`. General, not
  hive-specific — the Watchtower's watcher was the most exposed of all.
- **Two new props, one shared silhouette** (extends). Hive and Flowers get
  props of their own — they are the buildings whose safety the player reads at
  map distance. The Meadery shares the timber-workshop silhouette, a seventh
  sharer recorded against the open `docs/CLAUDE_TODO.md` item rather than
  solved here.

## Goals

- A drink chain whose footprint the player sites: hive, fields and meadery go
  where there is room, and room is what pulls the wall outward.
- Mead pays out in the game's scarce currency — people arrive sooner — and in
  nothing else.
- Every piece of the chain is a copy of a pattern that exists: no new task
  kind, no new colonist state, no new world layer. The one addition outside the
  chain — the keeper's door guard — is an extraction and two guards.

## Non-goals

- Beer, a tavern, a drink errand, any work-speed or morale effect.
- Wax or any second output — multi-output recipes are rejected
  (`2026-09-11-sheep-and-clothes.md:88–90`).
- A generated meadow layer, distance pricing, or any rule that makes honey
  *have* to be outside.
- Making honey or mead a food; `FOODS` is unchanged.
- A per-kind ground rule: `canPlace` is untouched, so fields may stand on sand
  as every building may — flowers on a beach look odd, and the game's first
  per-kind ground rule would cost more than the oddity.
- Fixing the gate-tile stall (`2026-09-05-monsters-and-the-hours-they-keep.md:74–86`)
  or sheltering the pool workers who feed an outside building; both are named
  below as the price of an outside hive.

## Design

### The three buildings

Appended to `BuildingKind` and `BUILDING_DEFS`:

- **Hive** — 2×2, `cost: 4` logs, `hasSlot: true`, the `per: 0` recipe above.
  `HIVE_TICKS` is the *base* batch, with no fields in reach.
- **Flowers** — 3×3, `cost: 2` logs (a fenced plot, the Stockpile's price),
  `hasSlot: false`, `recipe: null`. Passive: it has no worker, no panel action,
  no state beyond being built.
- **Meadery** — 2×2, `cost: 4` logs, `hasSlot: true`,
  `recipe: { input: Honey, per: 1, output: Mead, ticks: MEADERY_TICKS, inputCap:
  WORKSHOP_INPUT_CAP, outputCap: WORKSHOP_OUTPUT_CAP }`, with
  **`MEADERY_TICKS = 5 * TICK_HZ`** — the band the Oven and Dairy already sit in
  (`tuning.ts:67, 105`), and deliberately not slower: honey is the scarce half
  of this chain, so the brewing step should not be a second bottleneck on top of
  it. An ordinary workshop otherwise: hauls feed it, ceilings brake it, filters
  route it, nothing new.

`canPlace` is unchanged, so all three go wherever a House goes, walled or not.
Buildings are never razed, so a field, once built, stands.

### The boost

`fieldsInReach(sim, hive)` counts active `Flowers` whose plot lies within
`HIVE_REACH` of the hive's plot, and clamps at `HIVE_FIELDS_MAX`. The distance
is the Chebyshev **gap between two footprints**: per axis, how far the nearer
edge of one rectangle is from the nearer edge of the other, zero when they
overlap on that axis — the clamp-to-interval arithmetic `besideFootprint`
already does for "standing next to a building" — and the gap is the larger of
the two. Equivalently: a field counts when **any tile of its plot lies inside
the hive's footprint grown by `HIVE_REACH` on every side**, which is exactly the
rectangle the overlay draws, so what the player sees is the rule at every edge.
Origin-to-origin, the tower's rule, is exact only for 1×1 footprints; with a
2×2 hive and 3×3 fields it counts plots two-thirds outside the line and skips
plots two-thirds inside it — and fields are never razed, so a rule that
disagrees with its picture is baked into every colony's honey rate for good.

`HIVE_REACH = 6` and `HIVE_FIELDS_MAX = 3`, both tunables in `tuning.ts`.
`HIVE_TICKS_BY_FIELDS` is a tunable table indexed by that count:
`[20, 12, 8, 6] × TICK_HZ` — 200, 120, 80, 60 ticks — so a lone hive makes
three honey a game-day and a hive among three fields ten, against the Farm's
twelve grain. Integers throughout; nothing is scaled at runtime.

`batchTicks(sim, b, recipe)` in `economy/workshop.ts` returns the table entry
for a Hive and `recipe.ticks` for everything else, and the completion compare
reads it **every tick**. So a field that finishes mid-batch speeds the batch
under way, and since fields are never removed the count only ever rises — no
batch is ever lengthened after it starts. Fields built before the hive count
from the hive's first batch; order of construction is irrelevant.

### The cellar

`cellarSet(sim)` in `settlers.ts`, beside `tableSet`: every mead anywhere —
stored, loose or carried, counted as every other good is — `≥ settled + 1`.
No exemption for an empty colony: with nobody home there is nobody to hurry.

`stepSettlers` (`:149–158`) decrements by `cellarSet(sim) ? 2 : 1`, still
clamped at zero. Nothing about `restart`'s draw changes, so the PRNG stream is
untouched and the boost switches on and off mid-countdown as stock crosses the
line. The check sits inside the existing gate sequence — under cap, table set,
House standing — so a boosted clock is still a clock that only runs while
someone may actually come.

`resolve`, on the branch that settles (`dest = −1`), calls `drinkCup(sim)`:
find the lowest-id item of type Mead with `reservedBy === −1` and `loc` Stored
or Ground, and `removeItem` it. Never a carried item and never a reserved one —
removing either would orphan a haul mid-flight. None found: settle anyway.
The cup is paid on delivery, not at spawn, so a wanderer caught on the beach
costs the colony nobody's drink.

### Goods

`ItemType.Honey = 11`, `ItemType.Mead = 12`, each through the fourteen append
sites the research lists (`goods.ts` row and `accept` union, the `Building`
field, `place()`'s default, `limits`, palette, `GOOD_VAR` and its CSS variable,
`GOOD_GROUP`, the styleguide table). Two constraints on the colours: **honey
must not read as `gold`** — gold is intent and nothing else may wear it — so it
is a deep amber, darker and redder than `gold` the way `bread` is darker and
redder than `timber`; mead is a pale straw, distinct from `sand`.
`GROUP_ORDER` becomes `["wood", "stone", "food", "cloth", "drink"]`; the group
label and the styleguide's Stores prose gain the fifth heading.

### Save and migration

`SAVE_VERSION = 11`. `MIGRATIONS[10]` stamps `acceptHoney: 0` and
`acceptMead: 0` on every saved building — refusing until opted in, per the
Key decision — appends `-1, -1` to `limits`, and touches neither colonists nor
`world`. The three kinds need
nothing in the state; the bump exists so an older build refuses the save rather
than crashing on kind 12. Every pinned hash moves for shape (two `Building`
fields, two `limits` slots), and a `v11.castles` fixture joins holding the chain
standing — a hive with fields in reach, honey and mead in the colony, a cellar
that is set.

### Panels and overlay

- **Hive**: the ordinary workshop panel plus a `Fields in reach  N / 3` row
  (mirroring the Watchtower's `watching`), and, at zero, the note `no flowers
  in reach — plant fields within 6 tiles` in the house voice. `Inspection`
  gains `fields: number` (−1 for every other kind).
- **Flowers**: the House's shape — what it is, then the consequence note
  `boosts hives within 6 tiles`. No action button.
- **Meadery**: the workshop panel, plus the consequence note `mead in the
  cellar brings folk sooner` — state-independent, like the Flowers note,
  because this is the one place the game can say what mead is *for* before it
  is already working.
- **House**: a second consequence note, `mead in the cellar — folk come sooner`,
  when `cellarSet` holds, arrivals are possible, and the table is not short —
  the short-table note wins, since nobody comes either way. `Inspection` gains
  `cellarStocked: boolean` beside `tableShort`, **composed in `know`** exactly as
  `tableShort` is at `know/index.ts:501` — `def.beds > 0 && Active && settled <
  populationCap && tableSet && cellarSet` — because the HUD cannot rebuild that
  from `tableShort` alone (false both at cap and with a set table) and carries
  no cap.
- **Reach overlay** (extends `drawWatchRange`): the reach is the hive's
  footprint grown by `HIVE_REACH` on every side — a rectangle, not a square
  about a point — so `drawWatchRange` generalises to a rectangle outline,
  `drawReach(x0, y0, x1, y1)`, of which the tower's square is the 1×1 case: one
  function, two callers, the same keylined sage bars and the same refuse-whole
  budget rule (a 2×2 hive at reach 6 is 56 bars against the tower's 196).
  Shown while the Hive tool is held,
  the ghost's reach first and then every standing hive's — exactly as the
  tower tool shows every tower (`main.ts:459–480`), since siting a second hive
  is where seeing the first one's reach matters; while a hive is selected, its
  own; while the Flowers tool is held, every hive's reach, so a field is sited
  with a tile of its plot inside one.
- **Rail**: three buttons join the Buildings section, **each with its own icon**
  — the rail is icon-only, so a button with no entry in the icon table is a
  blank cell that the player reads as a missing building. A Hive is a banded
  skep with an entrance at its foot (not the Oven's single dome with a door and
  a chimney curl); Flowers is blooms on stems over a ground line (circles on
  stems, which nothing else in the set has, and so not the Farm's rows or the
  Pasture's fence); a Meadery is a cask on its side with two hoops and a spigot
  (not the Dairy's upright churn). All three in the table's idiom: a 22×18
  viewBox, `fill="none" stroke="currentColor" stroke-width="1.4"`, legible at
  22px.
- **The icon table becomes compile-forced for buildings**. `ICONS`
  (`hud.ts:287`) is `Record<string, string>` and `toolButton` renders
  `ICONS[key] ?? ""` (`:909`) — the one per-kind table in this codebase with no
  forcing function, which is exactly why three blank buttons shipped past a
  build and two reviews. The building half splits out as
  `BUILDING_ICONS: Record<BuildingKindValue, string>`, the way `BUILDING_DEFS`,
  `GOODS`, `GOOD_VAR`, `GOOD_GROUP` and `GOOD_HEX` already are, and
  `toolButton` reads it directly for `kind === "build"` with no `??` fallback.
  A future building with no icon is then a compile error rather than an empty
  cell. The non-building tools keep their string map; that set changes once a
  year, not once a chain.

### The keeper's door

A colonist inside a building is uncatchable wherever it stands
(`threats/flee.ts:50`, `threats/monsters.ts:185`), so an outside hive shelters
its keeper — except at meals. Both self-errands `leaveBuilding` and plan a
route on the same tick (`colonists.ts:229–244` for the meal, `:363–375` for the
fitting), the flee check at `:111` has already returned null that tick
*because* they were inside, and monsters step after colonists (`tick.ts:50–51`):
a prowler adjacent after its move kills them at the door.

The fix is one extraction and two guards. `threatNear`'s body from its
bounds check down (`flee.ts:51`) — the guard on the `tileIndex` read, the
tile's inside test, then the nearest prowling monster within `FLEE_RANGE` by
`reach`, ties by id — becomes `prowlerNear(sim, x, y): Monster | null` in
`threats/flee.ts`; `threatNear` is then `c.inside ? null : prowlerNear(sim,
c.x, c.y)`, behaviour unchanged. In each errand's `c.inside && b` branch,
before `leaveBuilding`, the worker asks `prowlerNear(sim, wx + 0.5, wy + 0.5)`
about the tile `leaveBuilding` would put them on — `workTile(b)`, or its drop
tile — **as tile-centre floats**, the coordinates `threatNear` passes in
`c.x, c.y` and `watched` passes for its beach (`settlers.ts:296`); integers
would shift the `FLEE_RANGE` boundary by half a tile and make two
implementations hash apart. If it answers, the errand returns `false`: nothing
this tick, the door stays shut, and the check runs again next tick as every
errand's does. Nothing is stored and nothing else moves. A keeper kept
in by a long prowl gets hungry; from `HUNGRY_TICKS` their cadence drops to
×0.6 and nothing else happens — a plateau, as the concept requires.

The guard is general: every slot building has this door, and the Watchtower,
whose `millProgress` is always −1, opened it most freely. The encounter hash
moves only if the scripted encounter has an indoor slot worker due a meal
beside a prowler; if it does, it moves for behaviour. **The guard is its own
change to the threat model and lands as its own changelog entry** — a slug that
names the thing, `indoor-workers-wait-out-prowlers` or the like — citing
`2026-09-09-watchtowers` and `docs/specs/2026-09-04-monsters.md`, separate
from the hives entry, per CLAUDE.md's one-file-per-change rule.

### What an outside hive still costs, named

Nothing here shelters the pool workers who feed an outside meadery or build an
outside field, and every commute crosses a gate tile that reads as outside
(`2026-09-05-monsters-and-the-hours-they-keep.md:74–86`). Both stay as they
are: they are the price the concept asks for building outside, and the gate
stall's prescribed fix is a third enclosure state with a hash of its own.

## Alternatives considered

- **A generated meadow layer** hives must sit on. Puts the game, not the player,
  in charge of where honey is; a saved `World` layer, a seeded rung on the v4
  lair pattern, a per-kind ground rule and a mesher visual. The research's
  default, superseded by the user's field idea, which keeps the pull and drops
  all four costs.
- **Painted flower ground** on the terraform pattern — labour-only, any shape,
  the new drag box. A tile layer, a designation map and a new `TaskKind`: a
  spec's worth of plumbing. May replace the building later without touching
  the Hive; the boost reads "fields in reach" either way.
- **Distance-priced honey** (rate by the lair band). Honest but invisible; the
  pull becomes a number in a panel.
- **Honey as a third food.** No Meadery, no mead, no hook — a smaller feature
  than the one asked for.
- **A slotless hive.** New machinery in `stepWorkshop`'s two gates, against the
  concept's own price for infrastructure.
- **A drink errand** on the meal pattern. Two colonist fields, a rung, and the
  per-tick seek the dress errand already shows the cost of, for an effect the
  settle path delivers in one line.
- **Mead as a second arrival gate.** Strictly harsher than food's gate; a tax.
- **Scaling the interval drawn at `restart`.** Applies only from the next
  countdown and edits the one PRNG-shaped value; the decrement is gradual and
  reversible mid-countdown.
- **Leaving the keeper's errand leak as the price of building outside.** The
  draft's default; rejected by the user, since a hive is the first building the
  game *invites* the player to put outside, and a shelter with a hole in it is
  worse than none. The fix is two guards and an extraction, and general.
- **Stamping the new accept flags `1` on saved piles**, the v10 rung's rule.
  Rejected: since `2026-09-14-stockpile-default-and-clearing` a pile's filters
  are the player's curation, and a good that did not exist was never opted into.
- **Origin-to-origin reach, the tower's rule.** Cheapest and exactly the
  existing code, but exact only for 1×1 footprints; for a 2×2 hive and 3×3
  fields the drawn square lies at three of four edges, and since fields are
  never razed the mismatch would be permanent in every colony's rate.
- **Fixing the batch length at batch start.** Deterministic too, but a field
  finishing mid-batch would wait a batch to matter, for no gain.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5, as two changes in sequence.** First the keeper's door
  guard — `threats/flee.ts` and two branches of `labour/colonists.ts`, its own
  changelog entry, and the one place the encounter hash may move for
  behaviour — so that move is seen on its own before the chain moves every
  hash for shape. Then the chain: three kinds, two goods, the boost, the
  cellar, the cup, the v11 rung, props, overlay and panels — one thread from
  `store.ts`/`buildings.ts` outward through `know` to `hud.ts`, where each
  file's edit is decided by the one before it.
- Opus rather than Sonnet because three decisions have to be interpreted, not
  transcribed: the footprint-gap reach and its overlay generalisation, the
  door guard's coordinate contract, and what the golden and fixtures can still
  assert once every hash has moved.
- Not multi-agent: the guard is forty lines and would cost an agent more than
  it saves; the chain's streams all meet in `Inspection` and the def rows.
  Not ultracode: kind and item numbers are the only one-way doors, and every
  content step has already accepted those.

## Amendments

- 2026-09-14 — `MEADERY_TICKS` is stated as `5 * TICK_HZ`. The draft named it
  without a value while numbering every other tunable; the build picked that
  band from the Oven and Dairy on the spec's own reasoning about honey being
  the scarce half, and the spec now says so outright.
- 2026-09-15 — The rail bullet now requires an **icon per building** and makes
  the building half of `ICONS` a compile-forced `Record<BuildingKindValue,
  string>`. The draft said only that "three buttons join the Buildings
  section"; because the rail is icon-only and the table is keyed by loose
  `string` with a `?? ""` fallback, the three buildings shipped as blank,
  clickable cells and read as missing. The same bullet had also kept a
  duplicated fragment of the reach-overlay bullet, and a claim about the rail
  scrolling at 720 that `2026-09-15-rail-sections-and-fit` has since
  superseded; both are removed.
