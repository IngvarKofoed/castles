import { applyCommands, type Command } from "./commands";
import { stepWorkshops } from "./economy/workshop";
import { stepColonists } from "./labour/colonists";
import { generateTasks } from "./labour/tasks";
import type { Sim } from "./store";
import { settleEnclosure } from "./walls/enclosure";

/**
 * One fixed tick of game time.
 *
 * **The order below is part of the determinism contract** — it is not an
 * implementation detail and changing it changes the game:
 *
 * 1. **Commands.** Player intent lands at the tick boundary and nowhere else,
 *    so a replay of the same command log at the same ticks reproduces the
 *    colony exactly.
 * 2. **Task generation.** The queue is topped up against the world as the
 *    commands left it, so a building placed this tick is already hiring.
 * 3. **Colonists.** Pool and slot workers act, in id order.
 * 4. **Workshops.** Production runs after its workers have moved, so a log
 *    delivered this tick can start milling this tick.
 * 5. **Enclosure.** Last, and only if something moved the wall graph this
 *    tick — a placement, a segment finished, a segment torn down. Batching it
 *    here means however many segments changed cost one flood-fill, and a quiet
 *    tick costs none; every tick boundary still ends with `insideMap` current.
 *
 * The tick counter advances first, so a system asking `sim.tick` sees the tick
 * it is simulating rather than the one just finished.
 */
export function advanceTick(sim: Sim, commands: readonly Command[] = []): void {
  applyCommands(sim, commands);
  sim.tick++;
  generateTasks(sim);
  stepColonists(sim);
  stepWorkshops(sim);
  settleEnclosure(sim);
}

export type { Command };
