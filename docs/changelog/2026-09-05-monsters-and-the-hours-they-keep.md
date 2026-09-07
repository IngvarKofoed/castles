# The Wilds have teeth: orcs, trolls, and the hours they keep

Two dozen dens now sit on every map, each with one monster keeping its own
seeded rest/prowl rhythm — it wakes, walks a circuit, bites palisades and
catches anyone outside, then walks home when its clock runs out. Damage is a
grid layer and repair is labour alone; deaths are permanent and leave a grave.
Inside the walls remains absolutely safe, and finished stone cannot be touched.
`SAVE_VERSION` is 4. Implements `docs/specs/2026-09-04-monsters.md` (step 4a).

## Detail

**The rhythm is the mechanic, and the clock is the law.** A monster is
dangerous only while prowling: resting it notices nothing, and `GoingHome`
notices nothing either, which is what makes CONCEPT's "hold until it leaves"
something a player can plan around. An attack ends when `phaseTicks` hits zero
and at no other moment — the monster disengages mid-bite and walks off, leaving
the segment standing and wounded. Nothing the player does drives one away, and
nothing keeps one past its hours.

**`wallDamageMap` stores damage, not hit points**, revisiting the placeholder
`docs/specs/2026-09-04-monsters.md` itself contradicted (its store sketch calls
the layer `wallHpMap` and has the migration stamp full HP on every segment).
Damage means 0 is pristine, so a new segment is born sound with no write, and
`PALISADE_HP` / `GATE_HP` stay tunables rather than being baked into every save
the first time they were chosen. Rejected the HP reading for exactly that.

**The enclosure flood now seeds from lairs as well as the map edge**, and
nothing may be built on a lair tile. That closes the stone-box exploit in one
line: a den's ground can never read as calm however much stone surrounds it, so
walls may *contain* a monster while the pen stays dangerous. Both promises
survive — inside means safe, and a monster is never permanently neutralized.

**Five bugs found and fixed during the build, all worth not re-introducing.**

- **Adjacency is a fact about tiles**, not a Chebyshev distance from a
  fractional position to a tile centre: measured that way a monster standing on
  the tile beside a wall came out 1.3 away and could never bite anything it had
  walked up to, so it stood there for a whole prowl (`adjacentTo`).
- **A stored route is stale when its end is no longer at *or beside* the goal.**
  Testing `path[last] !== goal` is always true when the goal cannot be stood on
  — which every wall is — so it re-planned an A\* per monster per tick. The
  looser test doubles as the chase's hysteresis.
- **Flee judges the route, not the task.** Dropping the task is not enough: a
  slot worker walking to its workshop, or anyone mid step-aside, carries a live
  route with *no task behind it*, and kept walking it straight past the monster.
  A route ending on enclosed ground is an escape; anything else is re-planned
  (`fleeing`). Deliberately not a `fleeing` flag in the store — the route
  already says.
- **`nearestDamageable` now checks its own range.** Its scan box is built from a
  *floored* position, so it reached a tile further than the notice radius on
  whichever axis the monster stood short of a tile centre — and a monster
  noticed a wall from further away than it noticed a person.
- **A repair task is cancelled when its segment falls.** `clearWall` zeroes the
  damage as the wall comes down, so the tile-walk's tidy-up could never fire on
  it; the task outlived the wall, above hauling, and somebody walked to open
  ground to discover nothing to mend. Tidied from the task list instead.

**A resting monster is drawn at its den's mouth, and the offset must stay under
half a tile.** It is drawn forward because a hunched figure is shorter than the
den it shares a tile with and was simply invisible inside the prop. At 0.55 it
was worse than invisible: the figure crossed into the next tile, so clicking the
sleeper you could see selected nothing and its ground height was sampled from
the tile south. 0.45 clears the mound and stays on its own tile.

