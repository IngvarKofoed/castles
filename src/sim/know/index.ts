import {
  BUILDING_DEFS,
  buildingAt,
  canPlace,
  consumes,
  defOf,
  footprint,
  recipeOf,
  storedCount,
  workTile,
} from "../buildings";
import { limitOf, overLimit, stepLimit } from "../economy/limits";
import { batchTicks, fieldsInReach } from "../economy/workshop";
import { GOODS, GOOD_LIST, stockpileAccepts, stockpileClearing } from "../goods";
import { canMine, canTerraform, isTargetHeight } from "../ground";
import { countItems, groundItemsAt } from "../items";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  MonsterKind,
  MonsterPhase,
  findMonster,
  type Building,
  type Colonist,
  type Item,
  type Monster,
  type Sim,
} from "../store";
import { hungry } from "../labour/hunger";
import { canRehome } from "../labour/tasks";
import { cellarSet, populationCap, settled, tableSet } from "../settlers";
import { defOfMonster, monsterAt } from "../threats";
import {
  BUILD_TICKS,
  DAY_TICKS,
  HIVE_FIELDS_MAX,
  HIVE_REACH,
  LIMIT_MAX,
  LIMIT_STEP,
  RHYTHM_FUZZ,
  STARTING_COLONISTS,
  STOCKPILE_PER_TILE,
  THREAT_BUCKETS,
  THREAT_RANGE,
  UNLIMITED,
  WALL_ITEM_COST,
  WATCH_BUCKETS,
  WATCH_RANGE,
} from "../tuning";
import {
  WallState,
  canPlaceWall,
  damageTier,
  isDamageable,
  isGateway,
  isStoneWall,
  razeMarked,
  wallAt,
  wallItem,
} from "../walls";
import { enclosedLand } from "../walls/enclosure";
import { hash } from "../world/noise";
import { tileIndex } from "../world/world";

/**
 * What the player is allowed to know.
 *
 * `render/` and `ui/` import from here and nowhere else in `sim/`, because the
 * moment they read the sim's truth directly, the watchtower mechanic quietly
 * stops being a mechanic (docs/ARCHITECTURE.md, "Truth and knowledge"). In
 * step 2 nothing is hidden, so most of this is an identity projection over the
 * live arrays — deliberately zero-copy, so the render loop allocates nothing.
 * When threats arrive, this module starts filtering and the consumers do not
 * have to change shape.
 */

export type { Building, Colonist, Item, Sim };
export { BuildingKind, BuildingState, ItemType, Loc, BUILDING_DEFS, defOf, footprint, workTile, canPlace };
export type { BuildingKindValue, ItemTypeValue } from "../store";
/**
 * The wall predicates the renderer is allowed: what a segment is made of,
 * whether it is a gateway, whether it is still a drawing. Exported so
 * `render/` can pick a model per segment without ever comparing a wall byte to
 * a state — which is the rule that let the stone tier append four states
 * without touching a consumer (`sim/walls`).
 */
export { WallState, canPlaceWall, wallAt, isGateway, isStoneWall };
export { isBlueprint as wallIsBlueprint } from "../walls";
export { GOODS, GOOD_LIST };
export type { GoodDef } from "../goods";
/** What one wall segment costs, and of what. The rail's cost captions read
 *  these rather than hard-coding "1 log" twice and "1 block" twice. */
export { WALL_ITEM_COST, wallItem };
export type { WallMaterial } from "../walls";
/**
 * The production-ceiling control's arithmetic, for the workshop panel's `−`/`+`
 * (docs/specs/2026-09-07-production-control.md). The HUD computes the landing
 * with `stepLimit` and sends it as a `setLimit` command; it never writes the
 * number itself. `UNLIMITED` is what the panel reads as "no ceiling".
 */
export { stepLimit, LIMIT_MAX, LIMIT_STEP, UNLIMITED };
/**
 * How far a Watchtower reads, in tiles, Chebyshev — for the range boundary the
 * renderer traces. Knowledge in the strict sense: the range is a flat, stated
 * rule with no line of sight and no terrain in it, so showing it denies the
 * player nothing (docs/specs/2026-09-09-watchtowers.md).
 */
export { WATCH_RANGE };
/**
 * A hive's reach and the fields that fill it — for the placement overlay's
 * rectangle and for the panel's `Fields in reach` row. Knowledge in the strict
 * sense, as `WATCH_RANGE` is: both are flat stated rules with no line of sight
 * and nothing hidden, so drawing them denies the player nothing
 * (docs/specs/2026-09-14-hives-and-mead.md).
 */
export { HIVE_FIELDS_MAX, HIVE_REACH };

export function colonists(sim: Sim): readonly Colonist[] {
  return sim.colonists;
}

export function buildings(sim: Sim): readonly Building[] {
  return sim.buildings;
}

