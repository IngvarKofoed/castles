import { defOf } from "./buildings";
import { FOODS } from "./goods";
import { countItems } from "./items";
import { occupancy, passable, type Occupancy } from "./path";
import {
  BuildingState,
  MonsterPhase,
  findBuilding,
  mintId,
  type Building,
  type Colonist,
  type Sim,
} from "./store";
import { defOfMonster, reach } from "./threats";
import {
  STARTING_COLONISTS,
  WANDERER_INTERVAL,
  WANDERER_JITTER,
  WANDERER_PATIENCE,
} from "./tuning";
import { atStation } from "./labour/colonists";
import { nextRand } from "./world/rng";
import { Terrain, tileIndex } from "./world/world";

/**
 * Population inflow: the bookkeeping half of the arrival loop
 * (docs/specs/2026-09-07-housing-wanderers.md).
 *
 * **The split is deliberate.** Walking lives in `stepColonists`, because a
 * wanderer is an ordinary colonist with a destination — which is what makes
 * the whole of step 4a apply to them for nothing: monsters notice them, they
 * flee, they can be caught, they leave a grave. This file owns only the four
 * moments that are not movement: the countdown, the spawn, the settle, and the
 * give-up.
 *
 * **No homelessness, and no bed ownership.** The population cap is
 * `STARTING_COLONISTS` plus the summed beds of every *active* House, derived
 * per read so there is no counter to drift; arrivals happen only under cap and
 * nobody needs a bed to stay. A death therefore opens room the next arrival
 * refills, which is the whole point of the step: the population is no longer a
 * ratchet, and growth costs placement rather than being awarded for progress.
 *
 * **One wanderer in transit at a time.** That keeps an arrival a *scene* — a
 * figure on the sand, a walk through the wilds, one more pair of hands — and
 * keeps failure cheap. Lifting it later means relaxing one guard.
 */

/** The wanderer currently walking in, or null. At most one exists. */
export function wanderer(sim: Sim): Colonist | null {
  for (const c of sim.colonists) if (c.dest >= 0) return c;
  return null;
}

/**
 * Beds standing in finished Houses. Summed off `BuildingDef.beds`, which is 0
 * for everything else, so this needs no kind test and a second housing kind
 * would need no edit here.
 */
export function bedsBuilt(sim: Sim): number {
  let n = 0;
  for (const b of sim.buildings) {
    if (b.state === BuildingState.Active) n += defOf(b).beds;
  }
  return n;
}

/**
 * How many folk the colony can hold: the starting five plus every bed. Derived
 * on every read rather than stored — a cap counter would be a second source of
 * truth over a sum of four buildings.
 *
 * **It only ever rises.** Buildings are permanent (no razing), so deaths are
 * the only thing that ever lowers the population, and the room they open is
 * exactly what the next arrival fills.
 */
export function populationCap(sim: Sim): number {
  return STARTING_COLONISTS + bedsBuilt(sim);
}

/** Folk who live here — everyone but the one still walking in. */
export function settled(sim: Sim): number {
  let n = 0;
  for (const c of sim.colonists) if (c.dest < 0) n++;
  return n;
}

/**
 * Is the table set for one more? A **food** in the colony for **everybody plus
 * the one arriving** (docs/specs/2026-09-08-bread-economy.md).
 *
 * The second half of the arrival gate, beside the beds: growth now costs
 * placement *and* a working food chain, so a colony that has not built one
 * stops growing when its provisions run out. Counted the way every
 * other good is counted — every loaf and every cheese anywhere, stored, loose
 * or carried — so the bar cannot flicker as haulers walk, and so a colony can
 * satisfy it down either road (`FOODS` in `goods.ts`,
 * docs/specs/2026-09-10-sheep-and-clothes.md).
 *
 * Exported because the House panel says so when this, rather than the cap, is
 * what holds arrivals: the gate can stand for game-days, it is player-caused,
 * and a ceiling set at or below `settled` on **every** food holds it shut
 * indefinitely — legal, but never unexplained.
 */
export function tableSet(sim: Sim): boolean {
  // **A colony with nobody left in it is exempt**, and that is not a softening
  // of the gate: with no colonists there is nobody to staff a farm, so
  // `settled + 1` is unsatisfiable by construction and the arrival loop would
  // stop for good — deleting the recovery the housing step exists for ("a death
  // frees room, so the colony can always recover",
  // docs/specs/2026-09-07-housing-wanderers.md). The one pair of hands that
  // comes back has to bootstrap the chain, and the *second* arrival is priced
  // in food again like everybody else's.
  if (settled(sim) === 0) return true;
  let food = 0;
  for (const type of FOODS) food += countItems(sim, type);
  return food >= settled(sim) + 1;
}