**Flee knows about enclosure and nothing else.** A colonist on outside ground
with a prowler within `FLEE_RANGE` drops everything (the standard
release-and-drop) and runs a bounded BFS to the nearest inside tile, or directly
away when none is reachable — which is the whole early game, deliberately.
Consequences stated rather than discovered: two colonists on outside ground flee
even with a palisade between them and the monster, because a line encloses
nothing; and a colonist *inside a building* is uncatchable wherever it stands,
so an outside workshop is a bunker for its slot worker but not for its haulers.

**A third consequence, found in review and left standing — this one bites.**
`insideMap` is 0 on *any* tile carrying a wall, deliberately, because the
ribbon's count means **buildable** enclosed ground. Using the same layer for
safety therefore means a colonist standing in their own closed **gateway**
reads as outside. With a prowler within `FLEE_RANGE` beyond the gate, a hauler
crossing it abandons the errand at the threshold, retreats, re-claims, steps
back on, and abandons again — traffic through the gate stalls for the whole
prowl. The same holds for a wall blueprint drawn inside a ring. Not repaired
here: making a built gateway count as safe ground touches both `threatNear` and
`noticeable`, is a decision against the spec's own "enclosure is the *only*
wall-awareness flee has", and moves the pinned encounter hash. It is the first
thing to fix if gates read as broken in play, and the fix is a third state
(safe-but-not-buildable) rather than a change to what `insideMap` counts.

**The numbers make an unwalled colony genuinely lethal.** `NOTICE_RANGE` (8)
exceeds `FLEE_RANGE` (6), so a prowling orc — 1.3× a colonist's walk — has
already committed by the time anybody runs. On a seed with a near den a work
crew caught in the open dies almost to a colonist. That is the spec's stated
intent (no safe radius; attrition to an unplayable colony is accepted for 4a),
but it is the first thing to look at if the early game reads as unfair, and it
is one constant.

**Repair is a tile task worked from an adjacent tile at `REPAIR_HP_PER_SECOND`,
priority directly after `BuildWall`.** The dynamic that falls out: a biting
monster camps its segment for its whole prowl and keeps the outside ground
beside it lethal, so mid-siege repair only works from the **inside face**. A
closed ring can be held; an unclosed push cannot, which leaves exactly CONCEPT's
triad — build faster, write the segment off, or fall back. Repair generation
joined `generateDesignations`' single grid walk rather than adding a sixth scan;
it reserves nothing, so its position in that walk is immaterial.

**Knowledge is coarse by construction, and the fuzz is the 4b product
boundary.** `know.rhythm` buckets the true timer into fifths and offsets it by a
per-monster error derived from id and seed — stored nowhere, because it is a
property of what the player can work out. Exact timers, circuits and notice
radii never leave `sim/`. `know.threat` picks the colony's most relevant monster
and is *handed* the previous pick by the HUD rather than remembering one: the
"hold until it rests" rule is display state, and `know/` reads the store and
never writes it.

**The lair pass reads a world it is *handed*, and the v4 rung hands it one
regenerated from the save's seed** — not the save's own layers. That distinction
is the whole rung: chopping clears `treeMap` and quarrying rewrites `tmap`, the
pass filters candidates on exactly those two, and the candidate list is a
running cumulative weight — so one felled tree moves every later draw. Reading
the played world gave a migrated colony a *different* wilderness than a fresh
game on its seed, silently, with all three fixture hashes green. Pinned now
against the committed v3 fixture, whose recipe really does chop and mine.

**The enclosure seeds a lair tile unconditionally**, bypassing the `isBlocking`
guard every other seed goes through — because a seed that a wall can silently
swallow is not a guarantee. A den with a segment over it would have had its seed
dropped, the pen would have read as calm, and the monster would have been
permanently neutralized. Nothing in the game puts a wall on a lair tile today
(`canPlaceWall` refuses one, and the v4 rung refuses the reverse), so this is
belt to that braces: the promise holds by construction rather than by every
future writer of `wallMap` remembering it, and it also covers a hand-edited
save, which `decode` runs the fill over like any other.

