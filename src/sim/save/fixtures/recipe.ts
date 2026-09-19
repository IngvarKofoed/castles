import type { Command } from "../../commands";
import { canPlace, footprintGap } from "../../buildings";
import { canMine, canTerraform } from "../../ground";
import { canPlaceWall } from "../../walls";
import { HIVE_REACH } from "../../tuning";
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

/**
 * v11: hives, flower fields and mead, back on the default fixture seed — the
 * whole drink chain is priced in **logs**, and 20260901's woods are two tiles
 * from the centre, so nothing here waits on a sawmill.
 *
 * What it carries, and what no earlier file could: **a Hive standing and
 * manned with three Flowers inside its reach**, so the file freezes a batch
 * length that is a fact about *where a building stands* rather than a number
 * from a def; a **Meadery** turning honey into mead; both new goods in the
 * colony at once; and a **cellar that is set** — mead for every settled
 * colonist plus one — which is the state the arrival clock reads and the one
 * no save has ever held.
 *
 * The fields are sited off the **hive's own plot** rather than by the general
 * search, because the thing being frozen is the reach: a field placed wherever
 * there was room would have left the count to luck.
 *
 * Caught at 2500, a hundred ticks after the sixth cup and **well before the
 * 2×2 pile fills**: the boosted hive out-produces the meadery, and a few
 * hundred ticks later the whole chain is jammed at `output-full` with a full
 * stockpile — a real colony state, but one that could not demonstrate running
 * on from where it was saved.
 */
export const V11_TICKS = 2500;

export function v11Script(sim: Sim): Command[] {
  switch (sim.tick) {
    // Twenty-four trees, not forty: sixteen logs build the whole chain and the
    // eight left over sit in the pile beside the honey and the mead. Chopping
    // the wood out would fill a 2×2 stockpile, and a file frozen with its
    // workshops jammed at `output-full` could not demonstrate running on.
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 24) }];
    case 5:
      return chainPlace(sim, 0 /* Stockpile */);
    case 6:
      return openPile(sim);
    case 150:
      return chainPlace(sim, 12 /* Hive */);
    case 400:
      return staff(sim, 12 /* Hive */);
    // Three fields, spaced so each is fed rather than standing as a frame, and
    // every one of them inside the hive's reach by construction.
    case 700:
      return fieldPlace(sim);
    case 1000:
      return fieldPlace(sim);
    case 1300:
      return fieldPlace(sim);
    case 1700:
      return chainPlace(sim, 14 /* Meadery */);
    case 2100:
      return staff(sim, 14 /* Meadery */);
    default:
      return [];
  }
}

/**
 * A 3×3 flower plot inside the hive's reach, searched outward from the hive's
 * own origin so the answer is a pure function of the store — and so the fields
 * this recipe builds are the ones the boost is meant to count.
 */
function fieldPlace(sim: Sim): Command[] {
  const hive = sim.buildings.find((b) => b.kind === 12 /* Hive */);
  if (!hive) return [];
  for (let r = 3; r <= HIVE_REACH + 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = hive.x + dx;
        const y = hive.y + dy;
        const plot = { x, y, w: 3, h: 3 };
        if (footprintGap(hive, plot) > HIVE_REACH) continue;
        if (sim.buildings.some((b) => footprintGap(b, plot) < 2)) continue;
        if (!canPlace(sim, 13 /* Flowers */, x, y)) continue;
        return [{ kind: "place", building: 13, x, y }];
      }
    }
  }
  return [];
}

/**
 * Turn every filter on, on the stockpile the recipe placed a tick ago.
 *
 * Not an edit to what any recipe *means*, which is why it does not break the
 * freeze above: each was written when a new pile accepted everything, and
 * default-off (docs/changelog/2026-09-14-stockpile-default-and-clearing.md) would
 * otherwise leave every one of these colonies with its goods on the ground and
 * v7's rock toggle meaning the opposite of what its prose claims. One press of
 * `all`, on the tick *after* the placement while the pile is still a blueprint,
 * restores the colony each recipe describes — and is behaviourally invisible,
 * since nothing reads a blueprint's filters.
 */
function openPile(sim: Sim): Command[] {
  const pile = sim.buildings.find((b) => b.kind === 0 /* BuildingKind.Stockpile */);
  return pile ? [{ kind: "setAllFilters", building: pile.id, on: true }] : [];
}

/** v1: twelve trees marked, a stockpile placed. 400 ticks. */
export const V1_TICKS = 400;

