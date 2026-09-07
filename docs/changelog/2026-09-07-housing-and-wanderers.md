# The colony can grow: houses, beds, and wanderers off the beach

A House (4 planks, 2 beds) raises the population cap, and while the colony sits
under it a wanderer lands on a calm beach and walks in — settling as a pool
worker, dying to an orc on the way, or waiting two days and leaving. Deaths open
room the next arrival refills, so the population is no longer a ratchet.
`SAVE_VERSION` is 6. Implements `docs/specs/2026-09-07-housing-wanderers.md`.

## Detail

**The cap is derived, and it has no counter.** Population cap is
`STARTING_COLONISTS` plus the summed `beds` of every *active* House, computed
per read (`sim/settlers.ts`). Beds are a **cap, not an assignment**: nobody owns
one, nobody is homeless, and the only thing that lowers the population is a
death. Rejected bed ownership and a homelessness mechanic outright — bookkeeping
with no decision behind it, and the calm tone has no room for a "homeless"
alert.

**A wanderer is a colonist with `dest` set**, and that one field is why the
whole threat tier applies to them for nothing: monsters notice them, they flee,
they can be caught, they leave a grave. `stepColonists` branches on `dest >= 0`
before the pool/slot split, so they never claim a task; they settle on reaching
any tile **beside** the destination House's footprint (`atStation`'s rule, now
shared — a House has no work tile to aim at). They count in **none** of the four
labour numbers: `slots` is `folk − pool`, so counting a wanderer in `folk` alone
would have the meter invent a phantom slot worker.

**The give-up clock is `Colonist.patience`, its own field.** It holds at 0
while they are walking and counts up only on a tick where no route to the
destination could be found, so a flee neither advances it (nobody times out for
time spent running) nor resets it (running in a circle is not progress), and its
wrap doubles as the repath cadence — one A\* every `TASK_COOLDOWN_TICKS` while
stuck, rather than one per tick for two game-days.

It shipped inside `work` first, because the spec allowed exactly one new
colonist field; the amendment un-punned it. **Both halves of the old behaviour
were accidents rather than decisions**, which is the whole argument for the
field: nothing advanced the clock during a flee only because `stepWanderer`
never ran, and nothing reset it only because `abandonForFlight` returns early
for a colonist with no task — and a wanderer never has one. The one case that
*did* reset it silently was eviction, since `stepAside` calls `clearWorker`: a
stuck wanderer standing where a building was dropped got a fresh two days.
That is now the only behaviour change from the un-pun, and it is the right way
round — being shoved aside is not the same as getting unstuck, and a route that
actually opens still resets the clock properly.

**`findPath` gained a `ceiling` argument, and the wanderer passes `ISLAND_WIDE`.**
This was a real defect, not a precaution: the island has no land edge, so an
arrival walks ~110 tiles from the coast to a colony at the centre, and A\* over
open ground *plateaus* — every shortest route ties, so the search expands the
whole band between the ends. Measured at 700–6300 nodes for the same walk across
three seeds, against a `MAX_VISITED` of 6000: on seed 20260904 the wanderer
could not find a route that plainly existed and left after two days. The default
ceiling is unchanged for every other caller. A genuinely impossible walk now
exhausts the reachable land instead — 36k nodes, ~15 ms — which is affordable
only because one wanderer exists at a time and a stuck one re-plans on the
cooldown's rhythm.

**The landing beach is measured in Manhattan distance, and that is not a style
choice.** The grid is 4-neighbour, so Manhattan *is* walking distance. Chebyshev
picks the diagonal coast of a round island — both a longer walk and a diagonal
A\* whose tie plateau is at its widest. Eligibility is: sand, beside water,
standable, outside any enclosure, and outside every **prowling** monster's
notice radius at that tick, so nobody is ever put down in front of an orc. No
eligible beach means retry next tick, **without a PRNG draw** — a draw per failed
attempt would make the arrival stream depend on how long the wilds were busy.

**The countdown is clamped at 0, because -1 on that field is a sentinel and not
a small number.** A timer allowed to step past zero would read as "one in
transit", restart itself, and stop arrivals for good. It cannot happen at
today's tunables — all four are whole ticks only because `DAY_TICKS` is 600 —
which is exactly why the clamp is there rather than left to the arithmetic.