**The v4 rung refuses a den on ground the save had already claimed** — anything
it had enclosed, **and every tile carrying a wall** — and that is the only place
the rung looks at the colony at all. Without it two spec decisions collided: the
pass is seed-only (above) and lairs seed the enclosure, so a den waking inside
an old ring turned that colony's entire interior to open country the moment it
loaded, unchosen and unrecoverable. The rung now runs the real flood-fill over
the save's own `wallMap` first (with `monsters` still empty, so it seeds from
the map edge alone and answers *what was inside before any den existed*) and
hands the result to the pass as a refusal mask.

**The wall half of that mask is not belt-and-braces — it is the same failure by
a different door**, and it was measured rather than reasoned about: a wall tile
is never "inside" (the enclosure excludes the ground under a segment), so
masking enclosed tiles alone still let a den land *on* the ring, and because a
lair seeds the flood unconditionally one den there took a 3844-tile interior to
zero. Refusing wall tiles also makes the rung agree with the live rule, since
`canPlaceWall` refuses a lair tile and a den under a standing segment is a state
the game never otherwise produces.

**It is a rejected draw, not a filtered candidate list**, and the difference is
the whole reason the wilderness survives the rung: the weight table stays a pure
function of the regenerated world, so the draw stream is the one a fresh game
would make and every den *outside* the colony still lands exactly where that
game would put it. Filtering the list would shift every later draw — the same
defect as reading the played world, arriving by a different door.

**The threat tier got its own golden run** rather than moving `tick.test.ts` to
a new seed: `threats/encounter.test.ts` scripts a palisade bitten, left standing
at the prowl's end, repaired, and a colonist caught — on seed 20260981, chosen
because its nearest den is fourteen tiles out. The labour pin keeps its own seed
and its assertions are untouched; its hash moved `430213d1` → `8aabfdb3` for
*shape* only (three new store fields), since that seed's wilds are forty tiles
away and never reach the colony.

**Fixture hashes moved and the pre-v4 shape replays are now peaceful.** v1
`cf8c3fd7` → `c1b9ffd1`, v2 `02dba047` → `41f2beab`, v3 `b7480025` →
`7dcf3387`, all for the 3 → 4 rung; the files themselves are untouched and stay
frozen. `v4.castles` joins them, caught mid-siege: monsters with routes and
clocks in flight, bite damage on a standing palisade, and a live repair task
queued against it. Its `graveMap` is empty and that is a real gap — no tick on
that seed holds damage, a repair and a grave at once, because the damage is
mended before the prowl that kills anybody arrives. The three older recipes
replay with `monsters` emptied, because they were written for a world with none:
replayed in a dangerous one on a seed with a near den they can lose the whole
colony, and the shape test then has no colonist to read a key set off.

**Vitest's `testTimeout` is 120 s, and the scripted runs are shared.** The
suite drives the sim for thousands of ticks against a 256² world, which was
already close to the 5 s default; two dozen monsters and a third grid read
pushed it past. Ceilings of 30 s and 60 s each then failed on a loaded machine,
where the whole suite ran 4–20× slower than its idle time — so no fixed ceiling
survives contention, and the real fix went into the tests: `tick.test.ts` and
the encounter each compute **one** scripted run and share it across every
read-only assertion, and the encounter's tick-by-tick damage trace rides that
same run rather than a second identical one. A run per test was affordable
before this tier and is not now. If the ceiling fires again, look for a genuine
hang or another duplicated run rather than raising it.

**Rust widened rather than a fourth colour arriving** (`docs/STYLEGUIDE.md`):
slots, invalidity and danger are all "the costly things". The ribbon's threat
meter and a monster's rhythm bar share one five-segment recipe, unlit segments
are the trough, and there is no alarm, banner, toast or sound anywhere — the
meter moving, its quiet caption, the folk readout shrinking and a grave in the
grass are the whole vocabulary.

**The den's bones sat inside its own mound** as enclosed geometry nobody could
ever see. The mound is narrower now and the bones clear it — by a few
hundredths of a tile, which is why the mesher's containment test allows a hair
of spill rather than none.

**The threat meter's hold is a tie-break, not an override.** Feeding last
frame's pick back in is what stops the bar flickering between clocks mid-siege,
but it was short-circuiting *above* the spec's first rule, so a monster with its
teeth in the walls lost to whatever the meter happened to be watching — through
the one event the meter exists to report.