export function v1Script(sim: Sim): Command[] {
  if (sim.tick === 0) return [{ kind: "designateChop", tiles: nearestTrees(sim, 12) }];
  if (sim.tick === 5) return [{ kind: "place", building: 0, x: 128, y: 128 }];
  if (sim.tick === 6) return openPile(sim);
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
  if (sim.tick === 6) return openPile(sim);
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
    case 6:
      return openPile(sim);
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
 * v4: the threat tier, on the seed `threats/encounter.test.ts` picks — chosen
 * when it was recorded because its nearest den sat fourteen tiles from the
 * colony, close enough to bite the line this script raises.
 *
 * What **the committed file** carries: two dozen monsters mid-rhythm with their
 * routes and phase clocks in flight, and a standing palisade still carrying its
 * **bite damage** with a live repair task queued against it — plus the walls,
 * items, tasks and reservations the older fixtures prove. Caught at 1100, in
 * the gap between the first prowl walking home and the repairer finishing: no
 * tick on that seed held damage, a repair task *and* a grave at once.
 *
 * **Re-running the recipe today reproduces none of the threat half**, and that
 * is expected rather than broken. There are no dens
 * (docs/specs/2026-09-17-incursions-from-the-sea.md) and `replay` parks the
 * forecast, so the line goes up unmolested and the store comes back with no
 * monsters, no damage and no `Repair`. The file is frozen and never
 * re-recorded, and the shape test compares **key sets** rather than contents —
 * so what this script still has to produce is one entity of each kind it is
 * asked about, which it does. The `monsters` kind came out of that list with
 * the dens.
 */
export const FIXTURE_SEED_V4 = 20260981;
export const V4_TICKS = 1100;

export function v4Script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 24) }];
    case 5:
      return [{ kind: "place", building: 0, x: 126, y: 126 }];
    case 6:
      return openPile(sim);
    // Late enough that the line was standing — not a row of blueprints — when
    // the den's first full prowl reached it, which is what got the committed
    // file its bite damage rather than a chewed-up building site.
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
    case 6:
      return openPile(sim);
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
    case 6:
      return openPile(sim);
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

/**
 * v8: the bread economy, on **its own seed** — 20260931, whose nearest outcrop
 * is five tiles from the colony and whose nearest den is ninety-one. Both
 * numbers are load-bearing: the Oven costs *blocks*, so the fixture needs stone
 * within walking distance, and a 1930-tick recipe on a seed with a near den can
 * lose the colony it is meant to freeze.
 *
 * What it carries, none of which the format has ever held: **grain, flour and
 * bread** in the colony, the **three new buildings** standing and staffed, the
 * three new accept flags on every one of them, a `limits` array of seven, five
 * **running hunger clocks** at five different values, and a colonist **caught
 * mid-meal** with `eating` set and a route to a particular loaf in flight —
 * which is the state a save could most plausibly lose.
 *
 * Caught at 1930, eight ticks after the first loaf came out of the oven: before
 * that there is no bread but the provisions, and a few hundred ticks later
 * everybody is fed and nobody is walking.
 */
export const FIXTURE_SEED_V8 = 20260931;
export const V8_TICKS = 1930;

export function v8Script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 30) }];
    case 5:
      return chainPlace(sim, 0 /* Stockpile */);
    case 6:
      return openPile(sim);
    case 150:
      return chainPlace(sim, 2 /* Mason */);
    case 400:
      return staff(sim, 2 /* Mason */);
    case 420:
      return [{ kind: "designateMine", tiles: rockSite(sim, 3) }];
    case 600:
      return chainPlace(sim, 4 /* Farm */);
    case 650:
      return chainPlace(sim, 5 /* Mill */);
    // Placed once blocks are coming out of the mason, so the site is fed rather
    // than standing as a frame — the stone tier's own lesson.
    case 900:
      return chainPlace(sim, 6 /* Oven */);
    case 1300:
      return staff(sim, 4 /* Farm */);
    case 1500:
      return staff(sim, 5 /* Mill */);
    case 1800: {
      // The oven takes the mason's slot worker back: four workshops against
      // five colonists leaves one pair of hands to feed all of them.
      //
      // Numeric kinds, like every other recipe in this file: a frozen recipe
      // names the numbers that were in the save, not the enum a later build
      // happens to have (`BuildingKind` is append-only, so they agree — but the
      // literal is what the fixture was written from).
      const mason = sim.buildings.find((b) => b.kind === 2 /* Mason */);
      return [
        ...staff(sim, 6 /* Oven */),
        ...(mason ? [{ kind: "unstaff" as const, building: mason.id }] : []),
      ];
    }
    default:
      return [];
  }
}