export function items(sim: Sim): readonly Item[] {
  return sim.items;
}

/** The HUD's numbers: the ribbon's colony facts, and the Stores panel's goods. */
export interface Readout {
  /** How much of each good the colony holds, indexed by `ItemType` — every
   *  good the game has, so a new one appears in the Stores panel by existing. */
  goods: number[];
  /**
   * Everyone who lives here. A wanderer still walking in from the coast is
   * counted in **none** of the four numbers below — they are not a pair of
   * hands until they settle, and counting them in `folk` alone would have the
   * labour meter invent a phantom slot worker (`slots` is `folk - pool`).
   */
  folk: number;
  /**
   * Pool workers **available for work**: no task claimed, and not away on a
   * self-errand — a meal or a fitting. What the player reads off it is how much
   * slack the pool has, so it
   * has to be hands that could take work now, not hands that merely hold
   * nothing. Counted the other way, day two read `5 idle` with every starting
   * hunger clock coming due at once and nobody idle.
   *
   * It is **not** a prediction of what staffing will cost: `staff` takes the
   * *nearest* pool worker, busy or idle, on purpose (`sim/commands.ts`), so a
   * workshop can be filled without this number moving at all.
   */
  idle: number;
  /** Pool workers: population minus everyone locked in a workshop. */
  pool: number;
  slots: number;
  /**
   * How many folk the colony's beds allow, or **-1 until the first House is
   * standing** — the ribbon shows a bare count until then, so a fresh colony
   * never reads as "full" and an old, death-reduced save is not teased with
   * room nothing will fill (docs/specs/2026-09-07-housing-wanderers.md).
   */
  cap: number;
  day: number;
  /**
   * How many folk are hungry enough to be **slowed** (`HUNGRY_TICKS`, not
   * merely due a meal) — the ribbon's one honest signal of the plateau, and it
   * arrives exactly as the slowdown does. Counting everyone past mealtime
   * instead would flicker a `1` at every lunch walk.
   */
  hungry: number;
  /**
   * Enclosed *land* tiles — the game's progress bar (docs/CONCEPT.md: land is
   * grabbed bite by bite). Water inside the wall is inside and deliberately
   * uncounted; so is the ground under the wall itself, which is not buildable.
   */
  enclosed: number;
}

export function readout(sim: Sim): Readout {
  const goods = GOOD_LIST.map(() => 0);
  for (const it of sim.items) {
    // Indexed by type rather than counted into named locals: an `else`
    // branch counting "everything that isn't a log" as planks is exactly the
    // shape that broke the moment a third good existed.
    if (it.type >= 0 && it.type < goods.length) goods[it.type]++;
  }
  let folk = 0;
  let pool = 0;
  let idle = 0;
  let starving = 0;
  for (const c of sim.colonists) {
    // Still walking in: not a colonist the colony can spend yet.
    if (c.dest >= 0) continue;
    folk++;
    if (hungry(c)) starving++;
    if (c.slot >= 0) continue;
    pool++;
    // Not merely task-less: an eater and somebody at a fitting both hold no
    // task and neither can be spent, so both self-errands are excluded here
    // rather than in the HUD
    // (docs/changelog/2026-09-09-idle-means-available.md).
    if (c.task < 0 && c.eating === 0 && c.dressing === 0) idle++;
  }
  // A bed exists only in a finished House, so "any beds at all" is the same
  // question as "is a House standing" — and it is the one the suffix turns on.
  // Asked off the cap rather than off a second `bedsBuilt` call: the cap is
  // `STARTING_COLONISTS` plus the beds, so "above the floor" *is* "has beds",
  // and this runs once per frame.
  const cap = populationCap(sim);
  return {
    goods,
    folk,
    idle,
    pool,
    slots: folk - pool,
    cap: cap > STARTING_COLONISTS ? cap : -1,
    day: Math.floor(sim.tick / DAY_TICKS) + 1,
    hungry: starving,
    enclosed: enclosedLand(sim),
  };
}

/** Is this tree marked for felling? */
export function isDesignated(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.chopMap[y * sim.world.size + x] === 1;
}

/** Is this outcrop marked for quarrying? */
export function isMineMarked(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.mineMap[y * sim.world.size + x] === 1;
}

/** Is this tile marked for levelling? */
export function isTerraformMarked(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.terraformMap[y * sim.world.size + x] !== 0;
}

/**
 * The ground's own height — what the terraform tool captures from the tile the
 * player presses on, and turns into the whole drag's target. Knowledge rather
 * than truth in the strict sense: the shape of the land is something you can
 * see by looking at it.
 */
export function groundHeight(sim: Sim, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return 0;
  return sim.world.hmap[tileIndex(x, y, sim.world.size)];
}

/** Can these tools act on this tile at all? The tools ask before designating,
 *  so an ineligible tile ghosts as skipped instead of silently doing nothing. */
