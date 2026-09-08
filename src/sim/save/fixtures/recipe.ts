import type { Command } from "../../commands";
import { canPlace } from "../../buildings";
import { canMine, canTerraform } from "../../ground";
import { canPlaceWall } from "../../walls";
import { tileIndex } from "../../world/world";
import { createSim, type Sim } from "../../store";
import { advanceTick } from "../../tick";

/**
 * How each committed `.castles` fixture was made.
 *
 * The recipes live here rather than inside `fixture.test.ts` because two
 * things need them and must not drift apart: the one-off generator that wrote
 * each file, and the shape test that re-runs the same recipe against the
 * *current* build to see whether the store has grown a field since. A fixture
 * whose recipe nobody kept is a fixture nobody can re-derive.
 *
 * The recipes themselves are frozen for the same reason the files are: editing
 * one silently changes what the shape test compares against.
 */

export const FIXTURE_SEED = 20260901;

/** v1: twelve trees marked, a stockpile placed. 400 ticks. */
export const V1_TICKS = 400;

export function v1Script(sim: Sim): Command[] {
  if (sim.tick === 0) return [{ kind: "designateChop", tiles: nearestTrees(sim, 12) }];
  if (sim.tick === 5) return [{ kind: "place", building: 0, x: 128, y: 128 }];
  return [];
}

/**
 * v2: the same opening, then a closed 3×3 ring — seven palisade segments and
 * one gate — so the file carries a genuinely enclosed tile rather than an
 * all-zero `insideMap`; then, right at the end, a fresh run and a dismantle
 * mark, so it also carries blueprints, live build-wall tasks with their logs
 * reserved, and a raze designation nobody has got to yet.
 *
 * The late commands are timed to *not* resolve: the run is drawn ten ticks
 * from the end and the raze mark five, which is what leaves work in flight in
 * the file. And the raze mark lands on a ring segment, which is safe precisely
 * because nobody finishes tearing it down — the ring is still closed at the
 * tick the save was taken.
 *
 * Every site is derived from the store, never hard-coded — but derived from
 * the **wall layer** once walls exist, not by re-searching for placeable
 * ground: `canPlaceWall` refuses a tile that already holds a wall, so a second
 * search would silently wander off to somewhere else on the map.
 */
export const V2_TICKS = 1000;

export function v2Script(sim: Sim): Command[] {
  if (sim.tick === 0) return [{ kind: "designateChop", tiles: nearestTrees(sim, 40) }];
  if (sim.tick === 5) return [{ kind: "place", building: 0, x: 128, y: 128 }];
  if (sim.tick === 200) {
    const ring = ringSite(sim);
    if (!ring.length) return [];
    // One tile of the ring is the gate. A ring with a gate still encloses —
    // pathing walks through it, the flood-fill does not.
    return [
      { kind: "placeWall", tiles: ring.slice(1), material: "timber" },
      { kind: "placeGate", tiles: [ring[0]], material: "timber" },
    ];
  }
  if (sim.tick === 990) {
    const run = wallSite(sim, 5);
    return run.length ? [{ kind: "placeWall", tiles: run, material: "timber" }] : [];
  }
  if (sim.tick === 995) {
    const built = sim.wallMap.indexOf(2 /* WallState.Palisade */);
    return built >= 0 ? [{ kind: "designateRaze", tiles: [built] }] : [];
  }
  return [];
}

/**
 * v3: the stone tier, on **its own seed**. 20260904 puts woods ten tiles from
 * the map centre and a quarriable outcrop fourteen, where the default fixture
 * seed's nearest rock is nearly fifty tiles out — far enough that a
 * command-only recipe would spend thousands of ticks walking before a single
 * block existed. A fixture's job is to carry the format's state, not to
 * reproduce a particular map, so the near seed is the right one and the older
 * fixtures keep theirs untouched.
 *
 * What it carries: a staffed mason with rock in its buffer, blocks in the
 * colony, a stone line (drawn, and built where a block reached it), quarry
 * designations part-worked, a levelling area mid-job, plus the timber walls and
 * live tasks v2 already proved.
 */
export const FIXTURE_SEED_V3 = 20260904;
export const V3_TICKS = 1400;

