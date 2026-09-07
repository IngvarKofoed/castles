/**
 * The migrations ladder: how an old save becomes a current one.
 *
 * **Keyed by from-version** — `MIGRATIONS[1]` turns a version-1 state into a
 * version-2 state. `decode` walks the ladder one rung at a time from the
 * save's version up to `SAVE_VERSION`, so every migration only ever has to
 * know about the single step it performs.
 *
 * Append-only, per docs/ARCHITECTURE.md's versioning policy: a landed
 * migration is never edited, because saves in the wild still go through it.
 * Adding a rung means bumping `SAVE_VERSION`, writing the function here, and
 * leaving `fixtures/v1.castles` exactly as it is — that fixture failing to
 * load *is* the alarm, and it is meant to be loud.
 *
 * Pre-1.0 the escape hatch ARCHITECTURE allows is a refusal, not a guess: if a
 * store change is too deep to migrate, leave the rung out. `decode` then fails
 * with a plain message rather than loading something half-shaped.
 */
import { spawnLairs } from "../threats/lairs";
import type { Sim } from "../store";
import { WANDERER_INTERVAL } from "../tuning";
import { recomputeEnclosure } from "../walls/enclosure";
import { WORLD_SIZE, generate } from "../world/world";

export type Migration = (state: unknown) => unknown;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /**
   * 1 → 2: walls. A v1 colony has no wall graph, so it gains three zero-filled
   * layers and a clean enclosure flag; `decode` recomputes `insideMap` from
   * `wallMap` afterwards, so the zeroes here are a shape rather than a claim
   * (docs/specs/2026-09-02-palisade-walls.md).
   *
   * **Task kinds need no migration**, which is the whole reason `BuildWall`
   * and `Raze` were appended to `TaskKind` rather than slotted into its
   * priority order: a v1 save's live tasks still mean exactly what they meant.
   * The same held when `Mine` and `Terraform` were appended for v3, and it
   * keeps holding for exactly as long as nobody inserts.
   */
  1: (state) => {
    const s = object(state);
    const tiles = tileCount(s);
    return {
      ...s,
      wallMap: new Uint8Array(tiles),
      razeMap: new Uint8Array(tiles),
      insideMap: new Uint8Array(tiles),
      enclosureDirty: 0,
    };
  },

  /**
   * 2 → 3: the stone tier. Two zero-filled intent layers — nothing was
   * designated for quarrying or levelling in a v2 colony — **and the two new
   * stockpile filters stamped on to every building that already exists.**
   *
   * That second half is the whole reason this rung is more than a line. The
   * accept flags are per-good fields on `Building`, and a v2 building has no
   * `acceptRock`/`acceptBlock` at all: left alone they read as `undefined`,
   * `stockpileAccepts` refuses, and every stockpile in every migrated colony
   * would quietly refuse rock and blocks *forever* while the mason jammed at
   * output cap. Nothing would error; the colony would simply stop working, and
   * the player would have no way to tell why.
   *
   * Stamped to 1, matching what `place` gives a new building — a v2 player
   * never chose to exclude a good that did not exist, so the default is the
   * only honest reading of their intent.
   */
  2: (state) => {
    const s = object(state);
    const tiles = tileCount(s);
    return {
      ...s,
      mineMap: new Uint8Array(tiles),
      terraformMap: new Uint8Array(tiles),
      buildings: Array.isArray(s.buildings)
        ? // Non-object entries pass through untouched so `assertSim` still
          // refuses the save rather than this rung papering over it.
          s.buildings.map((b) =>
            b && typeof b === "object" ? { ...(b as Record<string, unknown>), acceptRock: 1, acceptBlock: 1 } : b,
          )
        : s.buildings,
    };
  },

  /**
   * 3 → 4: monsters. Two zero-filled layers — nothing has been bitten and
   * nobody has died in a colony that never had anything to fear — **and the
   * lair pass run over the save's own world**, so an old colony wakes up in a
   * wilderness that has always been there. Resting, at first: the pass seeds
   * each monster's phase from its own periods, so most of them are asleep on
   * the tick the save resumes.
   *
   * Running the pass rather than shipping an empty `monsters` array is the
   * whole point of this rung. Its draws come from a stream derived from the
   * world seed alone — never `rngState`, never the colony — which is what
   * makes a migrated v3 save and a fresh game on the same seed wake **the same
   * monsters at the same lairs on the same rhythms**. The ids differ, because
   * they come off the save's own counter; nothing else does.
   *
   * The colony enters in exactly one place, and only as a veto: **ground the
   * save has already claimed — enclosed ground, and every tile carrying a
   * wall — is refused a den** (`enclosedBefore`, which explains why both
   * halves are needed). Lair ground is never "inside" (see `walls/enclosure`),
   * so a den waking within an old ring would turn that colony's whole interior
   * to open country on load, which the player never chose and cannot undo.
   *
   * **The equality above holds exactly while the veto never fires**, which is
   * the ordinary case: a v3 ring is small and `LAIR_SPACING` keeps dens off it.
   * When it *does* fire, the wilderness is a near-miss rather than a match, and
   * that is unavoidable rather than an oversight — a rejected draw spends the
   * tile draw but not the monster's own (its kind, hours and four waypoints,
   * a variable number of values), and the rejection also changes what `placed`
   * holds and therefore which later draws the spacing rule refuses. So dens
   * before the rejection are identical, the ones after it are drawn from the
   * same gradient but not the same values. Filtering the candidate list instead
   * would shift *every* draw including the first, which is strictly worse.
   *
   * The pass mints ids through `nextId`, so this rung hands it the real store
   * shape rather than a partial one. `assertSim` still has the last word on
   * whether what comes out is a save at all.
   */
  3: (state) => {
    const s = object(state);
    const tiles = tileCount(s);
    const next: Record<string, unknown> = {
      ...s,
      monsters: [],
      wallDamageMap: new Uint8Array(tiles),
      graveMap: new Uint8Array(tiles),
    };
    // The pass reads a world **regenerated from the save's seed**, not the
    // save's own layers: those have been chopped and quarried, and the pass
    // filters on exactly those two layers, so reading them would hand a played
    // colony a different wilderness than a fresh game on its seed. Regenerating
    // is what makes "the same seed is the same world" survive the rung.
    //
    // Guarded, because a rung may be handed anything: `spawnLairs` is live sim
    // code and would throw a raw TypeError on a malformed world, which would
    // escape `decode` as something other than a `SaveError` and put a stack
    // trace in the menu's note row. A save that fails these checks passes
    // through with no monsters and `assertSim` refuses it properly.
    //
    // The size check is part of that guard rather than pedantry: `generate`
    // always builds at this build's `WORLD_SIZE`, and the pass writes circuit
    // *tile indices*, so a save from a differently sized world would get a
    // wilderness indexed against the wrong grid. No such save exists; skipping
    // is the safe answer if one ever does.
    const world = object(s.world);
    if (tiles > 0 && typeof next.nextId === "number" && typeof world.seed === "number" && world.size === WORLD_SIZE) {
      spawnLairs(next as unknown as Sim, generate(world.seed), enclosedBefore(next, tiles));
    }
    return next;
  },

  /**
   * 4 → 5: housing. Two defaults and nothing else — a v4 colony has no House,
   * so it has nobody walking in and nothing to walk to
   * (docs/specs/2026-09-07-housing-wanderers.md).
   *
   * **`dest` on every colonist is the half that cannot be skipped.** Left
   * missing it reads as `undefined`, `c.dest >= 0` is false and the colony
   * would appear to work — but the field is in the hash, in the save, and in
   * `stepColonists`' first branch, and a store that carries `undefined`
   * anywhere breaks the plain-data rule the whole format rests on. Stamped to
   * -1, which is what a colonist who lives here has always meant.
   *
   * `wandererTimer` gets a full interval, exactly as `createSim` gives a fresh
   * colony — the clock does not run until a House stands, so an old save is not
   * owed a head start it never earned, and it is not banking one either. Read
   * from the tunable rather than frozen as a number on purpose: a retuned
   * interval should reach a migrated colony as well as a new one, and the
   * fixture pins are what make that visible when it happens.
   */
  4: (state) => {
    const s = object(state);
    return {
      ...s,
      wandererTimer: WANDERER_INTERVAL,
      colonists: Array.isArray(s.colonists)
        ? // Non-object entries pass through untouched so `assertSim` still
          // refuses the save rather than this rung papering over it.
          s.colonists.map((c) => (c && typeof c === "object" ? { ...(c as Record<string, unknown>), dest: -1 } : c))
        : s.colonists,
    };
  },

  /**
   * 5 → 6: the patience clock gets its own field.
   *
   * v5 kept the wanderer's give-up clock in `work`, whose documented meaning is
   * task progress — the exact type pun the format's own rules forbid, and one
   * whose correctness rode on `abandonForFlight` and `clearWorker` happening to
   * zero it. `patience` is now a field of its own and `work` means only what it
   * says (docs/specs/2026-09-07-housing-wanderers.md, the 2026-09-07
   * amendment).
   *
   * **0 is the honest default, including for the one colonist it could be wrong
   * for.** A v5 save taken while a wanderer was *stuck* carries their elapsed
   * wait in `work`, and this rung deliberately does not read it across: `work`
   * is written by half a dozen systems, so a number found there means "task
   * progress" far more often than it means "waiting", and a settled colonist
   * mid-chop would arrive with a phantom clock. The cost is bounded and
   * invisible — one wanderer, in one save, waits up to two game-days longer
   * than they had left. Guessing the other way could only ever make somebody
   * vanish sooner than the save implied.
   */
  5: (state) => {
    const s = object(state);
    return {
      ...s,
      colonists: Array.isArray(s.colonists)
        ? s.colonists.map((c) => (c && typeof c === "object" ? { ...(c as Record<string, unknown>), patience: 0 } : c))
        : s.colonists,
    };
  },
};