export { canMine, canTerraform, isTargetHeight };

export function hasTree(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.world.treeMap[y * sim.world.size + x] === 1;
}

/**
 * The raw designation and tree layers, for the bulk per-tile work the renderer
 * does — meshing a chunk's trees, projecting every tree to test a drag-box.
 * Zero-copy, like the rest of this module: nothing here is hidden from the
 * player, and a per-tile predicate call would cost more than the read.
 */
export function chopLayer(sim: Sim): Uint8Array {
  return sim.chopMap;
}

export function treeLayer(sim: Sim): Uint8Array {
  return sim.world.treeMap;
}

export function mineLayer(sim: Sim): Uint8Array {
  return sim.mineMap;
}

export function terraformLayer(sim: Sim): Uint8Array {
  return sim.terraformMap;
}

export function wallLayer(sim: Sim): Uint8Array {
  return sim.wallMap;
}

export function razeLayer(sim: Sim): Uint8Array {
  return sim.razeMap;
}

/**
 * The enclosure layer, and the single-tile question threats will ask of it
 * from step 4. Nothing about inside/outside is hidden from the player — it is
 * read off the map by looking, per CONCEPT — so this is an identity projection
 * like the rest of this module.
 */
export function insideLayer(sim: Sim): Uint8Array {
  return sim.insideMap;
}

export function isInside(sim: Sim, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= sim.world.size || y >= sim.world.size) return false;
  return sim.insideMap[y * sim.world.size + x] === 1;
}

/** Is this tile marked for dismantling? `sim/walls` owns the bounds rule. */
export function isRazeMarked(sim: Sim, x: number, y: number): boolean {
  return razeMarked(sim, x, y);
}

/** Does this tile hold a wall of any kind — blueprint, palisade or gate? */
export function hasWall(sim: Sim, x: number, y: number): boolean {
  return wallAt(sim, x, y) !== WallState.None;
}

/** One good a building holds, for the panel to list. */
export interface StoredGood {
  type: number;
  name: string;
  count: number;
  /** Strictly "the flag is `1`", so a good being cleared reads as `off` — the
   *  toggle stays binary and `clearing` carries the third state. */
  accepted: boolean;
  /** The pile is clearing this good out: refusing it, and handing what it holds
   *  to the tidy-up hauls. A `2` with nothing stored is indistinguishable from
   *  `off` everywhere in the panel, which is why nothing reverts it. */
  clearing: boolean;
  /**
   * The clear has nowhere to go — no other active pile accepts the good, *or*
   * every one that does is full. Asked of `canRehome`, the very predicate the
   * haul asks, rather than computed from the flags: the full-but-accepting case
   * is the one a player watching a stalled clear is most likely looking at.
   */
  stuck: boolean;
}

