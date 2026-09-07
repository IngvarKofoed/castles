import {
  MonsterKind,
  MonsterPhase,
  mintId,
  type Monster,
  type Sim,
} from "../store";
import {
  CIRCUIT_WAYPOINTS,
  LAIR_ATTEMPTS,
  LAIR_CLEAR_RADIUS,
  LAIR_INNER_WEIGHT,
  LAIR_SPACING,
  LAIR_TARGET,
  OUTER_BAND,
  PERIOD_SPREAD,
  PROWL_BASE,
  REST_BASE,
  ROAM_RADIUS,
  TROLL_CHANCE_INNER,
  TROLL_CHANCE_OUTER,
  WAYPOINT_TRIES,
} from "../tuning";
import { nextRand } from "../world/rng";
import { Terrain, tileIndex, type World } from "../world/world";

/**
 * Where the monsters live, and the hours each of them keeps.
 *
 * **One mechanism, two callers.** Generation runs this pass, and so does the
 * v4 migration over an old save — from the same derived stream, so a migrated
 * v3 colony and a fresh game on the same seed wake the same monsters at the
 * same lairs on the same rhythms. That is the whole reason this file reads
 * **only the world layers** and never `wallMap`, `buildings` or `rngState`: a
 * pass that consulted the colony would give an old save a different wilderness
 * than a new one, and "the same seed is the same world" would stop being true.
 *
 * The consequence, accepted deliberately: a migrated colony can find a lair
 * under a wall it already built, or inside a footprint. That is coherent rather
 * than broken — walls may *contain* a monster (docs/specs/2026-09-04-monsters.md)
 * and the enclosure fill seeds from lair tiles precisely so the pen never reads
 * as calm — but it is worth knowing before it is seen.
 *
 * The gradient, and the thing that is *not* here: probability rises with radius
 * and trolls weight outward, but there is **no protected radius** around the
 * start. A near-centre lair is rare, never impossible; the gradient is the only
 * mercy. `LAIR_CLEAR_RADIUS` excludes the spawn clearing alone, so a new colony
 * does not open sharing its courtyard with a den — spawn sanity, not safety.
 */

/** Salt for the lair stream, so it is uncorrelated with terrain and forest. */
const LAIR_SEED_SALT = 0x27d4eb2f;

/**
 * `terrain` is the world the pass *reads*, separate from the sim it writes to.
 * They are the same object for a new colony; the v4 migration passes a world
 * regenerated from the save's seed instead, because the save's own layers have
 * been played on — a chopped tree or a quarried outcrop changes which tiles are
 * eligible, and since the candidate list is a running cumulative weight, one
 * gained or lost tile moves every later draw. Reading the played world would
 * give a migrated colony a different wilderness than a fresh game on its seed,
 * which is the one thing this pass exists to prevent.
 *
 * `forbidden` marks tiles this pass may not use, 1 per tile — **the ground a
 * migrating colony has already walled in**. Generation passes none, because at
 * generation there are no walls; the v4 rung passes the save's own enclosure,
 * so an old colony never wakes a den inside its own ring and finds its whole
 * interior turned to open country on load.
 *
 * It is a *rejection*, applied after the draw rather than a filter applied to
 * the candidate list, and that distinction is the point: the weight table stays
 * a pure function of the regenerated world, so the draw stream is the one a
 * fresh game on this seed would make. Filtering the list instead would shift
 * every draw from the first one and hand the colony a wholly different
 * wilderness — the very thing the `terrain` parameter above exists to stop.
 *
 * A rejection is still not free, and this is the honest limit: it spends the
 * tile draw but not the monster's own (see `makeMonster` — a variable number of
 * values), and it changes what `placed` holds, so the dens drawn *after* a
 * rejection differ from a fresh game's. Every den before the first rejection is
 * identical, and a mask that vetoes nothing — which is what generation passes —
 * leaves the whole stream identical.
 */
export function spawnLairs(sim: Sim, terrain: World = sim.world, forbidden?: Uint8Array): void {
  const world = terrain;
  const candidates = eligible(world);
  if (!candidates.tiles.length) return;

  let state = (world.seed ^ LAIR_SEED_SALT) | 0;
  const draw = (): number => {
    const next = nextRand(state);
    state = next.state;
    return next.value;
  };

  // Weighted sampling with spacing rejection, rather than a per-tile
  // probability: the count then depends on the *gradient* alone instead of on
  // how much land a particular seed happens to have, so every map gets a
  // comparable wilderness. A rejected draw still consumes one value from the
  // stream, which is what keeps the whole pass reproducible.
  const size = world.size;
  const placed: [number, number][] = [];
  for (let attempt = 0; attempt < LAIR_ATTEMPTS && placed.length < LAIR_TARGET; attempt++) {
    const i = candidates.tiles[pick(candidates.cumulative, draw() * candidates.total)];
    const x = i % size;
    const y = (i - x) / size;
    // Ground the colony already holds, and dens too close together, are refused
    // the same way: the draw is spent, the walk carries on, and the count still
    // lands near target because there are plenty of attempts left.
    if (forbidden && forbidden[i]) continue;
    if (placed.some(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) < LAIR_SPACING)) continue;
    placed.push([x, y]);
    sim.monsters.push(makeMonster(sim, world, x, y, draw));
  }
}

