# Incursions: the Wilds arrive by sea, and peace is empty

Monsters no longer live on the map. Between incursions there are none at all —
the land outside the wall is genuinely safe, which is what makes a wall push
possible. When the forecast runs out they **land from boats on a coast you can
see**, press inland toward the colony, attack whatever is unfinished and
whoever is outside, and leave by sea when the storm passes. The wall is still
absolute, so an incursion cannot touch anyone behind it: the forecast is a
curfew, not a siege. **Incursion strength scales with enclosed land**, so
expansion still buys the risk — pillar 2, by a different mechanism.

This reverses `docs/CONCEPT.md` in four places and that document is rewritten
as part of the change.

## Outcome

**What you get:**

- Between incursions there are no monsters on the map at all, so a wall push
  has a window long enough to finish in.
- An incursion lands from boats on one coast, presses inland to the colony's
  edge, and leaves by sea — and the forecast tells you roughly when, in words.
- The more land you have enclosed, the stronger the incursion.
- A manned watchtower sights one earlier and reads the forecast more finely.

**How to verify:**

- Start a colony and watch: nothing roams. Send a crew well outside the wall
  and leave them there through a quiet stretch — nobody is attacked, and no
  monster appears anywhere on the map.
- Let the forecast run out: boats land on one beach, monsters come ashore and
  press toward the colony, and the direction they came from is visible at a
  glance. Everyone behind a closed wall is untouched throughout.
- Wall a landed monster in and check the enclosure wash: that ground does not
  read as enclosed while it is in there.
- Let an incursion end with its route to the coast walled off: the monster is
  gone within the backstop clock rather than staying forever.
- Enclose substantially more land, then compare the next incursion: it is
  bigger, **and it presses further inland** — depth still costs something.
- Wall a monster in and check the *next* incursion's strength: it is sized on
  the colony's real acreage, not on the zero a sealed-in monster makes the fill
  report.
- Man a watchtower: its overlay shows the coast it covers, its panel says how
  much of the shore it can see, and a landing on covered coast is forecast
  earlier and more precisely than one that isn't.
- Watch the ribbon through a whole cycle: one bar on one clock, counting toward
  the landing and then reporting that one is ashore. It never jumps between
  monsters, which is what it does today.
- Pause at ×0: the forecast stops. Load a pre-change save: it opens with an
  empty wilderness and a storm coming, and does not crash on a dropped den.

## Key decisions

- **No dens. In peace, `sim.monsters` is empty** (breaking). Monsters exist
  only for the length of an incursion: they are created at a landing, they
  press inland, and they are removed when they withdraw. This is the whole of
  what the change is for — "no monsters roaming in peace" is not a tuning of
  the old model, it is the absence of one.
