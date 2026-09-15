import { describe, expect, it } from "vitest";
import { BuildingKind, BuildingState, ItemType, Loc, TaskKind, type BuildingKindValue } from "./store";
import { createSim } from "./store";
import { advanceTick } from "./tick";
import type { Command } from "./commands";
import { hashSim } from "./hash";
import { inspect, readout } from "./know";
import { canPlace } from "./buildings";
import { canMine, canTerraform } from "./ground";
import { WallState, canPlaceWall, isBlueprint, isStoneWall } from "./walls";
import { tileIndex } from "./world/world";

const SEED = 20260901;

/**
 * The scripted run the determinism contract is pinned to: a seed, a command
 * log keyed to exact ticks, and a fixed number of ticks. Everything a session
 * changes about the labour loop shows up as a different hash here.
 */
type Store = ReturnType<typeof createSim>;

function scriptedRun(ticks: number): Store {
  const sim = createSim(SEED);
  for (let t = 0; t < ticks; t++) advanceTick(sim, script(sim));
  return sim;
}

/**
 * The full run, computed once and shared by every assertion that only *reads*
 * it. The run is by far the expensive part of this file, and it got dearer
 * again when the world gained two dozen monsters to step — a run per test was
 * affordable before and is not now. Anything that mutates its store, or that
 * needs a second independent run to compare against, still builds its own.
 */
let cached: Store | null = null;
const scripted = (): Store => (cached ??= scriptedRun(1500));

/** The pinned hash of that run. Named so the move history above can cite it. */
const GOLDEN_V11 = "e9599a0f";

/**
 * Designate a handful of trees, place a stockpile, place a sawmill, staff it.
 *
 * The log is keyed to exact ticks and every choice it makes is a pure function
 * of the store, so it is reproducible in the sense the contract needs — the
 * sawmill's id isn't hard-coded, it's whatever the identical run produced.
 */
