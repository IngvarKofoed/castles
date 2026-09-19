import { occupancy } from "../path";
import { beachAt } from "../settlers";
import { MonsterKind, MonsterPhase, mintId, type Monster, type Sim } from "../store";
import {
  INCURSION_BASE,
  INCURSION_DEPTH,
  INCURSION_MAX,
  INCURSION_TICKS,
  LAND_PER_MONSTER,
  STORM_INTERVAL,
  STORM_JITTER,
  STORM_SEVERITY,
  TROLL_SHARE_MAX,
  TROLL_SHARE_MIN,
  WITHDRAW_BACKSTOP,
} from "../tuning";
import { markEnclosureStale } from "../walls/enclosure";
import { hash } from "../world/noise";
import { nextRand } from "../world/rng";
import { Terrain, markChunkDirty } from "../world/world";

/**
 * The weather: when the Wilds come, how hard, and from which coast.
 *
 * **Between incursions there are no monsters on the map at all**
 * (docs/specs/2026-09-17-incursions-from-the-sea.md). That is the whole of what
 * this file is for — the land outside the wall is genuinely safe, so a wall
 * push has a window long enough to finish in, and the window is knowable in
 * advance. The wall is still absolute: an incursion cannot reach anyone behind
 * a closed one, which is why the forecast is a curfew rather than a siege.
 *
 * One clock, `sim.stormTicks`, means two things in turn, and
 * `sim.monsters.length` is the discriminator — deliberately, rather than a
 * second flag that could disagree with the array it describes. In peace it
 * counts down to the **landing**; ashore it counts down to the **withdrawal**.
 * It runs on the tick, so ×0 stops it with everything else.
 *
 * No draw is made anywhere but `restart`, and `restart` runs only when the last
 * monster of a storm leaves — so a replay of the same seed meets the same
 * weather at the same ticks.
 */

/** Where the aim point for a bearing sits, as a multiple of the map's width —
 *  far enough off the island that "nearest beach to it" reads as "the shore in
 *  that direction" rather than as a point on the map. */
const AIM_REACH = 1;

/**
 * The clock, run once per tick before any monster moves.
 *
 * Ashore, zero turns the storm: every monster drops what it is doing and heads
 * for the boats. In peace, zero lands one — or, when no shore qualifies this
 * tick, retries next tick **without touching the PRNG**, exactly as the
 * wanderer's beach search does: a draw per failed attempt would make the
 * weather depend on how long the coast happened to be busy.
 */
export function stepForecast(sim: Sim): void {
  if (sim.monsters.length) {
    if (sim.stormTicks > 0 && --sim.stormTicks === 0) turn(sim);
    return;
  }
  if (sim.stormTicks > 0) {
    sim.stormTicks--;
    // The forecast's subject, resolved lazily: `createSim` and the migration
    // rung both hand this -1, because neither has a settled `insideMap` to ask
    // and a landing site is a fact about the coast rather than about the clock.
    if (sim.stormLanding < 0) sim.stormLanding = beachToward(sim, bearingOf(sim));
    return;
  }
  land(sim);
}

/**
 * Has the storm emptied? Run once per tick **after** the monsters have moved,
 * because that is when the last one is removed. `had` is whether anything was
 * ashore when the tick began.
 *
 * This is the only place the forecast is re-seeded, which is what makes the
 * schedule replayable: three draws, always in the same order, always at the end
 * of an incursion.
 *
 * **`had` is the whole guard, and it is not decoration.** Keying off "the clock
 * is at zero and nothing is ashore" instead looks equivalent and is not: the
 * clock reaches zero one tick *before* `stepForecast` gets to act on it, so a
 * naturally expiring forecast would be rescheduled on that tick and the landing
 * would never happen at all. Every storm in the game was silently skipped until
 * this read the transition rather than the state
 * (docs/specs/2026-09-17-incursions-from-the-sea.md).
 */
export function settleIncursion(sim: Sim, had: boolean): void {
  if (!had || sim.monsters.length) return;
  restart(sim);
}

