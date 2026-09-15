import { footprintGap, outputFull, recipeOf, type Recipe } from "../buildings";
import { removeItem } from "../items";
import { workTicks } from "../labour/hunger";
import { atLimit } from "./limits";
import {
  BuildingKind,
  BuildingState,
  Loc,
  mintId,
  findColonist,
  type Building,
  type Item,
  type Sim,
} from "../store";
import { HIVE_FIELDS_MAX, HIVE_REACH, HIVE_TICKS_BY_FIELDS } from "../tuning";

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

  // The cadence is keyed off its slot worker: a workshop runs on somebody's
  // hours, so the food chain's own workers are not immune to the food chain
  // being empty (docs/specs/2026-09-08-bread-economy.md) and a dressed weaver
  // weaves faster than a ragged one
  // (docs/specs/2026-09-10-sheep-and-clothes.md).
  const paid = workTicks(sim, worker);
  if (paid === 0) return;
  b.millProgress += paid;
  // Read **every tick**, not fixed when the batch started: a field that
  // finishes mid-batch speeds the batch under way. Safe in that direction only,
  // and it is the only direction available — buildings are never razed, so the
  // count can only rise and no batch is ever lengthened after it starts.
  if (b.millProgress < batchTicks(sim, b, recipe)) return;
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

/**
 * How long one batch of this recipe takes, here.
 *
 * `recipe.ticks` for every kind but the Hive, whose rate is **a fact about
 * where it stands**: the table in `tuning.ts` indexed by the flower fields in
 * its reach (docs/specs/2026-09-14-hives-and-mead.md). Nothing is stored on the
 * hive and nothing is scaled at runtime — a count and a lookup.
 */
export function batchTicks(sim: Sim, b: Building, recipe: Recipe): number {
  if (b.kind !== BuildingKind.Hive) return recipe.ticks;
  return HIVE_TICKS_BY_FIELDS[fieldsInReach(sim, b)];
}

/**
 * Active Flowers whose plot lies within `HIVE_REACH` of this hive's plot,
 * capped at `HIVE_FIELDS_MAX`.
 *
 * Derived per read, exactly as `populationCap` sums beds: nothing on the hive
 * records its fields, so a field built later needs no notification and a field
 * is never double-counted. **Footprint to footprint** — the gap between two
 * rectangles, which is the same rectangle the placement overlay draws, rather
 * than origin to origin, which is exact only for 1×1 plots.
 *
 * Exported for the Hive panel's `Fields in reach` row, which must read the very
 * number the batch length reads.
 */
export function fieldsInReach(sim: Sim, hive: Building): number {
  let n = 0;
  for (const b of sim.buildings) {
    if (b.kind !== BuildingKind.Flowers || b.state !== BuildingState.Active) continue;
    if (footprintGap(hive, b) > HIVE_REACH) continue;
    n++;
    if (n === HIVE_FIELDS_MAX) break;
  }
  return n;
}
