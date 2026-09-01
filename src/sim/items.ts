import { occupancy, passable, type Occupancy } from "./path";
import { Loc, mintId, type Item, type Sim } from "./store";

/** Items on a given ground tile, in id order. */
export function groundItemsAt(sim: Sim, x: number, y: number): Item[] {
  return sim.items.filter((it) => it.loc === Loc.Ground && it.x === x && it.y === y);
}

export function countItems(sim: Sim, type: number): number {
  let n = 0;
  for (const it of sim.items) if (it.type === type) n++;
  return n;
}

/**
 * The nearest tile at or around (x, y) an item may be put down on. Ground
 * items never sit under a building or in water, so a drop next to a footprint
 * has to look outward; the spiral is ordered so the choice is deterministic.
 */
export function dropTile(sim: Sim, occ: Occupancy, x: number, y: number): [number, number] | null {
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (passable(sim.world, occ, x + dx, y + dy)) return [x + dx, y + dy];
      }
    }
  }
  return null;
}

/** Put a new item on the ground, as close to (x, y) as there is room for. */
export function spawnItem(sim: Sim, type: number, x: number, y: number, occ?: Occupancy): Item | null {
  const where = dropTile(sim, occ ?? occupancy(sim), x, y);
  if (!where) return null;
  const item: Item = {
    id: mintId(sim),
    type,
    loc: Loc.Ground,
    x: where[0],
    y: where[1],
    holder: -1,
    reservedBy: -1,
  };
  sim.items.push(item);
  return item;
}

/** Move an item into a building's store (a buffer, a pile, or delivered stock). */
export function storeItem(item: Item, buildingId: number): void {
  item.loc = Loc.Stored;
  item.holder = buildingId;
  item.x = -1;
  item.y = -1;
}

export function carryItem(item: Item, colonistId: number): void {
  item.loc = Loc.Carried;
  item.holder = colonistId;
  item.x = -1;
  item.y = -1;
}

/** Put a held or stored item down on the ground at the nearest free tile. */
export function groundItem(sim: Sim, occ: Occupancy, item: Item, x: number, y: number): void {
  const where = dropTile(sim, occ, x, y);
  item.loc = Loc.Ground;
  item.holder = -1;
  item.x = where ? where[0] : x;
  item.y = where ? where[1] : y;
}

export function removeItem(sim: Sim, id: number): void {
  const i = sim.items.findIndex((it) => it.id === id);
  if (i >= 0) sim.items.splice(i, 1);
}

/** The tile an item currently occupies, for distance and pathing purposes. */
export function itemTile(sim: Sim, item: Item): [number, number] | null {
  if (item.loc === Loc.Ground) return [item.x, item.y];
  if (item.loc === Loc.Stored) {
    for (const b of sim.buildings) if (b.id === item.holder) return [b.x, b.y];
    return null;
  }
  for (const c of sim.colonists) {
    if (c.id === item.holder) return [Math.floor(c.x), Math.floor(c.y)];
  }
  return null;
}

/** True while nothing has claimed this item for a task. */
export function isFree(item: Item): boolean {
  return item.reservedBy < 0;
}
