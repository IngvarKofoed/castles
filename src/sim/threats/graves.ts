import type { Sim } from "../store";
import { markChunkDirty, tileIndex } from "../world/world";

/**
 * Graves: a marker, and deliberately nothing else.
 *
 * CONCEPT is explicit that a death is *just the loss* — no mourning mechanics,
 * no morale, no memorial that has to be tended. So a grave blocks nothing,
 * costs nothing and is checked by nothing: placement and levelling walk over
 * one and clear it silently, and a second death on a tile shares the marker.
 * The colony is simply one pair of hands smaller, and the labour meter is where
 * that is felt.
 *
 * It bakes into the chunk mesh like the props it stands among, which is why
 * both writes below dirty the tile.
 */

export function bury(sim: Sim, x: number, y: number): void {
  const size = sim.world.size;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = tileIndex(x, y, size);
  if (sim.graveMap[i]) return;
  sim.graveMap[i] = 1;
  markChunkDirty(sim.world, x, y);
}

/** Take a grave off a tile the colony is about to use. Silent by design: a
 *  refusal here would turn a marker into a mechanic. */
export function clearGrave(sim: Sim, x: number, y: number): void {
  const size = sim.world.size;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = tileIndex(x, y, size);
  if (!sim.graveMap[i]) return;
  sim.graveMap[i] = 0;
  markChunkDirty(sim.world, x, y);
}