/**
 * Ground a den may stand on, with each tile's radial weight — one row-major
 * pass, so the candidate list is a pure function of the world.
 *
 * Grass or sand, no tree: "anywhere on land" in the spec's sense, narrowed to
 * ground a monster can actually walk off. Rock stands at least two height steps
 * above everything around it, so a lair on an outcrop would be a monster with
 * nowhere to go, and a tree on the tile is both impassable and something the
 * den prop would grow through.
 */
function eligible(world: World): { tiles: number[]; cumulative: number[]; total: number } {
  const size = world.size;
  const centre = (size - 1) / 2;
  const half = size / 2;
  const tiles: number[] = [];
  const cumulative: number[] = [];
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = tileIndex(x, y, size);
      const t = world.tmap[i];
      if (t !== Terrain.Grass && t !== Terrain.Sand) continue;
      if (world.treeMap[i]) continue;
      const d = Math.hypot(x - centre, y - centre);
      if (d <= LAIR_CLEAR_RADIUS) continue;
      const b = Math.min(1, d / half);
      total += LAIR_INNER_WEIGHT + (1 - LAIR_INNER_WEIGHT) * b * b;
      tiles.push(i);
      cumulative.push(total);
    }
  }
  return { tiles, cumulative, total };
}

/** First index whose cumulative weight passes `v`. */
function pick(cumulative: readonly number[], v: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * One monster, with its hours drawn once and for all.
 *
 * The initial phase is weighted by the two periods, so a fresh map is mostly
 * quiet with a few monsters already out — and the remaining timer is a random
 * fraction of its period, so nothing ticks in unison. Everything a monster ever
 * does derives from what is written here plus the shared tick; the tick loop
 * makes no draws at all.
 */
function makeMonster(sim: Sim, world: World, x: number, y: number, draw: () => number): Monster {
  const size = world.size;
  const centre = (size - 1) / 2;
  const band = Math.min(1, Math.hypot(x - centre, y - centre) / (size / 2));

  const kind = draw() < (band >= OUTER_BAND ? TROLL_CHANCE_OUTER : TROLL_CHANCE_INNER)
    ? MonsterKind.Troll
    : MonsterKind.Orc;
  const restTicks = Math.max(1, Math.round(REST_BASE * spread(draw())));
  // The outward gradient multiplies the prowl share: a den at the island's
  // edge is out roughly twice as long as one near the middle.
  const prowlTicks = Math.max(1, Math.round(PROWL_BASE * spread(draw()) * (1 + band)));
  const prowling = draw() < prowlTicks / (restTicks + prowlTicks);
  const phaseTicks = Math.max(1, Math.ceil(draw() * (prowling ? prowlTicks : restTicks)));

  const circuit: number[] = [];
  for (let k = 0; k < CIRCUIT_WAYPOINTS; k++) circuit.push(waypoint(world, x, y, draw));

  return {
    id: mintId(sim),
    kind,
    x: x + 0.5,
    y: y + 0.5,
    px: x + 0.5,
    py: y + 0.5,
    heading: 0,
    lairX: x,
    lairY: y,
    circuit,
    leg: 0,
    phase: prowling ? MonsterPhase.Prowl : MonsterPhase.Rest,
    phaseTicks,
    restTicks,
    prowlTicks,
    target: -1,
    targetTile: -1,
    biteTicks: 0,
    path: [],
    step: 0,
  };
}

/** A period multiplier in [1 − PERIOD_SPREAD, 1 + PERIOD_SPREAD]. */
function spread(v: number): number {
  return 1 + (v * 2 - 1) * PERIOD_SPREAD;
}

/**
 * One circuit waypoint: standable ground within `ROAM_RADIUS` of the lair, or
 * the lair itself when a bounded number of tries finds none — a den ringed by
 * water or rock gets a circuit that keeps it home, which is correct and cannot
 * hang the pass.
 */
function waypoint(world: World, lx: number, ly: number, draw: () => number): number {
  const size = world.size;
  for (let attempt = 0; attempt < WAYPOINT_TRIES; attempt++) {
    const dx = Math.round((draw() * 2 - 1) * ROAM_RADIUS);
    const dy = Math.round((draw() * 2 - 1) * ROAM_RADIUS);
    const x = lx + dx;
    const y = ly + dy;
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    const i = tileIndex(x, y, size);
    const t = world.tmap[i];
    if (t !== Terrain.Grass && t !== Terrain.Sand) continue;
    if (world.treeMap[i]) continue;
    return i;
  }
  return tileIndex(lx, ly, size);
}