function script(sim: Store): Command[] {
  switch (sim.tick) {
    // One command carrying sixteen tiles — the shape a drag-box produces, and
    // the reason a marquee over a whole wood stays one entry in the log.
    case 0:
      return [{ kind: "designateChop", tiles: tileList(sim, nearestTrees(sim, 16)) }];
    // A second box, overlapping the first: designation is additive, so the
    // repeats are no-ops and only the four new tiles take.
    case 60:
      return [{ kind: "designateChop", tiles: tileList(sim, nearestTrees(sim, 20)) }];
    // And one taken back by hand, so the single-tile toggle stays pinned too.
    case 90: {
      const [x, y] = nearestTrees(sim, 1)[0];
      return [{ kind: "cancelChop", x, y }];
    }
    case 5: {
      const [x, y] = nearestSite(sim, BuildingKind.Stockpile);
      return [{ kind: "place", building: BuildingKind.Stockpile, x, y }];
    }
    // A new pile accepts nothing, so the very next tick turns on the two goods
    // this colony has — while it is still a blueprint, which is where a player
    // configures one too (docs/specs/2026-09-14-stockpiles-default-off-and-clear.md).
    // **Planks are never turned on**, so the two the mill makes stay in its own
    // buffer, which is what the assertions below read.
    case 6:
      return [
        ...filterCommand(sim, "toggleFilter", ItemType.Log),
        ...filterCommand(sim, "toggleFilter", ItemType.Bread),
      ];
    case 400: {
      const [x, y] = nearestSite(sim, BuildingKind.Sawmill, sim.buildings[0]);
      return [{ kind: "place", building: BuildingKind.Sawmill, x, y }];
    }
    // The second workshop, and the reason it exists: with the mason staffed
    // too, two of five colonists are locked in slots and the pool that feeds
    // both is down to three. CONCEPT's labour trap, inside the pin.
    case 700: {
      const [x, y] = nearestSite(sim, BuildingKind.Mason, ...sim.buildings);
      return [{ kind: "place", building: BuildingKind.Mason, x, y }];
    }
    case 1000:
      return staffCommand(sim, "staff", BuildingKind.Mason);
    // Staff, pull them back out, put them back in: the slot worker's whole
    // round trip — walk over, step inside, step out to the work tile, rejoin
    // the pool, walk back in — sits inside the determinism pin.
    case 1200:
    case 1380:
      return staffCommand(sim, "staff");
    case 1300:
      return staffCommand(sim, "unstaff");
    // Production control, inside the pin: a plank ceiling of two, set before
    // the first plank exists, so the brake is what stops the mill rather than
    // the log supply. The pile refuses planks throughout — it was never told to
    // take them — so the two it makes stay in the mill's own buffer instead of
    // being hauled away. Both are asserted below rather than left as hash noise.
    case 1250:
      return [{ kind: "setLimit", type: ItemType.Plank, value: 2 }];
    // The accept flag's third value, inside the pin, on a good the pile is
    // actually holding. **Pinned is all it is** — this script has one
    // stockpile and `nearestStore` skips the item's own holder, so the clear
    // can never generate a haul and the logs sit where they are for the rest
    // of the run. The behaviour it turns on (haul-out, the nowhere-to-go
    // stall, toggling back on stopping it) needs two piles and is pinned in
    // `labour/tasks.test.ts`.
    case 1210:
      return filterCommand(sim, "clearFilter", ItemType.Log);
    // One L-shaped wall drag, as the single command a gesture produces — both
    // legs and the corner in one entry in the log, so the wall tier's
    // placement, its build-wall tasks and the enclosure recompute all sit
    // inside the determinism pin.
    //
    // Late on purpose. Build-wall outranks haul-to-input, so a wall drawn
    // early diverts every free log and the mill never cuts a plank — the
    // intended coupling (expansion competes with hauling), but it would have
    // cost this file its end-to-end plank assertion. Drawn at 1420 the wall is
    // demonstrably being worked at tick 1500 while the mill has already run.
    case 1420:
      return [{ kind: "placeWall", tiles: lDrag(sim, 6, 4), material: "timber" }];
    // The stone tier's three orders, all late for the same reason the timber
    // drag is: each one diverts the pool, and drawn earlier they would cost
    // this file its end-to-end plank assertion.
    //
    // The nearest outcrop on this seed is some fifty tiles out, so what sits
    // inside the pin here is the designation and the walk toward it — the
    // whole rock → block → wall chain running to completion is pinned in
    // `stone.test.ts`, on ground built for it.
    case 1440:
      return [{ kind: "designateMine", tiles: tileList(sim, nearestRock(sim, 3)) }];
    // Level a flat 3×3 *up* one block: nothing near the spawn clearing is
    // bumpy (generation keeps it flat), so the interesting case to pin is the
    // one the player can always ask for anywhere.
    case 1450: {
      const area = levelArea(sim, 3);
      return area.length ? [{ kind: "designateTerraform", tiles: tileList(sim, area), target: 5 }] : [];
    }
    case 1460:
      return [{ kind: "placeWall", tiles: lDrag(sim, 3, 3), material: "stone" }];
    default:
      return [];
  }
}

/** The nearest quarriable outcrops, by growing rings, so the pick is a pure
 *  function of the store. */
function nearestRock(sim: Store, count: number): [number, number][] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const out: [number, number][] = [];
  for (let r = 1; r < size && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (canMine(sim, centre + dx, centre + dy)) out.push([centre + dx, centre + dy]);
      }
    }
  }
  return out;
}

/** The nearest `n`×`n` block of levellable ground, clear of the colony. */
function levelArea(sim: Store, n: number): [number, number][] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const block = (x0: number, y0: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([x0 + dx, y0 + dy]);
    return out;
  };
  for (let r = 6; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const area = block(centre + dx, centre + dy);
        if (area.every(([x, y]) => canTerraform(sim, x, y))) return area;
      }
    }
  }
  return [];
}

/**
 * The tiles of an L with a `west`-long first leg and a `south`-long second,
 * anchored at the nearest spot where the whole shape takes a wall.
 *
 * Built by hand rather than by calling `wallRun`: that lives in `render/`, and
 * `src/sim/` may not import its consumers. Which is fine — the shape a command
 * carries is a plain tile list, and writing it out is what the UI hands over
 * anyway. `pick.test.ts` is what pins the gesture geometry itself.
 */
function lDrag(sim: Store, legX: number, legY: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const tiles = (x0: number, y0: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < legX; i++) out.push([x0 + i, y0]);
    for (let i = 1; i < legY; i++) out.push([x0 + legX - 1, y0 + i]);
    return out;
  };
  for (let r = 3; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const shape = tiles(centre + dx, centre + dy);
        if (shape.every(([x, y]) => canPlaceWall(sim, x, y))) {
          return tileList(sim, shape);
        }
      }
    }
  }
  return [];
}