/**
 * v9: the Watchtower, on **its own seed** — 20261035, whose woods are seven
 * tiles from the map centre and whose nearest den is sixteen. Both numbers are
 * load-bearing and pull opposite ways: a tower costs *planks*, so the log
 * chain has to run inside a fixture's lifetime, and a tower with no den inside
 * `WATCH_RANGE` would carry the kind without carrying the point of it. Seeds
 * with a den that near mostly lose the colony to it inside two thousand ticks;
 * this one does not, which is why it is the seed and not one of its
 * neighbours.
 *
 * What it carries, none of which the format has ever held: **a Watchtower
 * standing and manned**, watching one den eighteen tiles out — the game's
 * first 1×1 footprint, its first slot building with **no recipe at all**, and
 * a colonist bound to a slot that produces nothing.
 *
 * Caught at 1750, a hundred and fifty ticks after the watcher steps inside and
 * while the colony still holds loaves: before it the tower is a blueprint or a
 * walk, and a few hundred ticks later the provisions are gone and everybody is
 * hunting bread the recipe never builds a chain for.
 *
 * The v9 rung itself is an **identity** — the tower needed no store field — so
 * this file exists to pin the *shape*, not a migration, and no older fixture's
 * pinned hash moves for it.
 */
export const FIXTURE_SEED_V9 = 20261035;
export const V9_TICKS = 1750;

export function v9Script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 40) }];
    case 5: {
      const site = buildSite(sim, 0);
      return site ? [{ kind: "place", building: 0, x: site[0], y: site[1] }] : [];
    }
    case 6:
      return openPile(sim);
    case 200: {
      const site = buildSite(sim, 1);
      return site ? [{ kind: "place", building: 1, x: site[0], y: site[1] }] : [];
    }
    // The sawmill has to be cutting before the tower is placed: the tower is
    // the second thing in the game priced in planks.
    case 600:
      return staff(sim, 1);
    case 1000: {
      const site = buildSite(sim, 7);
      return site ? [{ kind: "place", building: 7, x: site[0], y: site[1] }] : [];
    }
    // And the watcher last, so the file is caught with somebody in the tower
    // rather than with an empty one.
    case 1600:
      return staff(sim, 7);
    default:
      return [];
  }
}

/**
 * v10: the sheep chain and the game's first equipment, on **its own seed** —
 * 20261126, whose woods are seven tiles from the map centre and whose nearest
 * den is forty-eight. Both numbers are load-bearing and this time they pull the
 * same way: the whole cloth chain is priced in *planks*, so the log chain has to
 * run first and then keep running (sixteen planks for four buildings), and a
 * 4250-tick recipe on a seed with a near den loses the colony it is meant to
 * freeze long before the tailor opens.
 *
 * What it carries, none of which the format has ever held: **all seven
 * buildings standing** — Stockpile, Sawmill, Farm, Pasture, Dairy, Weaver,
 * Tailor — **all four new goods in the colony at once** (wool, cloth, clothes
 * and cheese), **three colonists wearing clothes on three different wear
 * clocks**, and **two more caught mid-fitting** with routes to a garment in
 * flight, which is the id-order race for the tailor's output resolving on
 * camera. The dressing errand is the state a save could most plausibly lose,
 * exactly as the meal errand was at v8.
 *
 * **The staffing schedule is the recipe**, and it is what five pairs of hands
 * against seven buildings actually looks like: never more than three slots at
 * once, so two haulers always remain to carry between them. The Dairy is staffed
 * early and deliberately — cheese lands before the opening provisions run out,
 * so the colony is fed through the long middle instead of crawling at
 * `HUNGRY_FACTOR`, which is the labour trap being played rather than described.
 */
export const FIXTURE_SEED_V10 = 20261126;
export const V10_TICKS = 4250;

export function v10Script(sim: Sim): Command[] {
  switch (sim.tick) {
    case 0:
      return [{ kind: "designateChop", tiles: nearestTrees(sim, 44) }];
    case 5:
      return chainPlace(sim, 0 /* Stockpile */);
    case 6:
      return openPile(sim);
    case 150:
      return chainPlace(sim, 1 /* Sawmill */);
    // The Farm is priced in logs, so it can go up before a single plank exists.
    case 300:
      return chainPlace(sim, 4 /* Farm */);
    case 400:
      return staff(sim, 1 /* Sawmill */);
    case 600:
      return staff(sim, 4 /* Farm */);
    // The four plank-priced buildings, spaced so each is fed rather than
    // standing as a frame — the stone tier's lesson, applied to timber.
    case 800:
      return chainPlace(sim, 9 /* Dairy */);
    case 1100:
      return chainPlace(sim, 8 /* Pasture */);
    case 1400:
      return chainPlace(sim, 10 /* Weaver */);
    case 1700:
      return chainPlace(sim, 11 /* Tailor */);
    // Cheese before the provisions run out, off the grain the farm has banked.
    case 1900:
      return staff(sim, 9 /* Dairy */);
    // The planks are cut; the shepherd takes the sawyer's place.
    case 2600:
      return [...unstaff(sim, 1 /* Sawmill */), ...staff(sim, 8 /* Pasture */)];
    case 3000:
      return [...unstaff(sim, 4 /* Farm */), ...staff(sim, 10 /* Weaver */)];
    case 3400:
      return [...unstaff(sim, 10 /* Weaver */), ...staff(sim, 11 /* Tailor */)];
    // And the weaver back on at the end, off the banked cheese, so the file is
    // caught with the whole chain in flight rather than with its middle idle.
    case 4000:
      return [...unstaff(sim, 9 /* Dairy */), ...staff(sim, 10 /* Weaver */)];
    default:
      return [];
  }
}

