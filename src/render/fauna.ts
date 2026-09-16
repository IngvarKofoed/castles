import { BuildingKind, BuildingState, buildings, insideLayer, type Sim } from "../sim/know";
import { hash } from "../sim/world/noise";
import { Terrain, tileIndex } from "../sim/world/world";

/**
 * Wandering fauna: the Pasture's sheep and the deer of the wilds.
 *
 * **This reopens the door `docs/changelog/2026-09-11-sheep-and-clothes.md`
 * closed.** That step baked three static sheep into the Pasture prop and stated
 * that renderer-owned animation state was a door it would not open. What kept
 * it shut was scope, not principle — and what makes it safe to open is the
 * boundedness rule this module is built around: **a creature never leaves its
 * home radius.** A sheep does not leave its pasture and a deer does not cross
 * the map, so "something is travelling across open ground" keeps meaning
 * colonists and monsters, which is the game's entire threat toolkit
 * (docs/CONCEPT.md; docs/specs/2026-09-15-ambient-life.md).
 *
 * Nothing here is a sim entity. Fauna cannot be hunted, herded, eaten, killed
 * or counted, nothing in `sim/` knows they exist, no save carries them, and
 * **they do not notice monsters** — a deer that scattered from an orc would be
 * early warning nobody paid a pair of hands for, which is the one thing
 * watchtowers are for.
 *
 * The loop is the mockup's, recorded in `docs/ARCHITECTURE.md`: walk toward a
 * target inside the home radius, graze for a random pause, pick another. Every
 * model is built facing +z, so heading is `atan2(dx, dz)`.
 */

/** What a herd is made of. Transient: nothing here is saved or derived back. */
export interface Creature {
  x: number;
  z: number;
  heading: number;
  /** Where it is walking, inside its herd's home radius. */
  tx: number;
  tz: number;
  /** Seconds of grazing left. Above zero the head is down and the feet still. */
  graze: number;
  /** Leg phase, advanced only while walking, so a grazing animal stands. */
  gait: number;
}

export const FaunaKind = { Sheep: 0, Deer: 1 } as const;
export type FaunaKindValue = (typeof FaunaKind)[keyof typeof FaunaKind];

export interface Herd {
  kind: FaunaKindValue;
  /** Home centre in tiles, and how far from it a target may be picked. */
  hx: number;
  hz: number;
  radius: number;
  /**
   * A square inside the home that is not grazing ground — the Pasture's
   * shepherd's hut, and nothing else so far.
   *
   * The baked flock this replaced was placed by hand "clear of the hut's
   * corner"; a wander with no such rule walks sheep straight through the roof,
   * which is the one way a pasture full of animals can look worse than a
   * pasture with three glued to the turf. Half-extents in tiles.
   */
  avoid?: { x: number; z: number; r: number };
  creatures: Creature[];
}

/** Tiles per second. A sheep mills; a deer covers its patch a little faster. */
const SPEED: Record<FaunaKindValue, number> = { [FaunaKind.Sheep]: 0.32, [FaunaKind.Deer]: 0.5 };
/** Seconds of grazing between walks — a range, rolled per stop. */
const GRAZE_MIN = 2.5;
const GRAZE_SPAN = 5;
/** Close enough to have arrived, in tiles. */
const ARRIVED = 0.12;
/** How many offsets to try before calling a home unusable. */
const TARGET_TRIES = 8;

/** Sheep: three to a Pasture, inside the rails rather than on them. */
const SHEEP_PER_PASTURE = 3;
/** How far inside the fence a sheep may go. The fence is the promise. */
const PASTURE_INSET = 0.55;
/**
 * How far from the hut's own centre a sheep must stay. The hut's roof is 1.16
 * tiles across (`props.ts`), so 0.58 clears it and the rest is the animal's own
 * half-length.
 */
const HUT_CLEAR = 0.85;

/** Deer: a fixed set of small herds, derived from the world seed alone. */
const DEER_HERDS = 10;
const DEER_PER_HERD = 3;
const DEER_RADIUS = 4;
/** How far from the map centre a herd's home is first derived. */
const DEER_HOME_MIN = 22;
const DEER_HOME_MAX = 108;
/** Candidate homes tried before a herd is given up on, at derivation and again
 *  when it re-homes. */
const HOME_TRIES = 48;
/** How far outward a walled-in herd moves its home each time it re-homes. */
const REHOME_STEP = 5;
/** Keep every derived home clear of the map edge, so a herd's radius fits. */
const EDGE = 8;

const DEER_SALT = 0x51ed270b;

