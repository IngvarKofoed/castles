import { applyCommands, type Command } from "./commands";
import { stepWorkshops } from "./economy/workshop";
import { stepColonists } from "./labour/colonists";
import { generateTasks } from "./labour/tasks";
import { stepSettlers } from "./settlers";
import type { Sim } from "./store";
import { stepMonsters } from "./threats/monsters";
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
 * 3. **Colonists.** Pool and slot workers act — and flee — in id order.
 * 4. **Monsters.** After the folk have moved and before anything is produced.
 *    That placement is load-bearing in both directions: a catch always tests
 *    *post-move* positions, so a colonist who ran this tick is judged on where
 *    they got to; and a colonist's flee decision always reads the monster
 *    positions the previous tick ended with, so neither side ever moves twice
 *    against the other. A stale read is not the same as an unfair one.
 * 5. **Settlers.** The arrival loop's bookkeeping — the countdown, a spawn on
 *    the beach, a wanderer settling, a wanderer giving up. After monsters on
 *    purpose: a wanderer caught on the tick they would have arrived dies
 *    rather than settling, which is the same post-move rule a catch already
 *    obeys. Before workshops, so a settler joins the pool on the tick they
 *    arrive rather than a tick late.
 * 6. **Workshops.** Production runs after its workers have moved, so a log
 *    delivered this tick can start milling this tick.
 * 7. **Enclosure.** Last, and only if something moved the wall graph this
 *    tick — a placement, a segment finished, a segment torn down, **a segment
 *    bitten to pieces**. Batching it here means however many segments changed
 *    cost one flood-fill, and a quiet tick costs none; every tick boundary
 *    still ends with `insideMap` current, which is what makes a breach shrink
 *    the calm zone with no breach-specific code anywhere.
 *
 * The tick counter advances first, so a system asking `sim.tick` sees the tick
 * it is simulating rather than the one just finished.
 */
export function advanceTick(sim: Sim, commands: readonly Command[] = []): void {
  applyCommands(sim, commands);
  sim.tick++;
  generateTasks(sim);
  stepColonists(sim);
  stepMonsters(sim);
  stepSettlers(sim);
  stepWorkshops(sim);
  settleEnclosure(sim);
}

export type { Command };
