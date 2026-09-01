import { sawmillOutputFull, storedCount } from "../buildings";
import { removeItem } from "../items";
import {
  BuildingKind,
  BuildingState,
  ItemType,
  Loc,
  mintId,
  findColonist,
  type Building,
  type Item,
  type Sim,
} from "../store";
import { MILL_TICKS } from "../tuning";

/**
 * Workshop processing: the sawmill turns a log into a plank.
 *
 * The log is consumed when milling *starts*, and the progress lives on the
 * building — so pulling the worker out mid-cut loses nothing, it just stops.
 * Restaffing resumes exactly where it left off, which is what makes unstaffing
 * a real lever rather than a punishment.
 *
 * Nothing here is handed to another building: the plank goes into the output
 * buffer, and hauling it onward is the task queue's problem (filtered storage,
 * per CONCEPT.md's Kubifaktorium model).
 */
export function stepWorkshops(sim: Sim): void {
  for (const b of sim.buildings) {
    if (b.kind !== BuildingKind.Sawmill || b.state !== BuildingState.Active) continue;
    stepSawmill(sim, b);
  }
}

function stepSawmill(sim: Sim, b: Building): void {
  if (b.worker < 0) return;
  const worker = findColonist(sim, b.worker);
  // Work starts when the worker is *in* the building, not merely near it:
  // the walk over is not production time.
  if (!worker || worker.slot !== b.id || !worker.inside) return;

  if (b.millProgress < 0) {
    // Start a cut: only when there is a log to take and somewhere to put the
    // plank, so a finished plank can never be dropped for lack of room.
    if (sawmillOutputFull(sim, b)) return;
    if (storedCount(sim, b.id, ItemType.Log) < 1) return;
    const log = sim.items.find(
      (it) => it.loc === Loc.Stored && it.holder === b.id && it.type === ItemType.Log,
    );
    if (!log) return;
    removeItem(sim, log.id);
    b.millProgress = 0;
    return;
  }

  if (++b.millProgress < MILL_TICKS) return;
  const plank: Item = {
    id: mintId(sim),
    type: ItemType.Plank,
    loc: Loc.Stored,
    x: -1,
    y: -1,
    holder: b.id,
    reservedBy: -1,
  };
  sim.items.push(plank);
  b.millProgress = -1;
}
