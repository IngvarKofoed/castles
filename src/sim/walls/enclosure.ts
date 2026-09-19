import type { Sim } from "../store";
import { Terrain, tileIndex } from "../world/world";
import { WallState, isBlocking } from "./index";

/**
 * Enclosure: the load-bearing primitive. "Inside" is derived from the wall
 * graph, never prescribed — there are no rings, so the shape of the colony is
 * whatever the player drew (docs/CONCEPT.md, pillar 2).
 *
 * The test is a **flood-fill from the map edge and from every monster on the
 * map**: seed those tiles, flow through every tile where `isBlocking` is false,
 * and whatever the water never reached is enclosed. Trees and water do not
 * block — the wall is the only technology that turns unsafe ground into safe
 * ground — and blueprints do not block, so a planned ring encloses nothing
 * until it is actually standing.
 *
 * **A monster is a seed, and that closes the stone trap.** It used to be a
 * *lair* that seeded the flood; the wilds stopped living on the map with
 * `docs/specs/2026-09-17-incursions-from-the-sea.md`, so the seed moved to
 * where a monster is standing right now. In peace there are none and the fill
 * is the map-edge flood alone — cheaper than it has ever been.
 *
 * **The consequence is colony-wide and it is intended.** Close a wall around a
 * landed monster and the *whole* enclosure reads as outside: the acreage
 * readout collapses, the wash goes off, and every colonist becomes
 * fleeable-from. That is truthful — a monster inside your walls can walk
 * anywhere in them — and it is the trap the lair seed always existed to close,
 * doing its job against a new shape of mistake. It does not flicker: a monster
 * standing on *outside* ground is already in the region the map-edge flood
 * reached, so its seed adds nothing at all, and the answer changes in exactly
 * the one case above.
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
/**
 * The fill's scratch, reused across calls rather than allocated per call.
 *
 * **Measured, not assumed**, at 256² on the default seed: **0.89 ms** a call
 * freshly allocated, **0.84 ms** reused. The sub-millisecond figure
 * `docs/changelog/2026-09-02-palisade-walls.md` recorded was taken for a fill
 * that ran on wall events only; a monster now seeds it, so an incursion marks it
 * stale on nearly every tick, and at `MAX_TICKS_PER_FRAME` a catch-up frame can
 * run five of them against a whole incursion tick of about 0.99 ms. So the
 * reuse is worth having — it removes 320 KB of garbage a call — and it is
 * **not** the fix: the BFS and the final 65k pass are the cost, and only a
 * region-incremental re-flood would move them (`docs/CLAUDE_TODO.md`).
 *
 * It is **not sim state**: nothing here survives a call, `reached` is cleared at
 * the top of every fill, and `queue` is written before it is read. The store's
 * plain-data rule is about what a save holds, and this is held nowhere.
 */
let reachedScratch = new Uint8Array(0);
let queueScratch = new Int32Array(0);

export function recomputeEnclosure(sim: Sim): void {
  const size = sim.world.size;
  const wall = sim.wallMap;
  const inside = sim.insideMap;
  const n = size * size;
  // Grown, never shrunk: a test suite runs 16², 20² and 256² worlds in one
  // process, and a scratch that shrank would reallocate on every alternation.
  if (reachedScratch.length < n) {
    reachedScratch = new Uint8Array(n);
    queueScratch = new Int32Array(n);
  }
  const reached = reachedScratch;
  const queue = queueScratch;
  reached.fill(0, 0, n);
  let head = 0;
  let tail = 0;

  const flow = (i: number): void => {
    if (reached[i] || isBlocking(wall[i])) return;
    reached[i] = 1;
    queue[tail++] = i;
  };

/**
   * A monster seeds the flood **whatever is standing on it**, which the ordinary
   * `flow` cannot do: it drops any blocked tile, so a monster caught under a
   * segment that finished across it would have its seed silently discarded and
   * the pen would read as calm — the stone trap, arriving by the one route that
   * can still put a wall there. Nothing refuses a wall over a monster's tile,
   * because a monster is leaving; the guarantee has to hold by construction
   * rather than by everything that writes `wallMap` remembering to check.
   */
  const seedMonster = (i: number): void => {
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
  // And from wherever every monster is standing — unconditionally, so the seed
  // cannot be dropped by something on top of it. Ground a monster is standing on
  // is outside by definition. Empty on a quiet day, which is most of the game.
  for (const m of sim.monsters) {
    const mx = Math.min(size - 1, Math.max(0, Math.floor(m.x)));
    const my = Math.min(size - 1, Math.max(0, Math.floor(m.y)));
    seedMonster(tileIndex(mx, my, size));
  }

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