**The meter is never blank while a monster exists, and its caption tells coarse
time in words.** The tracking ladder ends in a fourth rung — biting monster,
nearest prowler in range, soonest-waking den in range, then **the nearest den on
the map, however far**, captioned `far wilds:`. Deliberately the *nearest* and
not the soonest-waking anywhere: with two dozen staggered rhythms something is
always about to wake, so that bar would sit permanently full and mean nothing.
`WILDS QUIET` is now reserved for a map with no monsters at all.

The caption pairs the kind with a phrase off the **same bucket the bar shows** —
"troll wakes in a day or two", "orc prowling, gone within the day" — so it can
never be sharper than the bar and never shows a digit, which is 4b's whole
product boundary held in one more place. A consequence worth knowing rather than
rediscovering: a *long* phase can never read "any moment now", because a fifth
of a three-day rest is well over a day and the estimate honestly does not know.
A monster walking home gets no phrase at all — that phase ends on arrival, not
on a clock, so there is no time to tell.

Verified in the browser (seed 20260981 and the v4 fixture imported through the
menu): a den as a dark mound with its mouth and bones, an orc hunched asleep at
it and selectable by clicking the figure itself, the same orc upright and
prowling, a grey troll half again taller out on its rounds, the ribbon meter
reading `ORC WAKES IN A DAY OR TWO` / `ORC PROWLING, GONE WITHIN THE DAY` /
`ORC HEADING HOME` as the clock turned, a monster panel with kind, tag, stance
and rhythm bar, a grave in the grass, and a bitten palisade segment visibly
darker than its neighbours. On a seed whose nearest den is past the meter's
range (20260913) the bar tracks it as `FAR WILDS: ORC WAKES IN A DAY OR TWO` and
visibly fills toward its waking, on one ribbon line. Console clean (0 errors,
0 warnings). 279 tests, lint, `tsc`, production build.

**Not covered.** The truly empty `wilds quiet` meter — a map with no monsters —
cannot occur in a generated world, so it rests on unit tests, as do the threat
meter's biting-outranks-held rule and its nearest-not-soonest fallback rule.
The v4 rung's refusal of already-walled ground is pinned by test only — it
touches no render or UI code, and no committed fixture encloses enough ground
for a den to have wanted any of it, so the test builds its own ring and checks
it is not passing vacuously. Nothing exercises two monsters converging on one
colonist, or a troll against a wall in the browser.
`props.test.ts` still pins only a sound palisade: the den, the grave and the
damage shading are tested through the mesher rather than at the prop. Three
review findings are recorded and unrepaired, all cheap and none load-bearing: a
monster re-acquires an unreachable damageable tile every tick, paying an A\*
each time (reachable with a blueprint drawn inside an all-stone ring);
`desperate` bites without recording `targetTile`, so the threat meter cannot see
a monster chewing its way out of a pen; and `denRun` in the save fixtures is a
near-copy of the encounter test's own helper. Bite,
notice, flee and repair numbers are all tune-by-eye firsts, and nobody has
played a full colony to judge the early game's lethality — the encounter run now
loses three of five folk where it lost one before the flee repair, which is the
numbers working rather than a regression, but it is the number to look at first
if the opening reads as unfair. And a monster whose prowl ends where no path
home exists idles until one opens, which is the spec's own "sleeps where it
stands"; that monster stops keeping visible hours until it can move again.

**`canTerraform` deliberately does not refuse a lair tile**, where `canPlace`
and `canPlaceWall` both do — so a den can be dug into a pit its monster cannot
climb out of, paid for in labour alone. **Raised as a defect and settled as
sanctioned play**: earthworks are siegecraft, the price is people-hours and a
scarred map, and the enclosure seed means the pen never turns calm however deep
it is. Adding the refusal was the obvious repair and was rejected — a monster
may be *contained*, by stone or by earth, and only never killed, removed, or
made safe to stand beside. Don't add it.