/** The storm passes: everything ashore turns for the boats. A withdrawing
 *  monster notices nothing, so this is also the moment an attack ends —
 *  mid-bite, as it always has (docs/CONCEPT.md). */
function turn(sim: Sim): void {
  for (const m of sim.monsters) {
    if (m.phase !== MonsterPhase.Ashore) continue;
    m.phase = MonsterPhase.Withdrawing;
    m.phaseTicks = WITHDRAW_BACKSTOP;
    m.target = -1;
    m.targetTile = -1;
    m.biteTicks = 0;
    m.path = [];
    m.step = 0;
  }
}

/**
 * Set the next forecast: how long the peace lasts, how hard the storm will hit,
 * and which coast it comes in on. Three draws off the store PRNG, in that
 * order.
 *
 * The bearing is **spent here rather than stored**: what a forecast has to
 * carry is a place, and a place can be re-picked near the old one if the coast
 * changes, whereas an angle would have to be re-resolved from scratch.
 */
function restart(sim: Sim): void {
  const wait = nextRand(sim.rngState);
  sim.rngState = wait.state;
  sim.stormTicks = Math.max(1, STORM_INTERVAL + Math.round((wait.value * 2 - 1) * STORM_JITTER));

  const severity = nextRand(sim.rngState);
  sim.rngState = severity.state;
  sim.stormStrength = 1 + (severity.value * 2 - 1) * STORM_SEVERITY;

  const bearing = nextRand(sim.rngState);
  sim.rngState = bearing.state;
  sim.stormLanding = beachToward(sim, bearing.value * Math.PI * 2);
}

/**
 * A bearing for a forecast that has none stored — **the opening one, and the
 * one a migrated save wakes with**, since `createSim` and the 11 → 12 rung both
 * hand `stormLanding` a -1.
 *
 * Derived from the **world seed** rather than drawn, for two reasons that pull
 * the same way: neither of those two callers may touch `rngState` (a fresh game
 * and a save migrated from any older version have to arrive at the same store),
 * and resolving a landing site late must not move the stream either. Seed-
 * derived keeps both, and still gives every world its own opening coast.
 *
 * It was derived from `stormStrength` first, and that was wrong in a way only a
 * sweep across seeds shows: both callers set that field to exactly 1, so the
 * expression was constant and **every game's first storm landed on the same
 * shore whatever the seed**. Only the second storm onward, whose bearing is
 * actually drawn in `restart`, varied at all.
 */
function bearingOf(sim: Sim): number {
  return hash(sim.world.seed, BEARING_SALT, sim.world.seed) * Math.PI * 2;
}

/** Salt for the opening bearing, so it is uncorrelated with terrain and forest,
 *  which are hashed off the same seed. */
const BEARING_SALT = 0x6d2b79f5;

/**
 * The landing: one site, one boat, one readable direction.
 *
 * **One site however large the incursion.** What the boats buy is *which side
 * of the colony is the wrong side to stand on today*, and several landings
 * dilute exactly that. If one proves too easy to wall against, a second is a
 * tuning change to this rule and not a new mechanic.
 *
 * The forecast site is re-checked here and re-picked near itself if the coast
 * has changed under it — a wall closed across the beach, the sand quarried
 * away. The storm still comes from the coast it was forecast on; it comes
 * ashore a few tiles along.
 */
