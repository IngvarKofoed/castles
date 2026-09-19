import { findPath, occupancy, type Occupancy, type StepGate } from "../path";
import {
  MonsterPhase,
  findColonist,
  type Colonist,
  type Monster,
  type Sim,
} from "../store";
import { NOTICE_BREAK } from "../tuning";
import { isDamageable } from "../walls";
import { markEnclosureStale } from "../walls/enclosure";
import { markChunkDirty, tileIndex } from "../world/world";
import { biteWall, nearestDamageable } from "./damage";
import { killColonist } from "./flee";
import { colonyAnchor, settleIncursion, stepForecast } from "./incursion";
import { adjacentTo, defOfMonster, monsterNeighbours, monsterPassable, monsterStep, reach } from "./index";

/**
 * A monster's tick: the weather first, then whatever is ashore.
 *
 * **Monsters exist only for the length of an incursion**
 * (docs/specs/2026-09-17-incursions-from-the-sea.md). In peace `sim.monsters` is
 * empty and everything below is skipped; the forecast clock still runs, which
 * is why `stepForecast` is called before the guard rather than after it. A
 * landed monster presses toward the colony, attacks what is unfinished and
 * catches who is outside, and walks back to its boat when the storm passes.
 * Nothing the player does drives one off, and nothing keeps one past the storm:
 * it disengages mid-bite and leaves. That hard stop is what makes CONCEPT's
 * "an attack ends only when the monster leaves" something a player can plan
 * around, and it is why `Withdrawing` notices nothing at all.
 *
 * **Where this sits in the tick is part of the contract.** Monsters step after
 * colonists and before workshops (see `tick.ts`), so a catch always tests
 * post-move positions while a colonist's flee decision always reads last tick's
 * monster positions. Neither side gets to move twice against the other. The
 * forecast rides in this slot rather than earning a step of its own in
 * `advanceTick`, because landing and withdrawal *are* monsters appearing and
 * disappearing.
 *
 * No draw is made here, ever — `threats/incursion.ts` owns the only ones, and
 * makes them only at the end of a storm.
 */
export function stepMonsters(sim: Sim): void {
  // Read before the forecast moves anything: `settleIncursion` needs the
  // *transition* from "something ashore" to "nothing ashore", not the state.
  const had = sim.monsters.length > 0;
  stepForecast(sim);
  if (sim.monsters.length) {
    const occ = occupancy(sim);
    const step = monsterStep(sim, occ);
    // The colony, resolved once for the whole incursion's press rather than per
    // monster: it is a whole-grid read, and every monster ashore walks at the
    // same colony.
    const anchor = colonyAnchor(sim);
    const size = sim.world.size;
    const goal =
      anchor ?
        tileIndex(
          Math.min(size - 1, Math.max(0, Math.floor(anchor[0]))),
          Math.min(size - 1, Math.max(0, Math.floor(anchor[1]))),
          size,
        )
      : -1;
    // Backwards, so a monster removed this tick does not shuffle one that has
    // not stepped yet out from under the loop.
    for (let i = sim.monsters.length - 1; i >= 0; i--) {
      const m = sim.monsters[i];
      m.px = m.x;
      m.py = m.y;
      const wasX = Math.floor(m.x);
      const wasY = Math.floor(m.y);
      stepMonster(sim, occ, step, m, goal);
      // **A monster seeds the enclosure flood**, so a monster changing tile is a
      // change to the fill's inputs exactly as a wall event is. Nothing else in
      // the sim marks this — `markEnclosureStale`'s other callers are all
      // wall-graph writes — and `settleEnclosure` runs last in `advanceTick`,
      // after this, so the batching needs no ordering work here.
      if (Math.floor(m.x) !== wasX || Math.floor(m.y) !== wasY) markEnclosureStale(sim);
    }
  }
  settleIncursion(sim, had);
}

function stepMonster(sim: Sim, occ: Occupancy, step: StepGate, m: Monster, goal: number): void {
  if (m.phase === MonsterPhase.Withdrawing) {
    withdraw(sim, occ, step, m);
    return;
  }
  ashore(sim, occ, step, m, goal);
}

function forget(m: Monster): void {
  m.target = -1;
  m.targetTile = -1;
  m.biteTicks = 0;
  m.path = [];
  m.step = 0;
}