/** Everything the inspector panel shows about one building. */
export interface Inspection {
  id: number;
  name: string;
  kind: number;
  state: number;
  /** 0..1 while under construction. */
  progress: number;
  /** Materials delivered against materials required, for a blueprint. */
  delivered: number;
  cost: number;
  /** Which good those are — `ItemType.Log` for most things, planks for a
   *  House. The panel and the rail name the number off this rather than
   *  saying "logs" and being wrong for one building in four. */
  costType: number;
  hasSlot: boolean;
  /** Beds this building adds to the cap once active; 0 for everything that is
   *  not housing. */
  beds: number;
  staffed: boolean;
  /**
   * Where the slot worker is. Once they are `inside` the renderer stops
   * drawing them, so this row and the labour meter's rust segment are the
   * only things telling the player someone is in there.
   *
   * `eating` and `dressing` are the fourth and fifth states and they exist to
   * stop the panel lying: a miller out at a meal is not a stall, and "waiting
   * for grain" while they walk to a loaf — or "waiting for wool" while the
   * weaver is at a fitting — would be the one thing this panel may never do
   * (docs/specs/2026-09-08-bread-economy.md,
   * docs/specs/2026-09-10-sheep-and-clothes.md).
   */
  worker: "none" | "walking" | "inside" | "eating" | "dressing";
  /**
   * Every good in the building, in `ItemType` order — the stockpile panel
   * walks this rather than naming logs and planks, which is what keeps a new
   * good from needing a new row of hard-coded UI.
   */
  stored: StoredGood[];
  storedTotal: number;
  capacity: number;
  /**
   * The workshop's chain, or null for anything that produces nothing. Its
   * names are what the panel's chain chips read.
   *
   * `input` is **null for a no-input recipe** — the Farm's chip is one-sided,
   * `→ Grain`, because there is nothing on the left of that arrow (see
   * `Recipe`'s no-input convention).
   */
  chain: { input: string | null; output: string } | null;
  inputCount: number;
  inputCap: number;
  outputCount: number;
  outputCap: number;
  /** 0..1 through the current batch, or -1 when the workshop is not working. */
  milling: number;
  /**
   * The workshop's output good, its production ceiling (`UNLIMITED` for none)
   * and how many of that good the **whole colony** holds — stored, loose and
   * carried alike, since that is the number the ceiling is measured against.
   * `-1` / `UNLIMITED` / 0 for anything that produces nothing. The panel's
   * "in colony" wording is load-bearing: this row sits under the per-building
   * output-buffer count, and two bare plank numbers on one panel would read
   * as the same thing.
   */
  outputType: number;
  limit: number;
  colonyCount: number;
  /**
   * Why a staffed workshop is not working, for the panel to say plainly. The
   * panel is the only place the game ever explains a stall — no alerts, no
   * colour changes — so it has to name the real reason rather than guess at
   * the commonest one. "no-input" rather than "no logs", because the mason
   * stalls on rock. "at-limit" outranks the other two: the ceiling is the
   * player's own setting, so when it is what holds the mill that is the reason
   * worth reading first.
   */
  stall: "none" | "no-input" | "output-full" | "at-limit";
  /**
   * For a House: **the food gate, not the cap, is what holds arrivals right
   * now**. The panel says so in one quiet line, because this gate can stand for
   * game-days, it is player-caused, and one interplay makes silence dangerous —
   * ceilings at or below the settled count on every food hold it shut for good.
   * False for everything that is not a House with beds standing.
   */
  tableShort: boolean;
  /**
   * For a House: the cellar is stocked and arrivals are actually possible, so
   * the panel may say that mead is bringing folk sooner. **Composed here, not
   * in the HUD**: it is the same `beds > 0 && Active && under cap && table set`
   * sequence `tableShort` is composed from, and the HUD carries neither the cap
   * nor the settled count to rebuild it
   * (docs/specs/2026-09-14-hives-and-mead.md). False for everything else.
   */
  cellarStocked: boolean;
  /**
   * For a Watchtower: **how many dens are within `WATCH_RANGE` of it**,
   * counted whether or not anybody is standing in it. `-1` for everything
   * else, which is how the panel tells a tower from a workshop.
   *
   * Deliberately staffing-blind, so an unstaffed tower's panel can honestly
   * say what it *would* watch — "3 dens in reach — no watcher" — while
   * `rhythm()` sharpens nothing until a watcher is inside. The panel's wording
   * is what carries the difference, off `worker` (docs/specs/2026-09-09-watchtowers.md).
   */
  watching: number;
  /**
   * For a Hive: **how many flower fields are within `HIVE_REACH` of its plot**,
   * the very number the batch length reads, capped at `HIVE_FIELDS_MAX`. `-1`
   * for everything else, which is how the panel tells a hive from a workshop —
   * `watching`'s convention, one building over.
   */
  fields: number;
}

