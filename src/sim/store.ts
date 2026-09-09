import { spawnLairs } from "./threats/lairs";
import { PROVISION_BREAD, STARTING_COLONISTS, UNLIMITED, WANDERER_INTERVAL } from "./tuning";
import { generate, tileIndex, Terrain, type World } from "./world/world";

/**
 * The sim store: one serializable object holding everything the game is.
 *
 * The plain-data rule (docs/ARCHITECTURE.md, "The one hard boundary") is
 * absolute here and persistence lands next, so the shape below is what a save
 * freezes: plain objects, plain number arrays and typed arrays only. No Sets,
 * no Maps, no class instances, no closures, no `undefined`. Ids are numbers
 * and "none" is `-1`, never null — `structuredClone(sim)` must round-trip the
 * whole thing and `hashSim` must see a total order over it.
 *
 * Enums are frozen `as const` objects of small integers rather than string
 * unions: they hash compactly and serialize as themselves. **Every enum here is
 * append-only** — the numbers are in save files, so inserting a value silently
 * reinterprets every old save that held the ones after it.
 */

export const ItemType = {
  Log: 0,
  Plank: 1,
  /** Quarried from a rock outcrop; the mason's input. */
  Rock: 2,
  /** Cut stone; one raises one segment of stone wall. */
  Block: 3,
  /** Grown on a farm out of nothing but labour; the mill's input. */
  Grain: 4,
  /** Ground grain; the oven's input. */
  Flour: 5,
  /** The one food in the game. A colonist walks to a loaf and eats it once a
   *  game-day, and the wanderer gate wants one for everybody plus the newcomer
   *  (docs/specs/2026-09-08-bread-economy.md). */
  Bread: 6,
} as const;
export type ItemTypeValue = (typeof ItemType)[keyof typeof ItemType];

/** Where an item is. Exactly one of the location fields is meaningful. */
export const Loc = {
  /** On the ground at (x, y). */
  Ground: 0,
  /** In a colonist's hands; `holder` is the colonist id. */
  Carried: 1,
  /** Inside a building; `holder` is the building id. Delivered construction
   *  materials and workshop buffers are both this — never bare counts. */
  Stored: 2,
} as const;
export type LocValue = (typeof Loc)[keyof typeof Loc];

export const BuildingKind = {
  Stockpile: 0,
  Sawmill: 1,
  /** The second slot workshop: rock into blocks. */
  Mason: 2,
  /** Beds. The first building the sawmill's planks are for, and the only
   *  thing in the game that raises the population cap. */
  House: 3,
  /** Grain out of nothing but a farmer's hours — the one recipe in the game
   *  with no input at all, and the biggest footprint. */
  Farm: 4,
  /** Grain into flour. The Mason move repeated: one def row, no machinery. */
  Mill: 5,
  /** Flour into bread, and the first building priced in **blocks** — the
   *  mason's first customer that is not a wall. */
  Oven: 6,
  /**
   * The Watchtower: a slot with no recipe, whose whole output is knowledge.
   * While its watcher is inside, every den within `WATCH_RANGE` reads in
   * tenths instead of fifths (docs/specs/2026-09-09-watchtowers.md).
   */
  Watchtower: 7,
} as const;
export type BuildingKindValue = (typeof BuildingKind)[keyof typeof BuildingKind];

export const BuildingState = {
  /** Placed, still short of its materials. */
  Blueprint: 0,
  /** Materials delivered; waiting on or under construction labour. */
  Building: 1,
  /** Finished and working. */
  Active: 2,
} as const;
export type BuildingStateValue = (typeof BuildingState)[keyof typeof BuildingState];

/**
 * Task kinds. **Append only, never insert** — a kind is a number written into
 * every save, so slotting a new one into the middle would renumber every live
 * task in every old save into a different meaning, with no migration able to
 * tell the difference.
 *
 * The numeric order therefore says nothing about priority: that lives in
 * `TASK_PRIORITY` (tuning.ts), which is the one fixed global order a pool
 * worker works down. It used to be this enum's order, which was a step-2
 * convenience the wall tier removed rather than patched
 * (docs/specs/2026-09-02-palisade-walls.md).
 */