/**
 * The herds, and the wander state they carry between frames.
 *
 * **State is kept when an anchor leaves the camera radius, not discarded.**
 * Updating stops and the herd simply holds; re-deriving on re-entry would
 * teleport a flock every time the player panned away and back, which is far
 * more visible than the reload case derivation is argued from.
 *
 * Initial placement *is* derived — a herd's home and each creature's starting
 * offset come from a hash of the anchor and the world seed — so a load, a
 * tab-wake or a renderer rebuild puts them in the same places with nothing
 * saved. The wander itself uses `Math.random`, which is banned in `sim/` and
 * perfectly fine here: no rule anywhere depends on where an animal was
 * mid-stride.
 */
export class Fauna {
  private readonly herds = new Map<number, Herd>();

  constructor(private readonly sim: Sim) {}

  /**
   * Advance every herd near the camera and return all of them for drawing.
   *
   * `dt` is game seconds off the loop's already-clamped delta, so a tab that
   * wakes owing ten seconds does not teleport a herd across its pasture, and at
   * ×0 nothing moves. `cx`/`cz` is where the colony is, which is the direction
   * a walled-in herd re-homes *away* from.
   */
  step(dt: number, fx: number, fz: number, radius: number, cx: number, cz: number): readonly Herd[] {
    this.syncPastures();
    this.syncDeer();
    for (const herd of this.herds.values()) {
      if (Math.abs(herd.hx - fx) > radius || Math.abs(herd.hz - fz) > radius) continue;
      this.walk(herd, dt, cx, cz);
    }
    return [...this.herds.values()];
  }

  /** A flock per Active Pasture. A blueprint or half-built one has none, exactly
   *  as it had no baked sheep. */
  private syncPastures(): void {
    for (const b of buildings(this.sim)) {
      if (b.kind !== BuildingKind.Pasture || b.state !== BuildingState.Active) continue;
      if (this.herds.has(b.id)) continue;
      // The home *is* the footprint, inset from the rails: the fence is the
      // promise, so a target is never picked outside it.
      const hx = b.x + b.w / 2;
      const hz = b.y + b.h / 2;
      const herd = this.makeHerd(
        FaunaKind.Sheep,
        hx,
        hz,
        Math.min(b.w, b.h) / 2 - PASTURE_INSET,
        SHEEP_PER_PASTURE,
        b.id,
        // The shepherd's hut stands in the south-east corner beside the work
        // tile, exactly as the Farm's does.
        { x: b.x + b.w - 0.75, z: b.y + b.h - 0.75, r: HUT_CLEAR },
      );
      this.herds.set(b.id, herd);
    }
  }

  /** The wilds' herds, derived once from the world seed and the terrain. */
  private syncDeer(): void {
    for (let i = 0; i < DEER_HERDS; i++) {
      const key = -(i + 1);
      if (this.herds.has(key)) continue;
      const home = this.deerHome(i);
      // A seed whose wilds offer this herd nowhere legal simply has one fewer
      // herd; it is retried on the next frame, which costs a few dozen hashes.
      if (!home) continue;
      this.herds.set(key, this.makeHerd(FaunaKind.Deer, home.x, home.z, DEER_RADIUS, DEER_PER_HERD, key));
    }
  }

  private makeHerd(
    kind: FaunaKindValue,
    hx: number,
    hz: number,
    radius: number,
    count: number,
    salt: number,
    avoid?: Herd["avoid"],
  ): Herd {
    const herd: Herd = { kind, hx, hz, radius, avoid, creatures: [] };
    const seed = this.sim.world.seed;
    for (let i = 0; i < count; i++) {
      // Derived, not random: the same anchor puts the same animals in the same
      // places after a reload, with nothing stored anywhere. The golden-angle
      // nudge is what keeps that true while still stepping off a spot the
      // derivation happened to put inside the hut.
      const base = hash(salt, i * 7 + 1, seed ^ DEER_SALT) * Math.PI * 2;
      const r = Math.sqrt(hash(salt, i * 7 + 2, seed ^ DEER_SALT)) * radius;
      let x = hx + Math.cos(base) * r;
      let z = hz + Math.sin(base) * r;
      for (let k = 1; k <= TARGET_TRIES && !this.standable(herd, x, z); k++) {
        const a = base + k * 2.39996;
        x = hx + Math.cos(a) * r;
        z = hz + Math.sin(a) * r;
      }
      herd.creatures.push({
        x,
        z,
        heading: base,
        tx: x,
        tz: z,
        graze: hash(salt, i * 7 + 3, seed ^ DEER_SALT) * (GRAZE_MIN + GRAZE_SPAN),
        gait: 0,
      });
    }
    return herd;
  }