export function inspect(sim: Sim, id: number): Inspection | null {
  const b = sim.buildings.find((x) => x.id === id);
  if (!b) return null;
  const def = defOf(b);
  const recipe = recipeOf(b);
  const stored = GOOD_LIST.map((good) => {
    const count = storedCount(sim, b.id, good.type);
    const clearing = stockpileClearing(b, good.type);
    return {
      type: good.type,
      name: good.name,
      count,
      accepted: stockpileAccepts(b, good.type),
      clearing,
      // The pile's items of one good share a holder, so they share the answer —
      // one of them is asked for all of them.
      stuck: clearing && count > 0 && !rehomable(sim, b, good.type),
    };
  });
  const held = (type: number): number => stored.find((s) => s.type === type)?.count ?? 0;
  // Asked only of a recipe that actually eats something: a no-input recipe's
  // `input` is a dummy naming its own *output* good (see `Recipe`), so without
  // the `consumes` guard the Farm would report the grain in its output buffer
  // as an input count — a number with no buffer behind it.
  const inputCount = recipe && consumes(recipe) ? held(recipe.input) : 0;
  const outputCount = recipe ? held(recipe.output) : 0;
  // One walk of the colony's items, not two: the ceiling verdict is the same
  // count the panel prints, so `overLimit` is asked rather than `atLimit`.
  const limit = recipe ? limitOf(sim, recipe.output) : UNLIMITED;
  const colonyCount = recipe ? countItems(sim, recipe.output) : 0;
  const worker = workerState(sim, b);
  return {
    id: b.id,
    name: def.name,
    kind: b.kind,
    state: b.state,
    progress: Math.min(1, b.progress / BUILD_TICKS),
    delivered: held(def.costType),
    cost: def.cost,
    costType: def.costType,
    hasSlot: def.hasSlot,
    beds: def.beds,
    staffed: b.worker >= 0,
    worker,
    stored,
    storedTotal: stored.reduce((n, s) => n + s.count, 0),
    capacity: b.kind === BuildingKind.Stockpile ? b.w * b.h * STOCKPILE_PER_TILE : 0,
    chain:
      recipe ?
        { input: consumes(recipe) ? GOODS[recipe.input].name : null, output: GOODS[recipe.output].name }
      : null,
    inputCount,
    inputCap: recipe?.inputCap ?? 0,
    outputCount,
    outputCap: recipe?.outputCap ?? 0,
    // Against `batchTicks`, not `recipe.ticks`: a boosted Hive's batch is
    // shorter than its def says, and a meter measured against the def would
    // fill to 30% and snap back rather than ever completing.
    milling: !recipe || b.millProgress < 0 ? -1 : Math.min(1, b.millProgress / batchTicks(sim, b, recipe)),
    outputType: recipe ? recipe.output : -1,
    limit,
    colonyCount,
    stall:
      // A worker away on either self-errand is not a stall of any kind, and
      // neither is a recipe with no input ever "waiting for" anything: the two
      // guards are what keep the panel honest about the Farm, about lunch and
      // about a fitting.
      (
        !recipe || b.worker < 0 || b.millProgress >= 0 || worker === "eating" || worker === "dressing"
      ) ?
        "none"
      : overLimit(limit, colonyCount) ? "at-limit"
      : outputCount >= recipe.outputCap ? "output-full"
      : consumes(recipe) ? "no-input"
      : "none",
    tableShort: def.beds > 0 && b.state === BuildingState.Active && settled(sim) < populationCap(sim) && !tableSet(sim),
    // The short-table note wins where both could apply: nobody is coming
    // either way, so "folk come sooner" would be the panel contradicting the
    // line above it.
    cellarStocked:
      def.beds > 0 &&
      b.state === BuildingState.Active &&
      settled(sim) < populationCap(sim) &&
      tableSet(sim) &&
      cellarSet(sim),
    watching: b.kind === BuildingKind.Watchtower ? densInReach(sim, b) : -1,
    fields: b.kind === BuildingKind.Hive ? fieldsInReach(sim, b) : -1,
  };
}

/** Is there another pile that would take one of these? */
function rehomable(sim: Sim, b: Building, type: number): boolean {
  const item = sim.items.find((it) => it.loc === Loc.Stored && it.holder === b.id && it.type === type);
  return item !== undefined && canRehome(sim, item);
}

function workerState(sim: Sim, b: Building): Inspection["worker"] {
  if (b.worker < 0) return "none";
  const worker = sim.colonists.find((c) => c.id === b.worker);
  if (!worker) return "none";
  // At most one errand flag is ever set (`startMeal` clears the other), so the
  // order here is a formality rather than a precedence rule.
  if (worker.eating) return "eating";
  if (worker.dressing) return "dressing";
  return worker.inside ? "inside" : "walking";
}

/** Which building, if any, the player just clicked. */
export function buildingAtTile(sim: Sim, x: number, y: number): Building | null {
  return buildingAt(sim, x, y);
}

/** Items lying loose on a tile — what the mover layer draws on the ground. */
export function groundItems(sim: Sim, x: number, y: number): Item[] {
  return groundItemsAt(sim, x, y);
}

// ------------------------------------------------------------------ threats
//
// The one place in the game where truth and knowledge genuinely differ.
//
// A monster's *position* is not hidden — CONCEPT says threats roam "in plain
// sight", and reading the map is the player's entire toolkit. What is hidden is
// the exact clock: schedules show **approximately**, and precision is
// buildable. So `rhythm` below is deliberately coarse and deliberately wrong by
// a little, and the exact timers, the circuit and the notice radii never leave
// `sim/`. Watchtowers (4b) narrow the fuzz and change nothing else — that is
// the whole product boundary, and it is one function wide on purpose.

/** What the renderer may know about a monster. */
export interface MonsterView {
  id: number;
  kind: number;
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  /**
   * Two stances, because two is what the eye can tell apart: asleep at the den,
   * or up and about. A monster on its way home reads as `out`, which is honest
   * — it is visibly out there — and the rhythm below is where the player learns
   * that it is leaving.
   */
  stance: "dormant" | "out";
}

export function monsters(sim: Sim): MonsterView[] {
  return sim.monsters.map(view);
}

function view(m: Monster): MonsterView {
  return {
    id: m.id,
    kind: m.kind,
    x: m.x,
    y: m.y,
    px: m.px,
    py: m.py,
    heading: m.heading,
    stance: m.phase === MonsterPhase.Rest ? "dormant" : "out",
  };
}

/** Which monster the player just clicked, if any — the tile→monster resolution
 *  beside `buildingAtTile`. */
export function monsterAtTile(sim: Sim, x: number, y: number): MonsterView | null {
  const m = monsterAt(sim, x, y);
  return m ? view(m) : null;
}