export const TaskKind = {
  Build: 0,
  HaulToSite: 1,
  HaulToInput: 2,
  Chop: 3,
  HaulToStore: 4,
  BuildWall: 5,
  Raze: 6,
  /** Quarry a rock outcrop down to buildable ground. */
  Mine: 7,
  /** Move one tile one height step toward its stored target. */
  Terraform: 8,
  /** Work bite damage back out of a standing segment. Labour only. */
  Repair: 9,
} as const;
export type TaskKindValue = (typeof TaskKind)[keyof typeof TaskKind];

/**
 * The two kinds of monster. **The split is stats-only** — notice range, speed
 * and bite, all in `sim/threats/` — because CONCEPT records orcs and trolls as
 * emergent from numbers rather than from kind-specific targeting rules: an orc
 * is fast enough to catch a fleeing worker, a troll hits hard enough to ruin a
 * wall, and neither has a rule the other lacks.
 *
 * Here beside the other enums, and append-only for the same reason: the number
 * is written into every save.
 */
export const MonsterKind = { Orc: 0, Troll: 1 } as const;
export type MonsterKindValue = (typeof MonsterKind)[keyof typeof MonsterKind];

/**
 * A monster's rhythm — the *when* of danger (docs/specs/2026-09-04-monsters.md).
 *
 * `Rest` notices nothing, chases nothing and bites nothing; all danger lives in
 * `Prowl`; `GoingHome` is already harmless, which is what makes CONCEPT's "hold
 * until it leaves" safe to trust. An attack ends only when the prowl clock
 * does — nothing the player does drives a monster off.
 */
export const MonsterPhase = { Rest: 0, Prowl: 1, GoingHome: 2 } as const;
export type MonsterPhaseValue = (typeof MonsterPhase)[keyof typeof MonsterPhase];

/**
 * One monster. Plain store data like everything else, and **everything it will
 * ever do is seeded at spawn**: the periods, the phase offset and the circuit
 * are drawn once from a stream derived from the world seed, so the tick loop
 * needs no runtime randomness at all and a monster keeps learnable hours.
 */
export interface Monster {
  id: number;
  /** One of `MonsterKind.*`. */
  kind: number;
  /** Continuous tile coordinates, as a colonist's are, with the previous
   *  tick's position beside them for the renderer to interpolate through. */
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  /** Home tile: where it rests, and the one tile of ground that can never
   *  read as "inside" however much stone surrounds it (see walls/enclosure). */
  lairX: number;
  lairY: number;
  /** Waypoint tile indices, walked in order while prowling. */
  circuit: number[];
  /** Index into `circuit`. */
  leg: number;
  /** One of `MonsterPhase.*`. */
  phase: number;
  /** Ticks left in this phase. Meaningless while `GoingHome`, which ends on
   *  arrival rather than on a clock. */
  phaseTicks: number;
  /** This monster's own seeded period lengths — its hours. */
  restTicks: number;
  prowlTicks: number;
  /** Colonist being chased, or -1. */
  target: number;
  /** Wall tile index being bitten, or -1. */
  targetTile: number;
  /** Ticks accumulated toward the next bite. */
  biteTicks: number;
  /** Stored route and the index of its next tile — the colonist pattern, so a
   *  monster plans a path when it needs one rather than every tick. */
  path: number[];
  step: number;
}

/** What a colonist is doing with its current task. */
export const Phase = {
  /** Walking to the thing to pick up. */
  ToSource: 0,
  /** Walking to where the work happens. */
  ToTarget: 1,
  /** Standing on the spot, accumulating work ticks. */
  Working: 2,
} as const;

