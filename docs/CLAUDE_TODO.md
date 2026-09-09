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
