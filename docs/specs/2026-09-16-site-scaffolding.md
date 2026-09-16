# A site under way wears scaffolding

A blueprint is a scraped plate and four corner stakes, and it stands like that
for as long as its haulers take — which is the longest anything in this game
stays unfinished, and the emptiest thing on the map to look at. This grows the
stakes into a **timber frame** on the plot's perimeter, with one hanging strip
of cloth that moves on the sway attribute, so a site reads as somewhere work is
about to happen rather than as a marked rectangle. It is baked, it is perimeter
only, and it costs no new machinery: the state transitions that raise and clear
it already dirty the chunk.

## Outcome

**What you get:**

- Every building site wears a timber frame — four posts, rails on all four
  faces, a diagonal brace across every bay, a walkway on the far side — from
  the moment it is placed until the building replaces it, with a rolled tarp that stirs against a post. Every site stands
  the same height, and several buildings finish lower than the frame that
  wrapped them.
- A site reads as a site from across the map for the whole time it spends
  waiting on haulers, which is the longest anything in the game stays
  unfinished.

**How to verify:**

- Place a House: the frame is there immediately, and **every** material ghost
  is visible past it from the default camera — nothing hidden behind a near
  member. Watch planks arrive and fill their slots without the frame moving.
  When the last one lands nothing new appears inside the frame — only the empty
  slots are gone — and four seconds later the frame is replaced by the finished
  building.
- Place a 3×3 Farm beside the House: the same object at a larger size, rails
  spanning the wider sides, nothing hand-placed for the bigger footprint, and
  the same height as the House's.
- Place a Stockpile and let it finish: the deck that emerges is lower than the
  frame was, and reads as scaffolding coming down rather than as a building
  shrinking.
- Orbit a site through a full turn: it reads as **scaffolding, not a fence**,
  from every angle — the diagonals are what carry that — and every material
  slot stays legible past the near members at the default camera.
- A stocked site shows the frame and a full set of material cubes and nothing
  else standing inside it: no slab, no half-deck.
- Place a Watchtower: a frame on its single tile, its posts clear of the four
  material slots, and the finished tower standing well above where the frame
  stood.
- Look away and back at a site, and reload the page: the walkway is on the same
  side both times, and it is the far side.
- Pause the game, and separately turn on reduced motion: the cloth holds still
  in both, and the frame is unchanged.
- Loaded through Playwright with a screenshot of a 2×2 and a 3×3 site, per
  `src/render/CLAUDE.md`, and the console clean of WebGL and three.js warnings.
- `src/sim/` untouched, `SAVE_VERSION` unchanged, no pinned hash moves.

## Key decisions

- **The frame stands from `Blueprint`, not from `Building`** (new). Fiction
  says you raise scaffolding when work starts; `BUILD_TICKS` says `Building`
  lasts four seconds, so a prop that waited for it would be one nobody ever
  sees. The frame goes up with the plot and comes down when the building does —
  a prepared site standing ready is the honest read of one waiting on its
  haulers, and it covers the minutes rather than the seconds.
- **Perimeter only — and the perimeter is narrower than it looks** (extends).
  Delivered materials and the shortfall ghosts do **not** sit at tile centres:
  `lattice` (`movers.ts:1477`) offsets them ±0.18 from centre and `GOOD_BOX` is
  0.34, so a corner slot reaches to **0.15 from the footprint edge**, spanning
  heights 0.08–0.49. Today's 0.14-section stake at the 0.18 inset overlaps that
  by 0.10 × 0.10 in plan and only escapes notice because it is 0.25 tall and
  grazes the lower lattice level. A taller member at that inset pierces both.
  The frame therefore sits **outboard**, at an inset of about 0.07, where a
  0.14 section spans 0.00–0.14 and clears the cubes with a hair to spare. That
  is the binding constraint on this prop and on every future one that shares a
  plot with materials.
- **Four sides, braced diagonally — and a bay is defined, not assumed** (new).
  Posts at all four corners, rails on every face, and a diagonal across every
  **bay**, where a bay is a span **about as wide as the frame is tall**. Each
  face is divided into as many bays as it takes, and each is braced. Taking a
  face as one bay is the reading that fails: corner to corner on a 2×2 face is
  1.86 against a 0.75 storey, which puts the member at **22°** — a third rail,
  and the fence the decision exists to prevent. Near 45° it reads as bracing.
  The diagonal is the whole point: posts plus horizontal rails is a *fence*,
  literally the Pasture's grammar, and a fence never carries a diagonal where
  scaffolding almost always does.
