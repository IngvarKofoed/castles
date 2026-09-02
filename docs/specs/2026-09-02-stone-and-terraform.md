# The stone tier and terraforming

Build-order step 3b: the wall system's permanent tier and the ground it
stands on. Rock outcrops become minable; a mason — the second slot
workshop — mills rock into blocks; stone walls and gates rise on the 3a
machinery at one block per segment; and pool workers level ground with
labour alone. This completes CONCEPT's expansion loop end to end: the
palisade claims fast, the stone wall holds forever, the old line comes
down. Wall damage stays with threats (step 4).

## Outcome

**What you get:**

- The full expansion loop from CONCEPT, playable: palisade a bite of
  land, raise a stone line behind it, raze the old timber — permanent
  walls paid for by mining the map's own outcrops through the mason.
- The labour trap, live: two slot workshops against five colonists, with
  the labour meter showing exactly what staffing both costs the pool.
- Terraforming: marquee rough ground and pool workers level it to the
  press tile's height, one step at a time — flat build sites bought with
  people-hours, never resources.
- Rock and block readouts on the ribbon; v1 and v2 saves load unchanged.

**How to verify:**

- Designate a rock outcrop: a worker quarries it from below, rock items
  drop, and the tile erodes to buildable grass at its neighbours' height.
- Build and staff a mason: rock flows in, blocks come out at 2:1, and the
  idle count drops by one more — with both workshops staffed, hauling
  visibly thins.
- Pick the Stone wall tool and drag a line behind an existing palisade:
  workers carry single blocks, the segments rise slower than timber, and
  razing the old palisade line refunds its logs while the ring never
  breaks — the enclosed count dips as wall tiles and the strip between
  the lines are given up, but it never collapses.
- Marquee a bumpy area with the terraform tool: it levels to the press
  tile's height step by step; water and occupied tiles are skipped.
- Load a v1 or v2 save: it opens working and can immediately mine, mill,
  and build stone. `npm test` and `npm run lint` pass.

## Key decisions

- **Every enum appends** (reuses the 3a rule — serialized values never
  renumber). `ItemType` += `Rock: 2`, `Block: 3`; `BuildingKind` +=
  `Mason: 2`; `TaskKind` += `Mine: 7`, `Terraform: 8`; `WallState` +=
  `StoneBp: 5`, `Stone: 6`, `StoneGateBp: 7`, `StoneGate: 8`. Wall
  consumers already go through `isBlocking`/`isWalkable`
  (`sim/walls/index.ts`), which gain four rows; no caller changes.
- **One block per stone segment** (reuses carried-until-completion). The
  3a build-wall task works verbatim with a block instead of a log; razing
  a stone segment refunds one block; no delivery ledger, no new item
  location. Cost pressure lives upstream in the chain — mining time,
  the mason's `ROCK_PER_BLOCK` ratio, hauling distance — all one-constant
  knobs.
- **Mining is chop for stone** (reuses the designation grammar).
  `mineMap` beside `chopMap`; the mine tool clicks or marquees rock
  tiles; the task quarries from an adjacent tile (a height-7 outcrop is a
  cliff — you work it from below), drops `ROCK_PER_TILE` rock items, and
  the tile *erodes*: its height becomes its lowest orthogonal land
  neighbour's (clamped ≥ 2), its terrain re-derives by the generation
  thresholds. Mining an outcrop yields stone and buildable ground — the
  second reward is deliberate.
- **The mason is the sawmill's shape, verbatim** (reuses). 2×2, 4 logs,
  one slot, rock input buffer, block output buffer, `ROCK_PER_BLOCK = 2`,
  `MASON_TICKS`. Its real purpose is systemic: two slot workshops
  against five colonists makes staffing a genuine trade-off for the
  first time — the concept's labour trap, live.
- **Stone walls are two more rail tools, not a toggle** (reuses). Stone
  wall and Stone gate join the rail as plain tools — the tool kind
  carries the material, each button shows its own cost caption, and no
  hidden toggle state can ever build the wrong material. The rail grows
  section labels to stay legible (Orders: chop, mine, terraform, raze ·
  Build: stockpile, sawmill, mason · Walls: wall, gate, stone wall, stone
  gate — the styleguide rail anatomy already supports section heads).
  Same line-drag and L-drag, same command shape plus a material field;
  raze needs no material and refunds the segment's own. **No in-place
  upgrade**: CONCEPT's loop is build the stone line *behind* the
  palisade, then raze the old one — which the 3a tools already do. Stone
  states block and walk exactly as their timber counterparts (all five
  predicate helpers in `sim/walls/index.ts` gain rows, not just the two
  named here).
