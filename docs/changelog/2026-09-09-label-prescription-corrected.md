# The "say Stores" comment prescription corrected in the HUD-refit spec

The HUD-refit spec's carve-out no longer prescribes re-pointing the
sim/renderer good-comments at the Stores panel — that would have swapped
one false claim for another: `GoodDef.label` feeds panel prose (Stores
rows render `name`), and `render/palette.ts`' colour table serves the
in-world piles only, `GOOD_VAR` in `hud.ts` being the HUD's own table
with the styleguide keeping the two in step.

## Detail

- Both items in the housekeeping pass's report were defects in the
  handoff instructions, not in the work: the comments were made true
  instead (`2026-09-09-good-label-and-colour-docs`), and the styleguide
  never had the conflicting idle description the instruction claimed —
  the ambiguity was silence, and the missing line was added
  (`2026-09-09-idle-means-available`). Only the spec text moved here.
- The instruction error's root: assuming a single goods-colour/label
  table spans HUD and world. It doesn't, by design — two tables, one
  guide keeping them aligned.