/**
 * Off the map, and the enclosure with it: the seed set just lost a member.
 *
 * The boat goes when the **last** monster that came in on it does, which is what
 * the second half tests for: the hull is baked into the chunk mesh, so the chunk
 * has to be told it is no longer there.
 */
function leave(sim: Sim, m: Monster): void {
  const i = sim.monsters.indexOf(m);
  if (i >= 0) sim.monsters.splice(i, 1);
  markEnclosureStale(sim);
  if (!sim.monsters.some((o) => o.landX === m.landX && o.landY === m.landY)) {
    markChunkDirty(sim.world, m.landX, m.landY);
  }
}

/**
 * Back to the boats, and gone on arrival.
 *
 * **The backstop clock is why this cannot simply wait for an arrival.** The way
 * to the coast can be walled off behind a monster, and without a second clock a
 * player who closed a ring at the wrong moment would keep a permanent resident —
 * the den problem reborn, and inside the colony this time. It is deliberately
 * longer than the storm, because removing one the instant the storm ended would
 * have monsters blinking out mid-map in plain sight, which reads as a bug.
 *
 * Where something chewable is in the way it chews, exactly as it did homeward
 * under the old model: a monster shut in by a palisade eats its way back out
 * rather than becoming furniture.
 */
function withdraw(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  if (--m.phaseTicks <= 0) {
    leave(sim, m);
    return;
  }
  const size = sim.world.size;
  const goal = tileIndex(m.landX, m.landY, size);
  const here = tileIndex(Math.floor(m.x), Math.floor(m.y), size);
  if (touches(here, goal, size)) {
    leave(sim, m);
    return;
  }
  const walked = walkTo(sim, occ, step, m, goal);
  if (walked === "arrived") {
    leave(sim, m);
    return;
  }
  if (walked === "stuck") desperate(sim, occ, step, m);
}

/**
 * The dangerous phase. A targetless monster looks for the nearest noticeable
 * thing; a monster with a target **holds** it until it is broken, so a chasing
 * orc never abandons its victim for a closer fence post.
 */
function ashore(sim: Sim, occ: Occupancy, step: StepGate, m: Monster, goal: number): void {
  if (m.target < 0 && m.targetTile < 0) acquire(sim, m);
  if (m.target >= 0) {
    chase(sim, occ, step, m);
    return;
  }
  if (m.targetTile >= 0) {
    attack(sim, occ, step, m);
    return;
  }
  press(sim, occ, step, m, goal);
}

/**
 * Notice: the nearest noticeable thing inside the kind's radius, Chebyshev.
 *
 * Two things are noticeable and neither is kind-specific — a colonist in the
 * open on outside ground, and a tile whose wall state is damageable. A colonist
 * standing on enclosed ground is not noticed at all, which is pillar one from
 * the other side: inside is not merely defended, it is invisible.
 *
 * Colonists win a tie against a wall at the same distance, which is the only
 * targeting preference in the game and exists so a monster stepping between the
 * two behaves the same way every time.
 */
function acquire(sim: Sim, m: Monster): void {
  const def = defOfMonster(m.kind);
  let bestD = Infinity;
  let victim: Colonist | null = null;
  for (const c of sim.colonists) {
    if (!noticeable(sim, c)) continue;
    const d = reach(m, c.x, c.y);
    if (d > def.notice) continue;
    if (d < bestD || (d === bestD && victim !== null && c.id < victim.id)) {
      bestD = d;
      victim = c;
    }
  }
  const tile = nearestDamageable(sim, m.x, m.y, def.notice);
  if (tile >= 0) {
    const tx = tile % sim.world.size;
    const ty = (tile - tx) / sim.world.size;
    const d = reach(m, tx + 0.5, ty + 0.5);
    if (d < bestD) {
      m.targetTile = tile;
      m.biteTicks = 0;
      m.path = [];
      m.step = 0;
      return;
    }
  }
  if (victim) {
    m.target = victim.id;
    m.path = [];
    m.step = 0;
  }
}

/** A colonist a monster can see: out of doors, and on ground the wall has not
 *  claimed. */
