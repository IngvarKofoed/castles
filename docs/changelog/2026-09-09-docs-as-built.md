# CONCEPT and ARCHITECTURE reconciled to the game as built

Both source-of-truth docs now describe the shipped game rather than an
intended one: ARCHITECTURE's header no longer says "not yet built", its
build order is a record of what landed (with entry slugs), the boundary is
stated as mechanically enforced (`eslint.config.js`), the world's 256²
and `TICK_HZ` read as facts, the repo layout matches disk, and CONCEPT's
"decisions still open" names the only two promises still unbuilt: alarm
systems and the belts-and-carts tier.

## Detail

- Verified against source before writing, not assumed: the eslint boundary
  rules exist (`no-restricted-imports` + restricted globals),
  `WORLD_SIZE = 256`, autosave ships in `app/main.ts`/`app/storage.ts`,
  and the content tables are `BUILDING_DEFS` / `GOODS` / `MONSTER_DEFS`.
- `assets/` still does not exist; the layout section now says so plainly
  (tables live in `sim/` until a content format earns its keep) instead of
  listing it as if real.
- The mockup record in ARCHITECTURE's second half is untouched — it is a
  record, and reconciliation never rewrites records.
- Deliberately not folded in: the code comments outside `src/ui/` that
  still call the ribbon the goods' home — that item stays on
  `docs/CLAUDE_TODO.md` because it is code, not docs, and this session's
  split keeps code edits with the implementer.
