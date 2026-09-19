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
  type Building,
  type Colonist,
  type Item,
  type Monster,
  type Sim,
} from "../store";
import { hungry } from "../labour/hunger";
import { canRehome } from "../labour/tasks";
import { cellarSet, coastal, populationCap, settled, tableSet } from "../settlers";
import { defOfMonster, monsterAt } from "../threats";
import {
  BUILD_TICKS,
  DAY_TICKS,
  HIVE_FIELDS_MAX,
  HIVE_REACH,
  FORECAST_HORIZON,
  LIMIT_MAX,
  LIMIT_STEP,
  STARTING_COLONISTS,
  STOCKPILE_PER_TILE,
  THREAT_BUCKETS,
  UNLIMITED,
  WALL_ITEM_COST,
  WATCH_BUCKETS,
  WATCH_HORIZON,
  WATCH_RANGE,
} from "../tuning";
import {
  WallState,
  canPlaceWall,
  damageTier,
  isGateway,
  isStoneWall,
  razeMarked,
  wallAt,
  wallItem,
} from "../walls";
import { enclosedLand } from "../walls/enclosure";
import { Terrain, tileIndex } from "../world/world";

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
 * What a colonist is doing with their claimed task — for the work swing, which
 * draws a tool only while somebody is actually working a stint
 * (docs/specs/2026-09-16-folk-at-work.md).
 *
 * **Meaningful only while `task >= 0`**, and that half of the test is not
 * optional: nothing resets `phase` when a task ends, so `abandonTask`,
 * `abandonForFlight` and `staff()` all leave a stale `Working` on a colonist
 * who is fleeing an orc, walking to a workshop, or standing where a cancelled
 * designation used to be. (`stepAside` is the exception that proves it: it
 * goes through `clearWorker`, which does reset the phase.)
 */
export { Phase } from "../store";
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
   * For a Watchtower: **how many tiles of coast are within `WATCH_RANGE` of
   * it**, counted whether or not anybody is standing in it. `-1` for everything
   * else, which is how the panel tells a tower from a workshop.
   *
   * Dens until `docs/specs/2026-09-17-incursions-from-the-sea.md` — a tower now
   * watches the sea, because that is where the Wilds come from
   * (docs/changelog/2026-09-09-watchtowers.md).
   *
   * Deliberately staffing-blind, so an unstaffed tower's panel can honestly say
   * what it *would* watch — "40 tiles of shore in reach — no watcher" — while
   * the forecast sharpens nothing until a watcher is inside. The panel's
   * wording is what carries the difference, off `worker`.
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
    watching: b.kind === BuildingKind.Watchtower ? coastInReach(sim, b) : -1,
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
// A monster's *position* is not hidden — CONCEPT says threats are visible in
// plain sight, and reading the map is the player's entire toolkit. What is
// hidden is **the weather**: when the next incursion lands, and from which
// coast. Schedules show approximately and precision is buildable, so `forecast`
// below is deliberately coarse, goes blank past a horizon, and never shows a
// digit. Watchtowers widen the horizon and halve the bucket, and change nothing
// else — that is the whole product boundary, and it is one function wide on
// purpose (docs/specs/2026-09-17-incursions-from-the-sea.md).

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
   * Two states, because two is what a monster has: ashore and dangerous, or
   * turned for its boat and already harmless. There is no third thing to tell
   * apart — nothing sleeps here any more, so nothing is drawn asleep.
   */
  doing: "ashore" | "withdrawing";
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
    doing: m.phase === MonsterPhase.Withdrawing ? "withdrawing" : "ashore",
  };
}

/** Which monster the player just clicked, if any — the tile→monster resolution
 *  beside `buildingAtTile`. */
export function monsterAtTile(sim: Sim, x: number, y: number): MonsterView | null {
  const m = monsterAt(sim, x, y);
  return m ? view(m) : null;
}