function land(sim: Sim): void {
  const occ = occupancy(sim);
  const size = sim.world.size;
  let tile = sim.stormLanding;
  if (tile >= 0) {
    const x = tile % size;
    const y = (tile - x) / size;
    if (beachAt(sim, occ, x, y) < 0) tile = nearestBeach(sim, x, y);
  } else {
    tile = beachToward(sim, bearingOf(sim));
  }
  // Nowhere to land this tick — every shore walled in, or a colony with nothing
  // left to anchor a bearing on. The clock is left at zero, so the next tick
  // simply tries again; **no draw is made**, because a draw per failed attempt
  // would make the weather depend on how long the coast happened to be busy.
  if (tile < 0) return;

  const lx = tile % size;
  const ly = (tile - lx) / size;
  const strength = strengthOf(sim);
  const depth = depthOf(sim, lx, ly);
  // Trolls weight toward the bigger storms, and land first so the order of the
  // array is a fact about the incursion rather than about a draw.
  const trolls = Math.round(strength * trollShare(strength));
  for (let n = 0; n < strength; n++) {
    sim.monsters.push(makeMonster(sim, n < trolls ? MonsterKind.Troll : MonsterKind.Orc, lx, ly, depth));
  }
  sim.stormLanding = tile;
  sim.stormTicks = INCURSION_TICKS;
  // Every monster on the map seeds the enclosure flood (walls/enclosure), so a
  // landing changes the seed set exactly as a wall event does.
  markEnclosureStale(sim);
  // The boat is baked into the chunk mesh like a tree, so the chunk has to be
  // told. Unlike a tree it also *un*-bakes — `leave` does the other half.
  markChunkDirty(sim.world, lx, ly);
}

function makeMonster(sim: Sim, kind: number, lx: number, ly: number, depth: number): Monster {
  return {
    id: mintId(sim),
    kind,
    x: lx + 0.5,
    y: ly + 0.5,
    px: lx + 0.5,
    py: ly + 0.5,
    heading: 0,
    landX: lx,
    landY: ly,
    depth,
    phase: MonsterPhase.Ashore,
    // Meaningless while ashore: the incursion's own clock ends this phase.
    phaseTicks: 0,
    target: -1,
    targetTile: -1,
    biteTicks: 0,
    path: [],
    step: 0,
  };
}

/**
 * How many monsters come ashore: **enclosed land, and nothing else**
 * (docs/CONCEPT.md, pillar 2 — expansion is the risk), wobbled by the seeded
 * severity drawn when the last storm ended.
 *
 * The acreage is read **here, at the landing**, and that is the whole of why
 * this is not a stored number. An incursion ends with monsters possibly still
 * inside a closed wall, and a monster inside a wall collapses the enclosure
 * fill to zero — so a strength rolled at the end of a storm would hand a player
 * who sealed one in a permanently weak next storm.
 */
function strengthOf(sim: Sim): number {
  let acreage = 0;
  const tmap = sim.world.tmap;
  for (let i = 0; i < sim.insideMap.length; i++) {
    if (sim.insideMap[i] && tmap[i] !== Terrain.Water) acreage++;
  }
  const raw = (INCURSION_BASE + acreage / LAND_PER_MONSTER) * sim.stormStrength;
  return Math.min(INCURSION_MAX, Math.max(INCURSION_BASE, Math.round(raw)));
}

/** The troll share, rising from `TROLL_SHARE_MIN` at the smallest incursion to
 *  `TROLL_SHARE_MAX` at the largest. */
function trollShare(strength: number): number {
  const t = (strength - INCURSION_BASE) / Math.max(1, INCURSION_MAX - INCURSION_BASE);
  return TROLL_SHARE_MIN + (TROLL_SHARE_MAX - TROLL_SHARE_MIN) * t;
}

/**
 * How far inland an incursion presses, Chebyshev from the beach it landed on:
 * **the walk to the colony, plus how far the colony has reached, plus a
 * margin.**
 *
 * The first term is what makes an incursion an incursion — it always gets to
 * the settlement, or to the wall that stops it. The second is the one that
 * matters, and it is the term that keeps CONCEPT's "danger scales outward … the
 * deep map is earned" alive under a single global strength dial: a colony whose
 * wall reaches forty tiles out is walked forty tiles further than one that has
 * enclosed nothing, so its far side is reachable and its near side is not the
 * only thing at risk. Without it a tile a hundred out would be exactly as
 * dangerous as one ten out, because strength alone says nothing about *where*.
 *
 * The margin covers an unwalled colony's outskirts, whose anchor is the
 * centroid of its folk rather than of any ground it holds.
 */
