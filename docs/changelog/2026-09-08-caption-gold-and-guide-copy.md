# Caption gold rule and guide copy ratified in the HUD-refit spec

The HUD-refit spec now matches what shipped: the caption strip's gold
follows which tool it names, not why (hovering the held tool stays
gold instead of flickering to ink); the styleguide-edit list includes
rewording guide copy that located goods "on the ribbon" (the flour
row), which "nothing else in the guide moves" had wrongly frozen; and
the sim-boundary comment carve-out names its whole class rather than
one file.

## Detail

- All three items in the build's spec-issues report were spec defects;
  the build (`2026-09-08-stores-panel-and-icon-rail`) stands unchanged
  and only `docs/specs/2026-09-08-hud-refit.md` moved (edits in place
  plus an Amendments entry).
- The comment truth-ups the build deliberately left — `GoodDef.label`
  in `sim/goods.ts`, the good-colour rationales in `render/palette.ts`
  and `render/movers.ts` — remain on `docs/CLAUDE_TODO.md` as the
  build recorded them; per the Owed follow-ups convention they start
  only when asked.
