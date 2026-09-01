# Slot workers step inside their workshop instead of standing at the door

A staffed colonist now walks to the work tile and *enters* the building: a new
`inside` flag on the colonist, position pinned to the footprint centre, and the
mover layer skips drawing them. Production gates on `inside`, so the walk over
is no longer production time. Unstaffing steps them back out to the work tile —
or the nearest free ground if it is blocked — and back into the pool. Refines
`2026-09-01-tick-and-labour`.

## Detail

**Why hide them at all:** until there are real work animations, a figure
standing motionless beside a building reads as loitering, not working. Hiding
is the honest placeholder — an idle-looking animation would be a lie about what
the sim is doing.

**The panel is now load-bearing.** With the worker invisible, the only evidence
the slot is filled is the inspector's new `Worker` row (`none` / `on the way` /
`inside`) and the labour meter's rust segment. Anything that later removes that
row removes the player's ability to see a staffed workshop at all.

**Milling gates on `inside`, not on `atStation`.** That distance test now only
decides *when* to step in, and stopped being exported. The outcome for a worker
who can never reach the station is unchanged — no `inside`, no production — but
"at work" is one field rather than a recomputed proximity check, and pinning the
position inside the footprint would have made the old adjacency test read false
anyway.

**`leaveBuilding` must always land on walkable ground**, because the colonist
rejoins the pool on the same tick and will immediately be asked to path away
from wherever it put them. It prefers the work tile and falls back to the
`dropTile` spiral, so a tree grown over the door since they went in does not
strand them. Both paths are tested.

Reached from three places, all of which now clear `inside`: the `unstaff`
command, `cancelBlueprint` (defensive — cancelling requires a non-Active
building and staffing requires an Active one, so a staffed building can never
be cancelled), and `stepSlotWorker` finding its building gone.
`evictFromFootprint` skips colonists who are inside: placement cannot overlap
an existing building, so they can never be in a new footprint, and the explicit
skip stops the pin being walked out from under them if that ever changes.

**Golden hash 93cf902e → aca92821**, legitimately: the store gained a field, the
pinned position differs, and the scripted command log gained an unstaff at tick
1300 and a restaff at 1380 so the whole round trip — walk over, step in, step
out, rejoin the pool, walk back in — sits inside the determinism pin. It did not
previously script an unstaff at all. Every behavioural assertion in
`tick.test.ts` is unchanged and still passes, which is what says the hash moved
for shape rather than for behaviour.

Verified in the browser per `src/ui/CLAUDE.md` and `src/render/CLAUDE.md`:
staffing showed `Worker on the way` while walking with `millProgress` still
stopped, then `Worker inside` the moment cutting began; the mill has no figure
at its door in the screenshot. Unstaffing changed 481 pixels in a patch tight
around the sawmill (max delta 486) — the worker reappearing — with the panel
returning to `Worker none` and the meter to `ppppp`; designating fresh trees
afterwards took all five folk from idle to working, so the ex-slot worker is
genuinely back in the pool. Console clean, 69 tests, lint, build.

Not covered: nothing exercises two staffed workshops at once, and the step-out
spot is only tested for walkability, not for being the *nearest* free tile.
