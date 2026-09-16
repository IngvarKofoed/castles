# A blueprint shows the materials it is still waiting for

A site already shows what has arrived: `drawGoods` stacks a blueprint's
delivered items on its marked-out plot, per frame, updating the moment a hauler
sets one down. What it cannot show is the *denominator* — two planks on a plot
read as "some goods here", not as "two of four", and the only place the four
exists is the inspector panel. This draws the shortfall: the same lattice
continued past the delivered items with faint empty slots, one per material
still owed, so a site's progress and its starvation both read off the map.

## Outcome

**What you get:**

- A blueprint shows a faint empty slot for every material it is still owed, in
  the same stack as the ones that have arrived — so a site two short and a site
  one short are told apart at a glance, across the map.
- A site nothing is reaching shows its whole cost as empty slots, for as long
  as that stays true.

**How to verify:**

- Place a House (4 planks) with no planks in the colony: four faint slots
  appear on its plot. Produce planks and watch them arrive — each slot fills in
  place, and the stack neither shifts nor re-flows as it does.
- When the last plank lands the site flips to under-construction and no slots
  remain; a finished building has none either.
- Place a Stockpile (2 logs) beside the House: it shows two slots, not four —
  the count comes from each building's own cost.
- Look at a plot on grass, on sand, **on the plot's own brown plate** and on a
  levelled dark plot: the slots read as an outline of something wanted on all
  four, and as a pile of goods on none of them. Grass at the opening zoom is
  the hard case, and the keyline is what has to carry it.
- Loaded through Playwright with a screenshot of each of those, per
  `src/render/CLAUDE.md`, and the console clean of WebGL and three.js warnings.
- `src/sim/` is untouched, `SAVE_VERSION` is unchanged, and no pinned hash
  moves — scripted-run or fixture.

## Key decisions

- **The ghosts are the delivered stack's own lattice, continued** (extends).
  `drawGoods` (`movers.ts:802`) already places item *n* of a building's stored
  goods on the plot at `DECK_Y`. A blueprint's ghosts are positions
  `delivered … cost − 1` of that same walk, so a full stack and a half-empty
  one are the same shape with the same spacing and nothing has to agree about
  layout twice. **The walk is two numbers, not one** — see Design: `lattice`
  (`movers.ts:1362`) gives the slot within a footprint tile and re-wraps every
  eight, and a separate `cell` term chooses the tile.
- **Only blueprints, never a site under construction** (new). A building flips
  to `Building` exactly when its materials are complete, so from that moment
  the shortfall is zero and there is nothing to ghost. The rule is simply
  `state === Blueprint`.
- **A ghost is a world object, not an overlay** (new). It draws for every
  blueprint, always, with no tool gate and no selection gate — because it
  continues the delivered stack, which is itself always drawn. That puts it
  deliberately outside the styleguide's in-world *overlay* grammar, every entry
  of which is conditional: the selection box lives only while the drag is held,
  the watch range "never permanently", the enclosure wash only under a wall
  tool. Those are all answers to a question the player just asked; a shortfall
  is a fact about the world that is true whether or not anyone is asking. A
  colony with a dozen queued blueprints shows four dozen empty slots, and that
  is the honest picture of a dozen queued blueprints.
- **A ghost carries no good's colour** (diverges from `drawGoods`' own rule).
  The delivered cubes are tinted per good by `GOOD_HEX` — "the pip and the pile
  are one object seen twice" — but a `BuildingDef` names **one** `costType` and
  never a mixture, so every ghost on a plot is the same good as every solid
  cube beside it and the colour would be telling the player something they can
  already see. The ghost is **`PROP.smoke` (`0xc4bdae`)**: an empty slot, not
  a translucent plank. "Low alpha" is the intent and not the number — because
  the keyline rim sits inside the slot's own volume rather than under it, what
  gets dialled is the **composite** of rim and fill, which lands around `0.42`
  rather than the much smaller figure the phrase suggests. Pale and desaturated is what makes it
  read as absence rather than as a material, and it is the one existing token
  lighter than every surface it can sit on. **Not `PROP.stake`** — the obvious
  guess, and wrong twice over: it is a warm brown rather than a grey, and it is
  the colour of the plot plate and corner stakes the ghosts stand on, so a
  faint stake-toned box on a plot is the single background it could not read
  against.
