# A colonist working outdoors swings a tool

Two arms in the body's cloth tint and a timber-and-stone implement appear while
a colonist holds a task and stands in `Phase.Working`, swung on a
0.8-game-second closed form of `(id, time)`; the carried box is suppressed for
those ticks. Folk now draw into a layer of their own, so an overflow of
colonists costs a colonist rather than a monster. Implements
`docs/specs/2026-09-16-folk-at-work.md`.

## Detail

**The gate is `task >= 0 && phase === Working`, and the first half is not
optional.** `Colonist.phase` is only meaningful while a task is held and nothing
resets it when one ends — `abandonTask`, `abandonForFlight` and `staff()` all
clear the task and leave `phase` where it was (`stepAside` is the exception
that proves it: it goes through `clearWorker`, which does reset the phase).
On `phase` alone a colonist would swing a tool **while fleeing an orc**,
while walking to a
workshop they were just staffed to, and after any cancelled designation. Written
into the code beside the check and into `sim/know`'s own export doc, so it is
not simplified back out.

**`Phase` is now re-exported from `sim/know`, and that is the one edit in
`src/sim/`.** The spec's Outcome asks for `src/sim/` untouched while its gate is
written in terms of `Phase.Working`, and the two cannot both hold: `know` did
not export the constant, and `render/` may not read the truth modules
(`src/render/CLAUDE.md`). A pure re-export was taken as the smaller breach — no
behaviour, no store field, no `SAVE_VERSION` move, no pinned hash move. What the
spec's Non-goals actually forbid — a knowledge export for the *task kind* — is
untouched.

**The layer term is `MAX_COLONISTS * 6`, not the spec's 5.** The spec enumerates
"body, head, two arms, tool" while its own *The tool* section asks for a haft
*and* a heavier head in timber *and* stone tones, and `put` carries one tint per
instance — so the tool is two boxes and a working colonist is six. A hauling one
is three; the carried box and the tool can never coexist, which is why it is not
seven.

**Folk left the shared `solids` layer, which now sizes for monsters and goods
alone.** Past a cap `put` drops whatever is drawn **last**, which in one shared
layer is monsters and loose goods — and a monster missing from the map is the
one false claim `movers.ts` refuses everywhere else. Separated, a colonist
overflow costs a colonist — a **whole** one, because `drawColonists` reserves
the figure's two to six boxes before it draws any of them rather than letting
`put` truncate one into a body with no head. Worth knowing while reading the
number: **nothing in
`sim/` caps population at `MAX_COLONISTS`**, so 64 is already a figure the game
can exceed — a pre-existing gap this change makes dearer per head rather than
one it introduces.

**There is no arc, and that is the rule rather than a limit of the mover
layer.** `put` composes its matrix from `Q.setFromAxisAngle(UP, rot)`, so an
arbitrary quaternion — a real shoulder pivot — is two lines away here, unlike in
the chunk mesher where `emitBox` knows no axis but y. What forbids it is
*Nothing leans* (`2026-09-16-no-leaning-geometry`), kept deliberately: one rule
over all geometry beats one better-looking arm, and the first carve-out is the
one every later prop cites. The stroke is therefore translation plus a y-twist
of the whole figure — hands and tool rise and draw back over 0.62 of the period,
then drive down and forward over the rest, accelerating, because a stroke that
falls slower than it rises reads as lifting rather than striking.

**Rejected: driving the stroke off `c.work`.** It would be deterministic and
sim-true, but `workTicks` returns 0, 1 or 2 per tick at 10 Hz, so a hungry
colonist's stroke would stall and freeze mid-arc. The clock is smooth and the
*gate* is already sim-true. The id offset is the golden-ratio conjugate, so
consecutive ids land as far apart in the cycle as they can.

**One motion for every job, and no per-job tool.** The renderer does not
distinguish a chop from a build and does not need to: the *place* says the job,
the motion says that work is happening. A wrong rhythm on one job would be a
bug where one rhythm on all of them is a style. The implement is deliberately
**not an axe** — an axe at a wall would be wrong, and a generic implement at a
tree reads as an axe because of the tree.

