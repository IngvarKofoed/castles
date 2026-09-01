# Persistence: saves that cannot drift

Build-order step 5, pulled forward per ARCHITECTURE.md's own note ("as soon
as the store shape settles — earlier than feels natural"). The whole `Sim`
store becomes a versioned, gzipped snapshot: autosaved to IndexedDB on a
small ring, saved to named manual slots, and exportable as a `.castles`
file that is byte-for-byte the same blob — with a pure codec inside the sim
boundary and all I/O behind an app-side storage interface the future Tauri
wrap will swap.

## Key decisions

- **The purity split** (extends the sim boundary). ARCHITECTURE places
  saves in `sim/save/`, but IndexedDB, downloads, and clocks are browser
  APIs the boundary bans. So `sim/save/` owns the *pure* half —
  `encode(sim): Uint8Array`, `decode(bytes): Sim`, `SAVE_VERSION`, the
  migrations ladder — and a new `src/app/storage.ts` owns the I/O half
  behind a `SaveStorage` interface (list/get/put/delete). Timestamps are
  assigned app-side: `Date.now` stays banned in `sim/`.
- **One byte format everywhere** (reuses ARCHITECTURE). The blob in
  IndexedDB *is* the `.castles` file: export downloads the same bytes,
  import is just load. Format: gzip (via `CompressionStream`) of a JSON
  envelope `{v, seed, tick, app, state}` where typed arrays are tagged
  (`{__ta: "u8" | "u32", d: base64}`). No second serialization path to
  drift.
- **Whole-store snapshot, no special cases** (reuses the plain-data rule).
  Every `Sim` field saves verbatim — `chunkVersion`, task cooldowns, all of
  it. Nothing is derived-on-save or reconstructed-on-load except the
  renderer's own caches, which rebuild anyway (a fresh `ChunkRenderer`
  treats every chunk as unseen).
- **Load rebuilds the sim-bound stack** (new). `ChunkRenderer`,
  `MoverRenderer`, and `Hud` capture `sim` at construction; a load
  therefore tears them down (disposing meshes) and reconstructs them around
  the decoded `Sim`, rather than threading a mutable reference through
  everything. Cheapest correct thing; no stale-capture bugs possible.
- **Migrations ladder, fail loudly** (reuses the ARCHITECTURE policy).
  `SAVE_VERSION = 1`; loading an older version runs it through an ordered
  array of pure migration functions; a newer version, unknown bytes, or a
  failed gunzip/parse shows a plain error in the menu panel and loads
  nothing — never garbage, never a partial store.
- **Autosave ring + named slots** (new). Three autosave slots written
  round-robin at every game-day rollover (`DAY_TICKS` already exists) and
  on `visibilitychange → hidden`; manual saves are named slots. Metadata —
  name, kind, savedAt, day, population, seed, save + app version — lives
  beside the blob as plain IndexedDB record fields, so listing saves never
  decodes one.
- **Menu panel per the styleguide** (reuses). A centre panel in the house
  language: save-with-name, the saves list (each row: load / export /
  delete), import, new colony. Opened by a ribbon Menu button or Escape
  when no tool is active (Escape with a tool active already cancels the
  tool — that stays). The game pauses while it is open.
- **The drift-free proof** (extends the golden test). Determinism plus
  whole-store snapshots make saves provable: save at tick T, load, advance
  to T+N — the store hash (`src/sim/hash.ts`) must equal an uninterrupted
  run's hash at T+N. This test is the feature's contract.

## Goals

- A colony survives a reload without the player doing anything (autosave +
  resume), and can be kept forever as a named save or a `.castles` file.
- Loading is exact: a loaded game continues as if it had never stopped.
- The store shape is now consciously frozen — any future field addition
  goes through `SAVE_VERSION` and a migration, loudly.
- The Tauri swap later touches exactly one file (`app/storage.ts`).

## Non-goals

- No command-log replays — snapshots only; the command seam stays ready
  for them later.