- **Not sage, not gold, not rust** (reuses the colour grammar). Sage means
  pool and validity, gold means player intent, rust means the costly things.
  A missing material is none of those — it is an absence, and the placement
  ghost's sage would be claiming a verdict about a thing that is not there.
- **It takes a new layer instance, not a new kind of layer** (reuses).
  `solidLayer` is an opaque `MeshLambertMaterial` whose `instanceColor` carries
  RGB only, so it cannot fade an instance — but `overlayLayer` already is what
  a ghost wants: `FLAT` is `BoxGeometry(1, 1, 1)` (`movers.ts:71`), so every
  overlay in the file is instanced *boxes* on a transparent `MeshBasicMaterial`
  with one colour and one opacity. The ghosts are one more call to it. The
  smoke column's refusal to fade is **not** the same case and should not be
  cited as precedent: smoke needed *per-instance* alpha, which genuinely is not
  available; the ghosts need one uniform alpha, which is.
- **The layer takes a cap and joins the `layers` list** (reuses). Every layer
  in `movers.ts` carries a `MAX_` constant, and one omitted from the `layers`
  getter is never reset per frame, never has `mesh.count` written — so it draws
  nothing — and is never disposed. `MAX_GHOST` drops silently past its cap,
  which is the right failure by `drawReach`'s own distinction: a missing ghost
  understates a shortfall, where a short watch square would claim a reach the
  tower does not have.
- **Each slot takes the ground keyline, as a rim rather than a plate**
  (reuses). The styleguide's rule — every overlay sits on a `ground`
  (`#14170f`) keyline at `0.5`, "drawn one line-width wider underneath",
  because "the meaning colours do not survive the terrain on their own" — is
  written for lines rather than boxes, and is taken here anyway: a pale
  low-alpha box on bright grass at the opening zoom is precisely the failure it
  was measured into existence for. One more `overlayLayer` call, and the
  keyline instance is **the slot's own box grown by `KEYLINE_GROWTH`**, so each
  slot keeps its own rim.
  **"Underneath" must not be read literally here.** A keyline *plate* beneath
  each slot is what the phrase suggests and it does not survive contact with
  the lattice: at its 0.36 spacing the plates merge into one dark slab and the
  four-separate-slots read — the entire point of the feature — is destroyed.
  This was tried on screen and rejected there.
  The precedent is `edge`/`outlineArea` (`movers.ts:748, 755`), which is how
  `markKeyline` pairs with **`markEdge`** — *not* with `markFill`, which is a
  bare `plate` (`:1248`) and takes no keyline at all.
- **Nothing moves** (reuses). The ghosts are static geometry keyed to a count.
  They are outside the three motion classes
  (`2026-09-15-ambient-life`) and neither the world clock nor
  `prefers-reduced-motion` has anything to say about them.

## Goals

- A player can tell a site two materials short from a site one material short,
  from the map, without opening a panel.
- A site nothing is arriving at looks like one, for as long as that is true.

## Non-goals

- Any read on *why* a site is starved. The styleguide's rule stands: a starved
  site explains itself in its panel, never on the ground. A shortfall is a
  count, not a complaint.
- Animating the build itself. `BUILD_TICKS` is four seconds and the state it
  covers is over before it can be watched — recorded here because it is the
  obvious next thought and it is not worth machinery.
- Ghosts on walls, on workshop input buffers, or on anything that is not a
  blueprint with a `cost`.
- Any change to the delivered cubes, which are correct as they are.

## Design

`drawGoods` already builds `perBuilding`, the count of stored items per
building, as it walks `items(sim)`. After that walk, it makes a second short
pass over `buildings(sim)`:

- skip anything whose `state` is not `Blueprint`;
- read `cost` from `BUILDING_DEFS[b.kind]` and `delivered` from `perBuilding`
  (0 when absent);
- for `n` from `delivered` to `cost − 1`, place a ghost where the delivered
  cube for slot *n* will land.