  /** One herd's tick of the mockup's loop: graze, or walk, or pick again. */
  private walk(herd: Herd, dt: number, cx: number, cz: number): void {
    const speed = SPEED[herd.kind];
    for (const c of herd.creatures) {
      if (c.graze > 0) {
        c.graze -= dt;
        continue;
      }
      const dx = c.tx - c.x;
      const dz = c.tz - c.z;
      const d = Math.hypot(dx, dz);
      if (d < ARRIVED) {
        c.graze = GRAZE_MIN + Math.random() * GRAZE_SPAN;
        // A herd whose home offers no legal target at all re-homes outward
        // rather than standing frozen on it — ARCHITECTURE's Gotcha 8, which
        // is this exact machine: the mockup's deer rejected every roam target
        // and froze on their home tiles for the rest of the game.
        if (!this.retarget(herd, c)) this.rehome(herd, cx, cz);
        continue;
      }
      const step = Math.min(d, speed * dt);
      c.x += (dx / d) * step;
      c.z += (dz / d) * step;
      c.heading = Math.atan2(dx, dz);
      c.gait += step;
    }
  }

  /** Pick a fresh target inside the home radius. False when none is legal. */
  private retarget(herd: Herd, c: Creature): boolean {
    for (let i = 0; i < TARGET_TRIES; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * herd.radius;
      const x = herd.hx + Math.cos(a) * r;
      const z = herd.hz + Math.sin(a) * r;
      if (!this.standable(herd, x, z)) continue;
      c.tx = x;
      c.tz = z;
      return true;
    }
    return false;
  }

  /**
   * Move a herd's home further from the colony and take its targets with it.
   *
   * The trigger is the herd's **own failure to find a target**, not a
   * notification: homes are derived once and enclosure grows wherever the
   * player builds, so a wall closing round a herd is a matter of time, and
   * there is no event anywhere that says the enclosure grew. One step at a
   * time, so a walled-in herd drifts out rather than teleporting.
   */
  private rehome(herd: Herd, cx: number, cz: number): void {
    let ax = herd.hx - cx;
    let az = herd.hz - cz;
    const len = Math.hypot(ax, az);
    // A herd sitting exactly on the colony centre has no outward direction of
    // its own; give it one rather than dividing by zero.
    if (len < 0.001) {
      ax = 1;
      az = 0;
    } else {
      ax /= len;
      az /= len;
    }
    const size = this.sim.world.size;
    for (let step = 1; step <= HOME_TRIES; step++) {
      const x = herd.hx + ax * REHOME_STEP * step;
      const z = herd.hz + az * REHOME_STEP * step;
      if (x < EDGE || z < EDGE || x > size - EDGE || z > size - EDGE) return;
      if (!this.grazeable(herd.kind, x, z)) continue;
      herd.hx = x;
      herd.hz = z;
      return;
    }
  }

  /**
   * May this creature stand here? Grass, on the map — and for deer, **outside
   * every enclosure**: a deer does not graze the courtyard.
   *
   * A sheep's pasture is levelled buildable ground inside a fence, so the
   * terrain test is all it needs, and a pasture inside the walls must obviously
   * not disqualify its own flock.
   */
  /** `grazeable`, plus the herd's own keep-out square. */
  private standable(herd: Herd, x: number, z: number): boolean {
    if (!this.grazeable(herd.kind, x, z)) return false;
    const a = herd.avoid;
    return !a || Math.abs(x - a.x) > a.r || Math.abs(z - a.z) > a.r;
  }

  private grazeable(kind: FaunaKindValue, x: number, z: number): boolean {
    const world = this.sim.world;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= world.size || tz >= world.size) return false;
    const i = tileIndex(tx, tz, world.size);
    if (world.tmap[i] !== Terrain.Grass) return false;
    if (kind === FaunaKind.Deer && insideLayer(this.sim)[i]) return false;
    return true;
  }

  /**
   * Where herd `index` lives, from the world seed and the terrain alone — never
   * from the enclosure, so the derivation is stable across a load however much
   * wall the player has since drawn. A home the colony has swallowed is the
   * re-homing rule's business, not this one's.
   */
  private deerHome(index: number): { x: number; z: number } | null {
    const world = this.sim.world;
    const cx = world.size / 2;
    const cz = world.size / 2;
    for (let k = 0; k < HOME_TRIES; k++) {
      const a = hash(index * 131 + k, 1, world.seed ^ DEER_SALT) * Math.PI * 2;
      const t = hash(index * 131 + k, 2, world.seed ^ DEER_SALT);
      const r = DEER_HOME_MIN + t * (DEER_HOME_MAX - DEER_HOME_MIN);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (x < EDGE || z < EDGE || x > world.size - EDGE || z > world.size - EDGE) continue;
      if (!this.grazeable(FaunaKind.Deer, x, z)) continue;
      return { x, z };
    }
    return null;
  }
}