/** Every den on the map, for the mesher to bake. A lair is a landmark, not a
 *  secret: you can see where a thing lives. */
export function lairs(sim: Sim): { x: number; y: number }[] {
  return sim.monsters.map((m) => ({ x: m.lairX, y: m.lairY }));
}

export function monsterName(kind: number): string {
  return defOfMonster(kind).name;
}

/**
 * How far through its current phase a monster is — **coarse, and off by a
 * little on purpose**, unless somebody is paid to watch.
 *
 * The true timer is bucketed into fifths and shifted by a per-monster error of
 * up to `RHYTHM_FUZZ`, derived here from the monster's id and the world seed
 * and stored nowhere: it is a property of what the player can *work out*, not
 * of the world. So the display is honest about the rhythm — watch a troll and
 * you learn its hours — and never exact about the minute.
 *
 * **A watched monster drops the error and buckets in tenths** (`isWatched`).
 * That is the whole of the watchtower's product and the whole of its sim
 * surface: this one function, and everything downstream sharpens by itself
 * because `threat()` and `when()` already read `buckets` from here
 * (docs/specs/2026-09-09-watchtowers.md). It buys resolution, never
 * arithmetic — tenths of a phase in words and segments, and never a digit.
 *
 * The output is quantized after the shift, so it is never sharper than its own
 * bucket whatever the error happened to be.
 */
export interface Rhythm {
  phase: "resting" | "prowling" | "homeward";
  /** 0 .. `buckets` − 1, how much of the phase is spent. */
  bucket: number;
  buckets: number;
  /**
   * Is a manned Watchtower reading this den's hours right now?
   *
   * Carried as a fact rather than left for a consumer to infer from
   * `buckets === WATCH_BUCKETS`, so the panel's wording keys off *why* the bar
   * is fine instead of off how many segments it happens to have — and so the
   * homeward branch below can report it honestly while keeping its own fixed
   * shape.
   */
  watched: boolean;
}

const RHYTHM_SALT = 0x2545f491;

export function rhythm(sim: Sim, id: number): Rhythm | null {
  const m = findMonster(sim, id);
  if (!m) return null;
  const watched = isWatched(sim, m);
  if (m.phase === MonsterPhase.GoingHome) {
    // Untouched by the tower on purpose: `GoingHome` ends on arrival and not
    // on a clock, so there is no timer for anybody to read more finely — a
    // watcher cannot sharpen a phase that has none. The flag still reports
    // honestly, so the inspector's note stays true beside a fixed-shape bar.
    return { phase: "homeward", bucket: THREAT_BUCKETS - 1, buckets: THREAT_BUCKETS, watched };
  }
  const resting = m.phase === MonsterPhase.Rest;
  const length = Math.max(1, resting ? m.restTicks : m.prowlTicks);
  const spent = 1 - Math.min(1, Math.max(0, m.phaseTicks / length));
  const buckets = watched ? WATCH_BUCKETS : THREAT_BUCKETS;
  const error = watched ? 0 : (hash(m.id, RHYTHM_SALT, sim.world.seed) - 0.5) * 2 * RHYTHM_FUZZ;
  const bucket = Math.min(buckets - 1, Math.max(0, Math.floor((spent + error) * buckets)));
  return { phase: resting ? "resting" : "prowling", bucket, buckets, watched };
}

/**
 * Every building of a kind, whatever state it is in.
 *
 * Exported for the reach overlay, which draws a boundary for a tower or a hive
 * the player has only just placed as well as for a finished one — the coverage
 * you are siting the next one against includes the site you just committed, and
 * a boundary that vanished the instant the ghost became a blueprint would be
 * the overlay flinching at the one moment it is being used.
 */
export function reachBuildings(sim: Sim, kind: number): readonly Building[] {
  return sim.buildings.filter((b) => b.kind === kind);
}

/**
 * Is any manned Watchtower reading this monster's den?
 *
 * **Lair-anchored**, Chebyshev, at `WATCH_RANGE` — a schedule is a property of
 * the den, so a prowler wandering past a tower changes nothing and placement
 * becomes the question the game wants asked: which dens do I want to
 * understand? The square is also exactly the shape the overlay draws, so the
 * picture can never deny knowledge the player has.
 *
 * **Manned or nothing**, gated the same way production is — the slot filled,
 * the worker still bound to this building, and *inside* it. So an unstaffed
 * tower sharpens nothing, unstaffing blurs the picture back the same frame,
 * and the watcher's lunch coarsens it for the walk: knowledge is rented with
 * hands and never banked.
 */