**Nothing distinguishes settled, died and gave up.** All three leave no wanderer
with `wandererTimer` at -1, and the next tick restarts the countdown — which is
how a death is detected at all, since `killColonist` splices a wanderer out
without knowing it was one. That is the recovery loop, and it is one branch.

**`BuildingDef.costType` landed, and every hardcoded `ItemType.Log` died with
it** — the blueprint's capacity, the haul that feeds it, the completion count in
`actHaul`, the panel's "Logs delivered" row and its "waiting for logs" note, and
the rail's `4 logs` caption. Missing any one of them leaves a House unbuildable
with its planks stacked inside it. Costs stay **one type per def**: a mixed cost
needs the per-site delivery ledger `actBuildWall` deliberately does not have.

**Two golden runs, both found by seed selection.** `settlers.test.ts` pins a
settling (20260908 — lands, walks ~110 tiles, settles, and a second is on the
road at the end) and a death en route (20260912 — an orc catches the wanderer in
the wilds, one grave, and the countdown restarts). The drift test saves and
loads mid-walk through both. The labour pin and the encounter keep their own
seeds and are untouched behaviourally: `tick.test.ts` `8aabfdb3` → `7cd7340f` →
`50083138` and the encounter `3290d599` → `d06c4a79` moved for **shape only** —
neither colony builds a House, so `stepSettlers` returns at its cap check every
tick and draws nothing. The encounter did **not** move for the v6 field, alone
among the pins, and the reason is worth knowing rather than puzzling over: by
tick 2400 the wilds have taken all five of its colonists, and `patience` is a
colonist field. `wandererTimer` moved it at v5 because that one sits on `Sim`.

**Two rungs, and every fixture hash moved twice; the files are untouched.** The
4 → 5 rung stamps `dest` and the arrival clock: v1 `c1b9ffd1` → `ea10914f`, v2
`41f2beab` → `e0a0ad53`, v3 `7dcf3387` → `9935f38b`, v4 `c32c98b0` → `80b2f86e`.
The 5 → 6 rung gives every colonist `patience`: v1 → `ab0c5574`, v2 →
`83891a24`, v3 → `8c8cb6fc`, v4 → `aee29fc7`, and `v5.castles` — the only file
ever written by a codec with `dest` but not `patience`, which is what makes it
worth keeping — `9ce13a24` → `1aba9400`. The v5 rung reads `WANDERER_INTERVAL`
from tuning rather than freezing a literal, so a retuned interval reaches a
migrated colony as well as a new one; the price is that retuning it moves those
hashes, which is honest rather than surprising.

**`v5.castles` and `v6.castles` both join the folder.** v5 is caught at 1600
with a wanderer mid-walk beside the House its colony built out of planks; v6 is
the same colony at 3400, holding **all three ways an arrival can end at once** —
a settler who came by sea and is now indistinguishable from a starting
colonist, the grave of the one after them, and a third mid-walk with a route
half-consumed. **The 5 → 6 rung defaults `patience` to 0 and does not read the
old `work` across**, deliberately: `work` is written by half a dozen systems, so
a number found there means task progress far more often than it means waiting,
and a settled colonist mid-chop would migrate in with a phantom clock. The
bounded cost is that one wanderer in one v5 save waits up to two game-days
longer than they had left; guessing the other way could only make somebody
vanish sooner than the save implied.

**`staff` refuses a wanderer**, which is the one place an unchanged caller had
to learn about `dest`. It picks the nearest colonist with no slot — deliberately
including a busy one — and a wanderer has no slot either, so the player pressing
Staff while somebody was walking in could bind the workshop to them. They would
keep walking (`stepColonists` reads `dest` first), leaving the mill marked
staffed by somebody who never arrives, and a give-up would then despawn them
with `b.worker` still holding their id — recoverable only by pressing Unstaff.
Found in review, fixed with the guard beside the slot check, and pinned.