export function v3Script(sim: Sim): Command[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 40) }];
    case 5:
      return [{ kind: "place", building: 0, x: centre - 6, y: centre + 4 }];
    case 200: {
      const site = buildSite(sim, 1);
      return site ? [{ kind: "place", building: 1, x: site[0], y: site[1] }] : [];
    }
    case 320: {
      const site = buildSite(sim, 2);
      return site ? [{ kind: "place", building: 2, x: site[0], y: site[1] }] : [];
    }
    // Staff the mason and set it quarrying: the fixture's whole point is a
    // rock→block chain caught mid-flow.
    case 700:
      return staff(sim, 2);
    case 720:
      return [{ kind: "designateMine", tiles: rockSite(sim, 2) }];
    // A stone line, and a levelling area beside it.
    case 1200: {
      const run = wallSite(sim, 3);
      return run.length ? [{ kind: "placeWall", tiles: run, material: "stone" }] : [];
    }
    case 1210: {
      const area = levelSite(sim, 2);
      return area.length ? [{ kind: "designateTerraform", tiles: area, target: 5 }] : [];
    }
    // Two more marks right at the end, so the file carries a live quarry
    // designation and a dismantle order as well as the finished work.
    case 1390:
      return [{ kind: "designateMine", tiles: rockSite(sim, 1) }];
    case 1395: {
      const built = sim.wallMap.findIndex((v) => v === 2 /* WallState.Palisade */ || v === 6 /* Stone */);
      return built >= 0 ? [{ kind: "designateRaze", tiles: [built] }] : [];
    }
    default:
      return [];
  }
}

/**
 * v4: the threat tier, on a seed whose nearest den sits fourteen tiles from the
 * colony — the same seed `threats/encounter.test.ts` picks, and for the same
 * reason: the default fixture seed's wilds are forty tiles out and would never
 * touch the colony inside a fixture's lifetime.
 *
 * What it carries: two dozen monsters mid-rhythm with their routes and phase
 * clocks in flight, and a standing palisade still carrying its **bite damage**
 * with a live repair task queued against it — plus the walls, items, tasks and
 * reservations the older fixtures prove.
 *
 * Caught at 1100, in the gap between the first prowl walking home and the
 * repairer finishing, rather than later: no tick on this seed holds damage, a
 * repair task *and* a grave at once, because the damage is mended before the
 * prowl that kills anybody arrives. The damage layer and a live `Repair` task
 * are the states nothing else in the format exercises, so they win the tie;
 * `graveMap` rides along as zeros, which the codec treats exactly as it treats
 * the eight layers beside it, and graves themselves are pinned in
 * `threats/flee.test.ts` and the encounter run.
 */
export const FIXTURE_SEED_V4 = 20260981;
export const V4_TICKS = 1100;

export function v4Script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 24) }];
    case 5:
      return [{ kind: "place", building: 0, x: 126, y: 126 }];
    // Standing before the den's first full prowl, so it is bitten rather than
    // eaten as sticks — which is the whole of what this fixture is for.
    case 400:
      return [{ kind: "placeWall", tiles: denRun(sim, 0), material: "timber" }];
    default:
      return [];
  }
}

/**
 * v5: housing, on the seed `settlers.test.ts` uses for its settling run —
 * 20260908, whose colony gets a House standing inside a thousand ticks and
 * whose wanderer walks in from the west coast without being eaten on the way.
 *
 * What it carries: a **wanderer in transit** — a colonist with `dest` set, a
 * hundred-tile route in flight and the arrival clock parked at -1 behind them —
 * plus a finished House built out of planks and the sawmill that cut them. Those
 * are the states the format has never held: every other fixture's colonists are
 * settled and every other fixture's buildings cost logs.
 *
 * Caught at 1600, in the gap between the spawn on the beach and the settle:
 * before it the House is a blueprint and there is nobody walking, after it the
 * wanderer is an ordinary colonist and `dest` is -1 again. A fixture that landed
 * either side of that window would carry nothing this rung is about.
 */
export const FIXTURE_SEED_V5 = 20260908;
export const V5_TICKS = 1600;

export function v5Script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 40) }];
    case 5: {
      const site = buildSite(sim, 0);
      return site ? [{ kind: "place", building: 0, x: site[0], y: site[1] }] : [];
    }
    case 200: {
      const site = buildSite(sim, 1);
      return site ? [{ kind: "place", building: 1, x: site[0], y: site[1] }] : [];
    }
    // Staff the mill: the House is the first thing in the game built from
    // planks, so the chain has to be running before the site is placed.
    case 600:
      return staff(sim, 1);
    case 900: {
      const site = buildSite(sim, 3);
      return site ? [{ kind: "place", building: 3, x: site[0], y: site[1] }] : [];
    }
    default:
      return [];
  }
}

