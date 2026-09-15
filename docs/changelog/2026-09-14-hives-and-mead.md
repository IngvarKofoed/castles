# Honey into mead, and the first rate that is a fact about where a building stands

A **Hive** makes honey out of a keeper's hours and up to three times faster for
the **Flowers** standing within six tiles of its plot; a **Meadery** turns honey
into mead. Mead's whole payout is on *who comes*: while the colony holds a cup a
head and one for the newcomer the wanderer countdown runs at double speed, and
each wanderer drinks one on settling. All three go wherever a House goes, walled
or not. `SAVE_VERSION` is 11. Implements
`docs/specs/2026-09-14-hives-and-mead.md`.

## Detail

**The boost is a batch length, read at the completion compare every tick.**
`stepWorkshop`'s `millProgress < recipe.ticks` became
`millProgress < batchTicks(sim, b, recipe)`, which answers `recipe.ticks` for
every kind but the Hive and `HIVE_TICKS_BY_FIELDS[fieldsInReach(...)]` for it —
200 / 120 / 80 / 60 ticks for 0 to 3 fields. Reading it per tick means a field
finishing mid-batch speeds the batch already under way; the opposite can never
happen, because buildings are never razed, so the count only rises. Nothing is
stored on the hive and nothing is scaled at runtime: a count and a lookup, the
way `populationCap` sums beds.

**Reach is footprint to footprint, and that was the decision.** `footprintGap`
(`buildings.ts`) is `besideFootprint`'s clamp-to-interval arithmetic
generalised from a point to a rectangle, so a field counts exactly when some
tile of its plot lies inside the hive's plot grown by `HIVE_REACH` — which is
exactly the rectangle the overlay traces. Origin-to-origin, the Watchtower's
rule, is exact only for 1×1 footprints: with a 2×2 hive and 3×3 fields it lies
at three of four edges, and since fields are never razed that mismatch would be
baked into every colony's honey rate for good. `drawWatchRange` generalised with
it — one `drawReach(rect)` and two callers, of which the tower's square is the
1×1 case.

**Mead speeds the clock; it never gates it.** `cellarSet` is `tableSet`'s bar on
mead, counted the same way (stored, loose or carried, so it cannot flicker as
haulers walk), and `stepSettlers` decrements by 2 instead of 1 while it holds.
Read inside the existing gate sequence and per tick, not folded into `restart`'s
draw — so the PRNG stream is untouched and the boost switches on and off
mid-countdown as stock crosses the line. **Beds and food remain the only gates**;
a second gate was rejected in the spec as strictly harsher than food's, and
should stay rejected. `resolve` takes the **lowest-id free** mead that is stored
or on the ground, never a carried or reserved one (either would orphan a haul
mid-flight), and a wanderer settling into an empty cellar settles anyway. The cup
is paid on delivery, so a wanderer caught on the beach costs nobody's drink —
and demand therefore equals arrivals, which is what keeps the cellar a standing
cost rather than a threshold crossed once.

**Flowers are the first building with no worker and no recipe.** A 3×3 plot,
two logs, built by the ordinary `Build` task and then simply standing. That is
what makes the whole feature cost no world layer, no designation map, no new
`TaskKind` and no seeded migration rung — a generated meadow layer would have
wanted all four, and would have put the game rather than the player in charge of
where honey lives.

