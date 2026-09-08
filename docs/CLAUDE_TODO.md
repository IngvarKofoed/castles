# Owed follow-ups

Work this project owes and hasn't done, written and drained by Claude — the rules are
under *Owed follow-ups* in `CLAUDE.md`. Items are deleted when the work lands, so this
is not a record of anything; `docs/changelog/` is. A line you add here is read as a request.

- **There is no `testColonist` helper, and a dozen files hand-build the literal** —
  `test-sim.ts` has `flatSim`, `testBuilding` and `testMonster` for exactly this reason
  ("a hand-written literal goes stale the moment the entity grows a field"), but a
  `Colonist` still has none, so every field added to it is a compile error in a
  dozen places at once (`grep -rln 'patience: 0,' src/`). Two fields were added
  that way in `2026-09-08-bread-economy`, which also left two more local
  factories behind — `hunger.test.ts`'s `colonist()` is the helper this asks for,
  scoped to one file.

- **The ribbon's `idle` count includes colonists at a meal** — it means "holds no
  task" and an eater holds none, so the first synchronized lunch reads `5 idle`
  with nobody idle. The fix is one clause; what it needs first is a decision
  about whether that number means *no task* or *available for work*, since the
  styleguide describes it either way. Surfaced by the commit review of
  `2026-09-08-bread-economy`.
