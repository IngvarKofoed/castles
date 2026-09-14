# Owed follow-ups

Work this project owes and hasn't done, written and drained by Claude — the rules are
under *Owed follow-ups* in `CLAUDE.md`. Items are deleted when the work lands, so this
is not a record of anything; `docs/changelog/` is. A line you add here is read as a request.

- **A fleeing pool worker still counts in the ribbon's `idle`** — `idle` now means
  *available for work* (`2026-09-09-idle-means-available`), and somebody running from
  an orc is not, but `abandonForFlight` clears their task and nothing marks them as
  fleeing, so they satisfy the readout's test. Not the one-clause fix the meal case
  was: flight is deliberately inferred from the walker's route rather than carried as
  a flag (`2026-09-05-monsters-and-the-hours-they-keep`), so `readout()` would have to
  ask a question it currently cannot. Surfaced by the commit review of
  `2026-09-09-idle-means-available`.

- **The workshop panel's stall notes fabricate one plural and miss another** —
  `millNote` builds "nowhere to put the breads" by appending `s` to `GoodDef.name`,
  and prints "waiting for log" from the singular `name`, against its own docstring
  promising "waiting for logs". Both want `GoodDef.label`, which is exactly the
  field documented as the prose that counts a good in a sentence
  (`2026-09-09-good-label-and-colour-docs`); the input case needs an `inputType` on
  `Inspection` first, mirroring `outputType`, and a Playwright pass because it
  changes rendered HUD text. Surfaced by the commit review of that entry.

- **Six buildings share one silhouette** — the Dairy, Weaver and Tailor fall through
  to the timber-workshop prop that the Sawmill, Mason and Mill already share, so half
  the buildings in the game read identically across the map in a game whose whole
  toolkit is reading the map. The Mill set that precedent for one building; three more
  at once is what makes it worth a line. The Pasture and the Farm have props of their
  own, so the pattern for fixing it exists. Surfaced by
  `2026-09-11-sheep-and-clothes`.

- **Seven comments across five `sim/` files still call the area drag a "marquee"** —
  the screen-space marquee was removed with `2026-09-13-map-space-selection-box`, but
  `commands.ts`, `ground.ts` and three test files still name the gesture after the DOM
  element that no longer exists, so a grep for how designation boxes work lands on a
  word with nothing behind it. `src/render/` and `src/ui/` were truthed up with the
  change; these sit across the sim boundary and were out of its scope, the same split
  `2026-09-08-stores-panel-and-icon-rail` made for "the ribbon". Surfaced by
  `2026-09-13-map-space-selection-box`.