export interface Colonist {
  id: number;
  /** Continuous tile coordinates; the centre of tile (t, u) is (t+.5, u+.5). */
  x: number;
  y: number;
  /** Position at the end of the previous tick — the renderer lerps px→x. */
  px: number;
  py: number;
  /** Facing, radians, atan2(dx, dy) so a model built facing +y turns right. */
  heading: number;
  /** Building this colonist is a slot worker of; -1 means they're in the pool. */
  slot: number;
  /**
   * 1 once a slot worker has reached its building and stepped inside it, 0
   * otherwise. Inside, the colonist's position is pinned to the footprint's
   * centre and the renderer skips drawing them — until there are real work
   * animations, a figure standing motionless at a door reads as loitering
   * rather than working. Production gates on this rather than on proximity,
   * so "at work" is one field instead of a distance test.
   */
  inside: number;
  /** Claimed task, or -1. */
  task: number;
  /** One of Phase.*, meaningful while `task >= 0`. */
  phase: number;
  /** Work ticks accumulated in Phase.Working. */
  work: number;
  /** Item in hand, or -1. */
  carrying: number;
  /**
   * While this colonist is a **wanderer** walking in from the coast: the id of
   * the House that invited them. `-1` for everyone settled, which is everyone
   * the colony started with and everyone who has arrived.
   *
   * A wanderer is an ordinary colonist with this one field set, so the whole of
   * step 4a applies to them for free — monsters notice them, they flee, they
   * can be caught, they leave a grave. What they never do is claim a task
   * (`stepColonists` branches on this before the pool/slot split), and they
   * count in **none** of the labour numbers until they settle.
   *
   * **`dest >= 0` excludes a colonist from every selector that means "an
   * available worker"**, and that is the contract rather than a list of sites:
   * the four labour readouts and `staff()`'s nearest-`slot < 0` pick are
   * today's, and any future one asks the same question. A selector that forgets
   * binds a workshop to somebody still walking in
   * (docs/specs/2026-09-07-housing-wanderers.md).
   */
  dest: number;
  /**
   * Ticks a wanderer has spent unable to reach their destination. At
   * `WANDERER_PATIENCE` they give up and leave, quietly and with no grave.
   *
   * **Its own field rather than a corner of `work`.** The clock only advances
   * on a tick where a route could not be found, so it is paused by anything
   * that moves them — a flee, an eviction, a route that opens — and reset by a
   * route that succeeds. Riding on `work` made that correctness depend on
   * `abandonForFlight` and `clearWorker` happening to zero it, which is an
   * invariant nobody wrote down; a field costs one migration line instead
   * (docs/specs/2026-09-07-housing-wanderers.md, the 2026-09-07 amendment).
   *
   * 0 for everyone settled, and reset to 0 the moment a wanderer arrives.
   */
  patience: number;
  /**
   * Ticks since this colonist last ate, unbounded. At `MEAL_TICKS` they are due
   * a meal and go looking for bread; from `HUNGRY_TICKS` with none found they
   * work and walk at `HUNGRY_FACTOR` — and that is the whole penalty, forever
   * (docs/CONCEPT.md: supply failures plateau, they never spiral).
   *
   * A **wanderer does not hunger**: the clock is only advanced for colonists
   * with `dest < 0`, so it starts at settling rather than at the coast.
   */
  hunger: number;
  /**
   * 1 while the meal errand is in hand — a route to a particular loaf, or the
   * standing-still tick that follows a workshop's door.
   *
   * Its own named field rather than a corner of `work` or `task`, per the
   * housing amendment's lesson (docs/specs/2026-09-07-housing-wanderers.md):
   * what it buys is that `stepColonists` skips the pool/slot split while it is
   * set, so a slot worker walking to a loaf is not re-routed to its station and
   * a pool worker does not claim a task on top of its lunch.
   */
  eating: number;
  /** Remaining route as tile indices; `step` is the index of the next one. */
  path: number[];
  step: number;
}

export interface Item {
  id: number;
  type: number;
  loc: number;
  /** Tile coordinates while `loc === Loc.Ground`. */
  x: number;
  y: number;
  /** Colonist id while Carried, building id while Stored, else -1. */
  holder: number;
  /**
   * Task that owns this item, or -1. A task reserves its item for its whole
   * life, so no second hauler can ever target it — two-haulers-one-log is the
   * classic colony-sim bug and this is where it is designed out.
   */
  reservedBy: number;
}

