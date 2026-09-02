# One wall drag draws an L, not just a straight run

The wall tool's gesture is now two legs: leg one along the dominant axis from
the press tile to the cursor's extent on it, leg two perpendicular from that
corner tile to the cursor tile. The ghost previews both, and release still
emits a single place-wall command carrying the whole shape. A cursor left on
the dominant axis gives an empty second leg, so a straight drag is the
degenerate case and behaves exactly as it did. Refines
`docs/specs/2026-09-02-palisade-walls.md`.

## Detail

**This supersedes the spec's "corners are composed from multiple drags."** That
line stands as a record of what step 3a shipped, not as a constraint — the spec
is signed off and is not being edited. Two drags still compose, and that is
still how a T or a cross gets made; what changed is that the commonest case, a
corner, is one gesture.

**All of it lives in `wallRun`.** The ghost and the release both already went
through that function, so neither `main.ts` nor the command shape needed
touching: the L is geometry, not new plumbing. `Command.placeWall` still
carries a flat tile list, so nothing about the save log or the golden replay
changed shape.

**The corner tile belongs to leg one and is never repeated** — leg two starts
one step past it. That matters because the tiles go into one command, and a
duplicated tile would be a silent no-op today and a double charge the moment a
segment costs more than one log.

**The diagonal tie now decides which leg leads, not whether there is a second
one.** `wallRun([5,5], [7,7])` used to be a straight horizontal run; it is now
a horizontal leg then a vertical one. The old assertion was updated rather than
preserved — a perfect diagonal producing a straight line was a property of
there being only one leg, not a rule worth keeping. Everything else is
unchanged and still pinned: a sub-6px press is one segment, the far end clamps
to the map (including the turn), a drag starting off-map is empty, and the axis
is re-evaluated live so the L may flip which way it turns while held.

**The ghost's instance cap had to double.** `MAX_RUN` was one map edge; an L's
two legs together reach nearly two, and the overlay layers silently drop
instances past their cap — which would have quietly truncated the far end of
the very preview the player aims with.

**Golden hash `9783cd77` → `c0441655`** (moved again to `11a997a8` by
`docs/changelog/2026-09-02-stale-route-repath.md`), and legitimately a
*behaviour* change
rather than a shape one: `tick.test.ts`'s scripted log gained an L-shaped
`placeWall`, so wall placement, build-wall tasks and the enclosure recompute now
sit inside the determinism pin. It also gained an assertion of its own — nine
tiles from one command, six in a row and four in a column, with folk working
them — so the new command is not merely hash noise.

**The drag is scripted at tick 1420, late on purpose.** Build-wall outranks
haul-to-input, so a wall drawn early diverts every free log and the mill never
cuts a plank. That is the intended coupling (expansion competes with hauling)
and it is worth knowing, but it would have cost that file its end-to-end
designate → chop → haul → build → mill → plank assertion. Drawn late, the wall
is demonstrably being worked at tick 1500 while the mill has already run.

**Cancelling reaches the whole gesture, and was checked on the effect.** Escape
mid-L clears `runFrom`/`runTo` through the existing `cancelDrag`, and the check
is a byte-comparison of the target ground before and after — identical — rather
than a look at the ghost. Watching the overlay instead of the outcome is
precisely what let a cancelled marquee still fire its command once before
(`docs/changelog/2026-09-01-drag-box-designation.md`).

**Not covered.** Nothing tests the gesture against a rotated or tilted camera —
`pick.test.ts` uses a top-down orthographic camera, so the projection is
exercised but not the game's oblique view; that limit is inherited, not new.
There is no way to draw a U or a staircase in one gesture, and no plan for one.

Verified in the browser per the `CLAUDE.md` files: an L held mid-drag previewed
both legs with the corner drawn once, released and built into a continuous
corner; a straight drag along a world axis previewed and built as a plain
straight run; a single click placed one segment; two separate straight drags
composed into a T and then a four-way cross. Console clean. 164 tests, lint,
`tsc`, production build.
