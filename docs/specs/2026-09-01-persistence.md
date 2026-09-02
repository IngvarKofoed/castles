# Persistence: saves that cannot drift

Build-order step 5, pulled forward per ARCHITECTURE.md's own note ("as soon
as the store shape settles — earlier than feels natural"). The whole `Sim`
store becomes a versioned, gzipped snapshot: autosaved to IndexedDB on a
small ring, saved to named manual slots, and exportable as a `.castles`
file that is byte-for-byte the same blob — with a pure codec inside the sim
boundary and all I/O behind an app-side storage interface the future Tauri
wrap will swap.

## Outcome

**What you get:**

- Colonies survive: an autosave every in-game day (ring of three) plus a
  best-effort save on tab-hide, and boot resumes the newest loadable save
  automatically — leaving costs at most the last game-day, usually
  nothing.
- Named manual saves, and a `.castles` file you own: export downloads it,
  import loads it — the same bytes as the local save.
- Exact loads: a loaded colony continues as if it had never stopped,
  provably, not approximately.
- A menu panel in the house style — save, load, export, import, delete,
  new colony — on the ribbon and on Escape.

**How to verify:**

- Play a couple of in-game days, close the tab, reopen: the colony is back
  exactly where it was, with no action taken.
- Save with a name, chop a few more trees, load that save: the trees stand
  again. Export it, delete the slot, import the file: it reappears and
  loads.
- The drift proof: save at tick T, load, run on — the console's store hash
  matches an uninterrupted run at the same tick (and the automated test of
  the same claim passes in `npm test`).
- Import a garbage or future-version file: a quiet error line in the
  panel, and nothing about the running game changes.

## Key decisions

- **The purity split** (extends the sim boundary). ARCHITECTURE places
  saves in `sim/save/`, but IndexedDB, downloads, and clocks are browser
  APIs the boundary bans. So `sim/save/` owns the *pure* half —
  `encode(sim): Promise<Uint8Array>`, `decode(bytes): Promise<Sim>`,
  `SAVE_VERSION`, the migrations ladder — and a new `src/app/storage.ts`
  owns the I/O half
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
- **Menu panel: a named styleguide exception** (extends). A centre modal
  panel in the house language — the one allowed centre element, because
  the game pauses behind it; added to `docs/STYLEGUIDE.md` as a component
  by this change. Save-with-name, the saves list (load / export / delete
  per row), import, new colony. Opened by the ribbon Menu button, or by
  Escape at the end of its ladder: tool → selection → menu, one step per
  press.
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

`codec.ts`: `encode(sim): Promise<Uint8Array>` runs in two strictly
ordered halves: a **synchronous** snapshot first — the `JSON.stringify`
walk, with a replacer tagging typed arrays as
`{__ta: "u8" | "u32", d: base64}`, where the base64 encodes the array's
**little-endian bytes** (pinned in writing here, because this is the file
format forever) — then async gzip via `CompressionStream`. The synchronous
snapshot is what makes every save coherent: the store is captured whole
before anything awaits. The envelope records `v: SAVE_VERSION` plus
`seed`, `tick`, and `app` — all three informational, for tooling and the
saves list; `state` is the whole `Sim` verbatim and is the sole authority
on decode. `decode` reverses it: gunzip, parse, migrate (below), revive
typed arrays. Round-trip identity — `decode(encode(sim))` hash-equal to
the source — is a unit test: `CompressionStream` is a JS-runtime global
(Node 18+ included), so the codec stays Vitest-testable. Amend
`src/sim/CLAUDE.md`'s "no browser APIs" phrasing to "no DOM or rendering
APIs" as part of this change — compression streams are runtime-standard,
not browser-only.

`migrations.ts`: `const MIGRATIONS: ((raw: unknown) => unknown)[]` indexed
by from-version, empty today. `decode` applies `raw.v ≤ SAVE_VERSION`
migrations in order; anything else throws a typed `SaveError` with a
player-readable message. A version-1 `.castles` fixture is committed
alongside, with a test that it loads forever — ARCHITECTURE's "migrations
tested against fixture saves" starts now, while v1 is cheap to freeze.

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
slots. The export/import *file* plumbing — the download anchor and the
`File` picker — also lives in `app/storage.ts`, since those are exactly
what the Tauri build replaces; that is what keeps the one-file-swap goal
honest. Export downloads `castles-day<N>-seed<seed>.castles` (no colony
name exists yet); import reads a `File`, decodes, and — on success —
loads it and writes it to a named slot, name = the filename stem
(deliberate: importing keeps a local copy). Saving under an existing name
overwrites that slot — the name is the key. Autosaves display as
"Autosave · Day N". Decode failure (wrong file, corrupt, newer version)
surfaces as the panel error text; nothing changes.

