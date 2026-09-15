# An indoor slot worker no longer steps out for a meal into a prowler

A slot worker inside a building now checks the doorstep before leaving on
either self-errand: a prowling monster within `FLEE_RANGE` of the tile they
would land on means no errand this tick, retried next tick like every errand.
The indoor exemption is therefore sound — a workshop beyond the wall really is
a bunker for whoever is in it — where before, the one way out of it killed them.
From `docs/specs/2026-09-14-hives-and-mead.md`.

## Detail

**The hole was a tick-order fact, not a missing rule.** Both errands
`leaveBuilding` and plan a route on the same tick; the flee check had already
passed the worker over that tick *because* they were inside; and monsters step
after colonists. So a prowler standing beside the work tile caught them at the
door with nothing in the game able to intervene.
`2026-09-09-watchtowers` recorded this as accepted-but-untested texture, and
the Watchtower — whose `millProgress` is always `-1`, so no batch ever holds its
watcher in — opened the door most freely of all. The guard is general: every
slot building has this door.

**`prowlerNear(sim, x, y)` is the boundary asked about a place.** It is
`threatNear`'s body from the bounds check down, extracted unchanged, and
`threatNear` is now `c.inside ? null : prowlerNear(sim, c.x, c.y)` — so a
colonist and a doorstep are judged by one implementation and cannot drift
apart. **Coordinates are tile-centre floats**, the `x + 0.5` every other
`reach` caller passes; integers would move the range boundary half a tile and
leave the guard disagreeing with the flee check about the same ground.

**`exitTile(sim, b)` is split out of `leaveBuilding`** for the same reason: the
guard must check the tile the worker actually lands on — the work tile, or the
drop tile when something has blocked it — and a guard that checked a different
one would be a guard in name only. A building with no free tile around it
answers "no prowler", which is right: `leaveBuilding` does not move the worker
in that case either.

**Nothing is stored and nothing else moves.** No new colonist field, no flag, no
memory of having waited. A keeper kept in by a long prowl gets hungry and from
`HUNGRY_TICKS` works at `HUNGRY_FACTOR` — a plateau, per CONCEPT, not a spiral.
Every pinned hash held, including the scripted encounter's: that run has no
indoor slot worker due a meal beside a prowler, so the guard fires nowhere in
it. Had it fired the hash would have moved for behaviour, and this entry is
where that would have been said.

**Still unsheltered, deliberately:** the pool workers who haul to and build an
outside workshop, and every commute across a gate tile that reads as outside
(`2026-09-05-monsters-and-the-hours-they-keep`). Those are the price of
building outside, not holes in the door.

Verified: 455 tests (4 new — the keeper held in over sixty ticks with the
doorstep provably watched, the errand resuming the moment the orc stops
prowling, the same for a fitting, and `prowlerNear`'s own exemptions), lint,
`tsc`, production build. No browser pass: nothing here reaches a pixel.