function isWatched(sim: Sim, m: Monster): boolean {
  for (const b of sim.buildings) {
    if (b.kind !== BuildingKind.Watchtower || b.state !== BuildingState.Active) continue;
    // Range before staffing: the Chebyshev test is two subtractions, while
    // `manned` walks the colonist array. Asked the other way round this scans
    // every colonist once per tower per monster, for towers that were never in
    // reach of this den in the first place.
    if (Math.max(Math.abs(m.lairX - b.x), Math.abs(m.lairY - b.y)) > WATCH_RANGE) continue;
    if (manned(sim, b)) return true;
  }
  return false;
}

/** Is this building's slot worker actually in it? `stepWorkshop`'s gate,
 *  asked of a building that makes knowledge instead of goods. */
function manned(sim: Sim, b: Building): boolean {
  if (b.worker < 0) return false;
  const worker = sim.colonists.find((c) => c.id === b.worker);
  return worker !== undefined && worker.slot === b.id && worker.inside === 1;
}

/** How many dens a Watchtower on this tile could read, staffed or not. */
function densInReach(sim: Sim, b: Building): number {
  let n = 0;
  for (const m of sim.monsters) {
    if (Math.max(Math.abs(m.lairX - b.x), Math.abs(m.lairY - b.y)) <= WATCH_RANGE) n++;
  }
  return n;
}

/** What the ribbon's threat meter shows. */
export interface Threat {
  /** The monster the meter is tracking, or -1 when nothing is near. */
  monster: number;
  kind: number;
  /** Segments lit, 0 .. `buckets`. Fills toward a waking, drains toward a
   *  leaving. Empty only on a map with no monsters at all. */
  lit: number;
  buckets: number;
  /**
   * One quiet line: the kind, and a **coarse verbal time** off the same fuzzed
   * bucket the bar shows — "troll wakes in a day or two", "orc prowling, gone
   * within the day". Words rather than digits, because the estimate is a fifth
   * of a phase wide by design and a minutes-and-seconds readout would spend
   * 4b's whole product before it exists. Prefixed "far wilds:" when the den
   * being tracked is beyond `THREAT_RANGE`, which is the meter saying *this is
   * the wilderness, not your doorstep*. Never an alarm.
   */
  caption: string;
}

/** Nothing to track: no monsters at all, or no colony to anchor on. */
const QUIET: Threat = { monster: -1, kind: -1, lit: 0, buckets: THREAT_BUCKETS, caption: "wilds quiet" };

/**
 * The colony's most relevant monster, and how much of its clock is left.
 *
 * The pick, in order: one **currently biting the colony's walls**, because
 * nothing is more relevant than that; else the nearest prowler within
 * `THREAT_RANGE` of the colony anchor; else the soonest-waking den within that
 * same range; else **the nearest den on the map, however far**. The anchor is
 * the centroid of the buildings, or of the colonists while there are no
 * buildings yet — a colony is where its things are.
 *
 * That last rung is what keeps the bar from ever going blank while a monster
 * exists: "time to monsters" was the whole point, and a colony that has walked
 * somewhere quiet still wants to know how long quiet lasts. It is deliberately
 * the **nearest** den rather than the soonest-waking one anywhere — with two
 * dozen staggered rhythms something is always about to wake, so a
 * soonest-waking fallback would sit permanently full and mean nothing.
 *
 * `held` is the monster the caller was shown last, and it **wins as long as it
 * is still out**. That is what stops the bar flickering between two clocks
 * mid-siege. It is passed in rather than remembered here because `know/` reads
 * the store and never writes it, and which monster a *particular* meter is
 * watching is a property of that meter, not of the world.
 */
export function threat(sim: Sim, held = -1): Threat {
  if (!sim.monsters.length) return QUIET;
  const anchor = colonyAnchor(sim);
  if (!anchor) return QUIET;

  // The hold is a tie-break, not an override. A monster with its teeth in the
  // colony's walls outranks whatever the meter was watching a frame ago —
  // otherwise the bar reports some distant prowler's clock through the one
  // event it exists to report, which is the opposite of not flickering.
  const fresh = choose(sim, anchor);
  const keep = held >= 0 ? findMonster(sim, held) : null;
  const picked =
    fresh && biting(sim, fresh) ? fresh
    : keep && keep.phase !== MonsterPhase.Rest ? keep
    : fresh;
  if (!picked) return QUIET;
  const r = rhythm(sim, picked.id);
  if (!r) return QUIET;

  const name = defOfMonster(picked.kind).name.toLowerCase();
  // Measured on the *den*, not on where the monster has wandered to: the prefix
  // says which wilderness this is, and a den is where a wilderness is.
  const far = lairDistance(picked, anchor) > THREAT_RANGE;
  const say = (line: string): string => (far ? `far wilds: ${line}` : line);

  if (r.phase === "resting") {
    // Filling toward a waking: "time to monsters".
    return {
      monster: picked.id,
      kind: picked.kind,
      lit: r.bucket + 1,
      buckets: r.buckets,
      caption: say(`${name} wakes ${when(r, picked.restTicks)}`),
    };
  }
  if (r.phase === "homeward") {
    return {
      monster: picked.id,
      kind: picked.kind,
      lit: 0,
      buckets: r.buckets,
      caption: say(`${name} heading home`),
    };
  }
  // Draining toward a going-home: "time until it's gone".
  return {
    monster: picked.id,
    kind: picked.kind,
    lit: r.buckets - r.bucket,
    buckets: r.buckets,
    caption: say(`${name} prowling, gone ${when(r, picked.prowlTicks)}`),
  };
}

