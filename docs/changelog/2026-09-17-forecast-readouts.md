# The ribbon's meter is the weather, and a watchtower reads the coast

The threat meter is now a **forecast**: one bar on one clock, counting toward the
next landing and standing full while anything is ashore. It never re-targets, so
it cannot flicker between monsters — which is what it did before. Past its
horizon there is no bar at all and the caption says only that a storm is far
off. A manned Watchtower covering the coast a storm is due on **sights it from
twice as far out and reads it in tenths**, and its panel now counts tiles of
shore rather than dens. From
`docs/specs/2026-09-17-incursions-from-the-sea.md`.

## Detail

**The horizon is the new product boundary, and it is what the tower widens.**
`FORECAST_HORIZON` (a day and a half) is how far ahead the colony reads the
weather unaided; `WATCH_HORIZON` (three days) is what a watcher buys, alongside
`WATCH_BUCKETS`. Without the horizon a forecast that ran to the sim's own
clock would have spent the tower's whole product before it existed.

**The two horizons are paired with their bucket counts on purpose.** A horizon
divided by its buckets is the width of the finest thing the meter can say, and
`when()` only reaches "any moment now" under about a third of a game-day — so
1.5 days in fifths and 3 days in tenths both land at 0.3 and both can say it.
Widen a horizon without moving its buckets and the meter quietly loses its
sharpest phrase. The verbal bands moved with them (`within the day` now ends at
a day rather than at a day and a half), so a day-and-a-half horizon spans four
phrases instead of three.

**"In a few days" is a phrase only a watcher can reach**, since it needs more
than two days left and the unaided horizon is shorter than that. That was not
designed; it falls out of the pairing above and is worth knowing before somebody
reads it as a bug.

**Coverage is the *landing site*, not the monsters.** `sim.stormLanding` is a
store field, so the question is two subtractions rather than a scan, and it
stays the subject once an incursion is ashore — a tower watching the coast a
storm came in on keeps reading finely for as long as it is there. The gate is
unchanged and still manned-or-nothing: slot filled, worker bound to this
building, worker inside. The watcher's lunch still coarsens the picture.

**`rhythm()` is gone, and the monster panel lost its bar with it.** There is no
per-monster clock left to bucket — a monster is ashore until the storm passes,
and that clock is the colony's weather, which the ribbon already shows. The
panel says `ashore` or `heading for the boats` and carries one note in the house
voice. `MonsterView.stance` became `doing`, and `know.lairs()` became
`know.boats()`.

**The HUD lost a field, not just a function.** `Hud.watching` — the monster the
meter was holding between frames — is gone, because there is nothing to hold:
the hold existed only to stop the bar flickering between two monsters' clocks,
and one clock cannot flicker. `bars()` went with the rhythm bar, its only
caller.

**`docs/STYLEGUIDE.md` carries the new recipe**, replacing its "threat meter and
rhythm bar" section: same rust, same trough, same no-digit law, one widget
instead of two, and the watch-range overlay's stated subject moved from a
monster's den to the coast.

**Not covered.** The withdrawing caption (`the wilds are leaving`) and the
`heading for the boats` row are unit-tested but were never seen in the browser —
catching one needs a storm to run its full course with the camera on it. The
compass word was checked at east and north only; the diagonals rest on the
octant arithmetic. Nobody has read the meter through several storms to judge
whether a day-and-a-half horizon is long enough to plan a push against.
