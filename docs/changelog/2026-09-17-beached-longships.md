# A beached longship marks where the Wilds came ashore

The den prop is gone and a **boat** takes its place in the same baked layer: a
tarred hull with an upturned prow, a pale square sail on a mast, lying **along
the shore** because the mesher reads which side the water is on. It stands on
the sand for as long as the incursion lasts and un-bakes when the last monster
boards — so *they came from there* is readable at a glance, which is the whole
reason an incursion has one landing site. From
`docs/specs/2026-09-17-incursions-from-the-sea.md`.

## Detail

**It stays inside its own tile, which is stricter than the den it replaces.**
That one let a bone overhang by a few hundredths; this one overhangs by nothing,
and `mesher.test.ts` asserts it. A boat lands on open sand where the nearest
thing to click is more sand, but geometry proud of a footprint costs that
footprint clickable area whatever is under it (`src/render/CLAUDE.md`), and there
was no reason to spend it.

**The sail is what does the reading, and the first attempt did not.** A low dark
hull on pale sand is nearly invisible at the opening zoom; a 0.2-block cap on a
short mast read as a knob rather than a sail, and in the browser the prop looked
like a fence section. The mast is now 1.8 blocks and carries a 1.15-block square
sail — all height, no width, so the silhouette carries across the map without
costing a neighbouring tile anything.

**A prop that un-bakes is new here.** A den never moved and never vanished, so
nothing had to tell the chunk about it; a boat appears at a landing and goes when
the last monster that came in on it leaves, so `land` and `leave` both call
`markChunkDirty`. `leave` checks that no other monster shares the site first —
one hull per landing, not one per monster.

**`movers.ts` lost the dormant posture entirely.** `DORMANT_SQUASH`, `SPREAD`
and `FRONT` existed only to draw a monster asleep at its den's mouth, shifted
forward so a hunched figure was not swallowed by the mound. Nothing sleeps any
more, so all three are gone and a monster is drawn one way.

**The palette lost `den` and `bone` and gained `hull`, `hullTrim` and `sail`;
`denMouth` became `doorway`**, since its other caller is a building's doorway
and the word outlived the thing it was named after.

**Verified in the browser** (seed 20260901, 1280×800, Chrome): the opening on an
empty map with `A STORM IS FAR OFF` and no bar; the forecast filling to
`STORM FROM THE WEST, ANY MOMENT NOW` on five rust segments; the landing and
`THE WILDS ARE ASHORE`; the hull close up with its sail and prow, and at opening
zoom beside a troll; the monster panel reading `Doing / ashore` with no bar and
no button; the Watchtower's reach square drawn over the terrain while its tool
is held. Console clean — no errors, no warnings, no three.js complaints.

**Not covered.** The browser pass reached the props through a **forced** landing
beside the colony, because the real one is a hundred tiles from the opening
camera — so the hull has not been seen standing on sand, and `shoreAngle` (which
turns it to lie along the water) rests on the mesher test and on reading the
code. Nobody watched a boat vanish as its last monster boarded. `props.test.ts`
still covers `wallBoxes` only, so `boatBoxes` is pinned through the mesher
rather than at the prop.
