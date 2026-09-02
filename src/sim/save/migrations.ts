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
   *
   * The size is read off the save's own world rather than `WORLD_SIZE` — a
   * migration describes the file it is handed, not the build reading it. A
   * nonsense size yields zero-length layers and `assertSim` refuses the save,
   * which is the correct outcome: this rung guesses at nothing.
   */
  1: (state) => {
    const s = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
    const world = s.world && typeof s.world === "object" ? (s.world as Record<string, unknown>) : {};
    const size = typeof world.size === "number" && Number.isInteger(world.size) && world.size > 0 ? world.size : 0;
    const tiles = size * size;
    return {
      ...s,
      wallMap: new Uint8Array(tiles),
      razeMap: new Uint8Array(tiles),
      insideMap: new Uint8Array(tiles),
      enclosureDirty: 0,
    };
  },
};