- **Terraforming: level-to-target areas, labour only** (new, per
  CONCEPT's "charge labour, not stone"). `terraformMap: Uint8Array`
  stores target-height-plus-one (0 = none). The terraform tool marquees
  an area; the target is the press tile's height; every off-target,
  eligible tile gets designated. A terraform task works a tile one height
  step per `TERRAFORM_TICKS` until it reaches target, re-deriving terrain
  each step. Targets clamp to 2–6 and water tiles are never eligible —
  the island's shape is not for sale.
- **SAVE_VERSION 3** (reuses the ladder). The migration adds
  `mineMap`/`terraformMap` zero-filled **and stamps
  `acceptRock`/`acceptBlock` to 1 on every existing building** — without
  that, pre-v3 stockpiles would silently refuse the new goods forever and
  the mason would jam at output cap. The mason reuses `millProgress`
  (kind-scoped, already in the shape), so nothing else rides this rung.
  v1 and v2 fixtures keep loading; a v3 fixture joins them.
- **Priority order grows by two** (extends the `TASK_PRIORITY` table):
  build > build-wall > haul-to-site > haul-to-input > chop > mine >
  raze > terraform > haul-to-store. Mining sits with chopping (raw
  material flow); terraforming is ground-keeping, above only the tidying.

## Goals

- CONCEPT's expansion loop is complete and playable: palisade claims,
  stone holds, the old line comes down — with the stone paid for by a
  real two-step chain (rock → block) off the map's own outcrops.
- Staffing becomes a decision: two workshops, five colonists, and the
  labour meter showing what each slot costs the pool.
- Rough ground can be made buildable, priced in people-hours.
- The save ladder carries v1 and v2 colonies forward untouched.

## Non-goals

- No wall hit points, damage, or repair — nothing exists to do damage;
  that arrives with threats (step 4) and its own migration.
- No in-place palisade→stone conversion (the loop is build-behind).
- No stone buildings, roads, or bridges — walls and gates only.
- No terraforming of water, no lowering land below height 2, no raising
  above 6 — world shape is generation's job.
- No renewable stone, deliberately. Nothing ever re-derives to rock, so
  the map's outcrops are the colony's total stone budget — finite
  resources are what pull expansion outward (CONCEPT: "resources you can
  see but don't yet own"), and a quarry building can arrive later if
  depletion bites. Generation tuning must keep the budget generous:
  outcrop coverage × `ROCK_PER_TILE` should price several stone rings,
  checked once when tuning.
- No watchtowers (step 4b territory, with the knowledge model).

## Design

### Store and migration

Enum appends as listed in Key decisions. `mineMap` and `terraformMap`
join `chopMap`/`razeMap` in `Sim` (player intent beside the world).
`SAVE_VERSION = 3`; the migration zero-fills both maps; decode's
post-migration enclosure recompute is untouched. Fixtures: v1 and v2
keep loading (existing tests), v3 committed.

### Mining

Designation: the mine tool accepts tiles whose terrain is rock *and* that
have at least one orthogonal land neighbour — a sea-stack outcrop with no
adjacent stand tile is refused at designation rather than retried forever.
Click toggles, marquee adds (the chop interaction verbatim, including the
gold base-diamond mark, which sits on the rock's top face) — and the
designated rock's baked top face tints toward gold, the styleguide's
two-marks rule, at the cost of a chunk-version bump exactly like chop's
canopy tint. The mine task claims, walks to a tile 4-adjacent to the target
(reachability discovered at claim, as everywhere), works `MINE_TICKS`,
then: drop `ROCK_PER_TILE` rock items via the `dropTile` spiral starting
at the mined tile (which has just become enterable), set the tile's
height to its lowest orthogonal *land* neighbour's height clamped to
2–6 (the upper clamp is what guarantees mined ground never re-derives to
rock), re-derive its terrain (2 → sand, else grass), clear `treeMap`
(nothing grows on an outcrop anyway), mark the chunk dirty.

### The mason

`BUILDING_DEFS` gains the mason: 2×2, cost 4 logs, `hasSlot: true`.
Input buffer holds rock (haul-to-input reuses the sawmill sourcing —
ground or stored), output holds blocks, hauled away to accepting
stockpiles. Stockpile filters gain rock and block accept flags,
defaulted on. The slot worker mills `ROCK_PER_BLOCK = 2` rock into one
block per `MASON_TICKS`, progress-on-the-building exactly like the
sawmill (unstaffing loses nothing). The ribbon's readouts grow rock and
block counts. "The sawmill's shape, verbatim" includes the surfaces and
the plumbing: the stockpile panel's hard-coded logs/planks rows and
accept text, the workshop chain chips (Rock → Block here), the stall
note, and the four sawmill/plank special cases in task generation
(`isLoose`, `sourceForSite`, `generateHaulToInput`, `sawmillOutputFull`)
all generalize over item types rather than growing copies.

### Stone walls and gates

The place-wall and place-gate commands gain a `material` field
(timber | stone). The build-wall task fetches a log or a block by the
blueprint's material and is otherwise unchanged — carried until the
completion instant, every interruption path already correct. Build
times: `STONE_BUILD_TICKS` ≈ 2× palisade, stone gate ≈ 2× wooden gate.
Raze refunds one item of the segment's material. `isBlocking` treats
`Stone`/`StoneGate` like their timber counterparts (blocking for
enclosure), `isWalkable` passes both gate kinds and both blueprint
kinds. Rendering: stone segments bake as block courses in the stone
palette (the mockup's wall/tower material language is the reference),
stone gates as a squared arch; blueprints reuse the 3a blueprint
grammar in the stone palette.

### Terraforming

The terraform tool: press captures the target height (the press tile's
own), drag marquees the area, release designates every eligible tile
whose height differs from target — eligible means **grass or sand, never
rock** (mining is the only way an outcrop comes down; a careless marquee
must not demolish the colony's finite stone for zero yield), height 2–6,
target in range, and free of trees, walls, buildings, and ground items
(ineligible tiles are skipped, the marquee's rust-skip rule). A
designated tile stores target+1 in `terraformMap`; clicking a designated
tile with the tool clears it (chop's toggle), and re-marqueeing an
already-designated tile **overwrites** its stored target — a mis-pressed
area is fixed by re-dragging, never by clearing tiles one at a time. The terraform task walks
adjacent and moves the tile one step toward target per `TERRAFORM_TICKS`,
re-deriving terrain at each step and marking the chunk dirty; the task
completes when the tile hits target and clears its designation. The task
re-checks eligibility at every step and cancels the designation if the
tile has since grown a wall or building (chop's the-tree-went-away
tidy-up); before each height change it steps any colonist off the tile
(the wall-completion eviction rule), which is also what prevents a
lowered tile from stranding an idle colonist in a pit. Items on the tile
simply ride the height change — they store only x, y. One engine
extension is required and named here because the existing rule does not
cover it: the walker's per-step gate today re-checks only passability,
not heights — it gains the `MAX_STEP` check against the walker's current
tile, so a cliff forming under a precomputed path triggers the normal
repath instead of being climbed.

### Determinism and the golden test

The scripted command log gains a mine designation, a stone wall L-drag,
a mason staffing, and a terraform area; the hash test and the
save-at-T/load/advance drift test run over the extended script.

## Alternatives considered

- **Multi-block segments with a `Loc.Site` item state** — heavier,
  more medieval costs, but a whole new item-location riding into the
  save format for a tuning preference the rock→block ratio already
  controls. Rejected.
- **In-place palisade→stone upgrade** — not the concept's loop
  (build-behind-then-raze), and it would need a dual-state tile.
  Rejected; the existing tools express the real loop.
- **Raise/lower brush terraforming** — maximum control, fiddly for the
  actual use case (flat build sites). Rejected for level-to-target.
- **Mining as a slot workshop (quarry building)** — a third building and
  a fixed extraction point; designation-mining keeps extraction tied to
  the map's actual outcrops and reuses the chop pattern whole. Rejected
  for now; a quarry may return when outcrops run out.
- **A palisade|stone material toggle on the wall tools** — one hidden
  state whose forgotten setting builds the wrong material, and a control
  shape the rail doesn't host; two plain rail buttons carry the material
  in the tool kind with per-button costs. Rejected for the buttons.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread through the sim again: enum
  appends, the mason, mining, stone walls, and terraforming all share the
  store, the task system, and the migration. Build the migration +
  fixtures and the mining/terraform sim systems with unit tests first,
  then the mason and stone wall plumbing (mostly generalizing sawmill
  and 3a code), then tools and rendering; verify against the Outcome
  section at the end, browser checks included.