/**
 * The boats on the sand, for the mesher to bake — one per incursion, at the
 * beach everything ashore came in on and will leave from.
 *
 * A landmark rather than a secret: the hull is the thing that makes *they came
 * from there* readable at a glance, which is the whole reason an incursion has
 * one landing site instead of several. Empty in peace, which is most of the
 * game. It replaced `lairs()` when the wilds stopped living on the map.
 */
export function boats(sim: Sim): { x: number; y: number }[] {
  const seen = new Set<number>();
  const out: { x: number; y: number }[] = [];
  for (const m of sim.monsters) {
    const key = m.landY * 65536 + m.landX;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: m.landX, y: m.landY });
  }
  return out;
}

export function monsterName(kind: number): string {
  return defOfMonster(kind).name;
}

/**
 * The colony's weather: **one bar on one clock**.
 *
 * It counts toward the next landing and then reports that one is ashore. It is
 * the colony's weather rather than any monster's hours, so it never re-targets
 * and cannot flicker between clocks — which is what the meter it replaced did,
 * and the thing that prompted the change
 * (docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md).
 *
 * **Coarse by construction.** Past `FORECAST_HORIZON` there is no bar at all and
 * the caption says only that a storm is far off: the colony genuinely cannot see
 * that far, and an unaided forecast that ran to the horizon of the *sim* would
 * spend the watchtower's whole product before it exists. Inside the horizon the
 * remaining time is bucketed into fifths and told in words — never digits,
 * because the estimate is a fifth of a horizon wide and a figure invites
 * arithmetic it cannot support.
 *
 * **A manned Watchtower covering the coast the storm is due on buys two things
 * and only two**: `WATCH_HORIZON` instead of `FORECAST_HORIZON`, so the storm is
 * sighted earlier, and `WATCH_BUCKETS` instead of `THREAT_BUCKETS`, so what it
 * says is finer. Same trade as ever — information bought with a pair of hands.
 */
export interface Forecast {
  /** Segments lit, 0 .. `buckets`. Fills toward the landing and stands full
   *  while anything is ashore. Zero past the horizon. */
  lit: number;
  buckets: number;
  /**
   * One quiet line: where the storm is coming from and roughly when, in words —
   * "storm from the north, before nightfall". Past the horizon it is only "a
   * storm is far off", because direction is not something you can see from
   * there either. Never an alarm, never a digit.
   */
  caption: string;
  /** Is a manned Watchtower reading the coast this storm is due on? Carried as
   *  a fact rather than left for a consumer to infer from the bucket count, so
   *  a panel can key its wording off *why* the bar is fine. */
  watched: boolean;
}

export function forecast(sim: Sim): Forecast {
  const watched = landingWatched(sim);
  const buckets = watched ? WATCH_BUCKETS : THREAT_BUCKETS;
  if (sim.monsters.length) {
    const leaving = sim.monsters.every((m) => m.phase === MonsterPhase.Withdrawing);
    return {
      lit: buckets,
      buckets,
      caption: leaving ? "the wilds are leaving" : "the wilds are ashore",
      watched,
    };
  }
  const horizon = watched ? WATCH_HORIZON : FORECAST_HORIZON;
  if (sim.stormTicks > horizon) {
    return { lit: 0, buckets, caption: "a storm is far off", watched };
  }
  // Bucketed *after* the division, so the phrase below can never be sharper
  // than the bar beside it.
  const spent = 1 - Math.min(1, Math.max(0, sim.stormTicks / Math.max(1, horizon)));
  const bucket = Math.min(buckets - 1, Math.max(0, Math.floor(spent * buckets)));
  const left = ((buckets - bucket) / buckets) * horizon;
  return { lit: bucket + 1, buckets, caption: `${from(sim)}, ${when(left)}`, watched };
}

/**
 * How long is left, in words, off the **bucketed** estimate rather than the true
 * clock — so the phrase inherits exactly the coarseness the bar shows. The bands
 * are in game-days because that is the clock the ribbon already keeps beside it.
 */