- **A diagonal is drawn as a stepped run of boxes, because tilted geometry does
  not exist here** (new). `Box.rot` spins about **+y only** and `emitBox` knows
  no other axis, so no member in this renderer can lean — not in props, not
  anywhere. Each brace is therefore a staircase of small boxes climbing its
  bay. This is a constraint on every future prop, not a quirk of this one, and
  it is why the bay width matters: a stepped run only reads as a diagonal when
  the steps are short against the span, which near 45° they are.
  *(The draft cited `props.ts:700` as precedent. That is two **horizontal**
  bars per height on the Watchtower's legs — "enough to say framed" — and not a
  diagonal at all. There was no precedent; there is now.)* Built three-sided first, on a
  camera-occlusion worry raised in review and never checked on screen; in the
  hand it read as a broken fence rather than as a deliberate opening, so the
  frame closes. If the near members do hide material slots, they are **thinned,
  not removed** — the sight line matters, the missing side did not buy it.
- **One fixed frame height, and buildings may finish lower** (new). The posts
  stand about a storey — one tunable, the same for every site — rather than
  scaling from what the site becomes. Deriving it was tried and abandoned: the
  Stockpile finishes at `0.55·BH` (0.275) and the Flowers plot at `0.5·BH`,
  so any frame kept under them stands ~0.22, **shorter than a delivered
  material cube** (0.08–0.28) and unreadable as a frame at all. Scaffolding
  outliving the thing it wrapped is also simply true: real scaffolding is
  routinely taller than what it is built around, and a Stockpile emerging from
  a frame taller than itself reads as scaffolding coming down rather than as a
  building shrinking.
- **The Pasture's fence grammar, proportioned rather than copied** (extends).
  Posts at the corners with horizontal rails between them is already written
  and already reads as a frame at map distance (`pasture()`), and the rails
  scale with `b.w`/`b.h` there exactly as they need to here. What does **not**
  carry over is its absolute heights: its rails sit at `0.34·BH` and `0.66·BH`
  on a `0.85·BH` post, which are a fence's proportions on a fence's post and
  bear no relation to the storey this frame stands at. The rails are placed as
  fractions of the fixed post height instead, which is also what keeps the bays
  between them square enough for their diagonals to sit near 45° — see below.
- **One swaying element, bottom-rooted because the mask says so** (reuses). A
  rolled tarp leans against the frame, lashed at its foot, carrying a `SWAY`
  weight through the existing `swaying(box, weight)` wrapper. **Bottom-rooted
  is not a stylistic choice**: `emitBox` (`mesher.ts:323`) writes
  `syi > 0 ? p.sway : 0`, pinning a box's bottom vertices and moving its top,
  so anything *hung* from a rail would swing at its attachment and hold still
  at its free end — backwards. A tarp standing on its foot leans the way the
  mask already moves. Inverting the mask would mean new mesher machinery and
  would break the existing test asserting every leaning vertex has
  `blockY === 1`. This deliberately **joins the three motion classes rather
  than making a fourth** — a bounded in-place displacement of baked geometry is
  exactly what sway is (`2026-09-15-ambient-life`), which is what that
  vocabulary was written down for.
- **Every footprint, the 1×1 Watchtower included** (new). The tower is the
  game's only 1×1 and it is also the tallest thing in it — legs at `3.1·BH` —
  so it is the one building a storey-tall frame does *not* tower over, and a
  tower is the archetypal scaffolded thing. The geometry holds at one tile: the
  posts' 0.07 inset spans 0.00–0.14 while its four material slots span
  0.15–0.49 and 0.51–0.85. It reads as a frame rather than as a cage because
  of what it is made of — braced bays at a storey, open between the members —
  not because a side is missing.
- **Baked, and no new dirtying** (reuses). `buildingBoxes` already branches on
  `state`, and every transition the frame turns on is already marked dirty:
  placement (`commands.ts:450–455`), the Blueprint→Building flip
  (`labour/colonists.ts:1189`) and — the one that actually clears the frame,
  since it stands through `Building` — completion at
  `labour/colonists.ts:989`. So the frame appears and disappears on
  transitions that are already handled:
  no per-frame layer, no `markChunkDirty` added anywhere, nothing in `src/sim/`,
  and no pinned hash moves.