**Wall building loses a signal it used to ship, knowingly.** `actBuildWall` sets
`Working` while the colonist still holds their log, so every palisade, gate and
stone segment in the game is raised by somebody holding the material — and the
tool now wins, so the log is not drawn for those ticks. A figure holding a log
above their head while swinging an implement reads as juggling; the wall coming
up out of the ground says nearly the same thing, and says it for longer.

**Not stilled by reduced motion, which is exactly what makes it a fourth motion
class.** `docs/STYLEGUIDE.md`'s Motion section now names **Work** beside sway,
motes and fauna, with its two distinguishing rules: gated on sim state, and not
stilled by `prefers-reduced-motion` — because the swing says work is happening,
which is information rather than decoration, so it sits with walking and
prowling. The existing reduced-motion sentence is untouched: this is an instance
of it, not an exception to it. At ×0 the swing stops with the colony, since no
work is being done. `drawColonists` therefore takes `Ambient.time` and
deliberately ignores `still`.

**The period was measured, not asserted, and the measurement is worth keeping.**
Under `prefers-reduced-motion` the rest of the world is provably still, so a
canvas window around a lone chopper isolates the swing exactly. Frame-to-frame
pixel-diff counts over that window **repeat with an exact period of 8 frames**,
three cycles running — exact repetition being what a closed form in `time`
predicts and an integrator could not produce. At 7 fps the loop's `dt` clamp
(`Math.min(0.1, …)`) pins game time to 0.1 s per frame, so 8 frames is **0.8
game seconds**, the constant in the source. The same trace puts the chop stint
at ~3 game seconds carrying ~3.7 strokes.

**Known limits, none repaired.**

- **The mine stint's doubled length was never watched on screen.** Rock on seed
  20260901 sits on a plateau a long walk north of the folk, and three attempts
  to isolate a single miner in a probe window caught walkers instead. That half
  rests on `MINE_TICKS` being twice `CHOP_TICKS` in `sim/tuning.ts` — untouched
  here — and on the gate knowing nothing about which job it is.
- **The reload-mid-stint bullet is reasoned, not played.** Nothing is
  integrated and nothing is saved, so there is no catch-up to perform; but
  `worldTime` restarts at 0 on a page load, so the stroke's *phase* is not
  continuous across a reload. What the spec promises — no jump, no catch-up — is
  about the absence of accumulated state, and that is what holds.
- **`movers.ts` still has no test file**, so all of this rests on the browser
  pass. `src/render/fauna.test.ts` covers the wander state and nothing here.
- **The Playwright MCP backend wedged again**, as it did for
  `2026-09-16-missing-material-ghosts` and `2026-09-16-site-scaffolding`. The
  pass was driven through chrome-headless-shell over CDP directly — same
  browser, same screenshots, plus a per-frame `gl.readPixels` probe that
  screenshots were far too slow for under software GL (~1.2 s a frame).
- **Nothing exercises the folk layer at its cap**, or a colonist swinging while
  a monster is beside them. Past 64 folk a whole colonist is now silently
  dropped instead of a monster — the graceful failure, but still a missing
  figure, and it is on `docs/CLAUDE_TODO.md`.

Verified: 490 tests, lint, `tsc`, production build; `SAVE_VERSION` still 11 and
no pinned hash moved, scripted or fixture. In the browser (seed 20260901,
1280×800, chrome-headless-shell over CDP): a chop at the opening zoom and at the
frustum floor showing arms, haft and stone head at several points of the stroke;
five idle folk as two boxes and a hauler as three, with no arms and no tool on
any of them; a palisade builder swinging with the log they are holding not
drawn; two colonists on adjacent trees with their tools at different heights.
Paused at ×0 mid-stint, **24 consecutive frames measure zero changed pixels**
over a working colonist while the same window at ×1 changes every frame. Under
`prefers-reduced-motion` the rest of the world measures zero changed pixels for
five seconds at a stretch while the swing runs. `v11.castles` imported through
the menu loaded to its pinned hash and drew **three** figures for five folk with
two in slots, none of them standing at the Hive or the Meadery. Console clean
apart from swiftshader's own `ReadPixels` stall warnings, which are the software
GL driver's and not the page's.
