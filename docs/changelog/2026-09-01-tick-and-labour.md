# The colony works: fixed tick, pool/slot labour, logs into planks

The game runs. A deterministic 10 Hz tick drives five colonists who fell
designated trees, haul logs, build what you place, and mill planks; the HUD is
the first `src/ui/` code and follows `docs/STYLEGUIDE.md`. Staffing the sawmill
takes a pair of hands out of the pool and you feel it. Implements
`docs/specs/2026-09-01-tick-and-labour.md` (build-order step 2).

## Detail

**Reservations are taken when a task is created, not when it is claimed** —
narrowing the spec's "claim → reserve". A task owns its item (`reservedBy`) and
one unit of destination capacity (`reservedIncoming`) for its whole life, so
generation's "is this free?" is one field read rather than a scan over live
tasks, and two haulers for one log is impossible by construction. The cost is a
priority inversion — a log reserved by a tidy-up haul is not available to a
blueprint raised a moment later — which self-heals via the stockpile and costs a
detour, never a stall. Don't move this back to claim-time without replacing the
dedup it provides.

**The mesher takes the buildings array, not a per-tile building index.** The
spec sketched a render-derived index; a 65k-entry `Int32Array` rebuilt on every
dirty event costs more than filtering a list that never gets long, and the
mesher only wants the buildings whose *origin tile* falls in its chunk. A
building is emitted whole by that one chunk, so a footprint straddling a seam is
never half-drawn.

**Colonists wear the mockup's cloth colours, not sage and rust.** Sage means
"pool" in the HUD, but a sage colonist on `#7ec043` grass is invisible — the
pool/slot split reads from the labour meter, where the styleguide actually puts
it. Same collision, larger: **every in-world overlay line now sits on a dark
`ground` keyline**, because sage and grass are within a few percent of each
other and even a fully opaque sage border measures under 15/255 against grass.
`docs/STYLEGUIDE.md`'s overlay grammar records this and two siblings (border
widths are screen-space; a mark caps what it marks rather than hiding under it)
— it revises `2026-09-01-hud-styleguide`, which wrote that section before any
overlay had met real terrain.

**Opening zoom 90 → 46**, revisiting `2026-09-01-bootstrap-world`, which chose
90 because 60 "opened on featureless grass". That premise is gone: there are
woods, a clearing and five colonists, and at 90 a colonist is a five-pixel speck.

First real customer of `2026-09-01-dirty-chunk-neighbours`: felling a tree and
every building state change bump `chunkVersion`. Trees are a world layer
(`treeMap`), tuned to 9.7–14.1% of grass across four seeds, in clumps averaging
4.1 wooded neighbours of 8 — dense enough to read as forest, gappy enough to walk.

Accepted limits, all reachable in play:

- **Pause blocks your own intent.** Commands apply only at tick boundaries and
  pause is zero ticks, so designating while paused shows nothing until you
  unpause, then it all lands at once. Correct per the contract, confusing in
  the hand; a fix belongs in the app loop, not the sim.
- **A tree ringed by trees can never be reached**, so its designation stays
  marked and its task retries on a cooldown forever. The spec accepts this;
  what is tested is that the rest of the colony keeps working around it.
- `claim` gives up for the tick after one failed path rather than trying the
  next candidate — bounded by the cooldown, but it wastes a tick per colonist
  when an unreachable task comes off cooldown.
- Task generation scans items, buildings and the whole 65k `chopMap` every
  tick. Fine at five colonists; the first thing to index when it isn't.
- `rngState` is in the store as persistence requires, but has exactly one
  consumer so far — the cooldown jitter that stops five colonists retrying the
  same unreachable target in lockstep.

Two things that cost real time and are not in the spec:

- **`instanceColor` needs `vertexColors: true` *and* a white `color` attribute
  on the geometry.** three's `color_fragment` chunk only multiplies `vColor`
  into the diffuse under `USE_COLOR`; instance tints otherwise reach the vertex
  stage and are thrown away, and a missing `color` attribute renders black.
- **A workshop must say *why* it stopped.** The panel is the only place the
  game explains a stall, so "waiting for logs" while the input buffer is full
  is the panel lying — a full stockpile blocks the mill's *output*, which is a
  different fix. `Inspection.stall` now names the reason.

Verified: 65 tests (golden hash `93cf902e`, byte-identical across runs and
through `structuredClone`), lint, `tsc`, production build; in the browser, the
whole chain driven by hand — designate, stockpile, sawmill, staff — with the
plank readout rising 0 → 9 as 9 logs were consumed, the labour meter going
`ppppp` → `pppps`, and console clean across ~90 fellings. Tick rate measured off
the day caption: 14.98 s/day at ×4 and 30.04 / 29.96 s/day at ×2 against 15.00 /
30.00 predicted, and zero advance in 8 s paused.

Not verified: no test or browser check covers save/load (step 5), and the
interpolation between ticks is eyeballed rather than measured.
