import { ItemType, type Building, type ItemTypeValue } from "./store";

/**
 * What each kind of good is called and how storage treats it — the item half of
 * the content tables (`BUILDING_DEFS` is the other), and the reason nothing in
 * the colony special-cases logs or planks by name any more.
 *
 * Step 2 shipped two goods and hard-coded both into the stockpile filter, the
 * hauling predicates, the ribbon and the inspector. Rock and block would have
 * meant a fourth copy of each. So the shape is a table: a good is a name plus
 * the stockpile flag it reads, and every consumer walks `GOOD_LIST`.
 *
 * `accept` names a field of `Building` because those flags are *store* state a
 * save freezes — they cannot become a keyed object without a migration for
 * every future good. Adding a good therefore means: append to `ItemType`, add
 * its `accept` field to `Building`, add a row here, and write the migration
 * rung that stamps the flag on to buildings already saved. Miss the last step
 * and every stockpile in every old colony refuses the new good forever.
 */
export interface GoodDef {
  readonly type: ItemTypeValue;
  /** Title case, for panel rows and chain chips. */
  readonly name: string;
  /** Lower case, for the ribbon's faint caps label. */
  readonly label: string;
  readonly accept: "acceptLog" | "acceptPlank" | "acceptRock" | "acceptBlock";
}

export const GOODS: Record<ItemTypeValue, GoodDef> = {
  [ItemType.Log]: { type: ItemType.Log, name: "Log", label: "logs", accept: "acceptLog" },
  [ItemType.Plank]: { type: ItemType.Plank, name: "Plank", label: "planks", accept: "acceptPlank" },
  [ItemType.Rock]: { type: ItemType.Rock, name: "Rock", label: "rock", accept: "acceptRock" },
  [ItemType.Block]: { type: ItemType.Block, name: "Block", label: "blocks", accept: "acceptBlock" },
};

/** Every good, in `ItemType` order — which is the order every readout uses. */
export const GOOD_LIST: readonly GoodDef[] = Object.values(ItemType).map((t) => GOODS[t]);

export function goodOf(type: number): GoodDef | null {
  return GOODS[type as ItemTypeValue] ?? null;
}

/** Does this stockpile take that good? Unknown goods are refused, not stored. */
export function stockpileAccepts(b: Building, type: number): boolean {
  const def = goodOf(type);
  return def !== null && b[def.accept] === 1;
}