/**
 * How long is left of a phase, in words.
 *
 * Built from the **bucketed** estimate rather than the true timer, so the
 * phrase inherits exactly the fuzz the bar shows and cannot be sharper than it:
 * a fifth of a phase is the resolution the base game sells, and 4b's towers
 * narrow that one number without touching anything here. Words rather than
 * digits for the same reason — a figure invites arithmetic the estimate cannot
 * support.
 *
 * The bands are in game-days because that is the clock the ribbon already keeps
 * beside it, and a monster's hours run from a quarter of a day to three.
 */
function when(r: Rhythm, phaseTicks: number): string {
  const left = ((r.buckets - r.bucket) / r.buckets) * phaseTicks;
  const days = left / DAY_TICKS;
  if (days <= 0.35) return "any moment now";
  if (days <= 1) return "within the day";
  if (days <= 2) return "in a day or two";
  return "in a few days";
}

/** Chebyshev tiles from the colony anchor to a monster's den. */
function lairDistance(m: Monster, [ax, ay]: [number, number]): number {
  return Math.max(Math.abs(m.lairX + 0.5 - ax), Math.abs(m.lairY + 0.5 - ay));
}

/** Is this monster's teeth in a wall right now? */
function biting(sim: Sim, m: Monster): boolean {
  return m.phase === MonsterPhase.Prowl && m.targetTile >= 0 && isDamageable(sim.wallMap[m.targetTile]);
}

function choose(sim: Sim, anchor: [number, number]): Monster | null {
  const [ax, ay] = anchor;
  let chewing: Monster | null = null;
  let nearest: Monster | null = null;
  let nearestD = Infinity;
  let waking: Monster | null = null;
  let wakingIn = Infinity;
  let anywhere: Monster | null = null;
  let anywhereD = Infinity;

  for (const m of sim.monsters) {
    const lairD = lairDistance(m, anchor);
    // The last rung, gathered for every monster whatever it is doing: the
    // nearest den on the map, so the ladder always lands somewhere.
    if (lairD < anywhereD || (lairD === anywhereD && anywhere !== null && m.id < anywhere.id)) {
      anywhere = m;
      anywhereD = lairD;
    }
    if (m.phase === MonsterPhase.Rest) {
      if (lairD <= THREAT_RANGE && m.phaseTicks < wakingIn) {
        waking = m;
        wakingIn = m.phaseTicks;
      }
      continue;
    }
    if (m.phase !== MonsterPhase.Prowl) continue;
    // Ties break by id everywhere here, so the pick never depends on array
    // order — which is what makes the meter reproducible in a replay.
    if (biting(sim, m) && (!chewing || m.id < chewing.id)) chewing = m;
    const d = Math.max(Math.abs(m.x - ax), Math.abs(m.y - ay));
    if (d <= THREAT_RANGE && (d < nearestD || (d === nearestD && nearest !== null && m.id < nearest.id))) {
      nearest = m;
      nearestD = d;
    }
  }
  return chewing ?? nearest ?? waking ?? anywhere;
}

/** Where the colony *is*: the centroid of its buildings, or of its folk while
 *  it has not built anything yet. Null for a colony with neither, which is a
 *  colony that has been wiped out. */
function colonyAnchor(sim: Sim): [number, number] | null {
  if (sim.buildings.length) {
    let x = 0;
    let y = 0;
    for (const b of sim.buildings) {
      x += b.x + b.w / 2;
      y += b.y + b.h / 2;
    }
    return [x / sim.buildings.length, y / sim.buildings.length];
  }
  if (!sim.colonists.length) return null;
  let x = 0;
  let y = 0;
  for (const c of sim.colonists) {
    x += c.x;
    y += c.y;
  }
  return [x / sim.colonists.length, y / sim.colonists.length];
}

/**
 * The wall damage layer and the predicate that turns it into something to
 * draw. The renderer bakes a segment's wear in thirds, so it reads the tier
 * rather than the raw number and never compares a wall byte to a state.
 */
export function damageLayer(sim: Sim): Uint8Array {
  return sim.wallDamageMap;
}

export function graveLayer(sim: Sim): Uint8Array {
  return sim.graveMap;
}

export { damageTier, MonsterKind };
export type { MonsterKindValue } from "../store";