## Goals

- The longest-lived unfinished state in the game is the most interesting one to
  look at, rather than the least.
- A site reads as a site from across the map, at every footprint, and reads as
  one before the player knows what is being built there.

## Non-goals

- Anything keyed to `progress`. The build is four seconds; a frame that filled
  in as it rose would be machinery for a state that is over before it is seen.
  Declined once already and declined again here.
- Site clutter — sawhorses, plank piles, buckets. A 2×2 perimeter is already
  carrying posts, rails, a walkway and up to four material cubes, and the point
  where a site looks busier than the finished building is the point this stops
  helping.
- Any colonist animation. A builder at work is four seconds of the same
  problem.
- Scaffolding on wall segments, which have no plot, no `cost` and their own
  lifecycle.
- Telling the player anything. A frame is scenery: the shortfall ghosts carry
  the information and the panel carries the words.

## Design

### The frame

In `buildingBoxes`' `Blueprint || Building` branch, **at every footprint
including the 1×1**, the four corner stakes become four **posts** of the same
0.14 section,
moved outboard to the ~0.07 inset the clearance above demands, and raised to
the fixed storey-ish height above — the same for every site, whatever it
becomes. Two
horizontal **rails** span **all four faces** at fractions of that height, and
a **diagonal brace** crosses every bay between them — the member that makes it
scaffolding rather than a fence. The **walkway** is a plank slab at the upper
rail's height on the far side, and it is **wider than the 0.14 section the
clearance budgets — so its surplus goes outboard**, overhanging the footprint
by about 0.16 rather than reaching in over the plot.

**Outboard because of what it would hang over, not because of height.** At a
storey the upper rail sits around 0.59, above the lattice's 0.49 ceiling, so an
inboard walkway would clear the cubes *vertically* — and that is precisely the
problem. Every material lands on the footprint's **first tile**, which is the
far tile from the camera, so a plank floating above the far side at rail height
would hang directly over the slots and hide them from a 38° view, which is the
one thing `2026-09-16-missing-material-ghosts` exists to prevent. The clearance
budget says it a second way: one plank wide exceeds the 0.14 section the 0.07
inset buys, so a member reaching inboard spends the margin that keeps the frame
off the slots in plan.

*An earlier draft justified this by saying the upper rail sat below a cube's
0.28. That was true when the frame's height derived from the finished building
and is false at the fixed height; it is corrected here rather than deleted,
because the stale version invites a future reader to move the walkway back
inboard.*

The overhang is accepted, and it is **not** consequence-free. It does not
reach placement (`canPlace` tests the footprint) or pathing (occupancy is
footprint-based) — but it does reach **picking**: `Picker.tileAt` floors the
hit position, so any member standing proud of the plot resolves a click on
itself to the *neighbouring* tile. Measured on a probe grid, a site loses about
a fifth of its clickable area to its own frame — a Watchtower plot selects at
15 of 49 points framed against 19 of 49 bare, a House at 56 of 81 against 65 of
81. Both stay comfortably selectable, so nothing is changed for it.

**The general rule, which matters more than this prop:** geometry is not
"visual only" in this renderer. `2026-09-09-watchtowers` built a rule around
picking as a consumer, and a prop author who reads "visual only" will not think
to check it. Anything overhanging a footprint costs that footprint clickable
area.

Which side carries the walkway is **fixed, never drawn at random**: a site
whose scaffolding rearranged itself between two looks is a site the player
cannot recognise. Note that `buildingBoxes` receives no seed
(`mesher.ts:265`), so the props' per-tile jitter is *not* the precedent it
looks like — `propJitter` hashes against `world.seed`, which is not in scope
here. A `hash(b.x, b.y, <constant salt>)` would be deterministic and
reload-stable, since `b.x`/`b.y` are saved; but see the decision below, which
settles the side by rule instead and makes the hash unnecessary.

The rails scale with `b.w` and `b.h` exactly as the Pasture's do, so a 3×3
Farm site and a 2×2 House site are the same object at two sizes with no second
set of numbers. Height does not vary with them: every site stands the same,
which is what makes a site recognisable as one before you know what it is
going to be.

