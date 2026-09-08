import { outputFull, recipeOf, type Recipe } from "../buildings";
import { removeItem } from "../items";
import { atLimit } from "./limits";
import {
  BuildingState,
  Loc,
  mintId,
  findColonist,
  type Building,
  type Item,
  type Sim,
} from "../store";

/**
 * Workshop processing: one recipe, whatever the workshop. The sawmill turns a
 * log into a plank; the mason turns two rock into a block; nothing here knows
 * which is which — the table in `buildings.ts` does.
 *
 * The inputs are consumed when work *starts*, and the progress lives on the
 * building — so pulling the worker out mid-job loses nothing, it just stops.
 * Restaffing resumes exactly where it left off, which is what makes unstaffing
 * a real lever rather than a punishment.
 *
 * Nothing here is handed to another building: the output goes into the output
 * buffer, and hauling it onward is the task queue's problem (filtered storage,
 * per CONCEPT.md's Kubifaktorium model).
 */
export function stepWorkshops(sim: Sim): void {
  for (const b of sim.buildings) {
    if (b.state !== BuildingState.Active) continue;
    const recipe = recipeOf(b);
    if (recipe) stepWorkshop(sim, b, recipe);
  }
}

function stepWorkshop(sim: Sim, b: Building, recipe: Recipe): void {
  if (b.worker < 0) return;
  const worker = findColonist(sim, b.worker);
  // Work starts when the worker is *in* the building, not merely near it:
  // the walk over is not production time.
  if (!worker || worker.slot !== b.id || !worker.inside) return;

  if (b.millProgress < 0) {
    // Start a batch: only with the whole input to hand, somewhere to put the
    // result — so a finished good can never be dropped for lack of room — and
    // the colony still short of its ceiling for the good. The ceiling gates
    // *starting* only: a batch under way (`millProgress >= 0`) never reaches
    // this line and completes below whatever the count does meanwhile, so a
    // ceiling can be lowered at any moment and nothing is half-made or lost.
    if (atLimit(sim, recipe.output)) return;
    if (outputFull(sim, b)) return;
    // The whole batch is chosen before any of it is consumed: taking inputs as
    // they are found and then giving up half way would eat them for nothing.
    const batch = sim.items
      .filter((it) => it.loc === Loc.Stored && it.holder === b.id && it.type === recipe.input)
      .slice(0, recipe.per);
    if (batch.length < recipe.per) return;
    for (const input of batch) removeItem(sim, input.id);
    b.millProgress = 0;
    return;
  }

  if (++b.millProgress < recipe.ticks) return;
  const made: Item = {
    id: mintId(sim),
    type: recipe.output,
    loc: Loc.Stored,
    x: -1,
    y: -1,
    holder: b.id,
    reservedBy: -1,
  };
  sim.items.push(made);
  b.millProgress = -1;
}