const tileList = (sim: Store, tiles: [number, number][]): number[] =>
  tiles.map(([x, y]) => tileIndex(x, y, sim.world.size));

/** A filter command aimed at whatever stockpile this run has built. */
function filterCommand(sim: Store, kind: "toggleFilter" | "clearFilter", type: number): Command[] {
  const pile = sim.buildings.find((b) => b.kind === BuildingKind.Stockpile);
  return pile ? [{ kind, building: pile.id, type }] : [];
}

function staffCommand(
  sim: Store,
  kind: "staff" | "unstaff",
  of: number = BuildingKind.Sawmill,
): Command[] {
  const shop = sim.buildings.find((b) => b.kind === of);
  return shop ? [{ kind, building: shop.id }] : [];
}

function nearestTrees(sim: Store, count: number): [number, number][] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const out: [number, number][] = [];
  for (let r = 1; r < size && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = centre + dx;
        const y = centre + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (sim.world.treeMap[tileIndex(x, y, size)]) out.push([x, y]);
      }
    }
  }
  return out;
}

function nearestSite(
  sim: Store,
  kind: BuildingKindValue,
  ...avoid: { x: number; y: number }[]
): [number, number] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  for (let r = 2; r < size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = centre + dx;
        const y = centre + dy;
        if (avoid.some((a) => Math.abs(x - a.x) < 4 && Math.abs(y - a.y) < 4)) continue;
        if (canPlace(sim, kind, x, y)) return [x, y];
      }
    }
  }
  throw new Error("no placeable site");
}

