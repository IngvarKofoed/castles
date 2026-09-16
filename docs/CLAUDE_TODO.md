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
  promising "waiting for logs". The drink chain's two mass nouns make it visible on
  two more panels — "nowhere to put the honeys", "the meads". Both want `GoodDef.label`, which is exactly the
  field documented as the prose that counts a good in a sentence
  (`2026-09-09-good-label-and-colour-docs`); the input case needs an `inputType` on
  `Inspection` first, mirroring `outputType`, and a Playwright pass because it
  changes rendered HUD text. Surfaced by the commit review of that entry.

- **Seven buildings share one silhouette** — the Dairy, Weaver, Tailor and now the
  Meadery fall through to the timber-workshop prop that the Sawmill, Mason and Mill
  already share, so nearly half the buildings in the game read identically across the
  map in a game whose whole toolkit is reading the map. The Mill set that precedent for
  one building; four more is what makes it worth a line. The Pasture, the Farm, the Hive
  and the Flowers have props of their own, so the pattern for fixing it exists. Surfaced
  by `2026-09-11-sheep-and-clothes`, widened by `2026-09-14-hives-and-mead`.

- **Seven comments across five `sim/` files still call the area drag a "marquee"** —
  the screen-space marquee was removed with `2026-09-13-map-space-selection-box`, but
  `commands.ts`, `ground.ts` and three test files still name the gesture after the DOM
  element that no longer exists, so a grep for how designation boxes work lands on a
  word with nothing behind it. `src/render/` and `src/ui/` were truthed up with the
  change; these sit across the sim boundary and were out of its scope, the same split
  `2026-09-08-stores-panel-and-icon-rail` made for "the ribbon". Surfaced by
  `2026-09-13-map-space-selection-box`.

- **Nothing mechanically pins the site frame's clearance over the material lattice** —
  the 0.07 outboard inset is what keeps a site's posts, rails and walkway off the
  delivered goods and the shortfall ghosts that sit 0.15 from the footprint edge, and
  `2026-09-16-site-scaffolding` states it binds every future prop sharing a plot with
  materials — with only 0.01 of margin on the 1×1 Watchtower's plot, where all four
  slots share one tile. It rests on a comment and one browser screenshot:
  `props.test.ts` covers `wallBoxes` only, so `buildingBoxes` has no test at all and
  a later prop can reach back inboard with nothing failing. Surfaced by
  `2026-09-16-site-scaffolding`.

- **`fauna.test.ts`'s shepherd's-hut clearance test is flaky** — it drives the flock
  forty simulated seconds and asserts a hard keep-out box, but the wander uses
  `Math.random` (legal outside `sim/`, per `2026-09-15-wandering-sheep-and-deer`), so
  the assertion fails roughly one run in eight. Measured on an otherwise unmodified
  tree, so it is not something a change caused; it wants a seeded generator for the
  test or a bound derived from the wander's own limits rather than a hand-picked
  0.58. Found while running the suite for `2026-09-16-site-scaffolding`.

- **The stockpile panel's stuck-clear check walks the whole colony every frame** —
  `know.inspect` asks `canRehome` once per good a pile is clearing, and each call
  walks every stockpile and, through `freeCapacity`, every item in the colony. It
  runs per frame for whichever building is selected, so a late colony clearing
  several goods at once pays tens of thousands of iterations a frame for one note
  row. The predicate is deliberately the haul's own rather than a cheaper read of
  the accept flags (`2026-09-14-stockpile-default-and-clearing`), so the fix is a
  per-frame memo, not a different question. Surfaced by the commit review of
  `2026-09-15-hive-meter-and-panel-staleness`.