/**
 * v6: the patience un-pun (`Colonist.patience`), and **the same colony as v5
 * carried further on** — same seed, same commands, a later tick. No new script,
 * because what v6 needs from the world is not a new situation but a *later* one:
 * by 2900 the first wanderer has arrived and joined the pool, and the second is
 * out on the road behind them.
 *
 * So the file holds what v5's could not: all three ways an attempt can end, at
 * once. A colonist who **came by sea and settled**, indistinguishable in the
 * store from one the colony started with; the **grave** of the one after them,
 * caught in the wilds; and a third **mid-walk**, route in flight with a
 * non-zero `step` — the state a save could most plausibly lose.
 *
 * `patience` rides along at 0 on every colonist, and that is a real gap in what
 * this file vouches for — no tick of this recipe has anybody stuck, because
 * nothing on this seed blocks the walk. A *running* clock surviving a save is
 * pinned by `settlers.test.ts` instead, which seals a wanderer out and encodes
 * them mid-wait. The same trade `v4.castles` made with its empty `graveMap`.
 */
export const FIXTURE_SEED_V6 = FIXTURE_SEED_V5;
export const V6_TICKS = 3400;

export function v6Script(sim: Sim): Command[] {
  // One late order, twenty ticks from the end and far too late to resolve, so
  // the file carries live tasks as well as live people. By 3400 the colony has
  // felled everything it was given and gone idle, and a fixture with an empty
  // task list cannot vouch for the shape of a `Task` at all — which the shape
  // test says out loud by refusing to compare an empty kind.
  if (sim.tick === 3380) return [{ kind: "designateChop", tiles: nearestTrees(sim, 6) }];
  return v5Script(sim);
}

/**
 * v7: production control, back on the default fixture seed — the plank chain
 * needs only woods, and 20260901's are two tiles from the centre.
 *
 * What it carries, and what no earlier file could: a **non-default ceiling**
 * (`limits[Plank]` at 2, the other three still `-1`), a **stockpile with one
 * filter off** (rock refused, everything else taken — the accept fields have
 * been in every save since v3, but never at anything but 1), and the state the
 * two produce together: a staffed sawmill standing at its ceiling with a log
 * parked in its input buffer, and exactly two planks in the colony, both in
 * the pile. Caught at 1000, comfortably after the mill has hit the ceiling and
 * long before anything spends a plank.
 */
export const V7_TICKS = 1000;

export function v7Script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 30) }];
    case 5: {
      const site = buildSite(sim, 0);
      return site ? [{ kind: "place", building: 0, x: site[0], y: site[1] }] : [];
    }
    case 200: {
      const site = buildSite(sim, 1);
      return site ? [{ kind: "place", building: 1, x: site[0], y: site[1] }] : [];
    }
    case 600:
      return staff(sim, 1);
    // The ceiling before the first plank exists, so it is the brake and not the
    // log supply that stops the mill; the filter on a good this colony never
    // sees, so the flag is off without changing where anything goes.
    case 650:
      return [{ kind: "setLimit", type: 1 /* ItemType.Plank */, value: 2 }];
    case 660: {
      const pile = sim.buildings.find((b) => b.kind === 0 /* BuildingKind.Stockpile */);
      return pile ? [{ kind: "toggleFilter", building: pile.id, type: 2 /* ItemType.Rock */ }] : [];
    }
    default:
      return [];
  }
}

/** A seven-tile run partway between the colony and the nearest den. Derived
 *  from the store, like every other site in this file. */
function denRun(sim: Sim, offset: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  if (!sim.monsters.length) return [];
  const m = sim.monsters.reduce((a, b) =>
    Math.hypot(a.lairX - centre, a.lairY - centre) <= Math.hypot(b.lairX - centre, b.lairY - centre) ? a : b,
  );
  const cx = Math.round(centre + (m.lairX - centre) * 0.55);
  const cy = Math.round(centre + (m.lairY - centre) * 0.55) + offset;
  const out: number[] = [];
  for (let k = -3; out.length < 7 && k < 7; k++) {
    if (canPlaceWall(sim, cx + k, cy)) out.push(tileIndex(cx + k, cy, size));
  }
  return out;
}