function noticeable(sim: Sim, c: Colonist): boolean {
  if (c.inside) return false;
  const size = sim.world.size;
  const x = Math.floor(c.x);
  const y = Math.floor(c.y);
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  return sim.insideMap[tileIndex(x, y, size)] === 0;
}

/**
 * Chase, at kind speed. The hold breaks when the victim reaches inside ground,
 * steps into a building, or gets past `NOTICE_BREAK` times the notice range —
 * hysteresis, so a colonist hovering at the edge of the radius is not picked up
 * and dropped every tick. Catching means adjacent, and adjacent means gone.
 */
function chase(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  const def = defOfMonster(m.kind);
  const victim = findColonist(sim, m.target);
  if (!victim || !noticeable(sim, victim) || reach(m, victim.x, victim.y) > def.notice * NOTICE_BREAK) {
    forget(m);
    return;
  }
  const goal = tileIndex(Math.floor(victim.x), Math.floor(victim.y), sim.world.size);
  // Re-plan only when the stored route has run out or no longer ends where the
  // victim is: a route per tick would be an A* per monster per tick.
  if (walkTo(sim, occ, step, m, goal) === "stuck") {
    // Nothing leads to them — across water, or behind stone. It keeps the hold
    // (the clock and the hysteresis are what break it) and takes out whatever
    // is actually in the way.
    desperate(sim, occ, step, m);
  }
  // Tested *after* the move, so a colonist who ran this tick is judged on where
  // they got to rather than where they started.
  if (adjacentTo(m, Math.floor(victim.x), Math.floor(victim.y))) killColonist(sim, occ, victim);
}

/**
 * Bite a wall. The monster walks to a tile beside the segment and then gnaws on
 * its kind's cadence — an orc a point a second, a troll four every two — until
 * the segment falls, or until the prowl clock takes it away mid-bite.
 */
function attack(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  const i = m.targetTile;
  if (!isDamageable(sim.wallMap[i])) {
    forget(m);
    return;
  }
  const size = sim.world.size;
  const tx = i % size;
  const ty = (i - tx) / size;
  if (adjacentTo(m, tx, ty)) {
    face(m, tx + 0.5, ty + 0.5);
    const def = defOfMonster(m.kind);
    if (++m.biteTicks < def.biteTicks) return;
    m.biteTicks = 0;
    if (biteWall(sim, i, def.bite)) forget(m);
    return;
  }
  // Nothing leads to it — a segment across a chasm, or behind stone. Drop it
  // and let the next tick find something else worth noticing.
  if (walkTo(sim, occ, step, m, i) === "stuck") forget(m);
}

/**
 * Nothing noticed: press toward the colony.
 *
 * The goal is the colony's own centre, so "almost to the middle" is a
 * *consequence* rather than a rule — a monster walks in until a wall stops it,
 * and a closed wall is what stops it. Behind stone it chews at whatever is
 * chewable and, finding nothing, waits.
 *
 * **`depth` is the one thing that bounds the walk**, measured from the beach it
 * came ashore on: a colony that has reached further inland is pressed further
 * inland, which is where CONCEPT's "danger scales outward" lives now that a
 * single strength dial governs how many come. It bounds the *press* only — a
 * chase already under way may carry a monster past it, because a colonist who
 * walked out to meet one is a choice the player made.
 */
function press(sim: Sim, occ: Occupancy, step: StepGate, m: Monster, goal: number): void {
  if (goal < 0) return;
  if (Math.max(Math.abs(Math.floor(m.x) - m.landX), Math.abs(Math.floor(m.y) - m.landY)) >= m.depth) return;
  if (walkTo(sim, occ, step, m, goal) === "stuck") desperate(sim, occ, step, m);
}

/**
 * Nothing can be walked to. Bite the nearest damageable thing in range instead
 * — the same rule prowling and homeward, so a monster shut in by a palisade
 * chews its way back out rather than becoming furniture. Behind finished stone
 * or a cliff there is nothing to chew, and it waits.
 */
function desperate(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  const def = defOfMonster(m.kind);
  const tile = nearestDamageable(sim, m.x, m.y, def.notice);
  if (tile < 0) return;
  const size = sim.world.size;
  const tx = tile % size;
  const ty = (tile - tx) / size;
  if (adjacentTo(m, tx, ty)) {
    face(m, tx + 0.5, ty + 0.5);
    if (++m.biteTicks < def.biteTicks) return;
    m.biteTicks = 0;
    biteWall(sim, tile, def.bite);
    return;
  }
  void walkTo(sim, occ, step, m, tile);
}