- **CONCEPT and ARCHITECTURE are both rewritten, not stretched** (breaking).
  At least nine passages in CONCEPT say the opposite of this — `:6`, `:88`,
  `:120–125`, `:128–131`, `:136–140` besides the four below — and
  `docs/ARCHITECTURE.md` reverses too: `:104` ("flood-fill from the map edge
  and from every monster lair") and `:113–118` (the lair seed, "Nothing may be
  built on a lair tile", "levelling one is left legal on purpose, as siegecraft
  priced in labour"). The four that matter most: pillar 1's "no sieges, no waves, no horde", the threat
  model's "never waves sent against the colony", Not-in-scope's "No sieges or
  base-defense waves", and pillar 2's "safety outside is a local, readable
  fact, not a timer" — which becomes exactly a timer. **The promise survives
  and is restated rather than dropped**: "risk is never imposed, only chosen"
  still holds, because the wall is still absolute and an incursion can only
  reach what you chose to leave outside. What changes is that the choice is now
  *when* as well as *where*.
- **Strength scales with enclosed land, and depth keeps a term of its own**
  (new). Tying strength to `enclosedLand(sim)` keeps pillar 2 — expansion is
  the risk. On its own it would abolish something else: today danger rises with
  radius (`LAIR_INNER_WEIGHT`, `OUTER_BAND`, `TROLL_CHANCE_OUTER`, the
  `(1 + band)` prowl multiplier in `lairs.ts:183`), which is the mechanism
  behind CONCEPT's "danger scales outward … the deep map is earned" and the
  counterweight pillar 3's "chains pull outward" pulls against. A single global
  dial makes a tile 100 out exactly as dangerous as one 10 out. **So how far
  inland an incursion presses scales with how far the colony has reached** —
  depth still costs something, the deep map is still earned, and the gradient
  survives in a new mechanism rather than being quietly dropped.
  **The term is a walk allowance, not a bound from the beach.** A flat distance
  from the landing site is unsatisfiable beside "their target is the
  enclosure's edge": on a generated map the coast is ~110 tiles out, so any
  constant small enough to be a gradient stops the incursion before it arrives
  and a storm with monsters ashore does nothing at all. Depth is therefore the
  Chebyshev walk from the beach to the colony anchor, **plus** the colony's own
  reach, plus a margin — so an incursion always arrives, and a colony that has
  walled further out is walked further across.
- **Strength is not sampled while a monster is sealed in** (new). It cannot be
  rolled off `enclosedLand` at the end of an incursion, which is exactly when a
  monster may still be inside a closed wall or running its backstop clock —
  and a sealed-in monster collapses the fill (below), so the reading would be
  zero. The roll happens **at the landing, from a fill with no monster seeds**,
  which is the colony's true acreage. Without this, walling one monster in is a
  standing exploit for a permanently weak next storm.
- **The enclosure's lair seed goes, and a landed monster seeds instead**
  (breaking). `enclosure.ts:88` seeds the flood-fill from every lair, which is
  what stops a player walling a den in and having that ground read as safe. No
  dens, no seed — but the trap returns in a new form the moment a wall closes
  around a *landed* monster, so the fill seeds from the map edge and from every
  monster on the map: empty on a quiet day, and cheaper than today for most of
  the game. **The consequence is colony-wide and is intended**: a monster
  sealed inside makes the entire enclosure read as outside, the acreage
  readout collapses, the wash goes off and every colonist becomes fleeable-from.
  That is truthful — a monster inside your walls can walk anywhere in them —
  and it is the trap the lair seed always existed to close, doing its job
  against a new shape of mistake.
- **`canPlace`'s lair rule goes with the dens** (breaking). `buildings.ts:596`
  and `walls/index.ts:267` refuse a lair tile so the seed can never be blocked.
  With no lairs there is nothing to protect and both checks are removed; a
  landed monster does not block placement, because it is leaving.
- **A watchtower reads the sea, not a rhythm** (breaking). Its entire product
  today is `isWatched` sharpening `rhythm()`'s buckets from fifths to tenths,
  and there is no per-monster rhythm left to sharpen. A manned tower instead
  **sights an incursion earlier and reports the forecast more precisely** —
  the same trade, information bought with a pair of hands, against the one
  clock that now matters. Coverage stops being lair-anchored and becomes what a
  tower can see of the coast.
- **Landing reuses the wanderer's arrival** (reuses). `settlers.ts`'s
  `eligible` already answers "a beach you can land on": sand, water-adjacent,
  passable, outside any enclosure. An incursion lands by the same rule, which
  means the two things that arrive by sea in this game arrive the same way.
- **`MonsterPhase` is remapped, not deleted** (extends). `Prowl` becomes
  *ashore and dangerous*, `GoingHome` becomes *withdrawing*, `Rest` is dropped.
  This is what lets the spec say flee is unchanged and mean it: `flee.ts:61`
  gates the entire flee check on `phase !== Prowl`, `settlers.ts:348` gates the
  beach rule on it, and `know/` branches on it in seven places — all of which
  keep working. It also keeps CONCEPT's "an attack ends only when the monster
  leaves" meaningful, because a withdrawing monster stops being a threat.
- **`SAVE_VERSION` rises and every scripted hash moves** (breaking). The
  monster record loses `lairX`, `lairY`, `circuit`, `leg`, `restTicks` and
  `prowlTicks`, keeps `phase` with its new meanings, and gains what an
  incursion needs; `Sim` gains the forecast clock, which must also be added to
  `assertSim` (`codec.ts:207–219`) or the structural check stops being total. Old saves migrate by **dropping their monsters and starting the
  forecast fresh** — there is no honest way to convert a resting den into an
  incursion, and a loaded colony finding its wilds empty and a storm coming is
  the truthful outcome.

## Goals

- Peace is peaceful: a wall push has a window long enough to finish in, and the
  window is knowable in advance.
- An incursion is legible before it lands — direction, and roughly when.
- Expansion still buys risk, so the second pillar holds.

## Non-goals

- Combat. Colonists still never fight, monsters still cannot be killed, and
  nothing here adds a weapon, a tower that shoots, or a way to clear the wilds.
- Breaching. The wall is still absolute; an incursion cannot enter a closed
  enclosure and cannot touch anyone behind one.
- Nothing about the readouts is deferred — see *The readouts* in Design. They
  cannot be: `know.threat()` reads `phase`, `restTicks`, `prowlTicks` and
  `lairX` and is live on the ribbon, and `rhythm()` is the monster inspector's
  bar. The fields are being deleted, so the meter and the panel are respecified
  here.
- Difficulty settings, incursion types, or named enemies.
- Sea combat, boats as objects the player can interact with, or any shoreline
  mechanic beyond where a landing may happen.

## Design

### The forecast

`Sim` gains a countdown to the next incursion, in ticks, and the strength that
incursion will have. **The strength is fixed in two halves, at two different
moments, and the split is deliberate**: its random component is drawn from the
store PRNG at the end of the previous storm, so the schedule is deterministic
and replayable and the forecast has something to describe; its **acreage
component is read at the landing**, from a fill with no monster seeds. Reading
acreage early would sample it exactly when a monster may still be sealed in and
the fill reports zero — the exploit the Key decisions rule out. The clock
itself is drawn at the end of the previous storm, whole: the wanderer clock's
shape (`settlers.ts`), applied to weather.

The countdown runs only while the colony exists, and **it runs on the tick**,
so ×0 stops it with everything else: pause is a pause, not a way to lose time
you could not watch passing. Wall-clock time is not available to it in any case
— `sim/` may not read `Date.now`, and a forecast that depended on it would
break determinism outright.

**The forecast has a stored subject, not a computed one.** A watchtower
sharpening a landing on the coast it covers means the site must be known
*before* the landing, so `Sim` carries the prospective landing beach from the
moment the countdown is set, and it is re-validated at zero rather than chosen
there. The alternative — having `know` work out the prospective site on demand
— is a whole-map scan on the HUD's update path, every frame, for a fact that
changes twice a storm.

It is exposed through `know` as a coarse verbal forecast — "a storm is far
off", "before nightfall" — never digits, which is the rule the meter already
follows.

### The opening grace

The first forecast has to outlast the scripted runs, or they stop testing what
they were written to test: `tick.test.ts`'s labour pin covers 2.5 game-days and
`threats/encounter.test.ts` four, and an incursion landing inside the first
would have colonists fleeing and dying in the middle of a labour golden. The
opening grace is therefore longer than the longest scripted run, and the
encounter run schedules its own incursion deliberately rather than waiting for
one. This is a tuning constant with a test-shaped floor under it, and the floor
is worth stating because it is invisible from the game.

### The landing

At zero, **one** landing site is chosen: an eligible beach by `settlers.ts`'s
predicate — sand, water-adjacent, passable, outside any enclosure — **minus its
fifth check**, `watched()` (`settlers.ts:345`), which rejects a beach near a
prowling monster. That check exists to land settlers safely and is exactly
backwards for a hostile landing.

Only the predicate is reusable, and it is module-private: `eligible` and
`landing` both are, and `landing` (`settlers.ts:293`) rings outward from an
**active House with beds**, not from enclosed ground. The "nearest enclosed
ground" anchor is new code, and the predicate is exported or lifted rather than
called where it sits. The monsters are created there, in a count and mix drawn from the
strength.

One site, however large the incursion. A single readable direction is what the
boats buy — which side of the colony is the wrong side to stand on today — and
several landings dilute exactly that. If one proves too easy to wall against,
a second site is a tuning change to this rule and not a new mechanic.

Boats are scenery — a hull on the sand at the landing site for as long as the
incursion lasts, and the thing that makes "they came from there" readable at a
glance. Nothing interacts with them.

### Inland

Monsters press toward the colony rather than walking a circuit: their target is
the nearest reachable unfinished thing — palisade, blueprint, or a colonist
outside — and failing all of those, the enclosure's edge. "Almost to the
centre" is the consequence of that, not a separate rule: they come as far as
the colony's own boundary and no further, because a closed wall stops them.

Everything about what they do on arrival is unchanged and deliberately so:
`nearestDamageable` scans `wallMap` for what `isDamageable` allows, finished
stone is untouchable, a colonist inside a building cannot be caught, and
`FLEE_RANGE` and the per-kind notice radii work exactly as they do. Orcs are
still fast and light, trolls slow and heavy. **This change is about when and
where monsters exist, not about what they do.**

### The readouts

`know.threat()` reads `phase`, `restTicks`, `prowlTicks` and `m.lairX` and
feeds the ribbon's meter; `rhythm()` feeds the monster inspector's bar; and
both lose their inputs here. They are respecified rather than deferred:

- **The ribbon's meter becomes the forecast** — one bar, one clock, counting
  toward the next landing, and during an incursion reporting that one is
  ashore. It is the colony's weather, not a monster's hours, so it no longer
  re-targets between monsters — which was the source of the jumping that
  prompted this change.
- **The monster panel** loses its rhythm bar and says what a landed monster is
  doing: ashore, or withdrawing. There is no per-monster clock left to bucket.
- **The watchtower's product moves with them.** `isWatched` sharpening
  `rhythm()` is only part of what a tower does today: `densInReach`
  (`know/index.ts:759`) feeds `Inspection.watching` and `hud.watchNote`
  ("watching N dens"), and `WATCH_RANGE` drives the reach overlay whose stated
  meaning is "which dens do I want to understand". With no dens, all three need
  a new subject: a tower **watches the coast**, its overlay shows the shore it
  covers, its panel says how much of the coast it can see, and a covered
  landing is forecast earlier and more precisely than an uncovered one. Same
  trade, same currency.

### The withdrawal

**The clock is acted on at a transition, never at a value, and writing it the
natural way is silently wrong.** The countdown reaches zero one tick before the
forecast step can act on it, so a settle keyed on "zero and nothing ashore"
reschedules the storm on that very tick and **no naturally arriving incursion
ever lands**. Nothing in the suite catches it, because every scripted run
writes the clock to zero itself and therefore never exercises the natural
arrival — it was found by playing. Key the settle off the transition, and pin
it with a test that lets the clock run down on its own.

An incursion ends on its own clock — the storm passes — and the monsters walk
back to their landing site and are removed on arrival. CONCEPT's "an attack
ends only when the monster leaves" survives word for word; what changes is that
leaving is now leaving the island.

**A second, longer clock is the backstop**, because the way home can be walled
off behind them. A monster whose route to the coast is blocked walks as far as
it can reach and is removed when that clock expires. Without it a player who
closed a wall at the wrong moment keeps a permanent resident — the den problem
reborn, and inside the colony this time rather than outside it. Removing it the
instant the storm clock ends would be simpler and would have monsters blinking
out mid-map in plain sight, which reads as a bug.

### Enclosure, without lairs

The flood-fill seeds from the map edge and from every monster on the map. In
peace there are none, so the fill is exactly what it is today minus the lair
seeds — cheaper, not more expensive.

**`stepMonsters` has to mark the enclosure stale when a monster changes tile,
and nothing does that today.** `markEnclosureStale` has exactly five callers
(`commands.ts:384`, `threats/damage.ts:90`, `labour/colonists.ts:1058` and
`:1095`, `labour/tasks.ts:255`) and every one is a wall-graph write. The call
is new work this spec adds. Ordering needs nothing: `settleEnclosure` already
runs last in `advanceTick`, after `stepMonsters`.

**Why the result does not flicker**, which is not the event-driven argument —
that governs how often the fill runs, not whether its answer is stable. The
real reason: a monster standing on *outside* ground is already inside the
region the map-edge flood reached, so its seed adds nothing at all. The answer
changes in exactly one case — a monster inside a closed enclosure — and then it
changes colony-wide rather than tile by tile. That is the trap, doing its job.

**The cost is not measured at this cadence and should not be claimed to be.**
The sub-millisecond figure in `2026-09-02-palisade-walls` was taken for a fill
that ran on wall events only. `recomputeEnclosure` allocates a fresh
`Uint8Array(65536)` and `Int32Array(65536)` — 320 KB — per call and ends with a
65,536-tile pass, and `MAX_TICKS_PER_FRAME` is 5, so a catch-up frame can run
five of them. Either reuse the scratch buffers or measure it before claiming
it is free.

### What else comes out

Named so none of it is stranded. `lairAt` (`store.ts:601`) and the
`canPlace`/`canPlaceWall` checks that call it; thirteen lair and rhythm
constants in `tuning.ts:263–305`; `threats/lairs.ts` and its 262-line test,
deleted outright. On the render side the den prop goes — `know.lairs()`
(`know/index.ts:643`) feeds `chunks.ts:98` → `mesher.ts:256`, pinned by
`mesher.test.ts` — and with it `movers.ts`'s `DORMANT_SQUASH`/`SPREAD`/`FRONT`
(`:595–605`) and `MonsterView.stance`, which exist only to draw a monster
asleep at a den. The boat is a baked prop at the landing site, in the same
layer the den prop leaves.

**A monster standing where a building is placed** needs an answer the old model
never needed: `canPlace` ignores colonists because `commands.ts:457` evicts
them, and `evictFromFootprint` is colonist-only. Nothing evicts a monster, and
`passable` then refuses that tile. The incursion path evicts a monster the same
way, or placement refuses the footprint while one stands on it — the second is
simpler and is the default here.

### Migration

**The rung destroys data, and the project's own policy allows it.**
`docs/ARCHITECTURE.md`'s versioning section: "Pre-1.0 the escape hatch is
allowed — breaking saves is fine, but it bumps the version and fails loudly,
never loads garbage." Carrying dead den records forward for one version to
keep a rollback path would be real complexity bought for a pre-1.0 game that
has already said it does not want it. So: the rung drops every monster from
the save and sets a fresh forecast. A v-old
colony loads into an empty wilderness with a storm on the way, which is the
truthful reading of "this world no longer has dens in it". `assertSim` accepts
it: `codec.ts:233–237` checks only that `monsters` is an array of objects, and
`[]` passes.

**The eleven `.castles` fixtures are not re-recorded — they are frozen by
policy** (`fixture.test.ts`: *"Never regenerate either file"*). What changes is
on the reading side: every migrated save now decodes with `monsters: []`, and
`shapeOf` asserts each requested kind is non-empty, so `"monsters"` comes out
of the `kinds` list of the eight shape tests that pass it. The eleven pinned
decode hashes move.

**Rung 3 has to be rewritten, not just extended.** The v3→v4 rung calls
`spawnLairs` (`migrations.ts:21`, `:154`) and `enclosedBefore` (`:485`), both of
which exist only for the lair pass; deleting `threats/lairs.ts` stops that rung
compiling. It becomes a plain `monsters: []`, and `enclosedBefore` goes with it.

**`threats/encounter.test.ts` is a golden run, not a fixture.** Its `den()` and
`run()` helpers pick the nearest lair and site a palisade partway to it, and all
four scripted beats hang off a den's rest and prowl clocks. It is **re-authored
around an incursion**, not re-recorded.

## Alternatives considered

- **Dens stay and monsters emerge on the timer.** Much smaller — enclosure,
  watchtowers and `canPlace` untouched — and it gives up the legible arrival
  entirely: twenty-five scattered emergence points instead of one coast you can
  watch.
- **Dens as landing anchors.** Keeps the enclosure seed and the tower's anchor
  while giving seaborne arrival, at the cost of a den being a place monsters
  visit rather than live, which is a harder thing to explain than either pure
  model.
- **Several landing sites at once.** More dramatic and harder to wall against,
  and it gives up the one thing the boats are for: a direction you can read.
- **Leaving a walled-in monster on the map until it can get out.** Truthful to
  the geometry, and it recreates the permanent resident the dens used to be,
  this time inside the walls.
- **Scaling strength with time rather than enclosed land.** Simpler, and it
  makes expansion free — which removes the second pillar rather than
  reinterpreting it.
- **Keeping the old roaming model and clearing the near ground** (no den within
  `LAIR_CLEAR_RADIUS + ROAM_RADIUS` of the start). Two tuning numbers, no
  concept change, and it would have made the first pushes safe — but it leaves
  the deep map exactly as unexpandable as it is now, which is the complaint.


## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5, as three changes in sequence**, each with its own
  changelog entry: **the model** (dens out, incursions in, `MonsterPhase`
  remapped, the enclosure seed and its new `markEnclosureStale` call, the save
  bump and rung, `threats/lairs.ts` and its test deleted, CONCEPT and
  ARCHITECTURE rewritten); **the readouts** (`know`'s `threat`/`rhythm`/
  watchtower surfaces and the HUD that reads them); **the render** (den prop
  out, boat in, the dormant constants and `stance` out). They are sequential by
  dependency, not parallel: stages two and three read what stage one defines.
- Opus rather than Sonnet throughout, and not a cheaper tier on any stage: the
  fresh-eyes review of this spec found three false claims about the code, an
  unexamined colony-wide exploit and a mis-stated blast radius, which is the
  profile of a change where a confident wrong move is expensive.
- **Not ultracode, and the reason is worth stating**: a fan-out cannot help
  here because the stages are sequential, and the one genuinely irreversible
  act — the migration destroying den records — is a policy decision already
  taken rather than a correctness risk to verify.
- **This is the one change in this series that a `git revert` does not undo.**
  Code reverts; a save that has passed the new rung has lost its dens. Say so
  to the user before the rung ships, not after.

## Amendments

- 2026-09-17 — Four build findings, all spec defects the build resolved as now
  written. **Depth is a walk allowance** — the Chebyshev distance from beach to
  colony plus the colony's reach plus a margin — not a bound measured from the
  landing site, which at a ~110-tile coast would stop every incursion before it
  arrived. **Strength is fixed in two halves**: the random component at the end
  of the previous storm, the acreage at the landing, which is what satisfies
  both the determinism requirement and the sealed-in-monster rule. **The
  forecast carries a stored landing site**, set when the countdown is, because
  a watchtower sharpening a coast it covers needs the site known before the
  landing and computing it on demand is a whole-map scan per frame. And **the
  clock is acted on at a transition**: keyed on the value, the settle fires on
  the tick the countdown hits zero and no naturally arriving storm ever lands —
  invisible to the suite, because every scripted run zeroes the clock itself.