export interface Building {
  id: number;
  kind: number;
  /** Footprint origin (minimum corner) and size in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  state: number;
  /** Construction ticks accumulated. */
  progress: number;
  /**
   * Units of incoming capacity claimed by live tasks — reserved when the task
   * is created, released when it finishes or is cancelled. Task generation
   * reads `stored + reservedIncoming` so it never over-orders.
   */
  reservedIncoming: number;
  /**
   * Stockpile filters, 0/1 — one per `ItemType`, read through
   * `stockpileAccepts` (goods.ts) rather than by name and flipped by the
   * `toggleFilter` command. They gate **inflow only**: a pile that refuses
   * planks still hands out the planks it already holds, and nothing re-homes
   * them — filters route, ceilings (`Sim.limits`) brake. A new good means a
   * new field *and* a migration rung that stamps it on to every building
   * already saved, or old stockpiles refuse it forever.
   */
  acceptLog: number;
  acceptPlank: number;
  acceptRock: number;
  acceptBlock: number;
  acceptGrain: number;
  acceptFlour: number;
  acceptBread: number;
  /** Slot worker, or -1. */
  worker: number;
  /**
   * Milling ticks accumulated, or -1 when not milling. The log is consumed at
   * the *start* of a mill, so progress living on the building is what makes
   * unstaffing mid-mill lose nothing: it waits here and resumes on restaff.
   */
  millProgress: number;
}

export interface Task {
  id: number;
  kind: number;
  /** Item to move (haul kinds), else -1. */
  item: number;
  /** Destination or subject building, else -1. */
  building: number;
  /** Chop target tile, else -1. */
  x: number;
  y: number;
  /** Colonist working it, or -1. */
  claimedBy: number;
  /** Ticks until anyone may claim it again. */
  cooldown: number;
}

export interface Sim {
  world: World;
  tick: number;
  /** The seeded PRNG's whole state — a number, so a save captures it. */
  rngState: number;
  nextId: number;
  colonists: Colonist[];
  items: Item[];
  buildings: Building[];
  tasks: Task[];
  /**
   * The Wilds' inhabitants. One per lair, placed at generation and never
   * killed — CONCEPT's avoidance-only law means this array only ever changes
   * length when a migration runs the lair pass over an old colony.
   */
  monsters: Monster[];
  /** 1 where the player has marked a tree for chopping. Player intent, so it
   *  lives beside the world rather than in it. */
  chopMap: Uint8Array;
  /** 1 where the player has marked a rock outcrop for quarrying — `chopMap`'s
   *  pattern, applied to stone. */
  mineMap: Uint8Array;
  /**
   * Terraform intent: **target height plus one**, 0 meaning no designation.
   * Plus one because 0 has to mean "none" and 0 is not a legal height, so a
   * bare target could not express an undesignated tile.
   */
  terraformMap: Uint8Array;
  /**
   * One `WallState` per tile — the wall graph, as a grid rather than as
   * hundreds of 1×1 entities. It lives in `Sim` rather than `World` because it
   * is player-made, and it is read only through `sim/walls`' predicates so the
   * stone tier can append states without touching a consumer.
   */
  wallMap: Uint8Array;
  /** 1 where the player has marked a wall segment for dismantling — `chopMap`'s
   *  player-intent pattern, applied to walls. */
  razeMap: Uint8Array;
  /**
   * Bite damage taken by the segment on each tile — **damage, not hit points**,
   * so 0 is pristine and a new segment is born clean without anybody writing to
   * this layer. That also keeps the max-HP numbers (`PALISADE_HP`, `GATE_HP`)
   * free tunables forever instead of baking a chosen maximum into every save
   * file. Read through `sim/walls`' `isDamageable` / `wallMaxDamage`.
   */
  wallDamageMap: Uint8Array;
  /**
   * 1 where a colonist was caught and killed. A marker, never a mechanic:
   * graves block nothing, building or levelling over one clears it silently,
   * and a second death on a tile shares the marker (docs/CONCEPT.md — a death
   * is just the loss, with no mourning systems attached to it).
   */
  graveMap: Uint8Array;
  /**
   * 1 where the wall graph encloses the tile: derived from `wallMap` by
   * `sim/walls/enclosure`, and serialized with the store like any other field
   * (it is deterministic, so what a save holds and what a load recomputes
   * agree). The renderer, the HUD and — from step 4 — threats all read it.
   */
  insideMap: Uint8Array;
  /**
   * Ticks until the next wanderer spawn attempt, or **-1 while one is in
   * transit**. Store state rather than a derived timer, because a reload in
   * the middle of an interval would otherwise forget where the clock was and
   * every load would restart it (docs/specs/2026-09-07-housing-wanderers.md).
   *
   * It only counts down while the gate is actually open — under cap, with an
   * active House, nobody in transit — so a colony with no house is not quietly
   * banking arrivals it will get all at once.
   */
  wandererTimer: number;
  /**
   * Production ceilings, one per `ItemType` value in enum order: "make this
   * good until N exist", **counted over every item of the type anywhere** —
   * stored, on the ground, in someone's hands — and `-1` (`UNLIMITED`) for no
   * ceiling, which is the default for every good and every migrated save. A
   * workshop whose recipe's output is at or over its ceiling neither orders
   * input nor starts a new batch; one in progress finishes, and nothing in
   * flight is ever cancelled by a ceiling (`economy/limits.ts`).
   *
   * Global rather than per workshop because the player's question is "how many
   * planks exist", not "which mill made them". Meaningful only for **produced**
   * goods: raw goods are already bounded by their designations, so the panel
   * never offers a ceiling on one, and the slot stays `-1`.
   *
   * **Append-only, like the enums it is indexed by.** Every future `ItemType`
   * appends a `-1` here in its own migration rung — miss it and an old save
   * reads `limits[Grain]` as `undefined`, which the plain-data rule forbids.
   */
  limits: number[];
  /**
   * 1 when a wall event this tick has invalidated `insideMap`. The recompute
   * batches to the end of the tick, so this is always 0 at a tick boundary and
   * a save can never carry a pending one.
   */
  enclosureDirty: number;
}

