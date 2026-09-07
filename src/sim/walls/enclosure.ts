import type { Sim } from "../store";
import { Terrain, tileIndex } from "../world/world";
import { WallState, isBlocking } from "./index";

/**
 * Enclosure: the load-bearing primitive. "Inside" is derived from the wall
 * graph, never prescribed — there are no rings, so the shape of the colony is
 * whatever the player drew (docs/CONCEPT.md, pillar 2).
 *
 * The test is a **flood-fill from the map edge and from every lair**: seed
 * those tiles, flow through every tile where `isBlocking` is false, and
 * whatever the water never reached is enclosed. Trees and water do not block —
 * the wall is the only technology that turns unsafe ground into safe ground —
 * and blueprints do not block, so a planned ring encloses nothing until it is
 * actually standing.
 *
 * **The lairs are a seed, and that closes the stone trap.** Ground holding a den
 * can never read as calm however much stone is drawn around it: walls may
 * *contain* a monster, but the pen stays dangerous, colonists in it still flee,
 * and the trapped monster still prowls its bounded circuit. Both promises
 * survive intact — inside means safe, and a monster can never be permanently
 * neutralized. Nothing may be built on a lair tile either (`canPlaceWall`,
 * `canPlace`), so the seed can never be walled over from beneath.
 *
 * **Event-driven rather than region-incremental**, which diverges from
 * ARCHITECTURE's original wording and is recorded there: at 256² a full BFS is
 * sub-millisecond, so `settleEnclosure` runs the whole fill at most once per
 * tick — batching however many segments completed or fell that tick — and not
 * at all on a quiet tick. `sim.enclosureDirty` is the batch flag, and it is
 * always 0 at a tick boundary, which is why a save never carries a pending
 * recompute. A genuinely incremental re-flood can replace the body of
 * `recomputeEnclosure` without any consumer noticing.
 */

/**
 * Rebuild `insideMap` from `wallMap`.
 *
 * The definition, pinned once: `insideMap[i] = 1` exactly when the flood never
 * reached tile `i` **and** the tile does not itself hold a wall. Excluding wall
 * tiles is what makes the readout below mean *buildable enclosed ground* — a
 * tile under a segment (or under a segment someone has drawn) is not ground the
 * colony can use.
 */
export function recomputeEnclosure(sim: Sim): void {
  const size = sim.world.size;
  const wall = sim.wallMap;
  const inside = sim.insideMap;
  const n = size * size;
  const reached = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const flow = (i: number): void => {
    if (reached[i] || isBlocking(wall[i])) return;
    reached[i] = 1;
    queue[tail++] = i;
  };

  /**
   * A lair seeds the flood **whatever is standing on it**, which the ordinary
   * `flow` cannot do: it drops any blocked tile, so a den with a wall over it
   * would have its seed silently discarded and the pen would read as calm —
   * the stone trap, arriving by the one route that can still put a wall there.
   * `canPlaceWall` refuses a lair tile, so no live game can; the v4 migration
   * places dens without consulting the colony's wall graph, so it can.
   */
  const seedLair = (i: number): void => {
    if (reached[i]) return;
    reached[i] = 1;
    queue[tail++] = i;
  };

  // Seed from the whole map edge. An edge tile carrying a raised wall is
  // *blocked*, not a seed — a wall on the border is still a wall.
  for (let x = 0; x < size; x++) {
    flow(tileIndex(x, 0, size));
    flow(tileIndex(x, size - 1, size));
  }
  for (let y = 1; y < size - 1; y++) {
    flow(tileIndex(0, y, size));
    flow(tileIndex(size - 1, y, size));
  }
  // And from every den — unconditionally, so the seed cannot be dropped by
  // something standing on it. The ground a monster lives on is outside by
  // definition, and that has to hold by construction rather than by everything
  // that writes `wallMap` remembering to check.
  for (const m of sim.monsters) seedLair(tileIndex(m.lairX, m.lairY, size));

  while (head < tail) {
    const i = queue[head++];
    const x = i % size;
    if (x > 0) flow(i - 1);
    if (x < size - 1) flow(i + 1);
    if (i >= size) flow(i - size);
    if (i < n - size) flow(i + size);
  }

  for (let i = 0; i < n; i++) {
    inside[i] = !reached[i] && wall[i] === WallState.None ? 1 : 0;
  }
  sim.enclosureDirty = 0;
}

/** Run the batched recompute, if this tick produced any wall event. */
export function settleEnclosure(sim: Sim): void {
  if (sim.enclosureDirty) recomputeEnclosure(sim);
}

/** Mark the enclosure stale. Called by anything that writes `wallMap`. */
export function markEnclosureStale(sim: Sim): void {
  sim.enclosureDirty = 1;
}

/**
 * Enclosed **land** tiles — the ribbon's "enclosed" readout. Water inside the
 * wall is inside, and is deliberately not counted: buildable ground is the
 * number the whole game is eventually about.
 */
export function enclosedLand(sim: Sim): number {
  const tmap = sim.world.tmap;
  const inside = sim.insideMap;
  let n = 0;
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] && tmap[i] !== Terrain.Water) n++;
  }
  return n;
}
