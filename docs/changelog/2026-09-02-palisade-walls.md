# Palisade walls, gates, and enclosure as a computed fact

The expansion loop exists: line-drag a palisade, pool workers fetch a log each
and raise it segment by segment, cut a gate for traffic, and the ground inside
becomes *inside* — a flood-fill from the map edge, read off `sim.insideMap` and
counted on the ribbon. Razing gives the log back. Walls are a grid layer in
`Sim`, not entities, read only through `sim/walls`' `isBlocking` / `isWalkable`.
`SAVE_VERSION` is 2 and v1 saves migrate. Implements
`docs/specs/2026-09-02-palisade-walls.md` (build-order step 3a).

## Detail

**`TaskKind` is append-only from now on, and priority left it.** `BuildWall`
and `Raze` are 5 and 6 — appended, never inserted — because a kind is a number
written into every save, so slotting one into the middle would renumber every
live task in every old save into a different meaning with no migration able to
tell. The priority order moved to `TASK_PRIORITY` in `tuning.ts`: **build >
build-wall > haul-to-site > haul-to-input > chop > raze > haul-to-store**.
Rejected remapping kinds in the v2 migration instead — that fixes the first
instance and leaves the bug class, plus every future insertion would need
another remap and a live-task fixture.

**`TASK_PRIORITY` holds bare numbers on purpose.** `store.ts` imports
`tuning.ts`, so a *value* import of `TaskKind` there closes a cycle whose
failure — `TaskKind` read in tuning's module body while `store.ts` is still
initializing — depends on which module a bundler happens to load first. The
import is `import type`, which is erased; the numbers are type-checked against
`TaskKindValue`, and `tasks.test.ts` pins the order **by name**, which is what
catches a renumbered enum rather than merely an invented number.

**The log is carried until the completion instant, and no delivery ledger
exists.** A build-wall task reserves its log at creation (the step-2
reservation discipline), the builder carries it through the whole work stint,
and it is consumed only when `wallMap` flips. That is what makes every
interruption path already correct: `abandonTask`, the `staff` command taking
the builder, and eviction all drop a carried item where the colonist stands, so
a cancelled blueprint's refund *is* that drop. Do not add a ledger — it would
have to be kept in step with all three, and one log per segment (gates
included) is precisely what avoids needing per-tile delivery bookkeeping until
the stone tier, which needs it anyway.

**Enclosure is event-driven, not region-incremental** — ARCHITECTURE's wording
was updated to match rather than the code bent to it. `sim.enclosureDirty` is
the batch flag: the whole BFS runs at most once per tick at the *end* of the
tick, batching every segment that completed or fell, and not at all on a quiet
tick. The flag is therefore always 0 at a tick boundary, so a save can never
carry a pending recompute. `enclosure.test.ts` asserts the skip explicitly,
which is what keeps the flag load-bearing rather than decorative.

**The enclosure definition, pinned once:** `insideMap[i] = 1` exactly when the
flood never reached the tile **and** the tile holds no wall — blueprints
included. Excluding wall tiles is what makes the ribbon's count mean *buildable
enclosed ground*. Two consequences that surprised the build: the map edge is
always outside, so an L of wall against the map corner encloses nothing (the
generator's water border is what makes this a non-issue); and a wall *on* an
edge tile must block rather than seed, or a colony walled to the coast would
never count as enclosed. Both are tested.

**`passable` takes `wallMap` as a required argument, not an optional one.** An
omitted layer reads as "no walls anywhere" and would let colonists ghost
through finished segments with nothing failing. Walls deliberately stay out of
the `occupancy` set: there are hundreds of them, which is exactly what would
destroy that set's "footprint area stays tiny" rationale.

**`dropTile` now skips every wall tile, gates and blueprints included** — more
than `passable` refuses, because a log lying where a wall will be blocks the
very segment it was fetched for (`canPlaceWall` refuses a tile with an item on
it). Anything older than the blueprint is swept off when the segment completes.

**Known limit found in play: raze-then-place on the *same* tile has to wait for
the log.** Razing drops the log on the tile just freed (the chop precedent, per
spec), and that log then blocks re-placing there — so converting a palisade to
a gate needs the log hauled away first. With a stockpile this self-heals in
seconds; without one the log sits forever, exactly as a loose log on any ground
you want to build on already does. Consistent with existing behaviour, so left
alone.

**Wall hit points are still absent, deliberately.** ARCHITECTURE says segments
carry them; that field arrives with threats and its own migration, not before
anything can damage them. Construction progress lives on the *builder*, not the
segment — one log and one work stint is the whole of a palisade — and
ARCHITECTURE now says so.

**Overlay strengths, dialed by eye against real grass** (the styleguide gained
the recipe): the enclosure boundary at 0.11 tiles wide, the interior wash at
0.14 alpha. 0.07 measured as a hairline that read *dark* rather than sage,
because the keyline under a line is wider than the sage on top of it; at 0.11 —
a placement ghost's weight — the sage wins. Raising the fill instead is the
wrong repair: at any strength where a wash reads alone it is tinting the world.
A gate blueprint stands taller with a crossbar so a planned gate is visible as
a gate inside a drawn run.

**Fixtures: `v1.castles` unchanged and still frozen; `v2.castles` joins it, and
both recipes now live in `fixtures/recipe.ts`** so the generator and the shape
test cannot drift apart. The v1 pinned hash moves `5d843ae6` → `507f1746`,
legitimately: the 1 → 2 rung adds three zero-filled layers and `decode`
recomputes enclosure over them. The v2 fixture deliberately carries work in
flight — a closed ring with a gate (so `insideMap` is not all zeroes),
blueprints with live build-wall tasks holding logs reserved, and a raze mark
nobody has finished acting on — because an all-quiet save would round-trip past
most of what the alarm exists to catch.

**Golden hash `fbe20cb9` → `9783cd77`, for shape not behaviour.** The store
gained four fields; the scripted run places no walls, so all four are as
`createSim` left them and every behavioural assertion in `tick.test.ts` is
unchanged.

**Two more full-grid scans per tick.** `generateBuildWall` and `generateRaze`
each walk all 65k tiles every tick, joining `generateChop` — the accepted
step-2 limit, now three times over. This is the first thing to index when five
colonists become fifty.

**Not covered.** `MAX_INSIDE` caps the interior wash at 16384 tiles (a ~128²
enclosure); past that the wash goes partial while the boundary line stays whole
— untested, and unreachable at hand-drawn sizes. `GateBp` never appears in the
v2 fixture (it is transient), so the format's coverage of that one state rests
on unit tests. Nothing tests the wall tools' DOM or the run preview against a
rotated camera; both are browser-verified only, as the rest of `src/ui/` is.

Verified in the browser per the subtree CLAUDE.md files, all four Outcome
bullets: a dragged run ghosting sage with a tree-occupied tile in rust and
skipped on release, then built into a *gapped* palisade; a blueprint-only ring
reading `0 enclosed` and jumping to `30` the tick it closed; the keylined sage
boundary traced along the inside edge with the wall tool held and gone on
Escape; a raze mark as gold base-plate plus gold-shifted timber, then the
segment down, a log on its tile and the count back to `0`; a gate built into
the gap taking it back to `30`; a stockpile *inside* the ring built and stocked,
which only workers coming through the gate could have done. The committed v1
save imported through the menu logged `load — tick 400, hashSim 507f1746` —
the same number the fixture test pins — opened wall-less, and took a palisade
straight away. 144 tests, lint, `tsc`, production build, console clean
throughout (0 errors, 0 warnings).
