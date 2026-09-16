# A building site wears a braced timber frame from the moment it is placed

Every site, at every footprint, now stands four posts a storey tall, rails on
all four faces, a diagonal brace across every bay, a walkway on the far side and
a tarp that stirs — from placement until the building replaces it, so the frame
covers the minutes a site waits on haulers rather than the four seconds it
spends being built. Nothing else stands inside it: the `Building` state adds no
geometry at all. Implements `docs/specs/2026-09-16-site-scaffolding.md`.

## Detail

**The 0.07 outboard inset is the binding number, and it binds every future prop
that shares a plot with materials.** Delivered goods and the shortfall ghosts of
`2026-09-16-missing-material-ghosts` do not sit at tile centres: `lattice`
offsets them ±0.18 and `GOOD_BOX` is 0.34, so a corner slot reaches to **0.15
from the footprint edge**, spanning heights 0.08–0.49. The old corner stake at a
0.18 inset overlapped that by 0.10 × 0.10 in plan and escaped notice only
because it was 0.25 tall and grazed the lower lattice level. A 0.14 section at
0.07 spans 0.00–0.14 and clears the cubes by 0.01 — including on a **1×1 plot**,
where all four slots sit on the one tile and span 0.15–0.49 and 0.51–0.85. That
0.01 is the whole margin. Everything that had to be wider than the budget — the
walkway, the brace — goes **outboard**, never in.

**The diagonal brace is the decision, and two ways of drawing it were built and
rejected before one read.** Posts plus horizontal rails is literally
`pasture()`'s grammar and reads as a *fence*; a fence never carries a diagonal
and scaffolding almost always does. What did not work:

- **One diagonal corner to corner per face.** A 2×2 face is 1.86 long against a
  0.75 storey, so the member lies at 22° and reads as a third rail. A face is
  therefore split into bays about as wide as the frame is tall — `round(span /
  SITE_TOP)` — and each bay braced, which puts it near 45° and is also what real
  scaffolding looks like. The bays alternate direction so the run zigzags.
- **Flush with the rails, in the rails' own timber.** It merges with the two
  rails it crosses into one plane of wood and the diagonal stops being legible
  at all. It now stands `SITE_BRACE_PROUD` out from the face in the walkway's
  pale `plank` against the rails' `timber`. Both were measured on screen, not
  reasoned.

**A tilted member does not exist in this renderer, so the brace is a
staircase.** `Box.rot` spins about +y and `emitBox` knows no other axis; a true
diagonal would mean new mesher machinery for one prop. Each step box is sized as
*one step* — its own rise and run plus a fifth for the overlap — and that sizing
is load-bearing: a box much taller than its rise overlaps its neighbours into a
continuous vertical smear, which was the first attempt.

**The near face is closed, and the open one is rejected.** Three sides answered
a camera-occlusion worry raised in review that never survived a screenshot:
every material lands on the footprint's **first** tile, which is the far one, so
at a 38° view the near members clear the cubes by a whole tile on anything
larger than 1×1, and on a 1×1 the lower near rail grazes the back edge of the
near cubes' tops and nothing else. What the missing side bought was a frame that
read as broken rather than as deliberately open.

**One fixed height — `SITE_TOP`, the sawmill's own 1.5·BH wall — and several
buildings finish lower than the frame that wrapped them.** Deriving post height
from the finished building was built first and abandoned: the Stockpile tops out
at 0.55·BH and the Flowers plot at 0.54·BH, so any frame kept under those stood
about 0.22 — **shorter than a delivered material cube** (0.08–0.28) and
unreadable as a frame at all. A deck emerging from a taller frame says
*scaffolding coming down*, not *building shrinking*, and one height is what lets
a site read as a site before the player knows what is going up there.

**The `Building` state now draws exactly what `Blueprint` draws.** The
featureless 0.7·BH timber slab it used to raise is **removed**, and the
Stockpile's half-`deck` with it: on a bare plot the slab was the only sign that
materials were in, and inside a frame it is a blank block standing among the
delivered cubes, which stay visible until the build completes. A stocked site
now differs from a waiting one by exactly the true statement — no empty slot is
left — and it lasts four seconds. `deck` lost the `scale` parameter the
half-height copy was its only user of, and `mesher.test.ts` no longer asserts
three distinct silhouettes; it pins the new rule, that two of the three states
draw the same and the finished building does not.