function when(left: number): string {
  const days = left / DAY_TICKS;
  if (days <= 0.35) return "any moment now";
  if (days <= 0.7) return "before nightfall";
  if (days <= 1) return "within the day";
  if (days <= 2) return "in a day or two";
  return "in a few days";
}

/** Which way the storm is coming from, as one of eight compass words — or a
 *  bare "a storm" when no coast has been picked yet, which is a colony with
 *  nothing left to aim a bearing at. */
function from(sim: Sim): string {
  const size = sim.world.size;
  if (sim.stormLanding < 0 || sim.stormLanding >= size * size) return "a storm";
  const anchor = weatherAnchor(sim);
  if (!anchor) return "a storm";
  const x = sim.stormLanding % size;
  const y = (sim.stormLanding - x) / size;
  return `storm from the ${COMPASS[octant(x + 0.5 - anchor[0], y + 0.5 - anchor[1])]}`;
}

/** Screen-space y grows south, and so does the tile grid, so the table runs
 *  clockwise from due east. */
const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"] as const;

function octant(dx: number, dy: number): number {
  const turns = Math.atan2(dy, dx) / (Math.PI * 2);
  return ((Math.round(turns * 8) % 8) + 8) % 8;
}

/**
 * Where the colony is, for the compass word alone — the centroid of its
 * buildings, else of its folk.
 *
 * Deliberately *not* `threats/incursion`'s anchor, which prefers enclosed
 * ground: this one only has to say which side of the settlement a beach is on,
 * and a colony with no wall yet still has a side.
 */
function weatherAnchor(sim: Sim): [number, number] | null {
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
 * Is any manned Watchtower reading the coast the next storm is due on?
 *
 * **Coast-anchored**, Chebyshev, at `WATCH_RANGE` — the weather comes off the
 * sea, so siting a tower is the question *which shore do I want warning of?*
 * The square is also exactly the shape the overlay draws, so the picture can
 * never deny knowledge the player has paid for. It was lair-anchored until the
 * wilds stopped living on the map (docs/changelog/2026-09-09-watchtowers.md).
 *
 * **Manned or nothing**, gated the same way production is — the slot filled,
 * the worker still bound to this building, and *inside* it. So an unstaffed
 * tower sharpens nothing, unstaffing blurs the picture back the same frame, and
 * the watcher's lunch coarsens it for the walk: knowledge is rented with hands
 * and never banked.
 *
 * While an incursion is ashore the subject is the beach it landed on, which is
 * the same field — so a tower watching the coast a storm came in on keeps
 * reading finely for as long as it is there.
 */
function landingWatched(sim: Sim): boolean {
  const size = sim.world.size;
  const tile = sim.stormLanding;
  if (tile < 0 || tile >= size * size) return false;
  const lx = tile % size;
  const ly = (tile - lx) / size;
  for (const b of sim.buildings) {
    if (b.kind !== BuildingKind.Watchtower || b.state !== BuildingState.Active) continue;
    // Range before staffing: the Chebyshev test is two subtractions, while
    // `manned` walks the colonist array.
    if (Math.max(Math.abs(lx - b.x), Math.abs(ly - b.y)) > WATCH_RANGE) continue;
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

/**
 * How much shore a Watchtower on this tile could read, staffed or not — tiles
 * of sand standing beside open water inside its `WATCH_RANGE` square.
 *
 * The square is walked rather than the whole map, so the cost is the overlay's
 * own 49 × 49 and does not grow with the island.
 */
function coastInReach(sim: Sim, b: Building): number {
  const size = sim.world.size;
  let n = 0;
  for (let y = b.y - WATCH_RANGE; y <= b.y + WATCH_RANGE; y++) {
    if (y < 0 || y >= size) continue;
    for (let x = b.x - WATCH_RANGE; x <= b.x + WATCH_RANGE; x++) {
      if (x < 0 || x >= size) continue;
      if (sim.world.tmap[tileIndex(x, y, size)] !== Terrain.Sand) continue;
      if (coastal(sim, x, y)) n++;
    }
  }
  return n;
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