/**
 * Rebuild a fixture's colony with whatever the store looks like today.
 *
 * `peaceful` empties the wilds before the first tick, and the three pre-v4
 * recipes use it. They were written for a world with no monsters in it, and
 * replaying them in one is not what they were ever meant to demonstrate: on a
 * seed with a den near the colony the whole colony can be caught and killed
 * inside a fixture's lifetime, which leaves the shape comparison with no
 * colonist to read a key set off. The shape test asks "does this build's store
 * have the fields the file has" — the wilderness is a confound in that
 * question, not a signal.
 */
export function replay(
  script: (sim: Sim) => Command[],
  ticks: number,
  seed = FIXTURE_SEED,
  peaceful = false,
): Sim {
  const sim = createSim(seed);
  if (peaceful) sim.monsters = [];
  for (let t = 0; t < ticks; t++) advanceTick(sim, script(sim));
  return sim;
}

/** Staff whatever building of `kind` exists, or nothing. */
function staff(sim: Sim, kind: number): Command[] {
  const b = sim.buildings.find((x) => x.kind === kind);
  return b ? [{ kind: "staff", building: b.id }] : [];
}

/** The first placeable site for a building kind, searched outward from the
 *  centre so the answer is a pure function of the store. */
function buildSite(sim: Sim, kind: 0 | 1 | 2 | 3): [number, number] | null {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  for (let r = 2; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (canPlace(sim, kind, centre + dx, centre + dy)) return [centre + dx, centre + dy];
      }
    }
  }
  return null;
}

/** The nearest quarriable outcrops, as tile indices. */
function rockSite(sim: Sim, count: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const out: number[] = [];
  for (let r = 1; r < 40 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (canMine(sim, centre + dx, centre + dy)) out.push(tileIndex(centre + dx, centre + dy, size));
      }
    }
  }
  return out;
}

/** The nearest `n`×`n` block of levellable ground, as tile indices. */
function levelSite(sim: Sim, n: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  for (let r = 5; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tiles: number[] = [];
        let ok = true;
        for (let oy = 0; oy < n && ok; oy++) {
          for (let ox = 0; ox < n && ok; ox++) {
            const x = centre + dx + ox;
            const y = centre + dy + oy;
            ok = canTerraform(sim, x, y);
            tiles.push(tileIndex(x, y, size));
          }
        }
        if (ok) return tiles;
      }
    }
  }
  return [];
}

/** Tree tiles nearest the map centre, by growing rings, as tile indices. */
export function nearestTrees(sim: Sim, count: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const out: number[] = [];
  for (let r = 1; r < size && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const i = tileIndex(centre + dx, centre + dy, size);
        if (sim.world.treeMap[i]) out.push(i);
      }
    }
  }
  return out;
}

/**
 * The eight perimeter tiles of the first 3×3 block whose whole outline takes a
 * wall — the cheapest closed ring there is, enclosing exactly one tile, which
 * is all a fixture needs to carry a non-empty `insideMap`.
 */
export function ringSite(sim: Sim): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const outline: [number, number][] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [2, 2],
    [1, 2],
    [0, 2],
    [0, 1],
  ];
  for (let r = 3; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x0 = centre + dx;
        const y0 = centre + dy;
        if (outline.every(([ox, oy]) => canPlaceWall(sim, x0 + ox, y0 + oy))) {
          return outline.map(([ox, oy]) => tileIndex(x0 + ox, y0 + oy, size));
        }
      }
    }
  }
  return [];
}

/**
 * The first horizontal run of `length` tiles that all take a wall, searched
 * outward from the centre in growing rings so the answer is a pure function of
 * the store — which is what makes the recipe replayable.
 */
export function wallSite(sim: Sim, length: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  for (let r = 2; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const y = centre + dy;
        const x0 = centre + dx;
        let ok = true;
        for (let k = 0; k < length && ok; k++) ok = canPlaceWall(sim, x0 + k, y);
        if (ok) {
          const out: number[] = [];
          for (let k = 0; k < length; k++) out.push(tileIndex(x0 + k, y, size));
          return out;
        }
      }
    }
  }
  return [];
}