**The v11 rung stamps the two accept flags `0`, deliberately against the v9
rung's rule.** Since `2026-09-14-stockpile-default-and-clearing` a pile's
filters are the player's curation, and a good that did not exist when the save
was written was never opted into; `all` is one press. The v9 rung's reason for
stamping `1` — that a *missing* flag refuses the good forever while its workshop
jams at output cap — is answered by writing the field, not by its value. Two
`-1`s join `limits`; no colonist and no world field moves. The bump itself is for
the older build: three new `BuildingKind`s would otherwise load clean and crash
on the first frame (rung 8's reason).

**Every pinned hash moved for shape, and that was proved rather than argued.**
With the two `Building` fields and the two `limits` slots stripped back out, all
four scripted runs hash to their old numbers exactly — the golden `3216d1b3`,
the settling `3d64cb83`, the death run `78fd60d6`, the bread chain `077aabf8`,
the encounter `88d00a73`. It could not be otherwise: no script builds a Hive, a
Flowers or a Meadery, so no mead exists, `cellarSet` is false on every tick and
`batchTicks` answers `recipe.ticks` everywhere. New numbers: golden `e9599a0f`,
settling `ebb40f13`, death `711457ba`, bread `2e74c71c`, encounter `b5e291f3`;
fixtures v1 `fd6e06a5`, v2 `d6358846`, v3 `85e11905`, v4 `b6afcd30`, v5
`b3c15c23`, v6 `fe2019bc`, v7 `a1539258`, v8 `a4634c50`, v9 `56c5e989`, v10
`2b8186a7`. The files themselves are untouched and stay frozen.

**`v11.castles` joins them**, on the default fixture seed and caught at 2500 —
a **manned Hive with three Flowers inside its reach**, so the file freezes a
batch length that is a fact about *where a building stands*; a Meadery running;
and a **cellar that is set**. Two numbers in the recipe are deliberate and worth
not rediscovering: it chops **24 trees, not 44**, and it stops at **2500, not
4200**. A 2×2 stockpile holds 32, the boosted hive out-produces the meadery, and
a few hundred ticks later the whole chain is jammed at `output-full` behind a
full pile — a real colony state, but one a fixture cannot demonstrate running on
from.

**Two panel notes are state-independent on purpose.** The Flowers panel says
*boosts hives within 6 tiles* and the Meadery says *mead in the cellar brings
folk sooner* whatever either is doing, because a hive's speed and mead's effect
are both invisible until they are already working — this is the only place the
game can say what they are *for* beforehand. The Hive gains a
`Fields in reach N / 3` row (the Watchtower's `watching` convention) and, at
zero, *no flowers in reach — plant fields within 6 tiles*. The House gains a
second note when the cellar is stocked and arrivals are possible; the
short-table note wins where both could apply, since nobody is coming either way.

**Known limits, none of them repaired.**

- **The Meadery is the seventh building on one silhouette** — it falls through
  to the timber-workshop prop. The Hive and the Flowers have props of their own,
  which is the point: they are the two buildings the game *invites* the player to
  put outside the wall, so whether they are safe has to read at map distance.
  `docs/CLAUDE_TODO.md` carries the shared-silhouette item, now widened.
- **`millNote` fabricates plurals**, so a jammed hive says "nowhere to put the
  **honeys**" and a jammed meadery "the **meads**". Two more mass nouns on the
  existing TODO item (`2026-09-11-sheep-and-clothes` exposed it with "clothess"),
  newly visible rather than newly caused.
- **The House's second note was not driven in the browser.** `cellarStocked` is
  unit-tested in both directions, including the short-table precedence, and the
  line that renders it is one `if` — but no run put a House, free beds, a set
  table and a stocked cellar on screen together, because the v11 colony is
  log-priced and has no sawmill to make a House's planks. Stated so this is not
  read as a screenshot it never got.
- **The two cadences were measured by test, not by stopwatch.** `batchOf` pins a
  lone hive's batch at exactly `HIVE_TICKS_BY_FIELDS[0]` and a three-field
  hive's at `[3]` — 200 against 60 ticks, which is the twenty seconds and the
  three-times-faster the Outcome asks for. The browser run was at ×4 with a
  colony that had eaten its provisions, so what it showed was that a lone hive
  produces at all, not how long it took.
- **Nothing tests two hives sharing a field**, a field built before its hive
  (the rule is order-free by construction, not by a run), or an arrival timed
  end to end in the browser at both clock rates.
- **Neither the fixture nor any test puts a hive outside the wall with a
  monster near it** — the keeper's shelter is
  `2026-09-14-indoor-workers-wait-out-prowlers`' own subject and is pinned
  there.
- **The rail is longer again.** Build is eight grid rows and Stores has a fifth
  group; measured at 1280×900 the rail is 62..455 and Stores 467..888, a 12px
  gap with 112px scrolling inside the rail, and at 1280×720 the same gap with
  292px scrolling. They still cannot overlap at any height — the left column's
  flex split — and the page never scrolls. `docs/STYLEGUIDE.md` records it.

Verified: 479 tests (24 new — the append rituals, the reach's edges and its cap,
the batch table, a field finishing mid-batch, the cellar's bar and its missing
exemption, the doubled and un-doubled countdown, the cup's three rules, and the
v11 fixture's three), lint, `tsc`, production build. In the browser (1280×900,
`v11.castles` imported through the menu): the Stores panel's fifth **Drink**
group with honey amber and mead pale straw; the Hive panel reading `→ Honey`,
`Worker inside`, `Fields in reach 3 / 3` with one gold button; the Meadery
`Honey → Mead` with its consequence note; the Flowers panel `Plot 2 logs` and
*boosts hives within 6 tiles* with no action button; the reach rectangle drawn
around a selected hive, around the ghost **and** every standing hive with the
Hive tool held, and around every hive but with **no ghost rectangle** with the
Flowers tool held. A second Hive placed beyond the first one's rectangle, built
and staffed, read `Fields in reach 0 / 3` with *no flowers in reach — plant
fields within 6 tiles*, then `working`, and put honey in the colony. Console
clean (0 errors, 0 warnings).