/** What a walk did this tick. `arrived` covers standing beside a goal tile that
 *  cannot be stood on, which is the usual case for a wall. */
type Walk = "arrived" | "moving" | "stuck";

/**
 * Walk toward a tile, planning a route **only when the stored one has run out
 * or no longer ends where it should**. That is the colonist pattern, and the
 * reason it matters here is arithmetic: a route per monster per tick is an A\*
 * per monster per tick, and there are two dozen monsters.
 */
function walkTo(sim: Sim, occ: Occupancy, step: StepGate, m: Monster, goal: number): Walk {
  const size = sim.world.size;
  const gx = goal % size;
  const gy = (goal - gx) / size;
  // A stored route is stale when it has run out, or when its end is no longer
  // at or beside the goal. **Not** `end !== goal`: a wall tile cannot be stood
  // on, so a route to one always ends on a *neighbour*, and testing for
  // equality would re-plan every single tick — an A* per monster per tick,
  // which is precisely what storing the route exists to avoid. For a chase it
  // doubles as the hysteresis: the route is kept until the victim has strayed
  // more than a tile from where it was aimed.
  if (m.path.length <= m.step || !touches(m.path[m.path.length - 1], goal, size)) {
    const to = monsterPassable(sim, occ, gx, gy)
      ? new Set([goal])
      : monsterNeighbours(sim, occ, gx, gy);
    const path = findPath(sim, occ, Math.floor(m.x), Math.floor(m.y), to, step);
    if (!path) {
      m.path = [];
      m.step = 0;
      return "stuck";
    }
    m.path = path;
    m.step = 0;
    if (!path.length) return "arrived";
  }
  move(sim, step, m, defOfMonster(m.kind).speed);
  if (m.path.length > m.step) return "moving";
  // An empty route is not proof of arrival: `move` also *throws a route away*
  // when a step has stopped being legal — a segment finished across it, ground
  // raised into a cliff — and the two are indistinguishable from the route
  // alone. So arrival is decided by where the monster is standing. Without this
  // a monster whose way home is walled off mid-walk reports "arrived" and
  // `goHome` beds it down in the open field for a whole rest period, nowhere
  // near its den.
  const here = tileIndex(Math.floor(m.x), Math.floor(m.y), size);
  return touches(here, goal, size) ? "arrived" : "stuck";
}

/** Same tile, or one of the eight around it. */
function touches(a: number, b: number, size: number): boolean {
  const ax = a % size;
  const bx = b % size;
  return Math.max(Math.abs(ax - bx), Math.abs((a - ax) / size - (b - bx) / size)) <= 1;
}

/**
 * Advance along the stored route by one tick of walking — the colonist walker,
 * with the monster's gate and the monster's speed. A step that has stopped
 * being legal (a segment finished across the route, ground raised into a cliff)
 * drops the route; the next tick plans a fresh one.
 */
function move(sim: Sim, step: StepGate, m: Monster, speed: number): void {
  const size = sim.world.size;
  let budget = speed;
  while (budget > 0 && m.step < m.path.length) {
    const tile = m.path[m.step];
    const tx = tile % size;
    const ty = (tile - tx) / size;
    const fromH = sim.world.hmap[tileIndex(Math.floor(m.x), Math.floor(m.y), size)];
    if (!step(tx, ty, fromH)) {
      m.path = [];
      m.step = 0;
      return;
    }
    const dx = tx + 0.5 - m.x;
    const dy = ty + 0.5 - m.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-9) m.heading = Math.atan2(dx, dy);
    if (dist <= budget) {
      m.x = tx + 0.5;
      m.y = ty + 0.5;
      m.step++;
      budget -= dist;
    } else {
      m.x += (dx / dist) * budget;
      m.y += (dy / dist) * budget;
      budget = 0;
    }
  }
  if (m.step >= m.path.length) {
    m.path = [];
    m.step = 0;
  }
}

function face(m: Monster, x: number, y: number): void {
  const dx = x - m.x;
  const dy = y - m.y;
  if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) m.heading = Math.atan2(dx, dy);
}