/**
 * No ceiling on any good: one `UNLIMITED` per `ItemType` value, in enum order.
 * What a fresh colony starts with, and what `flatSim` hands a test.
 */
export function unlimitedLimits(): number[] {
  return Object.values(ItemType).map(() => UNLIMITED);
}

/** Mint the next entity id. The only id source; ids are never reused. */
export function mintId(sim: Sim): number {
  return sim.nextId++;
}

export function findColonist(sim: Sim, id: number): Colonist | null {
  for (const c of sim.colonists) if (c.id === id) return c;
  return null;
}

export function findItem(sim: Sim, id: number): Item | null {
  for (const it of sim.items) if (it.id === id) return it;
  return null;
}

export function findBuilding(sim: Sim, id: number): Building | null {
  for (const b of sim.buildings) if (b.id === id) return b;
  return null;
}

export function findTask(sim: Sim, id: number): Task | null {
  for (const t of sim.tasks) if (t.id === id) return t;
  return null;
}

export function findMonster(sim: Sim, id: number): Monster | null {
  for (const m of sim.monsters) if (m.id === id) return m;
  return null;
}

/**
 * The monster whose lair stands on this tile, or null.
 *
 * A plain field scan over an array of a couple of dozen, and it lives *here*
 * rather than in `sim/threats/` on purpose: `walls/` and `buildings/` both have
 * to refuse a lair tile, and either of them importing the threats folder — which
 * reads the wall predicates — would close a cycle around `WALL_DEFS`, whose
 * table is built in a module body.
 */
export function lairAt(sim: Sim, x: number, y: number): Monster | null {
  for (const m of sim.monsters) if (m.lairX === x && m.lairY === y) return m;
  return null;
}

/**
 * Build the opening colony: a generated world plus STARTING_COLONISTS folk
 * standing in the clearing at its centre.
 *
 * Spawn tiles come from a deterministic outward ring walk, not the PRNG, so
 * the opening is identical for a seed no matter what else changes.
 */
