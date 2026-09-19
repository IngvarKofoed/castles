# Monsters stopped living here: the Wilds land from boats and leave the same way

There are no dens. **Between incursions `sim.monsters` is empty** and the land
outside the wall is genuinely safe, so a wall push has a window long enough to
finish in. When the forecast runs out an incursion lands on one coast, presses
inland as far as the colony has reached, and withdraws by sea when the storm
passes. Strength is measured off enclosed land, so expansion still buys the
risk. `SAVE_VERSION` is 12, and **the rung drops every monster an old save
holds**. Implements `docs/specs/2026-09-17-incursions-from-the-sea.md`.

## Detail

**The rung destroys data and a `git revert` does not undo it.** Code reverts; a
save that has passed the 11 → 12 rung has lost its dens for good. There is no
honest way to convert a resting den into an incursion — a v11 monster carries a
lair, a circuit and a pair of periods, and this world has none of those things
in it — so the rung ships `monsters: []` and a fresh forecast, under
ARCHITECTURE's pre-1.0 escape hatch. Carrying dead den records forward for one
version to keep a rollback path was rejected as real complexity bought for a
game whose own policy says not to.

**One clock means two things and `sim.monsters.length` is the discriminator.**
`sim.stormTicks` counts down to the landing in peace and to the withdrawal while
anything is ashore; there is deliberately no second flag that could disagree
with the array it describes. `sim.stormStrength` is the seeded severity for the
coming storm and `sim.stormLanding` the beach it is expected on — the latter
resolved with the countdown rather than at the landing, because a forecast
without a direction is half a forecast.

**The opening bearing comes off the world seed, not off `stormStrength`.** Both
things that hand the forecast an unresolved landing — `createSim` and the
11 → 12 rung — set that field to exactly 1, and neither may touch `rngState`, so
deriving the bearing from it made the expression constant: **every game's first
storm landed on the same shore whatever the seed**, and only the second onward
varied. Seed-derived keeps the no-draw property both callers need and still
gives every world its own opening coast. Caught by the commit review.

**The settle reads a transition, not a state, and that is not decoration.** The
clock reaches zero one tick *before* `stepForecast` can act on it. Keyed off
"zero and nothing ashore", the settle rescheduled the storm on that very tick
and the landing never happened — **every naturally arriving storm in the game
was silently skipped**, with the ribbon flicking from *any moment now* straight
back to *far off*. Found in the browser, not by a test; `settleIncursion` now
takes whether anything was ashore when the tick began, and `incursion.test.ts`
pins it.

**Strength is read at the landing and never at the end of a storm.** A monster
sealed inside a closed wall collapses the enclosure fill to zero (below), and an
incursion ends with exactly that state possible — so an acreage taken then would
hand a player who walled one in a permanently weak next storm. It works out for
free: a landing only happens when nothing is ashore, so `insideMap` is already a
monster-free fill when it is read.

**Depth is the walk to the colony plus the colony's own reach.** An early
attempt made it a flat `INCURSION_DEPTH` from the beach, and on a real map that
is 24 tiles against a coast 110 tiles from the colony — the incursion never
arrived at all. The first term is what makes an incursion an incursion; the
second is what keeps CONCEPT's "danger scales outward" alive under a single
global strength dial, since a colony that has walled forty tiles out is walked
forty tiles further in.

**The enclosure seeds from where a monster is standing, and `stepMonsters` marks
the fill stale when one changes tile.** That call is new work: the other five
callers of `markEnclosureStale` are all wall-graph writes. The consequence is
colony-wide and intended — close a wall around a landed monster and the *whole*
enclosure reads as outside, because a monster inside your walls can walk
anywhere in them. It does not flicker: a monster on outside ground is already
inside the region the map-edge flood reached, so its seed adds nothing.

**`canPlace` refuses a monster's tile; `canPlaceWall` does not.** Nothing evicts
a monster and `passable` would then refuse the tile it is stuck on, so a
footprint is refused while one stands in it. A wall is a blueprint first and
blueprints are open ground, so a line drawn under one is a line it walks over —
and closing a ring round it is legal, with the fill answering for it. Both used
to refuse a *lair* tile; there is nothing left to protect.

**What came out, so none of it is stranded.** `threats/lairs.ts` and its
262-line test, deleted; `lairAt` replaced by `monsterAt` in `store.ts` (it lives
there, not in `threats/`, because `buildings.ts` has to ask it and cannot import
that folder without closing a cycle); fourteen lair and rhythm constants;
`MonsterPhase.Rest`, with `Prowl` and `GoingHome` renamed `Ashore` and
`Withdrawing` at the same numbers. Rung 3 was **rewritten rather than
extended** — normally forbidden — because it called `spawnLairs` and stopped
compiling; it is now a plain `monsters: []`, and `enclosedBefore` went with it.

**The scripted runs moved, and two of them are different colonies.**
`threats/encounter.test.ts` is re-authored around **two storms it calls in
itself** by zeroing the clock: a scripted run cannot wait out an opening grace
that is deliberately longer than any run in the suite. All four beats survive,
on seed 20260912. `settlers.test.ts`'s death-en-route run is on 20260913 and
calls a storm in at tick 1400. **Seed selection still does the work, but it
selects for something new**: a world whose opening bearing puts the landing on
the same coast the wanderer walks up from, so the two meet — a sweep of
forty-one seeds at three storm ticks found exactly one that does it without
also costing the colony somebody at home. `tick.test.ts` and
`economy/bread.test.ts` moved for ids and shape only: `createSim` no longer
mints two dozen monsters before the opening five. Eleven pinned decode hashes
moved together, and `"monsters"` came out of the `kinds` list of the eight
shape tests that passed it, because `shapeOf` asserts each kind is non-empty and
every save now decodes with `monsters: []`.

**The opening grace has a test-shaped floor and it is invisible from the game.**
`FIRST_STORM` must outlast the longest scripted run — `tick.test.ts` covers 2.5
game-days, the encounter four — or a landing inside one turns a labour golden
into a massacre.

**Measured rather than claimed, per the spec.** At 256² the fill is **0.89 ms**
a call freshly allocated and **0.84 ms** with its scratch reused, against a
0.99 ms incursion tick — and a monster changing tile marks it stale, so during a
storm it runs on nearly every tick where it used to run on wall events alone.
The reuse ships (it removes 320 KB of garbage a call) but it is not the fix:
the BFS and the final 65k pass are the cost, not the allocation. Affordable,
not free; the standing follow-up is on `docs/CLAUDE_TODO.md`.

**Not covered.** Nothing exercises two incursions ashore at once, which cannot
happen. The withdrawal was watched only in unit tests — no browser pass caught a
monster walking back to its boat, or a boat disappearing when the last one
boarded. The browser pass that checked the props did so at a **forced** landing
beside the colony, so a hull standing on real sand at a real landing site has
been reasoned from `beachAt` and the mesher test rather than seen. The tuning —
interval, severity, depth, troll share, the two horizons — is all first-pass and
nobody has played a colony through several storms.