/**
 * Place a chain building at the nearest site that fits, keeping five tiles
 * clear of everything already standing.
 *
 * Its own helper rather than `buildSite`, whose exact search the pre-v8 recipes
 * are frozen against: those files were written by whatever it returned then,
 * and a widened clearance would move where they put things.
 */
function chainPlace(sim: Sim, kind: 0 | 1 | 2 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | 14): Command[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  for (let r = 2; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = centre + dx;
        const y = centre + dy;
        if (sim.buildings.some((b) => Math.abs(x - b.x) < 5 && Math.abs(y - b.y) < 5)) continue;
        if (canPlace(sim, kind, x, y)) return [{ kind: "place", building: kind, x, y }];
      }
    }
  }
  return [];
}

/**
 * A seven-tile palisade run a few tiles out from the colony.
 *
 * **It used to be sited off the nearest den**, which is how `v4.castles` was
 * actually recorded: the run went partway between the colony and a lair, so the
 * monster that lived there came out and bit it. There are no dens to aim at any
 * more (docs/specs/2026-09-17-incursions-from-the-sea.md), so the site is a
 * fixed offset from the centre instead. The frozen file is unaffected — it is
 * never re-recorded — and nothing downstream reads this run's *position*: the
 * shape tests compare store and entity key sets, and walls are a layer rather
 * than an entity.
 */
function denRun(sim: Sim, offset: number): number[] {
  const size = sim.world.size;
  const centre = Math.floor(size / 2);
  const cx = centre + 8;
  const cy = centre + 8 + offset;
  const out: number[] = [];
  for (let k = -3; out.length < 7 && k < 7; k++) {
    if (canPlaceWall(sim, cx + k, cy)) out.push(tileIndex(cx + k, cy, size));
  }
  return out;
}

/**
 * Rebuild a fixture's colony with whatever the store looks like today.
 *
 * **Every replay is peaceful, and the clock is parked to make it so.** A fresh
 * colony opens with an empty wilderness (docs/specs/2026-09-17-incursions-from-the-sea.md),
 * but the opening grace is *not* longer than every recipe here — `V10_TICKS` is
 * 4250 against a `FIRST_STORM` of 3600, so a replay that let the clock run met
 * an incursion, lost a colonist to it and finished with a monster still ashore.
 * The weather is a confound in the question this function exists to ask — *does
 * this build's store have the fields the file has* — exactly as the wilderness
 * was for the three pre-v4 recipes the old `peaceful` flag served. So the
 * forecast is pushed past the end of the run rather than each recipe being
 * re-tuned around it (docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md).
 *
 * It parks rather than empties: `stormTicks` is a plain countdown, so setting
 * it beyond the run is the whole of "no storm", and nothing else in the store
 * has to be touched.
 */
export function replay(script: (sim: Sim) => Command[], ticks: number, seed = FIXTURE_SEED): Sim {
  const sim = createSim(seed);
  sim.stormTicks = ticks + 1;
  for (let t = 0; t < ticks; t++) advanceTick(sim, script(sim));
  return sim;
}

/** Staff whatever building of `kind` exists, or nothing. */
function staff(sim: Sim, kind: number): Command[] {
  const b = sim.buildings.find((x) => x.kind === kind);
  return b ? [{ kind: "staff", building: b.id }] : [];
}

/** Its mirror. The v10 recipe hands one slot to the next as five pairs of hands
 *  work seven buildings, so it unstaffs as often as it staffs. */
function unstaff(sim: Sim, kind: number): Command[] {
  const b = sim.buildings.find((x) => x.kind === kind);
  return b ? [{ kind: "unstaff", building: b.id }] : [];
}

/** The first placeable site for a building kind, searched outward from the
 *  centre so the answer is a pure function of the store. */
function buildSite(sim: Sim, kind: 0 | 1 | 2 | 3 | 7): [number, number] | null {
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
