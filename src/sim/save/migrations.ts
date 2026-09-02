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

/** Empty at `SAVE_VERSION = 1`: nothing older than the current format exists. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};