describe("determinism", () => {
  it("replays a scripted command log to a byte-identical store", () => {
    expect(hashSim(scripted())).toBe(hashSim(scriptedRun(1500)));
  });

  it("holds the golden hash", () => {
    // A hash change is a behaviour change: if this fails, say in the changelog
    // what about the labour loop moved and why.
    //
    // 93cf902e → aca92821 when slot workers gained `inside` and stepped into
    // their workshop (docs/changelog/2026-09-01-slot-workers-step-inside.md):
    // a new store field, the pinned position, and an unstaff/restaff round
    // trip added to the script above.
    //
    // aca92821 → fbe20cb9 when `designateChop` began carrying a tile list
    // (docs/changelog/2026-09-01-drag-box-designation.md): the script above
    // gained a second, overlapping box and a hand cancel, and designating now
    // bumps the tile's chunk version, which the hash covers.
    //
    // fbe20cb9 → 9783cd77 for shape, not behaviour: the store gained
    // `wallMap`, `razeMap`, `insideMap` and `enclosureDirty`
    // (docs/changelog/2026-09-02-palisade-walls.md). That run placed no walls,
    // so all four were as `createSim` left them and nothing about the labour
    // loop moved — every observable the other tests in this file assert was
    // unchanged, which is what said the hash moved for shape.
    //
    // 9783cd77 → c0441655 when the script gained an L-shaped `placeWall` at
    // tick 1420 (docs/changelog/2026-09-02-wall-l-drags.md). A behaviour
    // change this time, and deliberate: the colony now draws and works a wall
    // inside the pin. The drag is late precisely so the mill still gets its
    // logs — build-wall outranks haul-to-input, so an early wall would have
    // starved the plank assertion below.
    //
    // c0441655 → 11a997a8 when `walk` began re-checking the next tile's
    // passability and re-planning a stale route. A behaviour change, and a bug
    // fix: routes are planned once and blueprints are walkable, so a segment
    // finishing across a walker's path had them stroll straight through
    // standing palisade. That this hash moved at all is the evidence — the
    // scripted L at tick 1420 was being walked through.
    //
    // 11a997a8 → 430213d1 with the stone tier
    // (docs/changelog/2026-09-02-stone-and-terraform.md). Both a shape change
    // (`mineMap`, `terraformMap`, two accept flags per building) and a
    // behaviour one, deliberately: the script now places and staffs a mason,
    // marks outcrops for quarrying, draws a stone L and levels a 3×3. The
    // assertions below are what say the number moved for those and not for
    // something quiet — most of all the plank assertion, which still passes
    // with *two* workshops staffed and three colonists left in the pool.
    //
    // 430213d1 → 8aabfdb3 with the threat tier
    // (docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md). A shape
    // change: the store gained `monsters`, `wallDamageMap` and `graveMap`, and
    // this seed's nearest den is forty-odd tiles from the colony, so nothing in
    // the run below ever meets one — every behavioural assertion in this file
    // is unchanged and still passes, which is what says so. The tier's own
    // determinism pin is `threats/encounter.test.ts`, on a seed picked for
    // having a lair close enough to matter.
    //
    // 8aabfdb3 → 7cd7340f with housing
    // (docs/changelog/2026-09-07-housing-and-wanderers.md). A shape change and
    // nothing more: the store gained `wandererTimer` and every colonist gained
    // `dest`. This run builds no House, so the arrival clock never starts —
    // `stepSettlers` returns at its cap check on every one of these 1500 ticks,
    // draws nothing from the PRNG and writes nothing — and every behavioural
    // assertion in this file is unchanged and still passes, which is what says
    // so. The arrival loop's own pin is `settlers.test.ts`, on two seeds picked
    // for what happens to the wanderer on the way in.
    //
    // 7cd7340f → 50083138 when the patience clock stopped riding on `work` and
    // became `Colonist.patience` (SAVE_VERSION 6). Shape again, and for the
    // same reason: no House, no wanderer, nobody's clock ever moves off 0.
    //
    // 50083138 → ade08d30 with production control
    // (docs/changelog/2026-09-07-production-limits-and-filters.md). Shape —
    // the store gained `limits` (SAVE_VERSION 7) — **and behaviour, on
    // purpose**: the script now sets a plank ceiling of two at 1250 and turns
    // the stockpile's plank filter off at 1260, so the mill stops at two planks
    // with a log parked in its buffer and both planks sit in its own output
    // buffer. The plank assertion below moved from "more than none" to
    // "exactly the ceiling", which is what says the number moved for the brake.
    //
    // ade08d30 → GOLDEN_V8 with the bread economy (SAVE_VERSION 8,
    // docs/changelog/2026-09-08-bread-economy.md). Shape — two fields on every
    // colonist and three more `limits` slots — **and behaviour, on purpose**:
    // this colony now opens with fifteen loaves in its clearing and everybody
    // breaks off to eat once a game-day, which is the meal loop inside the pin
    // without a farm anywhere in the script. The chain itself is pinned on its
    // own seed (`economy/bread.test.ts`), for the reason the stone tier's is:
    // the Oven costs blocks, and this seed's nearest outcrop is fifty tiles
    // out. Every behavioural assertion in this file is unchanged and still
    // passes — the plank ceiling still holds the mill at exactly two — which is
    // what says the number moved for the meals and not for something quiet.
    //
    // ade08d30's successor → GOLDEN_V10 with the sheep chain (SAVE_VERSION 10,
    // docs/changelog/2026-09-11-sheep-and-clothes.md). **Shape and nothing
    // else**, and that was proved rather than argued: with the two new colonist
    // fields and the four new `limits` slots stripped back out, this run hashes
    // to the old `04f53ac6` exactly. Nothing behavioural could have moved —
    // this script builds no Tailor, so no garment exists, so `workTicks`
    // returns what the old boolean gate returned on every tick of the run.
    //
    // GOLDEN_V10 → 3216d1b3 when a new stockpile stopped accepting anything
    // (docs/changelog/2026-09-14-stockpile-default-and-clearing.md). **No shape change
    // at all** — the store is byte-identical in layout — and entirely
    // behavioural, which is the reverse of the last two moves. The script now
    // turns logs and bread on the tick after placing the pile and never turns
    // planks on, so what this run stores is what it was told to store; and it
    // presses `clear` on logs at 1210, over nine of them, so the flag's third
    // value sits inside the pin. Every behavioural assertion below is
    // unchanged and still passes — the ceiling still holds the mill at exactly
    // two, both planks still in its own buffer — which is what says the number
    // moved for the default and not for something quiet.
    //
    // 3216d1b3 → GOLDEN_V11 with the drink chain (SAVE_VERSION 11, and the
    // first move where the constant's name and the save version agree again;
    // docs/changelog/2026-09-14-hives-and-mead.md). **Shape only**, proved
    // rather than argued: strip the two new `Building` accept flags and the two
    // new `limits` slots back out and this run hashes to 3216d1b3 exactly. It
    // could not be otherwise — this script builds no Hive, Flowers or Meadery,
    // so no mead exists, `cellarSet` is false on every tick and the wanderer
    // countdown decrements by one as it always did, `batchTicks` answers
    // `recipe.ticks` for every kind here, and `drinkCup` finds nothing.
    expect(hashSim(scripted())).toBe(GOLDEN_V11);
  });

  it("survives structuredClone unchanged — the shape persistence will freeze", () => {
    const sim = scriptedRun(600);
    const copy = structuredClone(sim);
    expect(hashSim(copy)).toBe(hashSim(sim));
    // And keeps running identically from the copy.
    advanceTick(sim);
    advanceTick(copy);
    expect(hashSim(copy)).toBe(hashSim(sim));
  });

  it("never reaches for unseeded randomness", () => {
    // The lint rule catches a literal `Math.random` written in sim/; this
    // catches one reached indirectly, through a helper or a dependency. Same
    // guarantee, from the other side — which is why this file gets the one
    // sanctioned exemption from the rule it is enforcing.
    /* eslint-disable no-restricted-properties */
    const original = Math.random;
    try {
      Math.random = () => {
        throw new Error("sim reached for Math.random");
      };
      expect(hashSim(scriptedRun(300))).toBe(hashSim(scriptedRun(300)));
    } finally {
      Math.random = original;
    }
    /* eslint-enable no-restricted-properties */
  });
});