/**
 * One tick of the arrival loop, run after monsters and before workshops.
 *
 * After monsters, so a wanderer caught on the tick they would have arrived
 * dies rather than settling — the tick contract's "catches test post-move
 * positions", applied to the last step of a long walk.
 */
export function stepSettlers(sim: Sim): void {
  const walking = wanderer(sim);
  if (walking) {
    resolve(sim, walking);
    return;
  }
  if (sim.wandererTimer < 0) {
    // The last attempt is over. **Nothing here distinguishes how** — settled,
    // caught by an orc, or waited two days and left: all three free the road,
    // and the countdown restarts the same way for each. A death is detected by
    // exactly this, because `killColonist` splices the wanderer out without
    // knowing it was one.
    restart(sim);
    return;
  }
  if (settled(sim) >= populationCap(sim)) return;
  // Beds *and* food. Checked beside the cap check and before the countdown, so
  // the clock **pauses** while the surplus is missing exactly as it pauses at
  // cap — a colony with a short table is not quietly banking arrivals it
  // will get all at once when the oven catches up.
  if (!tableSet(sim)) return;
  const home = destination(sim);
  if (!home) return;
  if (sim.wandererTimer > 0) {
    // Clamped at 0, because -1 is a *sentinel* on this field and not a small
    // number: a countdown allowed to step past zero would read as "one in
    // transit", restart itself, and arrivals would stop for good. It cannot
    // happen at today's tunables (all four are whole ticks), which is exactly
    // why the guard is worth having — a retuned `DAY_TICKS` is where it would
    // otherwise bite, silently.
    sim.wandererTimer = Math.max(0, sim.wandererTimer - 1);
    return;
  }
  const beach = landing(sim, home);
  // Nowhere calm to land this tick — every shore is watched, or walled in.
  // Retried next tick, and **without touching the PRNG**: a draw per failed
  // attempt would make the arrival stream depend on how long the wilds
  // happened to be busy.
  if (beach < 0) return;
  arrive(sim, home, beach);
}

/**
 * Has the walk ended? Two ways, and neither says a word to the player.
 *
 * Arrival is standing **beside the destination's footprint** rather than on a
 * fixed tile — `atStation`'s rule, for its reason: a fixed tile can be water
 * or off the map, and a House has no work tile at all. Giving up is the
 * patience clock running out wherever they got stuck, and it leaves **no
 * grave**: they left, they did not die, and the missing marker is the tell.
 */
function resolve(sim: Sim, c: Colonist): void {
  const home = findBuilding(sim, c.dest);
  if (home && home.state === BuildingState.Active && atStation(c, home)) {
    c.dest = -1;
    // Cleared on arrival, so a settled colonist is indistinguishable from one
    // who never wandered — the field means nothing once `dest` is -1, and a
    // stale number would ride in every save from here on.
    c.patience = 0;
    return;
  }
  // Only `stepWanderer` ever advances this, and only on a tick where no route
  // could be found — so a wanderer who spent the last two days running from an
  // orc has not spent them waiting, and cannot time out for it.
  if (c.patience < WANDERER_PATIENCE) return;
  const i = sim.colonists.indexOf(c);
  if (i >= 0) sim.colonists.splice(i, 1);
}

/**
 * Where the next wanderer is headed: the **lowest-id active House**.
 *
 * Deterministic and deliberately dumb — there is no per-house occupancy to
 * balance against, because beds are a cap and not an assignment. The choice
 * matters only in that it decides which coast the arrival lands on, so
 * "the first house you built" is as good an answer as any and never surprises.
 */
function destination(sim: Sim): Building | null {
  let best: Building | null = null;
  for (const b of sim.buildings) {
    if (b.state !== BuildingState.Active || defOf(b).beds <= 0) continue;
    if (!best || b.id < best.id) best = b;
  }
  return best;
}

/**
 * The tile a wanderer lands on: the **nearest eligible beach to the
 * destination House**, or -1 when no shore qualifies this tick.
 *
 * Destination first, then beach — the island has no land edge, so there is no
 * map-edge tile to walk in from and the coast is the only door. Measured in
 * **Manhattan** distance, which is not a style choice: the grid is
 * 4-neighbour, so Manhattan *is* walking distance, and it puts the landing on
 * the shore that is genuinely the shortest walk. (Chebyshev would pick the
 * diagonal coast of a round island — a longer walk, and a diagonal A\* whose
 * tie plateau is wide enough to hit `MAX_VISITED`.)
 *
 * Anchored on the footprint's origin corner, the same anchor every other
 * "nearest to a building" search in the sim uses.
 */