**Nothing stands inside the frame but the materials.** The featureless timber
slab the `Building` state used to raise (`props.ts:282` — `0.7·BH` across most
of the footprint) is **removed**: it made sense on a bare plot as the only sign
that materials were in, and inside a frame it is a blank block sitting among
the delivered cubes, which stay visible until the build completes. With it
gone, a stocked site differs from a waiting one by exactly the true statement —
no empty slots left — and four seconds later the building itself appears. The
Stockpile's half-`deck` goes the same way for the same reason.

**A Stockpile site draws the frame instead of `deck`'s fence, not as well
as.** In the `Building` branch a Stockpile calls `deck(…, 0.5)`
(`props.ts:236`), which emits its own corner posts at the *same* `corners()`
points and its own rails on the *same* `b.y + 0.18` lines (`props.ts:286`) —
left alone, a stockpile site would wear two frames on one perimeter. The site
frame supersedes it; `deck`'s fence returns with the finished building.

The `Building` state therefore adds *nothing* to the frame. It is four seconds
long; the honest difference from the state before it is that the last empty
slot has filled.

### The cloth

The element is a rolled tarp leaning against a post on the far side — a thin
upright slab a little under a tile tall, in **`PROP.linen`** (`0xe3d8ba`),
already the game's cloth tone on the house gable and the pasture hut's roof, so
nothing is added to the palette. It carries `SWAY.cloth`, a new named weight in
the `SWAY` table beside `canopyLow` and `crop`, dialled lighter than a canopy:
a tarp lashed at its foot stirs, it does not toss.

The weight is per vertex by the existing top-vertex mask, which pins the foot
and moves the head — so the tarp leans from where it is tied, which is the one
way round the mask already supports.

Because it is sway, it obeys the world clock and `prefers-reduced-motion` with
nothing said: at ×0 and under reduced motion the site is simply still.

### What the player sees

Placed: plate, four posts, rails on all four faces with a braced bay between
each pair, a walkway on the far side, a tarp stirring against a post, and the
full count of material ghosts, legible past the near members. Materials arrive
and fill their slots inside the frame. The last one lands and **nothing is
added** — the site's only change is that no empty slot remains. Four seconds
later the frame is gone and the building stands where it was, which for several
kinds is lower than the frame had been.

## Alternatives considered

- **Scaffolding from `Building` only**, which is when a real site would raise
  it. Four seconds of screen time, and the state with all the waiting in it
  stays bare.
- **A frame keyed to `progress`**, filling in as the build rises. The thing
  declined when construction was first considered, for the same reason, and
  the reason has not changed.
- **A three-sided frame, open to the camera.** What shipped first, on a
  camera-occlusion worry raised in review: at 38° a near member occludes about
  1.28× its own height of the ground behind it, which is where the shortfall
  ghosts sit. In the hand the missing side read as a broken fence, and the
  worry was never confirmed on screen. Closed, with thinning held in reserve if
  the sight line actually suffers.
- **Keeping the `Building` half-body.** It was the only sign materials were in,
  back when the plot was otherwise bare. Inside a frame, among the delivered
  cubes that stay visible until completion, it is a featureless block with
  nothing to say.
- **A hung strip of cloth**, which is what scaffolding actually carries. The
  sway mask pins a box's bottom and moves its top, so a hung strip swings at
  its attachment and holds still at its free end; fixing that means an
  invert-mask flag in the mesher and breaks a test that asserts every leaning
  vertex has `blockY === 1`.
- **Deriving the frame height from the finished building**, so no site is ever
  taller than what replaces it. It was the draft's rule and it does not
  survive the numbers: under it a Stockpile or Flowers site stands ~0.22, which
  is shorter than the material cubes inside it and reads as clutter rather than
  as a frame. Scaffolding taller than its building is both the lesser problem
  and the more truthful picture.
- **Exempting the 1×1 Watchtower.** The draft's rule, on the grounds that a
  frame round one tile reads as a cage. Braced bays at a storey do not — a cage
  is close bars, this is open structure — the posts clear the material slots,
  and the tower is the one building tall enough that the frame never
  overshadows it.
- **Site clutter instead of a frame.** A sawhorse and a plank pile say "work"
  without any structure to them, and they compete for the perimeter the frame
  needs. Better as a later addition to a site that already has a frame than as
  a substitute for one.
