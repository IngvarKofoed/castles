# Sheep graze their pasture and deer roam the wilds, bounded to a home radius

The Pasture's three sheep are no longer baked into its fence: they walk, graze
and turn, inside a home radius that never reaches the rails. Ten small herds of
deer roam the wilds, homed from the world seed and the terrain, refusing
enclosed ground and **re-homing outward** when a wall closes round them.
`docs/STYLEGUIDE.md` gains a **Motion** section naming the three classes — sway,
motes, fauna — and the rule between them: **only colonists and monsters cross
the map.** From `docs/specs/2026-09-15-ambient-life.md` (the last of three);
follows `2026-09-15-motes-bees-smoke-and-birds`.

## Detail

**This reverses `2026-09-11-sheep-and-clothes`.** That entry baked three static
sheep into `pasture()` and stated that renderer-owned animation state was a door
it would not open. What kept it shut was **scope, not principle**, and what
makes it safe to open is the boundedness rule: a creature never leaves its home
radius, so translation across open ground still means colonists and monsters and
nothing else. Fauna are still not sim entities — they cannot be hunted, herded,
eaten, killed or counted, nothing in `sim/` knows they exist, and no save
carries them.

**Fauna do not notice monsters, and that is a decision rather than an
omission.** A deer that scattered from an orc is **free information**, and
CONCEPT is emphatic that information is infrastructure bought with people — a
watchtower is a pair of hands. Wildlife that telegraphs a prowler undercuts the
one mechanic the game sells knowledge through. Pinned by test so it is not added
later as obvious polish.

**Re-homing is the one place this design could deadlock, and it is pinned
rather than reasoned.** ARCHITECTURE's Gotcha 8 is this exact machine: the
mockup's deer used `inOct(ringR + 2)` for their keep-out test, rejected every
roam target and froze on their home tiles. Here the trigger is the herd's **own
failure to find a legal target** — there are no rings and no event that says the
enclosure grew, and homes are derived once while enclosure grows wherever the
player builds, so a wall closing round a herd is a matter of time. The home then
steps outward from the colony centre, five tiles at a time, until it finds
ground the herd can graze; the creatures walk to it, so a walled-in herd drifts
out rather than teleporting. **Rejected: refusing enclosed targets with no
re-homing** — one line shorter, and Gotcha 8 with the serial numbers filed off.

**Initial placement is derived, not stored.** A herd's home and each animal's
starting offset come from a hash of the anchor and the world seed, so a load, a
tab-wake or a renderer rebuild puts them back in the same places with nothing
saved. The wander itself is transient and uses `Math.random`, which is banned in
`sim/` and fine here: no rule anywhere depends on where an animal was
mid-stride. **But state is kept when an anchor leaves the camera radius, not
discarded** — re-deriving on re-entry would teleport a flock every time the
player panned away and back, which is far more visible than the reload case the
derivation is argued from.

**Sheep keep clear of the shepherd's hut, and that rule had to be carried over
by hand.** The baked flock was placed "clear of the hut's corner"; a wander with
no such rule walks sheep straight through the roof, which is the one way a
pasture full of animals looks worse than three glued to the turf. `Herd.avoid`
is a keep-out square, the Pasture's hut is its only user, and the derived
starting offsets step around it on a golden angle so they stay derived.

**Legs slide, they do not hinge.** `put` spins about +y only, so a leg cannot be
pivoted; the diagonal pairs slide fore-and-aft along the heading instead, which
is what reads as a step at this size. Heads drop and reach forward while
grazing, which is the only thing that says which of the two an animal is doing.
The gait advances with distance walked, so a grazing animal stands still.

**Numbers, tune-by-eye.** Sheep 0.32 tiles/s, deer 0.5; a graze pause of 2.5–7.5
game seconds; three to a herd; ten deer herds homed 22–108 tiles from the map
centre with a 4-tile radius; the Pasture's radius is its footprint less 0.55, so
the fence is never reached. Deer are tan on four low legs — a silhouette nothing
else in the game has, which is what keeps one from ever being read as a monster.

**Not covered.** No `SAVE_VERSION`, no migration, no fixture, and **not one
pinned golden hash moved**; `src/sim/` is untouched. `movers.ts` still has no
test file, so `drawFauna` and the three mote layers rest on the browser pass
alone — `fauna.ts` has its own. **No browser run staged an orc walking through a
herd**: that rule is pinned by unit test (a monster standing on a herd's home
changes neither its home nor how far its animals stray) and by `fauna.ts`
reading nothing about monsters at all, but nobody watched it happen on screen.
Nothing exercises two Pastures, a herd whose re-homing walks it off the map
edge, or the fauna layer at its 384-instance cap.

Verified: 490 tests (7 new in `render/fauna.test.ts` — three sheep in an Active
pasture and none in a blueprint, the fence bound over sixty simulated seconds,
the hut clearance, stable derivation, homes on grass clear of the edge, the
re-homing case, and the monster indifference), lint, `tsc`, production build. In
the browser (1280×800, `v10.castles` imported through the menu, frames diffed
pixel by pixel): three sheep walking, grazing and turning inside the rails, with
a 48-second union of their positions forming one blob that **never touches the
fence** and never crosses the hut; deer grazing in herds on open grass with
heads down; paused at ×0 two frames three seconds apart are **byte-identical**
with deer on screen; with `prefers-reduced-motion: reduce` emulated at ×4 and a
wide view, six separate deer clusters measure **zero changed pixels** while
colonists and monsters in the same frame keep moving. `v8`, `v10` and `v11`
loaded to `a4634c50`, `2b8186a7` and their own pinned hashes. Console clean
(0 errors, 0 warnings).