function depthOf(sim: Sim, lx: number, ly: number): number {
  const anchor = colonyAnchor(sim);
  if (!anchor) return INCURSION_DEPTH;
  const [ax, ay] = anchor;
  const walk = Math.max(Math.abs(lx + 0.5 - ax), Math.abs(ly + 0.5 - ay));
  const size = sim.world.size;
  const tmap = sim.world.tmap;
  let reach = 0;
  for (let i = 0; i < sim.insideMap.length; i++) {
    if (!sim.insideMap[i] || tmap[i] === Terrain.Water) continue;
    const x = i % size;
    const y = (i - x) / size;
    const d = Math.max(Math.abs(x + 0.5 - ax), Math.abs(y + 0.5 - ay));
    if (d > reach) reach = d;
  }
  return Math.round(walk + reach) + INCURSION_DEPTH;
}

/**
 * Where the colony *is* — its enclosed ground if it has any, else the centroid
 * of its buildings, else of its folk. Null for a colony with none of the three,
 * which is a colony that has been wiped out.
 *
 * Enclosed ground first because that is what a colony *is* by the time one
 * exists; the two fallbacks are the early game, when the wall has not been
 * drawn yet. Exported: `stepMonsters` presses inland toward exactly this, so
 * the ground an incursion walks at and the ground a landing is aimed away from
 * cannot disagree.
 */
export function colonyAnchor(sim: Sim): [number, number] | null {
  const size = sim.world.size;
  const tmap = sim.world.tmap;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < sim.insideMap.length; i++) {
    if (!sim.insideMap[i] || tmap[i] === Terrain.Water) continue;
    const x = i % size;
    sx += x + 0.5;
    sy += (i - x) / size + 0.5;
    n++;
  }
  if (n) return [sx / n, sy / n];
  if (sim.buildings.length) {
    for (const b of sim.buildings) {
      sx += b.x + b.w / 2;
      sy += b.y + b.h / 2;
    }
    return [sx / sim.buildings.length, sy / sim.buildings.length];
  }
  if (!sim.colonists.length) return null;
  for (const c of sim.colonists) {
    sx += c.x;
    sy += c.y;
  }
  return [sx / sim.colonists.length, sy / sim.colonists.length];
}

/**
 * The eligible beach furthest *toward* a bearing: the one nearest an aim point
 * set a map-width out from the colony in that direction.
 *
 * One criterion rather than a weighted pair of them — an aim point that far out
 * favours the shore facing the bearing, and among those the one nearest the
 * colony, which is what "the storm comes in from the north" ought to mean. A
 * full-grid pass, run once per incursion rather than per frame.
 */
function beachToward(sim: Sim, bearing: number): number {
  const anchor = colonyAnchor(sim);
  if (!anchor) return -1;
  const size = sim.world.size;
  const aimX = anchor[0] + Math.cos(bearing) * size * AIM_REACH;
  const aimY = anchor[1] + Math.sin(bearing) * size * AIM_REACH;
  return bestBeach(sim, aimX, aimY);
}

/** The eligible beach nearest a tile — the re-pick when a forecast site has
 *  gone bad under a wall or a shovel. */
function nearestBeach(sim: Sim, x: number, y: number): number {
  return bestBeach(sim, x + 0.5, y + 0.5);
}

/**
 * The eligible beach nearest a point, by squared distance, ties broken by the
 * lowest tile index — so the answer is a pure function of the store and never
 * of iteration luck.
 *
 * Every candidate is cheap-rejected on `tmap` before `beachAt` is asked
 * anything, which is what keeps a whole-map pass affordable at the cadence this
 * runs on (once per incursion, and once more when a forecast site goes stale).
 */
function bestBeach(sim: Sim, px: number, py: number): number {
  const occ = occupancy(sim);
  const size = sim.world.size;
  const tmap = sim.world.tmap;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < tmap.length; i++) {
    if (tmap[i] !== Terrain.Sand) continue;
    const x = i % size;
    const y = (i - x) / size;
    if (beachAt(sim, occ, x, y) < 0) continue;
    const dx = x + 0.5 - px;
    const dy = y + 0.5 - py;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}