- **A per-frame layer in `movers.ts`.** Would allow motion beyond sway — a
  swinging pulley, a rope paying out — and costs a layer, a cap and per-frame
  writes for a prop that changes twice in its life. Baked is the right home for
  geometry that only moves when the state does.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One function in `src/render/props.ts` and one new
  `SWAY` entry, plus a styleguide line. Small in lines and unusually
  unforgiving in numbers: post inset, post height, rail fractions and the tarp
  all have to clear the material lattice in plan *and* in height, and the
  review of this spec found three geometric claims wrong before a line was
  written. Opus rather than Sonnet for that reason alone.
- Read `docs/ARCHITECTURE.md`'s Gotchas first — `src/render/CLAUDE.md` requires
  it before renderer work, and this change is entirely geometry against a
  camera.
- Not multi-agent, not ultracode: one file, nothing in `src/sim/`, no hash
  movement, and a `git revert` is the whole walk-back.

## Amendments

- 2026-09-16 — Three build findings and one reversal. **The walkway's surplus
  width goes outboard**, overhanging the footprint by ~0.16: the draft budgeted
  a 0.14 section at the 0.07 inset and then specified a wider plank without
  saying which way the excess went, and inboard would lay it across the very
  material slots the inset protects — clearing them by height fails too, since
  the upper rail sits below a delivered cube on the flattest kinds. **The orbit
  verify bullet is restated** as "the near face carries no member at any angle":
  the original could not be checked, because a three-sided frame necessarily
  puts rails between camera and plot once you orbit behind it, and no slot sits
  on the open side at any current def — every `cost` is at most 4 against eight
  slots per tile. And **the height rule is reversed**: one fixed height for
  every site, with buildings free to finish lower, because a frame kept under a
  Stockpile's 0.275 stands shorter than the materials inside it. The 1×1
  Watchtower exemption goes with it — every footprint gets a frame.
- 2026-09-16 — Two leftovers from the height reversal, both in Design where the
  amendment under-propagated. The frame section still said "for footprints of
  2×2 and larger", contradicting the decision and the Outcome bullet that both
  ask for a Watchtower frame. And the walkway's stated justification — that the
  upper rail sits below a delivered cube — was true under the derived height
  and false at the fixed one, where the rail clears the lattice vertically. The
  decision is unchanged; its reason is now the occlusion argument that opens
  the near face, since every material lands on the footprint's far tile and an
  inboard plank at rail height would hang over the slots.
- 2026-09-16 — Three changes from seeing it running. The frame **closes on all
  four sides**: three-sided was an answer to a camera-occlusion worry raised in
  review and never checked on screen, and in the hand it read as a broken fence
  rather than as a deliberate opening. Every bay gains a **diagonal brace**,
  which is the member that separates scaffolding from a fence — posts plus
  horizontal rails was the Pasture's grammar and produced the Pasture's read.
  And the `Building` state's timber slab is **removed**: it existed to show
  materials were in, back when a plot was otherwise bare, and inside a frame
  among the delivered cubes it says nothing. A stocked site is now the frame
  plus a full set of cubes, and the state's honest difference is that no empty
  slot remains.
- 2026-09-16 — Four findings from the closed-frame build. **Every remaining
  three-sided and half-body reference is gone** — the Outcome's House bullet,
  the Watchtower and Pasture-grammar decisions, and "What the player sees" all
  still described the old design after the last amendment; the build followed
  the sections that were current, which was right. **A bay is now defined** as a
  span about as wide as the frame is tall: read as "one bay per face", a 2×2
  diagonal lies at 22° and is a third rail, which is the fence the decision
  exists to prevent. **A diagonal is a stepped run of boxes**, because `Box.rot`
  spins about +y only and nothing in this renderer can lean — the draft's cited
  precedent (`props.ts:700`) is two horizontal bars, not a brace. And the
  overhang is **not "visual only"**: `Picker.tileAt` floors the hit position, so
  a site loses roughly a fifth of its clickable area to its own frame (measured:
  Watchtower 15/49 framed against 19/49 bare, House 56/81 against 65/81). Still
  comfortably selectable, so nothing changed — but the claim was wrong and the
  next prop author would have trusted it.
