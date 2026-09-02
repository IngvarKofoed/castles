# Colonies survive: versioned, gzipped save snapshots

The colony now persists. An autosave ring of three writes at every in-game day
rollover and on tab-hide, and boot silently resumes the newest save that
decodes. Named saves, `.castles` export/import (the same bytes), and a centre
modal menu on the ribbon or on Escape. Loading is exact, and tested to be:
save at T, load, run on — the store hash equals an uninterrupted run's.
Implements `docs/specs/2026-09-01-persistence.md` (build-order step 5), and
closes `2026-09-01-tick-and-labour`'s "no test or browser check covers
save/load".

## Detail

**The purity split moved the storage interface out of `sim/`.** ARCHITECTURE.md
put the whole of persistence in `sim/save/`; that section is rewritten, because
IndexedDB, the download anchor, the file picker and `Date.now` are exactly the
APIs the boundary bans. `sim/save/` is now only `encode` / `decode` /
`SAVE_VERSION` / `MIGRATIONS`, and `app/storage.ts` is the one file the Tauri
wrap replaces. `src/sim/CLAUDE.md`'s "no browser APIs" became **"no DOM or
rendering APIs"**: `CompressionStream` and `TextEncoder` are JS-runtime
globals, and allowing them is what keeps the codec a plain Vitest unit test
rather than something only a browser can exercise.

**`encode` is a plain function returning a promise, not an `async` one.** The
`JSON.stringify` walk is its first statement, so the store is captured whole
before anything awaits — the ordering is structural rather than a comment
someone can drift past. `decode` is the mirror: whole store or `SaveError`,
never a partial one, so nothing downstream needs a defensive read.

**Format decisions that are now permanent**, since they are the file format:
base64 of **explicit little-endian** bytes, written byte by byte rather than
read off the platform's buffer; and a hand-rolled base64 rather than `btoa`,
so the codec behaves identically in the browser, in Vitest, and in whatever
the desktop wrap runs on.

**`MIGRATIONS` is a record keyed by from-version, not the spec's array.** Same
ladder, but an array "indexed by from-version" has a permanent hole at index 0
(there is no version 0) that every future rung has to write around.

**`fixtures/v1.castles` is frozen — never regenerate it.** It decodes to hash
`5d843ae6`. Regenerating it silences the one alarm the versioning policy has.

**That pinned hash is not the drift alarm, though, and cannot be.** Decoding a
frozen file is a function of the bytes and the codec alone — nothing in
`store.ts` participates — so adding a field to `Colonist` leaves the hash at
`5d843ae6` and every fixture assertion green while a v1 save quietly loads with
the field missing. The alarm is a separate test that re-runs the fixture's own
recipe with the current build and compares **key sets**, store and world and
one of each entity kind; key sets rather than hashes, so retuning the labour
numbers changes the colony a recipe produces without reading as a broken save
format. Verified by adding a field to `Colonist`: the shape test fails, the
other three still pass.

**IndexedDB writes await the transaction, not the request.** A `put` can
report success and the transaction still abort on commit, which is how quota
overruns arrive — resolving on the request would have told the player their
colony was saved when it was not.

**Two readings of the spec, recorded because they were judgement calls.** The
fallback-boot ring suppression lifts *at* the fresh world's first rollover and
that rollover writes — a full game-day of play is what earns the ring, and
before it a quick tab-hide can no longer overwrite a good older save. And the
Escape ladder tests "menu open" **first**, not last: with the menu open, a
selection left standing would otherwise swallow the press meant to close it.

**Delete is guarded by a second click too**, not just New colony as the spec
asked — same in-place re-label, no dialog. Deleting a save is data loss and
the guard was already there.

**`pickSaveFile` must always settle, because the menu's busy lock has no way
out.** The panel disables every control while an action is in flight and only
re-enables in that action's `finally`, so a file picker that never resolves
does not merely lose an import — Save, Import, New colony and every row's
Load / Export / Delete stay dead until the page is reloaded. `cancel` on a file
input is too young to be the only path out of the dialog (WebKit from 16.4
only, absent in several embedded webviews), so a `window` focus fallback
resolves null after a grace period unless `change` has already claimed a file.

**A boot with no IndexedDB says why.** The menu's list-failed message no longer
overwrites the specific "this browser will not let the game store saves"
sentence, which is the one the failure actually needs — with no store at all
the listing fails every time the panel opens.

`@types/node` is deliberately **not** installed for the fixture test; it would
put `process`, `Buffer` and `require` in scope across every file including
`src/sim/`. `src/types/node.d.ts` declares the one function used instead.

**The golden hash `fbe20cb9` is unchanged** — no sim behaviour moved, and the
store shape is now consciously frozen behind `SAVE_VERSION`.

Verified in the browser, end to end: two in-game days of play, reload, colony
back at Day 5 with 48 logs and no action taken — console `save — tick 2400,
hashSim 57b58e4d` then `load — tick 2400, hashSim 57b58e4d`. Named save, more
chopping, load: the felled wood stands again (screenshot-confirmed, 130 logs →
48). Export → delete → import round-tripped to the identical hash `cf63d80a`.
Garbage and a v99 file each drew one quiet note-row line with the running game
untouched. The Escape ladder walked tool → selection → menu → close, restoring
the interrupted speed. A second tab took the blocked notice instead of the
ring; `?seed=42` played a full day and wrote nothing. 97 tests, lint, `tsc`,
build, console clean throughout.

**Not covered.** Headless Chromium reports every page as visible, so the
tab-hide save was triggered by a hand-dispatched `visibilitychange` — the
listener and the whole write are proven, the browser's own hide event is not.
The IndexedDB-unavailable boot (saving visibly disabled) has no test and was
not reproduced in a browser. Nothing tests the menu's DOM; it is
browser-verified only, as the rest of `src/ui/` is.