**"Where it will land" is two terms, and using only one is the trap.**
`drawGoods` computes `cell = Math.floor(n / 8) % (b.w * b.h)` — which tile of
the footprint — and `lattice(n % 8)` — which of eight slots within it — then
offsets by `b.x + (cell % b.w) + 0.5` and `b.y + Math.floor(cell / b.w) + 0.5`.
`lattice` re-wraps internally (`i = n % 8`), so calling `lattice(n)` alone is
right for `n < 8` and silently repeats after, with the footprint-tile term
missing entirely. The ghost walk mirrors the full formula.

At today's defs this is invisible either way — the largest `cost` in
`BUILDING_DEFS` is 4 — and it breaks at `cost ≥ 9`, where slot 8 would ghost
on top of slot 0 of the first tile while its delivered cube lands on the
second. Mirroring the formula costs nothing and removes a trap a future def
would spring silently.

Because the placement is shared, a plank arriving replaces its own ghost in
place: the slot does not move, it fills. That is the whole of the effect, and
it is why the delivered path is left alone rather than reimplemented.

The ghost's size matches the delivered cube (`0.34 × 0.2 × 0.34`) so the stack
reads as one object. The tone is a neutral stake-grey at an alpha low enough
that four ghosts on an empty plot read as a faint outline of what is wanted
rather than as a pile of something — the exact value dialled by eye against
grass, sand and a dark plot, since a value that works on one reads as dirt on
another.

A blueprint whose cost is already met has no ghosts and no gap in its stack;
a blueprint nothing has reached shows its whole cost as ghosts. Both are the
same loop.

### The styleguide

`docs/STYLEGUIDE.md` gains a line **beside the world's props, not in the
overlay grammar** — that section's entries are all conditional and this one is
not. **A ghosted good is an absence**: one pale neutral tone at low alpha over
the standard ground keyline, never a good's own colour and never sage, gold or
rust, marking a thing that is wanted and not there. The distinction from the
placement ghost is worth stating where a reader will meet both: a placement
ghost is *proposed* and lives only while a tool is held; a material ghost is
*owed* and stands until the material arrives.

## Alternatives considered

- **A tinted translucent plank** in the good's own colour. Prettier, and it
  says nothing the building does not already say, since a def carries one
  `costType`. It would also need a transparent material with per-instance
  colour, where a single tone needs none.
- **Gating the ghosts on a held build tool, or on selection**, the way every
  other in-world overlay is gated. It is the more conservative reading of the
  styleguide, and it hides the information at the moment it is most wanted —
  panning across a colony wondering why nothing is going up. Rejected, and the
  styleguide line is filed outside the overlay grammar to say so.
- **`PROP.drab` for the slot.** Subtler on every background, and subtlest on
  the plot it stands on, which is the one place it must not be.
- **Drawing the shortfall as a number floating over the plot.** It is the
  panel's job, it is text in the world, and the styleguide keeps state changes
  in panels.
- **Baking the ghosts into the chunk** with the plot and stakes. It would put
  them in the terrain's own lighting, and it needs `markChunkDirty` on every
  delivery rather than only on the Blueprint→Building flip, which is where the
  project already calls it (`labour/colonists.ts:1189`) — so the change is
  louder rather than novel. Two costs sink it. Every **scripted-run** pin would
  move (`tick.test.ts`, `settlers.test.ts`, `bread.test.ts`,
  `encounter.test.ts`), because `chunkVersion` is a field of `World` and
  `hashSim` walks the store totally; the fixture pins would not, since they
  hash decoded saves and re-simulate no deliveries. And `colonyCentre`'s cache
  is keyed on the chunk-version *total*, so every single delivery anywhere
  would force a 65,536-tile rescan. The per-frame path costs neither.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Sonnet 5.** One function in `movers.ts` gains a second pass,
  two `overlayLayer` calls and a `MAX_GHOST` join the class, and
  `docs/STYLEGUIDE.md` gains a paragraph. The design decisions are all made and
  written down; what is left is transcription plus the eye-dialling of one
  alpha, which is a screenshot rather than a judgement about the codebase.
- The one thing to get exactly right is mechanical and named in Design: mirror
  `drawGoods`' full two-term placement rather than calling `lattice(n)` alone.
- Not multi-agent and not ultracode: one file, no sim change, no hash movement,
  and a `git revert` is the whole walk-back.
