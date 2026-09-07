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
import { tileIndex } from "../world/world";
import { biteWall, nearestDamageable } from "./damage";
import { killColonist } from "./flee";
import { adjacentTo, defOfMonster, monsterNeighbours, monsterPassable, monsterStep, reach } from "./index";

/**
 * A monster's tick: the rhythm first, then whatever the rhythm allows.
 *
 * **The rhythm is the whole design.** A monster is either resting at its lair —
 * noticing nothing, chasing nothing, biting nothing — or prowling its circuit
 * with its notice radius live, and an attack ends *only* when the prowl clock
 * does. Nothing the player does drives one off, and nothing they do keeps one
 * out past its hours either: it disengages mid-bite and walks home. That hard
 * stop is what makes CONCEPT's "hold until it leaves" something the player can
 * actually plan around, and it is why `GoingHome` notices nothing at all.
 *
 * **Where this sits in the tick is part of the contract.** Monsters step after
 * colonists and before workshops (see `tick.ts`), so a catch always tests
 * post-move positions while a colonist's flee decision always reads last tick's
 * monster positions. Neither side gets to move twice against the other.
 *
 * No draw is made here, ever. Everything a monster does comes off state seeded
 * at spawn plus the shared tick counter, which is what keeps a colony under
 * siege as replayable as a quiet one.
 */
export function stepMonsters(sim: Sim): void {
  if (!sim.monsters.length) return;
  const occ = occupancy(sim);
  const step = monsterStep(sim, occ);
  for (const m of sim.monsters) {
    m.px = m.x;
    m.py = m.y;
    stepMonster(sim, occ, step, m);
  }
}

function stepMonster(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  advancePhase(m);
  if (m.phase === MonsterPhase.Rest) return;
  if (m.phase === MonsterPhase.GoingHome) {
    goHome(sim, occ, step, m);
    return;
  }
  prowl(sim, occ, step, m);
}

/**
 * Run the clock. Rest ends in a prowl that starts at the first waypoint; a
 * prowl ends in the walk home, whatever it was doing — target dropped, bite
 * abandoned, route thrown away. The clock is the law.
 */
function advancePhase(m: Monster): void {
  if (m.phase === MonsterPhase.Rest) {
    if (--m.phaseTicks > 0) return;
    m.phase = MonsterPhase.Prowl;
    m.phaseTicks = m.prowlTicks;
    m.leg = 0;
    forget(m);
    return;
  }
  if (m.phase === MonsterPhase.Prowl) {
    if (--m.phaseTicks > 0) return;
    m.phase = MonsterPhase.GoingHome;
    m.phaseTicks = 0;
    forget(m);
  }
  // GoingHome ends on arrival, not on a clock.
}

function forget(m: Monster): void {
  m.target = -1;
  m.targetTile = -1;
  m.biteTicks = 0;
  m.path = [];
  m.step = 0;
}

/**
 * Home, and then to sleep.
 *
 * A monster that cannot walk all the way in — its own den built over by a
 * migrated colony, a landslide of a terraform since — beds down beside it
 * instead: the rhythm has to keep running, or a monster could be neutralized
 * for good by being shut out of its lair, which is the one thing the design
 * will not allow. Where nothing at all can be reached and something damageable
 * is in the way, it chews; where even that is stone or cliff, it waits.
 */
function goHome(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  const home = Math.floor(m.x) === m.lairX && Math.floor(m.y) === m.lairY;
  if (!home) {
    const walked = walkTo(sim, occ, step, m, tileIndex(m.lairX, m.lairY, sim.world.size));
    if (walked === "moving") return;
    if (walked === "stuck") {
      // Deterministic desperation: something is between it and its den, and if
      // that something can be chewed it gets chewed — even homeward.
      desperate(sim, occ, step, m);
      return;
    }
  }
  m.phase = MonsterPhase.Rest;
  m.phaseTicks = m.restTicks;
  if (home) {
    m.x = m.lairX + 0.5;
    m.y = m.lairY + 0.5;
  }
  forget(m);
}

/**
 * The dangerous phase. A targetless monster looks for the nearest noticeable
 * thing; a monster with a target **holds** it until it is broken, so a chasing
 * orc never abandons its victim for a closer fence post.
 */
function prowl(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  if (m.target < 0 && m.targetTile < 0) acquire(sim, m);
  if (m.target >= 0) {
    chase(sim, occ, step, m);
    return;
  }
  if (m.targetTile >= 0) {
    attack(sim, occ, step, m);
    return;
  }
  patrol(sim, occ, step, m);
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

/** The circuit: waypoints in order, forever, until something is noticed or the
 *  prowl runs out. */
function patrol(sim: Sim, occ: Occupancy, step: StepGate, m: Monster): void {
  if (!m.circuit.length) return;
  const goal = m.circuit[m.leg % m.circuit.length];
  const walked = walkTo(sim, occ, step, m, goal);
  if (walked === "moving") return;
  // Arrived, or nothing leads there: either way take the next waypoint rather
  // than standing on this one for the rest of the prowl. A leg that is simply
  // unreachable also earns a look at whatever is in the way.
  m.leg = (m.leg + 1) % m.circuit.length;
  m.path = [];
  m.step = 0;
  if (walked === "stuck") desperate(sim, occ, step, m);
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
