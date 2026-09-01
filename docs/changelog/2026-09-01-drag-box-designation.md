# Drag a box to mark a whole wood for chopping

With the chop tool active, left-drag draws a screen-space marquee and marks
every tree whose base projects inside it on release — as **one**
`designateChop` command carrying a tile list, not one per tree. A press under
6px is still the single-tree toggle. The marquee only ever adds; taking a mark
back is still a click. While any rail tool is active the left-drag belongs to
the tool, and right-click or Escape drops the tool and hands it back to the
orbit. Refines `2026-09-01-tick-and-labour`.

## Detail

**`designateChop` carries `tiles: number[]`, not an x/y pair.** A drag over a
wood is one gesture and has to be one command: five hundred separate commands
would bloat the log that saves and the golden test replay, and would let a box
land half-applied across a tick boundary. A single click sends a one-element
list. Tile *indices*, matching `chopMap`'s own indexing, so the payload stays
compact — the cost is that a log is tied to its world size, which saves already
version anyway.

**Additive by construction.** `designateChop` never clears a mark, so dragging
over already-marked trees is a no-op rather than a toggle — a marquee that
un-marked what it crossed would make a second overlapping drag destructive.
`cancelChop` stays single-tile and is the only way to take one back.

**Selection tests the tree's base, not its crown.** The base is where the tile
actually is and where its diamond gets drawn, so what the box catches matches
what then lights up. A tall pine leaning into the box from just outside is
therefore not caught — correct, since the player is selecting ground.

**Projecting every wooded tile beat unprojecting the box.** One pass over an
array the renderer already has, on pointer-release only, and it stays correct
over uneven terrain — a flat-ground-plane unprojection would not. Points behind
the camera are dropped explicitly: `project()` wraps them to the far side of
the frustum, where they would read as inside any box near that edge.

**The orbit had to be taught to decline a gesture**, because a chop marquee and
a camera orbit cannot share one drag. `CameraRig` takes a `canOrbit` predicate,
checked at `pointerdown` and defaulting to always-true, so with no tool
selected the orbit behaves exactly as before — the orbit logic itself is
untouched, and zoom and WASD pan are never suspended. Right-click and Escape
were already wired to `hud.clear()`; both now also cancel an in-flight marquee.

**Cancelling a gesture is two pieces of state in two places, and missing one is
silent.** The HUD owns the Escape key and hides its own marquee; the `down` /
`marqueeing` drag state lives in `main.ts`. Escape initially cleared only the
first, so the box vanished on screen and the whole selection — including
movement after the Escape — still landed on the following `pointerup`. Review
caught it; `main.ts` now has its own Escape listener calling `cancelDrag`,
which also releases the pointer capture. The lesson generalises to any future
area tool: a cancel has to reach the gesture, not just its overlay, and a
screenshot cannot tell you it didn't.

The marquee follows the grammar `2026-09-01-marquee-grammar` had already
written into `docs/STYLEGUIDE.md` ahead of this work — 1px gold over a `ground`
keyline, `rgba(220,162,60,0.10)` fill, square, solid, alive only while held. It
is a plain DOM element with the keyline as a two-sided box-shadow, so the gold
reads over bright grass and dark wood alike.

**Golden hash aca92821 → fbe20cb9.** The scripted log now sends one 16-tile box
at tick 0, a second overlapping 20-tile box at tick 60 (proving the repeats are
no-ops), and a hand `cancelChop` at tick 90 — plus designating now bumps chunk
versions, which the hash covers. Every behavioural assertion in `tick.test.ts`
is unchanged.

Verified in the browser, measured rather than eyeballed: dragging with the tool
active moved the view **0 px** while the same drag with no tool moved
**42,607 px**, and right-click flipped the tool's `aria-pressed` from true to
false in between. A box over a forest patch marked the whole patch from one
command and took all five colonists from idle to working. 78 tests, lint,
build, console clean.

The Escape check in that pass watched the marquee element and the tool's
pressed state — both of which were already correct — and so missed that the
command still fired. Anything checking a cancel has to assert on the *effect*,
not the overlay.

Not covered: nothing tests the marquee against a rotated or tilted camera —
`pick.test.ts` uses a top-down orthographic camera, so the projection is
exercised but not the game's actual oblique view.