**Arrivals are silent, and the ribbon's `/ cap` suffix appears with the first
House.** Before that the folk readout is a bare count, so a fresh colony never
reads as "full" and an old death-reduced save is not teased with room nothing
will fill. No toast, no banner, no line of text: the figure walking up the beach
is the announcement. A wanderer draws as an ordinary colonist with the carry box
keyed off `dest` — the traveller's pack is the same crate on a different flag.

**Numbers, all tune-by-eye firsts.** `WANDERER_INTERVAL` half a game-day ±
`WANDERER_JITTER` (a fifth), `WANDERER_PATIENCE` two game-days,
`BEDS_PER_HOUSE` 2. Measured end to end: a House finishing at tick ~1000 has its
first settler at ~1900, so **the whole arrival takes about a game-day and a half
— and up to two and a half on a seed whose coast-to-colony route detours.** The
spec's "short walks near the colony: scenes, not off-camera treks" does not
survive contact with the geography, because the colony starts at the centre of
the island and the coast is a hundred tiles out in every direction. It is
still a scene, and it is still readable, but it is a long one; the number to
look at first is `WANDERER_INTERVAL`, not the walk, which is fixed by the map.

**The suite got dearer, and the new worst case is the v6 shape replay.** An
arrival cannot be scripted quickly — a House needs a plank chain and the walk in
is a hundred tiles — so v6's recipe is 3400 ticks and re-running it against the
current build costs ~12 s idle, second only to the scripted encounter's. Whole
suite ~100 s wall clock, every test far inside the 120 s ceiling, but this is
the file to look at first if that ceiling ever fires again
(docs/changelog/2026-09-05-monsters-and-the-hours-they-keep.md records the last
time it did).

**Not covered.** The v6 fixture carries `patience` at 0 on every colonist — no
tick of its recipe has anybody stuck — so what it vouches for is the field, not
the value; a running clock is pinned by unit test instead, through
`structuredClone` rather than the codec, because `assertSim` refuses a
hand-built test world. A wanderer whose clock runs out *while fleeing* still
despawns on that tick, which is honest (their two days were up) but means the
figure can vanish mid-run; nothing tests it and nobody has seen it.
Nothing exercises two Houses (the lowest-id rule is pinned by
unit test only, and no run has ever had a second House to choose between), or a
wanderer sealed out *mid-walk* by a wall finished across their route — the
patience test seals the coast off while they are still on it, which is the same
code path from a different start. The "wall the colony shut" Outcome bullet was
verified by unit test rather than in the browser. The House panel shows the
standard `POOL` tag, which reads oddly for a building with no workers but is the
existing grammar (`hasSlot ? slot : pool`) applied unchanged, exactly as a
stockpile gets it. And a mid-route re-plan inside `walk` still uses the default
ceiling, so a wanderer whose route goes stale far from home loses the route and
re-plans with `ISLAND_WIDE` on the next tick instead — correct, but one wasted
search, and it holds only because `patience` is 0 while walking — which
`settlers.test.ts` does pin — so the cooldown gate opens immediately. The
`landing` scan is a diamond-ring walk with early exit, so a colony with **no**
eligible shore anywhere sweeps the grid once per tick for as long as that
lasts; bounded and rare, but not free.

Re-verified after the un-pun: the walled-shut Outcome bullet (sealed out, the
clock runs on `patience` while `work` stays 0, gone about two game-days later
with no grave), and the new rule it exists for — a prowler arriving mid-wait
neither advances the clock nor resets it, and the wait resumes and finishes on
what was left of it. Both are tests rather than browser checks.

Verified in the browser (seed 20260908 with the v5 fixture imported through the
menu): the rail's `House / 4 planks` button, the House standing beside its
sawmill under a pale gable, its panel reading `House · Pool · Beds 2` with no
action button, the ribbon going `5 / 7` → `6 / 7` → `7 / 7` folk as two
wanderers walked in, arrivals stopping dead at the cap for three game-days after
it filled, the labour meter growing a segment for each settler and none for the
one in transit, and a wanderer out in the wilds drawn as a figure with a pack on
its back. Console clean (0 errors, 0 warnings); the imported fixture hashed
`9ce13a24` in the browser, the same number the test pins. 313 tests, lint, `tsc`,
production build.
