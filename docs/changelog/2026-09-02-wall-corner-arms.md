# Palisades are a centre post plus an arm per linked side

A wall segment no longer picks one axis for the whole tile. It bakes a centre
stake plus, for each neighbouring tile that also holds wall, a half-tile arm —
two rails out to the edge and a stake along the way. Corners, T-junctions and
four-way crosses therefore come out right instead of rendering as straight
runs with a hole at the turn. Refines
`docs/specs/2026-09-02-palisade-walls.md`.

## Detail

**What was actually wrong.** `wallBoxes` computed one `axisX` per tile — east/
west if either was linked, else north/south — and laid three stakes and two
full-tile rails along it. On a corner tile that meant stakes marching *across*
the turn rather than down it, and the perpendicular run's rails stopping half a
tile short of the join: a visible gap at every corner. T-junctions and crosses
could not be expressed at all, because one axis cannot describe three or four
sides. Arms fix the whole class rather than the corner case: each side is its
own piece, so nothing has to agree on an axis.

**A straight run's interior is pixel-identical, and that is measured.** The
arm/stake offsets and rail extents were chosen to reproduce the old formula
exactly — stakes at ±0.32 and the centre, rails spanning the full tile at 0.4
and 0.76 of the height — and `props.test.ts` writes that pre-rewrite formula
out longhand as the contract, so a future change to a straight run has to argue
for itself. In the browser, the same clip of the same seed at the same camera
came back with **5 differing bytes in 12774** across a run's interior, and
three of those are one colonist's tunic in a different spot.

**A run's *ends* did change, deliberately.** An end tile has one link, so it
draws one arm and terminates at its centre post instead of overhanging half a
tile into empty ground the way every tile used to. It reads as a proper
terminating post and it is the direct consequence of arms-per-link, but it is a
visible difference: a dead-end run is now half a tile shorter at each end than
its tiles are. A closed ring has no end tiles, so the shape the game is
actually about is unaffected.

**`Box` gained a jitter anchor, and a rail needs it.** Per-prop colour wobble
is keyed on the box's own position, so splitting a rail into two arms gave each
half its own tone — a seam at the centre of every tile of every run, at up to
12% brightness. Rails now anchor their wobble to the tile centre, so both
halves are one member and one tone; stakes keep their own positions and the
per-stake variation that comes with them. `mesher.ts` reads `p.jx/p.jz` instead
of `p.x/p.z`.

**Rejected: merging opposite arms back into one full-tile rail.** It would save
two boxes per straight tile and make the geometry, not just the image,
identical — but it reintroduces exactly the per-tile axis special-case this
change exists to remove, and the surplus faces are enclosed inside the solid
and never drawn. The cost is 7 boxes per straight tile instead of 5.

**West and North share a stake-height key, as do East and South.** That is what
keeps *both* straight orientations identical to the old output, since the old
code's outer stakes used one key pair regardless of axis. The price is that a
four-way cross shows two heights across four arms rather than four. A straight
run is most of every wall; a cross is rare.

**`links === 0` still borrows the east-west pair**, so a single click reads as a
piece of wall rather than a solitary post — unchanged from before, and pinned.

Gate and blueprint variants still take a single dominant axis and were not
touched: a gateway has a side you walk through, so it has to choose. The raze
tint is untouched. `markChunkDirty`'s ±1 fan-out already covers the 4-neighbour
read this needs, so orientation propagates to a new segment's neighbours for
free — do not widen it (`docs/changelog/2026-09-01-dirty-chunk-neighbours.md`).

**Not covered.** Nothing tests a junction against a chunk seam beyond the
existing straight-run seam test, and no test asserts that the arm overlap is
actually hidden — that claim rests on the geometry being enclosed, and on the
screenshots.

Verified in the browser per `src/render/CLAUDE.md`: a built corner, a T and a
four-way cross each screenshotted close up — rails continuous through every
turn, no gaps, stakes running along their own arms — plus a straight run and a
single-click stub. Console clean. 164 tests, lint, `tsc`.