**The 1×1 Watchtower is framed like everything else**, and bare stakes are
rejected: the geometry holds at one tile, the tower is the tallest thing the
colony builds so a storey-tall frame is the one thing it cannot overshadow, and
a tower is the archetypal scaffolded thing.

**The open face is south, by rule and never by hash.** `buildingBoxes` receives
no seed, so the props' per-tile jitter is not the precedent it looks like; south
is the face the camera can always see, the rule the House's door and the Oven's
mouth already follow. That is what fixes the walkway's side, so a site cannot
rearrange itself between two looks.

**The tarp is bottom-rooted because the mask says so, and it joins sway rather
than making a fourth motion class.** `emitBox` writes the sway weight through the
same top-vertex mask it uses for `aBlockY`, so a strip *hung* from a rail would
swing at its lashing and hold still at its free end. `SWAY.cloth` is 0.4, lighter
than any canopy.

**Two members were sitting where they said they were not.** The walkway's
planking was based at the upper rail's own base with the rail's exact x and y
extents and a superset of its z, so the far upper rail was swallowed whole — no
visible surface, four coplanar faces decided only by draw order. It now rests
*on* that rail, a `SITE_RAIL_DEPTH` higher (0.64, against the lattice's 0.49
ceiling), which is also how planking sits on a ledger. And the brace's step
boxes are placed by their **base**, so dividing the storey by `SITE_BRACE_STEPS`
put the top of the last step a fifth of a step *above* the post heads rather
than on them; the divisor is `SITE_BRACE_STEPS + 0.2`, which lands it exactly.

**Known limits, none repaired.**

- **A site costs about a fifth of its own clickable area**, measured: a probe
  grid over a Watchtower plot selected it at 19 of 49 points with no frame and
  15 of 49 with one; a House, 65 of 81 against 56 of 81. Members standing proud
  of the plot, and the walkway's 0.16 overhang, resolve through
  `Picker.tileAt`'s floor to the neighbouring tile. Both footprints stay
  comfortably selectable and the loss is proportional, so it is not the 1×1 trap
  `2026-09-09-watchtowers` recorded — but props are **not** purely visual, and
  that is the part worth not rediscovering.
- **Nothing unit-tests the frame's geometry.** `props.test.ts` covers
  `wallBoxes` only, so the 0.07 clearance rests on a comment and a browser
  screenshot. On `docs/CLAUDE_TODO.md`.
- **Orbiting behind a site puts rails between the camera and the slots**, which
  a closed frame necessarily does at some angle. The cubes stay legible past
  two thin bars; that was checked at four azimuths and not exhaustively.
- **The browser pass was driven by headless Chrome directly, not through the
  Playwright MCP**, which wedged again — same browser, same screenshots, the same
  fallback `2026-09-16-missing-material-ghosts` took.

Verified: 490 tests, lint, `tsc`, production build; `src/sim/` untouched,
`SAVE_VERSION` still 11, no pinned hash moved. In the browser (seed 20260901,
1280×800): a House, a 3×3 Farm, a Stockpile and a Watchtower placed side by
side, all four frames the same height, braced on every face, the 1×1 framed on
its single tile; a House blueprint's **four material ghosts all legible** past
the near rails at the default camera; the sites orbited through a full turn
reading as braced frames rather than as fences at every angle; a Stockpile
stocked, showing **the frame plus its two delivered cubes and nothing else** —
no slab, no half-deck — then finishing to a deck visibly lower than the frame.
Paused at ×0, two frames 3.5 s apart are byte-identical, and so are two under
`prefers-reduced-motion` at ×4 — against a control where the tarp alone changes
330 pixels while running. A House site placed identically across a full page
reload is pixel-identical but for a wandering orc. Console clean (0 errors, 0
warnings) throughout.