/**
 * Ground this save's colony has already claimed, as a per-tile mask: everything
 * it had enclosed, **plus every tile carrying a wall**.
 *
 * The enclosure half is computed here rather than trusted from the file:
 * `insideMap` is derived, a migrating save's copy may be stale or hand-edited,
 * and `decode` recomputes it after every rung anyway. So the layer is replaced
 * with a fresh one of the right length and the real fill runs over the save's
 * own `wallMap` — with `monsters` still empty, so it seeds from the map edge
 * alone and answers exactly the question being asked: *what was inside before
 * any den existed?* The write is deliberate and harmless: `decode`'s own
 * recompute overwrites it a moment later, that time with the new dens seeding
 * it too.
 *
 * **The wall half is not belt-and-braces, it is the same failure by a different
 * door.** A wall tile is never "inside" (the enclosure excludes the ground
 * under a segment), so masking enclosed tiles alone still lets a den land *on*
 * the ring — and since a lair seeds the flood unconditionally, one den on a
 * segment floods the interior behind it and the colony loses its enclosure
 * exactly as if the den had been placed in the middle. Refusing wall tiles also
 * makes the rung agree with the live rule: `canPlaceWall` refuses a lair tile,
 * so a den under a standing segment is a state the game never otherwise
 * produces.
 *
 * Guarded on the wall layer for the same reason the rung guards the world: this
 * is live sim code, and a save missing or mis-sizing `wallMap` would throw a
 * raw TypeError straight out of `decode`, which promises a `SaveError` or a
 * whole store and nothing else. A save that fails the check claims nothing as
 * far as this pass is concerned, and `assertSim` refuses it a moment later.
 */
function enclosedBefore(next: Record<string, unknown>, tiles: number): Uint8Array {
  const claimed = new Uint8Array(tiles);
  const wall = next.wallMap;
  if (!(wall instanceof Uint8Array) || wall.length !== tiles) return claimed;

  const inside = new Uint8Array(tiles);
  next.insideMap = inside;
  recomputeEnclosure(next as unknown as Sim);
  // Copied out rather than OR-ed in place, so what stays on the state is a
  // truthful `insideMap` rather than a mask wearing its name — even though
  // `decode` is about to recompute it anyway.
  for (let i = 0; i < tiles; i++) claimed[i] = inside[i] || wall[i] !== 0 ? 1 : 0;
  return claimed;
}

function object(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

/**
 * Tiles in the save's **own** world. Read off the file rather than from
 * `WORLD_SIZE`: a migration describes the save it is handed, not the build
 * reading it. A nonsense size yields zero-length layers and `assertSim`
 * refuses the save, which is the correct outcome — a rung guesses at nothing.
 */
function tileCount(s: Record<string, unknown>): number {
  const world = object(s.world);
  const size = typeof world.size === "number" && Number.isInteger(world.size) && world.size > 0 ? world.size : 0;
  return size * size;
}
