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
};

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