- No cloud saves, no save thumbnails, no compression tuning, no web-worker
  off-threading (the store is well under a megabyte; encode+gzip is a
  frame-time blip, measured before optimizing).
- No new dependencies. The IndexedDB layer is thin enough to verify in the
  browser rather than mock in Vitest.
- No Tauri implementation — only the interface it will implement.

## Design

### The codec (`src/sim/save/`)

`codec.ts`: `encode(sim)` walks the store with a JSON replacer that tags
typed arrays; the envelope records `v: SAVE_VERSION`, `seed`, `tick`, and
`app` (the git-describe `VERSION`, informational only — compatibility
decisions use `v` alone). Bytes are gzipped with `CompressionStream` and
returned as `Uint8Array`. `decode(bytes)` reverses it: gunzip, parse,
migrate (below), revive typed arrays, return a `Sim`. Round-trip identity
— `decode(encode(sim))` hash-equal to the source — is a unit test, since
the codec is pure and needs no browser.

`migrations.ts`: `const MIGRATIONS: ((raw: unknown) => unknown)[]` indexed
by from-version, empty today. `decode` applies `raw.v ≤ SAVE_VERSION`
migrations in order; anything else throws a typed `SaveError` with a
player-readable message.

### Storage (`src/app/storage.ts`)

```ts
interface SaveStorage {
  list(): Promise<SaveMeta[]>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array, meta: SaveMeta): Promise<void>;
  delete(key: string): Promise<void>;
}
```

`IndexedDbStorage` implements it (one object store, key = slot id,
value = `{meta, blob}`). Keys: `auto-0..2` and `save-<id>` for named
slots. Export streams `get()`'s bytes to a download named
`<colony-name>-day<N>.castles`; import reads a `File`, decodes, and — on
success — loads it and writes it to a named slot so it appears in the
list. Decode failure (wrong file, corrupt, newer version) surfaces as the
panel error text; nothing changes.

### Boot, autosave, load

Boot order in `main.ts`: a `?seed=` URL parameter always starts a fresh
`createSim(seed)` (the screenshot/debug path, unchanged); otherwise the
newest save by `savedAt` — auto or manual — is loaded; no saves means a
fresh default-seed world. A boot-load failure shows the error and falls
back to a fresh world; manual slots are never touched by that fallback,
and the autosave ring only cycles once the fresh world reaches its first
rollover.

Autosave runs in the frame loop, app-side, watching `sim.tick` cross a
day boundary: encode → `put` to the next ring slot. JavaScript's
single-threadedness means encode always sees a between-ticks store — saves
are coherent by construction. `visibilitychange → hidden` triggers the
same write immediately.

Load (from boot, the menu, or import): decode, dispose the current
`ChunkRenderer`/`MoverRenderer`/`Hud`, reconstruct them around the new
`Sim`, clear the queued command list, keep the camera where it is. The
console line (seed + world hash) reprints for the loaded state, so
determinism stays checkable by eye.

### The menu

Ribbon gains a Menu button (right of the speed group); Escape opens it
when no tool is active. Opening forces pause; closing restores the prior
speed. The panel, in styleguide anatomy: a name field plus Save action;
the saves list — `name · Day N · 5 folk · <date>` per row with Load,
Export, Delete; Import (file picker); New colony (fresh default-seed
world after a confirm row — the one destructive-ish action, guarded by a
second click, not a dialog). Errors are the panel's italic note row —
the house voice, no toasts.

## Alternatives considered

- **Structured-clone straight into IndexedDB** (no codec, no gzip for the
  local path) — faster to build, but it forks the format: exports would
  need a second serializer, and "the file is the blob" dies. Rejected.
- **Command-log saves (replay from seed)** — tiny files and free replays,
  but load time grows with colony age and every sim bugfix invalidates old
  saves. Snapshots are the product; the log seam stays for tooling later.
- **A mutable `sim` reference threaded through renderers/HUD** — avoids
  teardown on load but invites stale-capture bugs in every consumer;
  rebuild is simpler and load is rare.
