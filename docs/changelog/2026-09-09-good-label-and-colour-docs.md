# The good-label and good-colour docs name Stores, not the ribbon

The three comments outside `src/ui/` that still called the ribbon the goods'
home now name the Stores panel: the good-colour table's rationale in
`render/palette.ts` and `render/movers.ts`, and `GoodDef.label`'s doc in
`sim/goods.ts`, which now names its real consumers — the prose that counts a
good in a sentence — rather than a ribbon label it never fed. Comment-only.

## Detail

- Finishes what `2026-09-08-stores-panel-and-icon-rail` left outside its scope
  and `2026-09-08-caption-gold-and-guide-copy` then widened the carve-out for:
  the `src/ui/` and styleguide copies were truthed up when the panel landed,
  these three were not. `2026-09-09-docs-as-built` deferred them once more, as
  code rather than docs; this is the entry that pointer was waiting for.
- **`label` is not what the Stores panel renders — its rows use `name`**, so
  "point the doc at Stores" was only half the truth-up. The doc now says which
  field Stores reads, because the two are one keystroke apart and the wrong one
  gives a panel row a lower-case plural.
- **The good colour lives in two tables, not one, and the comment no longer
  implies otherwise.** `GOOD_HEX` (`render/palette.ts`) covers the in-world uses
  — ground piles and building buffers — while the Stores pip reads `GOOD_VAR`
  (`src/ui/hud.ts`) as CSS vars. Both mirror `docs/STYLEGUIDE.md`, which is what
  actually keeps the pip and the pile agreeing; the old wording claimed one table
  spanned the HUD as well, which was already false of the ribbon it named.
- **No browser pass, deliberately**: `src/render/CLAUDE.md` mandates one for
  *visual* changes, and nothing here reaches a pixel. Verified by `tsc` and lint
  alone — stated so a later session doesn't read this entry as a screenshot check
  it never got.
