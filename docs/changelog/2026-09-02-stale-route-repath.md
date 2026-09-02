# Colonists re-plan a route the wall closed instead of walking through it

Stepping onto the next tile of a planned route now re-checks that the tile is
still passable, and a stale route is re-planned to the same destination. Before
this a palisade finishing across someone's path let them walk straight through
standing wall — pillar 1 read as broken on screen. A route with no way round
hands the errand back, cargo and all, as an eviction does.

## Detail

**This is the rule `docs/specs/2026-09-01-tick-and-labour.md` already asked for
("repath when a step is blocked") and step 2 never implemented.** It cost
nothing while only building placement closed ground — a rare player action, and
`evictFromFootprint` covered anyone actually standing there. The wall tier is
what made it bite: blueprints are walkable *by design* so a run cannot wall in
its own builders, so every route is free to cross a drawn line, and segments
complete every couple of seconds. `docs/specs/2026-09-02-palisade-walls.md`
states colonists "already re-path when a step is blocked" as the reason walkers
cannot ghost through a finished segment; they did not, and they could.

**The golden hash moving is the evidence, not a side effect.** `c0441655` →
`11a997a8` with no change to the scripted command log: the L placed at tick
1420 in `tick.test.ts` was being walked through. A theoretical hazard would
have left the hash alone.

**Re-plan, don't abandon.** The first attempt handed the task back on any
blockage (the `stepAside` path), which drops the carried log and puts the task
to sleep on a cooldown — far too destructive for "something closed across your
route, walk around it". The route's own last tile is the destination, so
re-pathing to it needs no goal bookkeeping on the task or the colonist, and the
hand-back is kept only for the case where there is genuinely no way round.

**Escape routes are exempt, and must stay exempt.** `escapePath` deliberately
returns routes whose intermediate tiles are impassable — getting clear of a
footprint dropped on your head beats getting clear gracefully — so gating those
on passability would strand a colonist inside the wall that just closed on
them. The exemption is keyed on the walker's *current* tile being impassable,
which is exactly and only the escaping case: a normal walker is never on
blocked ground, because `evictFromTile` catches anyone straddling a segment at
the instant it completes.

**A finished gate no longer evicts.** `actBuildWall` cleared the tile of people
whatever it had just built, but a gate stays walkable: `escapePath` would not
even move them, while `stepAside` had already released their task and dropped
their cargo. So anyone crossing the gap at the completion tick lost a haul for
nothing. The eviction is now gated on `!isWalkable`; the ground-item sweep stays
unconditional, since it is a no-op on a tile nothing can be lying on.

**Not covered.** The two new tests in `walls.test.ts` use a hand-built walker on
a flat sim, so they pin the re-plan and the dead end but not the interaction
with slot workers, whose blocked route is simply dropped and recomputed from
their building on the next tick (no task exists to hand back). Nothing tests a
route blocked on the same tick it was planned.