Two storage realities get a sentence each instead of silence. **Single
instance:** boot takes a Web Lock (`navigator.locks`) on the colony; a
second tab gets a plain "already open in another tab" screen instead of
silently racing the autosave ring. **Write failure:** a rejected `put`
(quota, blocked storage) records an error string shown as the menu's note
row, and a boot where IndexedDB itself is unavailable starts a fresh
world with saving visibly disabled in the menu.

### Boot, autosave, load

Boot order in `main.ts`: a `?seed=` URL parameter always starts a fresh
`createSim(seed)` — and that session **never writes autosaves** (manual
saves still work), so a debug world can neither evict the player colony's
ring nor become "newest" and hijack the next plain boot. Otherwise boot
walks the saves **newest to oldest** by `savedAt` — auto and manual
alike — and loads the first that decodes; a fresh default-seed world only
when none exist or all fail. After any fallback, every ring write
(rollover *and* tab-hide) stays suppressed until the fresh world's own
first rollover, so one corrupt newest save can never cascade into good
older saves being overwritten. The failure surfaces by auto-opening the
menu with the error in its note row.

Autosave runs in the frame loop, app-side, comparing **day indices**
(`floor(tick / DAY_TICKS)`) — never `tick % DAY_TICKS === 0`, which
`MAX_TICKS_PER_FRAME` can step over — and re-baselining whenever a load
replaces the sim, so loading never fires a spurious save. The ring slot
written is always the **oldest by `savedAt`**, not an in-memory counter.
The write is `encode` (synchronous snapshot, then async gzip) → `put`.
`visibilitychange → hidden` triggers the same write immediately,
best-effort: a killed tab can lose it, which the day ring bounds to at
most one game-day (about a real minute at ×1) — the Outcome promises that
bound, not magic. Cadence deliberately rides `DAY_TICKS`: retuning day
length retunes autosave spacing; accepted, and noted beside the constant.

Load (from boot, the menu, or import): decode, dispose the current
session, rebuild it around the new `Sim`, clear the queued command list,
keep the camera where it is. Concretely, `main.ts` refactors its
module-scope nest — `sim`, `world`, the pointer handlers and ghost
closures, the HUD hookup — into a `buildSession(sim)` that returns a
dispose, and `Hud` gains a dispose of its own (it currently registers a
window keydown listener and appends to `document.body` with no teardown;
an undead HUD would keep eating Escape presses forever). On every save
and load the console prints `tick` plus `hashSim(sim)` — the real store
hash, not the static world hash — which is what makes the drift check
performable by eye as well as by test.

### The menu

Ribbon gains a Menu button (right of the speed group). Escape follows one
ladder, one step per press, in a single handler: an active tool → drop the
tool; else a selection → clear it; else toggle the menu. The Menu button
always works — with a tool active it drops the tool and opens. Opening
forces pause; closing restores the prior speed (a game already paused
stays paused).

The menu is a **centre modal panel** — a deliberate, named exception to
the styleguide's panels-hug-the-edges rule, allowed because the game is
paused behind it. The builder adds it to `docs/STYLEGUIDE.md` as a
component (same panel anatomy, ~320px, centred) as part of this change:
the guide and the game must not disagree. Contents: a name field plus
Save action; the saves list — `name · Day N · 5 folk · <date>` per row
with Load, Export, Delete; Import (file picker); and New colony with a
**fresh random seed** (app-side, `Date.now`-derived — allowed outside
`sim/`; the seed rides the save), because dealing the identical default
map to every "new" colony reads as broken. Boot fallbacks and `?seed=`
keep the deterministic default worlds; New colony is the one place
variety enters. It is guarded by a second click, not a dialog. Errors are
the panel's italic note row — the house voice, no toasts.

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

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread: the codec, storage layer, boot
  logic, menu, and the `buildSession` refactor of `main.ts` all interlock —
  and that refactor is the risk centre, needing the whole app's context.
  Build the codec + round-trip and fixture tests first (pure, fast
  feedback), then storage, then the session refactor, then the menu;
  verify against the Outcome section at the end, browser checks included.
