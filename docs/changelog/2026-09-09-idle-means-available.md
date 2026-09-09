# The ribbon's idle count means available for work, not "holds no task"

A pool worker away at a meal is no longer counted in `Readout.idle`: the number
is pool workers with no task claimed **and** `eating` clear. `Readout`'s doc and
`docs/STYLEGUIDE.md` now state that meaning in the same words, so the two can no
longer be read differently. Settles the question `2026-09-08-bread-economy`
raised and left open, and the first synchronized lunch reading `5 idle`.

## Detail

- **The decision was "available for work", and the other reading is rejected.**
  `idle` is how the player reads the pool's slack, so it has to mean hands that
  could take work now. "Holds no task" is a fact about the task list, not about
  the colony, and it made the readout least trustworthy exactly when the colony
  was busiest with itself. Note what it is *not*: `staff` takes the nearest pool
  worker busy or idle, so this number never predicted what staffing would cost —
  an earlier draft of both docs said it did, and the commit review caught it.
- **Only the meal errand is excluded. A *fleeing* pool worker still counts as
  idle**, and that is a known gap rather than an oversight: flight is inferred
  from the walker's route rather than carried as a flag
  (`2026-09-05-monsters-and-the-hours-they-keep` rejected a `fleeing` field on
  purpose), so reading it in `readout()` is a different change. Stated because
  "available for work" otherwise reads as exhaustive.
- **`pool` is deliberately untouched** — an eater is still a pool worker, and
  `slots` is `folk − pool`, so narrowing `pool` would have moved the labour
  meter's segments as a side effect of a ribbon fix.
- **The styleguide had no definition to correct, which is why the two could
  disagree.** It named the count twice — the sage palette row and the ribbon
  anatomy — without ever saying what it counted, so nothing pinned it either
  way. It now carries the one-line meaning beside the folk readout's hunger
  paragraph.
- **Not covered: the ribbon was not driven in the browser.** The rule is pinned
  by unit test against `readout()` in `know/know.test.ts`, and the HUD line that
  prints the number is unchanged. Reproducing the `5 idle` lunch on screen needs
  work designated first — an undesignated colony is genuinely idle, so a fresh
  colony's ribbon reads `5 idle` under *both* meanings and the screenshot would
  have distinguished nothing.
- No golden hash moved: `readout()` is a knowledge read over the store, not
  state in it.
- **The fleeing case above is written twice, per the convention** — here, and as
  the one line left on `docs/CLAUDE_TODO.md`. This change drained the last of the
  three items that file held and then put that one back, so the file survives
  rather than stopping existing: what is owed now is the readout the new
  definition implies and this change does not deliver.
