# A blueprint draws a faint empty slot for every material it is still owed

A site's shortfall now reads off the map, not only out of the inspector: each
material a blueprint still wants is a pale empty slot continuing the same stack
its delivered items sit in, so a delivery *fills* a slot rather than moving it.
Blueprints only — a site flips to `Building` exactly when its cost is met, so
from that moment there is nothing to ghost. Implements
`docs/specs/2026-09-16-missing-material-ghosts.md`.

## Detail

**It is a world object, not an overlay, and the styleguide says so in as many
words** — inside the in-world overlay section rather than away from it, because
there is no separate props section and that section already carries the other
world-prop rule, the clothed-colonist entry. The line states the exception where
a reader meets the grammar it is an exception to. Every entry in that grammar is
conditional — the selection box lives only while a drag is held, the watch range
never permanently, the enclosure wash only under a wall tool — because each
answers a question the player just asked. A shortfall is true whether or not anybody is asking, and it
is most wanted while panning across a colony wondering why nothing is going up.
**Rejected: gating the ghosts on a held build tool or on selection**, which is
the more conservative reading of the styleguide and hides the information at
exactly the moment it is worth having. A dozen queued blueprints show four
dozen empty slots; that is the honest picture of a dozen queued blueprints.

**The tone carries no good's colour, and that is a deliberate divergence from
`drawGoods`' own "the pip and the pile are one object seen twice" rule.** A
`BuildingDef` names one `costType` and never a mixture, so every ghost on a plot
is the same good as every solid cube beside it — the colour would be telling the
player something the site already says. It is `PROP.smoke` at `0.42` over the
standard keyline. **Not `PROP.stake`**, the obvious guess: it is the colour of
the plot plate and corner stakes the slots stand on, the one background they
could not read against. **Not `PROP.drab`** for the same reason, one step
subtler. **Not sage, gold or rust** — valid, intent, invalid, and an absence
claims none of the three.

**The keyline is a grown box, not a plate under the stack, and the difference
was measured rather than reasoned.** A base plate one line-width wider is what
the styleguide's wording literally suggests, and at the lattice's 0.36 spacing
four of them merge into one dark slab that destroys the four-separate-slots
read. A grown box keeps each slot its own dark rim. The alpha that was dialed is
therefore the *composite* — pale tone already blended over dark — which is why
`0.42` is not the "faint" number it looks like, and why lowering it reads as
dirt on the plate instead of as an empty slot.

**The placement mirrors `drawGoods`' full two-term formula**, `cell` for the
footprint tile and `lattice(n % 8)` for the slot within it. `lattice` re-wraps
internally, so `lattice(n)` alone is correct below 8 and silently repeats after
with the tile term missing — invisible at today's defs (the dearest cost is 4)
and a trap the first `cost ≥ 9` def would spring. Sharing the formula is also
what makes a slot fill in place.

**Rejected: baking the ghosts into the chunk** with the plot and stakes. It
needs `markChunkDirty` on every delivery rather than only on the
Blueprint→Building flip, which would move every scripted-run pin (`chunkVersion`
is a `World` field and `hashSim` walks the store totally) and force
`colonyCentre`'s 65,536-tile rescan on every delivery anywhere, since its cache
is keyed on the chunk-version total. The per-frame path costs neither.

**Known limits, none repaired.** `MAX_GHOST` is 1,024 per layer — 256 unfed
blueprints at today's dearest cost — and past it `put` drops instances
silently, which is `drawReach`'s distinction working as intended: a missing
ghost understates a shortfall, where a short watch square would claim reach a
tower does not have. Nothing exercises that cap. `movers.ts` still has no test
file, so all of this rests on the browser pass. Nothing in `src/sim/` was
touched, `SAVE_VERSION` is unchanged at 11, and no pinned hash moved — scripted
or fixture.

Verified: 490 tests, lint, `tsc`. In the browser (seed 20260901, 1280×800,
headless Chrome driven directly because the Playwright MCP backend was wedged —
same browser, same screenshots, not the MCP): a House placed with no planks in
the colony showing four slots and still showing them three game-days later; a
Stockpile beside it showing two, not four; the first log landing as an opaque
cube in the **left** slot with the right one still a ghost and the stack
unmoved; the plate flipping to under-construction with no slots the tick the
second landed; a finished Stockpile with none. Read against all four
surfaces — grass at the opening zoom, a beach's sand, the plot's own plate, and
plots standing in a levelled-down channel dark with occlusion. Console clean
(0 errors, 0 warnings).