function landing(sim: Sim, home: Building): number {
  const size = sim.world.size;
  const occ = occupancy(sim);
  // Diamond rings outward, first hit wins, lowest tile index within the ring —
  // so the answer is a pure function of the store. The scan is bounded by the
  // distance to the coast, which is the only reason walking the rings is
  // cheaper than a full-grid pass: a colony with no eligible shore anywhere
  // does sweep the map, once per tick, for as long as that lasts.
  for (let r = 0; r <= 2 * size; r++) {
    let best = -1;
    for (let dy = -r; dy <= r; dy++) {
      const rest = r - Math.abs(dy);
      const i = eligible(sim, occ, home.x - rest, home.y + dy);
      if (i >= 0 && (best < 0 || i < best)) best = i;
      if (rest === 0) continue;
      const j = eligible(sim, occ, home.x + rest, home.y + dy);
      if (j >= 0 && (best < 0 || j < best)) best = j;
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * Can somebody step off a boat here? The tile index if so, else -1.
 *
 * Sand, beside water, standable, **outside any enclosure**, and outside every
 * prowling monster's notice radius right now. The last one is what makes an
 * arrival a scene rather than a coin flip: nobody lands in front of an orc.
 *
 * The enclosure check is nearly vacuous — the flood flows in through the sea
 * from the map edge, so only the shore of a walled-in pond can read as inside —
 * and it stays anyway, because it is one array read and correctness by
 * accident is how regressions start.
 */
function eligible(sim: Sim, occ: Occupancy, x: number, y: number): number {
  const size = sim.world.size;
  if (x < 0 || y < 0 || x >= size || y >= size) return -1;
  const i = tileIndex(x, y, size);
  if (sim.world.tmap[i] !== Terrain.Sand) return -1;
  if (sim.insideMap[i]) return -1;
  if (!passable(sim.world, sim.wallMap, occ, x, y)) return -1;
  if (!coastal(sim, x, y)) return -1;
  return watched(sim, x, y) ? -1 : i;
}

/** Beside open water, orthogonally — the pathfinder's neighbourhood, so "on
 *  the shore" means the same thing walking as it does landing. */
function coastal(sim: Sim, x: number, y: number): boolean {
  const size = sim.world.size;
  for (const [dx, dy] of [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    if (sim.world.tmap[tileIndex(nx, ny, size)] === Terrain.Water) return true;
  }
  return false;
}

/** Is a prowling monster near enough to notice somebody standing here? Resting
 *  and homeward monsters notice nothing, so they do not close a shore. */
function watched(sim: Sim, x: number, y: number): boolean {
  for (const m of sim.monsters) {
    if (m.phase !== MonsterPhase.Prowl) continue;
    if (reach(m, x + 0.5, y + 0.5) <= defOfMonster(m.kind).notice) return true;
  }
  return false;
}

/**
 * A figure on the sand. No toast, no banner, no line of text anywhere — the
 * wanderer walking up the beach *is* the announcement (docs/STYLEGUIDE.md).
 *
 * They enter after `stepColonists` has already run this tick, so their first
 * step is next tick and the renderer draws them standing where they landed.
 */
function arrive(sim: Sim, home: Building, tile: number): void {
  const size = sim.world.size;
  const x = tile % size;
  const y = (tile - x) / size;
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
    dest: home.id,
    patience: 0,
    hunger: 0,
    eating: 0,
    // A wanderer lands **unclothed**, and abstains from the errand until they
    // settle exactly as they abstain from meals: `stepColonists` branches on
    // `dest` before either check.
    clothes: 0,
    dressing: 0,
    path: [],
    step: 0,
  });
  sim.wandererTimer = -1;
}

/** Start the next countdown: one interval, ± a seeded jitter, so arrivals do
 *  not fall on a metronome. The store PRNG's second consumer. */
function restart(sim: Sim): void {
  const roll = nextRand(sim.rngState);
  sim.rngState = roll.state;
  sim.wandererTimer = Math.max(0, WANDERER_INTERVAL + Math.round((roll.value * 2 - 1) * WANDERER_JITTER));
}