describe("the labour loop", () => {
  it("runs designate → chop → haul → build → mill → plank end to end", () => {
    const sim = scripted();
    const r = readout(sim);

    const stockpile = sim.buildings.find((b) => b.kind === BuildingKind.Stockpile);
    const sawmill = sim.buildings.find((b) => b.kind === BuildingKind.Sawmill);
    expect(stockpile?.state).toBe(BuildingState.Active);
    expect(sawmill?.state).toBe(BuildingState.Active);

    // Trees were felled into logs, and logs became planks — exactly as many as
    // the ceiling set at 1250 allows, and no more, with the mill standing at
    // its limit rather than out of logs. The brake, as a number.
    expect(r.goods[ItemType.Log]).toBeGreaterThan(0);
    expect(r.goods[ItemType.Plank]).toBe(2);
    expect(sim.limits[ItemType.Plank]).toBe(2);
    expect(inspect(sim, sawmill!.id)?.stall).toBe("at-limit");
    // And the filter routed: the stockpile was never told to take planks, so
    // both sit in the mill's own output buffer while its logs still came from
    // that same pile.
    expect(stockpile?.acceptPlank).toBe(0);
    expect(sim.items.filter((it) => it.type === ItemType.Plank).every((it) => it.holder === sawmill?.id)).toBe(true);

    // The clear pressed at 1210, over nine stored logs, is **still standing**
    // three hundred ticks later — the mill and the wall drained the pile
    // through `sourceForSite` as they always could, and a pile that now holds
    // none of the good does not revert its own flag.
    expect(stockpile?.acceptLog).toBe(2);
    expect(sim.items.filter((it) => it.type === ItemType.Log && it.holder === stockpile?.id)).toHaveLength(0);

    // Both workshops are staffed, so the pool that feeds both is two pairs of
    // hands short — the labour trap, as a number.
    const mason = sim.buildings.find((b) => b.kind === BuildingKind.Mason);
    expect(sawmill?.worker).toBeGreaterThanOrEqual(0);
    expect(mason?.state).toBe(BuildingState.Active);
    expect(mason?.worker).toBeGreaterThanOrEqual(0);
    expect(r.pool).toBe(r.folk - 2);
    expect(r.slots).toBe(2);

    // Goods ended up in storage rather than scattered on the ground.
    const stored = sim.items.filter((it) => it.loc === Loc.Stored && it.holder === stockpile?.id);
    expect(stored.length).toBeGreaterThan(0);
  });

  it("takes an L-shaped wall drag as one command and puts folk on it", () => {
    // The new command's own observable, so it is not merely hash noise: nine
    // tiles from one gesture — a six-long leg, a corner, and three more — and
    // the colony working them 80 ticks later.
    const sim = scripted();
    const size = sim.world.size;
    const placed: [number, number][] = [];
    for (let i = 0; i < sim.wallMap.length; i++) {
      // Timber only: the stone L drawn at 1460 is its own shape, counted below.
      if (sim.wallMap[i] !== WallState.None && !isStoneWall(sim.wallMap[i])) {
        placed.push([i % size, Math.floor(i / size)]);
      }
    }
    expect(placed).toHaveLength(9);

    // And it really is an L: one row holds six of them, one column the rest.
    const rows = new Map<number, number>();
    const cols = new Map<number, number>();
    for (const [x, y] of placed) {
      rows.set(y, (rows.get(y) ?? 0) + 1);
      cols.set(x, (cols.get(x) ?? 0) + 1);
    }
    expect(Math.max(...rows.values())).toBe(6);
    expect(Math.max(...cols.values())).toBe(4);

    // Being worked: either segments already standing or builders on their way.
    const standing = placed.filter(([x, y]) => sim.wallMap[y * size + x] === WallState.Palisade).length;
    const walling = sim.tasks.filter((t) => t.kind === TaskKind.BuildWall).length;
    expect(standing + walling).toBeGreaterThan(0);
  });

  it("takes the stone tier's three orders as three gestures", () => {
    // The new commands' own observables, so the hash move is not merely noise.
    // One `scriptedRun` for all three, because the run is the expensive part
    // of this file and every test in it pays for another.
    const sim = scripted();

    // Stone, and told apart from timber by state rather than by tile: the
    // material rides on the command, so nothing in the wall layer is
    // generically "wall" any more.
    const stone = [...sim.wallMap].filter((v) => isStoneWall(v));
    expect(stone).toHaveLength(5);
    // Drawn 40 ticks before the end with no block in the colony yet, so they
    // are still blueprints — and that *is* the tier's coupling: a stone line
    // waits on the mason, which waits on the quarry.
    expect(stone.every((v) => isBlueprint(v))).toBe(true);
    expect(sim.items.some((it) => it.type === ItemType.Block)).toBe(false);

    // Three outcrops marked, three quarry tasks — fifty tiles out, so what is
    // pinned here is the order and the walk, not the yield.
    expect([...sim.mineMap].filter((v) => v)).toHaveLength(3);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Mine)).toHaveLength(3);

    // Nine tiles designated to height 5, stored as target-plus-one, with a
    // task each: the marquee's whole area from one command.
    const marks = [...sim.terraformMap].filter((v) => v);
    expect(marks).toHaveLength(9);
    expect(marks.every((v) => v === 6)).toBe(true);
    expect(sim.tasks.filter((t) => t.kind === TaskKind.Terraform)).toHaveLength(9);
  });

  it("leaves no orphaned reservations when the queue drains", () => {
    const sim = scripted();
    for (const item of sim.items) {
      if (item.reservedBy < 0) continue;
      expect(sim.tasks.some((t) => t.id === item.reservedBy)).toBe(true);
    }
    for (const b of sim.buildings) {
      const incoming = sim.tasks.filter((t) => t.building === b.id && t.kind !== TaskKind.Build).length;
      expect(b.reservedIncoming).toBe(incoming);
    }
  });

  it("never sends two haulers for the same log", () => {
    const sim = createSim(SEED);
    for (let t = 0; t < 1500; t++) {
      advanceTick(sim, script(sim));
      const targeted = sim.tasks.filter((x) => x.item >= 0).map((x) => x.item);
      expect(new Set(targeted).size).toBe(targeted.length);
      const carried = sim.colonists.filter((c) => c.carrying >= 0).map((c) => c.carrying);
      expect(new Set(carried).size).toBe(carried.length);
    }
  });

  it("keeps every item somewhere legal", () => {
    const sim = scripted();
    for (const item of sim.items) {
      if (item.loc === Loc.Ground) {
        expect(item.holder).toBe(-1);
        expect(item.x).toBeGreaterThanOrEqual(0);
      } else if (item.loc === Loc.Carried) {
        expect(sim.colonists.some((c) => c.id === item.holder && c.carrying === item.id)).toBe(true);
      } else {
        expect(sim.buildings.some((b) => b.id === item.holder)).toBe(true);
      }
    }
  });

  it("only ever turns logs into planks inside a staffed mill", () => {
    const sim = scripted();
    const planks = sim.items.filter((it) => it.type === ItemType.Plank);
    expect(planks.length).toBeGreaterThan(0);
    // Nothing produced planks before the mill was staffed at tick 1200.
    const early = createSim(SEED);
    for (let t = 0; t < 1200; t++) advanceTick(early, script(early));
    expect(early.items.some((it) => it.type === ItemType.Plank)).toBe(false);
  });
});