export function createSim(seed: number): Sim {
  const world = generate(seed);
  const sim: Sim = {
    world,
    tick: 0,
    rngState: seed >>> 0,
    nextId: 1,
    colonists: [],
    items: [],
    buildings: [],
    tasks: [],
    monsters: [],
    chopMap: new Uint8Array(world.size * world.size),
    mineMap: new Uint8Array(world.size * world.size),
    terraformMap: new Uint8Array(world.size * world.size),
    wallMap: new Uint8Array(world.size * world.size),
    razeMap: new Uint8Array(world.size * world.size),
    wallDamageMap: new Uint8Array(world.size * world.size),
    graveMap: new Uint8Array(world.size * world.size),
    insideMap: new Uint8Array(world.size * world.size),
    // The arrival clock starts at a full interval and does not run until a
    // House stands, so the opening five are the whole colony until the player
    // builds one. No draw here: `createSim` makes none, and the v5 migration
    // has to be able to hand an old save the same value.
    wandererTimer: WANDERER_INTERVAL,
    limits: unlimitedLimits(),
    // A wall-less world encloses nothing, so the zeroed layer above is already
    // correct — but the flag makes the first tick settle it anyway rather than
    // trusting that. `store.ts` deliberately does not import `walls/enclosure`
    // to do it here: that folder reaches `buildings.ts`, whose module body
    // needs `BuildingKind` from this file, and the resulting cycle would fail
    // or not depending purely on which module a bundler happened to load first.
    enclosureDirty: 1,
  };

  // The Wilds get their inhabitants before the colony gets its people, so the
  // opening is *already* a dangerous world rather than one danger arrives in.
  // The pass draws from its own seed-derived stream, never `rngState`, which is
  // what lets the v4 migration reproduce it exactly over an old save.
  spawnLairs(sim);

  const centre = Math.floor(world.size / 2);
  const opening = spawnTiles(world, centre, STARTING_COLONISTS);
  for (const [x, y] of opening) {
    sim.colonists.push({
      id: mintId(sim),
      x: x + 0.5,
      y: y + 0.5,
      px: x + 0.5,
      py: y + 0.5,
      heading: 0,
      slot: -1,
      inside: 0,
      task: -1,
      phase: 0,
      work: 0,
      carrying: -1,
      dest: -1,
      patience: 0,
      hunger: 0,
      eating: 0,
      path: [],
      step: 0,
    });
  }

  // The starting five arrive **provisioned**: `PROVISION_BREAD` loaves a head,
  // lying in the clearing. Without them a fresh colony is hungry by day two
  // with no counter available yet, which is risk imposed rather than chosen
  // (docs/CONCEPT.md) — the runway is about three days, long enough to see the
  // loop and short enough that the bread chain is the first thing worth
  // building.
  //
  // Written as item literals rather than through `spawnItem`, and **not**
  // because it is shorter: `items.ts` reaches `path.ts`, which reaches
  // `walls/`, which reaches `buildings.ts`, whose module body reads `ItemType`
  // from this file — so importing the drop spiral here would evaluate that
  // table before this module's enums exist, in whichever load order a bundler
  // happened to pick. The same cycle `createSim` already declines to close for
  // the enclosure fill. Nothing is lost: with no buildings and no walls yet,
  // the spiral's answer *is* the first standable tile from the centre. One pile
  // on one tile, exactly as quarried rubble is — items never block each other.
  //
  // It lies under the **last** of the opening tiles rather than the middle of
  // the clearing, and that is not arbitrary: a ground item refuses a footprint
  // (`canPlace`), and the centre tile is where a player's first building goes.
  // The pile is swept into the first stockpile within a game-minute either way.
  const [px, py] = opening[opening.length - 1] ?? [centre, centre];
  for (let n = 0; n < PROVISION_BREAD * sim.colonists.length; n++) {
    sim.items.push({
      id: mintId(sim),
      type: ItemType.Bread,
      loc: Loc.Ground,
      x: px,
      y: py,
      holder: -1,
      reservedBy: -1,
    });
  }
  return sim;
}

/** Walk squares of growing radius around (cx, cy), yielding spawnable tiles. */
function spawnTiles(world: World, centre: number, count: number): [number, number][] {
  const out: [number, number][] = [];
  const ok = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= world.size || y >= world.size) return false;
    const i = tileIndex(x, y, world.size);
    return world.tmap[i] !== Terrain.Water && world.treeMap[i] === 0;
  };
  for (let r = 0; out.length < count && r < world.size; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        // Ring only: interior tiles were covered by a smaller r.
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (ok(centre + dx, centre + dy)) out.push([centre + dx, centre + dy]);
      }
    }
  }
  return out;
}
