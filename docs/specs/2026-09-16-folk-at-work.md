# Folk swing a tool when they work

A colonist chopping a tree stands stock still for three seconds, and mining for
six. Work is the most-watched motion the game doesn't have: many colonists,
doing it constantly, all game. This gives them **arms and a tool** and swings
them while `phase === Working` — one motion for every job, driven by a closed
form off `(id, time)`, gated on a field the renderer already receives. No
knowledge change, no sim change, nothing saved.

## Outcome

**What you get:**

- A colonist working outdoors — chopping, mining, levelling, building, razing,
  repairing — swings a tool for as long as the stint lasts, and stands plainly
  when they are not.
- A busy colony and a stalled one look different from across the map, with no
  panel open.

**How to verify:**

- Mark a wood and watch a colonist reach a tree: arms and a tool appear, swing
  for the three seconds the chop takes, and vanish the moment they walk on. A
  mine stint runs twice as long, the same way.
- Put two colonists on adjacent trees: they do not strike in step.
- Watch a colonist walking and carrying: three boxes, no arms, no tool — the
  animation belongs to the work, not to the person.
- Staff a workshop: its worker is still not drawn at all, exactly as before.
- Pause at ×0: the swing stops with the colony. Turn on reduced motion **and
  reload** (`still` is read once from `matchMedia` at load): the swing **keeps
  going**, as walking and prowling already do, while the tarps, bees and crops
  hold still.
- Raise a palisade: the builder swings, and the log they were holding is not
  drawn while they do.
- Reload mid-stint: there is **no catch-up** — no accumulated state to replay,
  and the swing resumes immediately. Its *phase* does jump, because
  `Ambient.time` is `worldTime`, a module-level accumulator in `app/main.ts`
  that restarts at 0 on a page load; a colonist mid-stroke before the reload is
  mid-a-different-stroke after it, and nothing depends on where. Absence of
  catch-up is the claim; continuity is not.
- Loaded through Playwright with a screenshot of a chop at the opening zoom and
  at full zoom-in, per `src/render/CLAUDE.md`, and the console clean of WebGL
  and three.js warnings.
- No behaviour, state or save change in `src/sim/` — `SAVE_VERSION` unchanged,
  no pinned hash moves. The one line it does add there is `know`'s `Phase`
  re-export, which the gate cannot be written without.

## Key decisions

- **The gate is `c.task >= 0 && c.phase === Phase.Working`, and the first half
  is not optional** (reuses). `Colonist.phase` is "standing on the spot,
  accumulating work ticks" (`store.ts:245–252`) and arrives whole through
  `colonists(sim)` — but its own docstring says it is **meaningful only while
  `task >= 0`**, and nothing resets it when a task ends: `abandonTask`
  (`tasks.ts:101`), `abandonForFlight` (`flee.ts:174`), `stepAside` and
  `staff()` (`commands.ts:533`) all clear the task and leave `phase` where it
  was. On `phase` alone a colonist would swing a tool **while fleeing an orc**,
  while walking to a workshop after being staffed, and after any cancelled
  designation — all ordinary play. The reason is recorded here so the check is
  not simplified back out.
  **This costs one line in `src/sim/`**: `sim/know` does not re-export `Phase`,
  and `src/render/CLAUDE.md` forbids the renderer reading the truth modules, so
  the constant reaches `movers.ts` through a `export { Phase } from "../store"`
  in `know/index.ts` and no other way. Nothing about the sim's behaviour, state
  or save format changes — but "`src/sim/` untouched" is not literally true of
  this change and should not be claimed.
- **One motion for every job** (new). The renderer does not distinguish a chop
  from a build, and does not need to: a colonist swinging at a tree is
  chopping, and one swinging at a blueprint is building. The **place says the
  job**; the motion says that work is happening. This rests on that alone, not
  on a plumbing cost — `know` re-exports `Sim` whole and `Sim.tasks` is
  type-reachable from `movers.ts`, so the barrier to per-job tools is the
  subtree convention plus a tool set to say what the ground already says.
- **The swing is translation and a twist, because the rule says so — not
  because a pivot is impossible here** (reuses the constraint). A vertical arc
  genuinely is inexpressible in the chunk mesher, where `emitBox` rotates x/z
  and never y. It is **not** inexpressible in the mover layer: `put` composes
  its matrix from `Q.setFromAxisAngle(UP, rot)`, and an arbitrary quaternion is
  two lines away with no mesher involved. What forbids it is
  `src/render/CLAUDE.md`'s *Nothing leans* — "not in props, not anywhere" —
  kept deliberately, because one rule covering all geometry is worth more than
  one better-looking arm, and a carve-out here is a carve-out the next prop
  author cites. So the stroke is built from what the rule allows: the tool and
  hands **rise, then drive down and forward**, with a small y-twist of the
  whole figure at the bottom. It reads as a swing without one existing.
- **Closed form off `(id, time)`, no state** (reuses). A colonist's stroke
  phase is a pure function of their id and the clock, so nothing is integrated,
  nothing is saved, a reload or a tab-wake needs no catch-up, and two colonists
  side by side are never in step. The motes' rule (`2026-09-15-ambient-life`),
  applied to a figure. **Not** driven off `c.work`: it advances 0, 1 or 2 ticks
  at 10 Hz, which is a stutter, not a rhythm.
- **On the world clock, but not stilled by reduced motion** (reuses). At ×0
  the swing stops with the colony — the sim is not advancing, so no work is
  being done. Under `prefers-reduced-motion` it **keeps going**, because the
  styleguide's Motion section already draws exactly this line: "stills
  everything ambient and nothing else. Colonists still walk and monsters still
  prowl: someone asking for less motion is not asking to stop seeing the orc."
  The swing says work is happening, which is information and not decoration, so
  it sits on the game side of that line with walking and prowling. `Ambient`
  (`{time, dt, fx, fz, still}`) reaches `sync` and stops there, so
  `drawColonists(alpha)` grows an argument — it needs `time`, and deliberately
  ignores `still`.
- **Colonists get a layer of their own** (extends). There is no colonist
  budget today: `solids` is one shared layer for colonists, monsters and goods
  (`movers.ts:592`), drawn in that order — so past the cap `put` silently drops
  whatever is drawn **last**, which is monsters and loose goods, never an arm.
  A dropped monster is exactly the false claim about the map that `movers.ts`
  refuses elsewhere, and this change raises a colonist's worst case from 3
  boxes to 5. Splitting colonists into their own layer makes a colonist
  overflow drop *colonists*, which is the graceful failure, and leaves the
  monster and goods budgets untouched. The term is **`MAX_COLONISTS * 6`**:
  body, head, two arms, and a **two-box tool** — `put` carries one tint per
  instance, so the haft and its heavier head below are two instances, not one.
  The carried box is not in the count, because it cannot coexist with the tool
  (see *Carrying and working*).
- **Slot workers stay invisible, and that is unchanged** (reuses). `c.inside`
  skips them entirely (`drawColonists`), so a sawmill's worker is not drawn and
  gains no animation — the panel's Worker row is where a staffed workshop is
  read (`2026-09-01-slot-workers-step-inside`). "Work" here means the outdoor
  stints: chop, mine, level, build, raze, repair.

## Goals

- A colony at work looks like one from any zoom, for the seconds the work
  actually takes.
- A stalled colony looks different from a busy one without opening a panel.

## Non-goals

- A walk cycle. Colonists have no legs, and a bad walk cycle reads worse than
  none — a clean follow-on with the fauna leg code as precedent, not this.
- Per-job tools or motions: no axe, pick or hammer set, and no knowledge export
  for the task kind.
- Animating what is worked *on* — no shaking tree, no flying chips.
- Any change to slot workers, to the sim, or to what is saved.
- Colonist faces, hands, or anything at a scale the camera cannot resolve.

## Design

### The stroke

Two arm boxes flank the body at shoulder height and a tool box sits in front of
them, all three carrying `c.heading` exactly as the body and head already do.
**The arms take the body's `cloth` tint**, not linen: `drawColonists` picks
`c.clothes > 0 ? CLOTH[…] : PROP.drab`, and that clothed/unclothed contrast is
a load-bearing map-distance read (`2026-09-10-sheep-and-clothes`) that two
always-pale arms would dilute. The tool takes timber and stone tones.
While `phase === Working`, a normalised stroke `s ∈ [0, 1)` comes from the
clock and the colonist's id:

- **Raise** over the first part of the stroke: arms and tool climb to about
  head height and draw back slightly.
- **Drive** over the rest: they fall to knee height and forward past the body's
  face, faster than they rose, because a stroke that falls slower than it rises
  reads as lifting rather than striking.
- **A small y-twist** of the whole figure through the drive, returning on the
  raise — the shoulders squaring into the blow. This is the only rotation
  available and it is what stops the motion reading as a box moving up and
  down.

The id offsets the phase so two colonists on adjacent tiles never strike
together, and the period is a little under a second: several strokes inside a
three-second chop, more than a dozen inside a twelve-second stone gate. **The
two shortest stints get one stroke and two** — `RAZE_TICKS` is 1 s and
`WALL_BUILD_TICKS` 2 s — which is correct rather than broken, and is said here
so a single-stroke raze is not filed as a bug.

Outside `Working` the arms and tool are not drawn at all. A colonist walking is
the three boxes they are today.

### The tool

One implement, held in front of the hands: a short haft with a heavier head,
in timber and stone tones — **two boxes**, since `put` gives an instance one
tint and a two-tone tool cannot be one. It is deliberately not an axe — an axe at a wall would
be wrong, and a generic implement at a tree reads as an axe because of the
tree. One shape, no table, nothing to extend when a job is added.

### Carrying and working at once

The carried-item box sits at `CARRY.y` 0.8, above the head, and doubles as the
wanderer's pack. **Working while carrying is the normal case, not an edge**:
`actBuildWall` (`colonists.ts:1038–1050`) sets `Phase.Working` while the
colonist still holds their log and clears it only when the segment completes,
so every palisade, gate and stone segment in the game is raised by someone
holding the material.

The **tool wins and the carried box is suppressed** for those ticks. A figure
holding a log above their head while swinging an implement reads as juggling,
and the cost is understood: wall building loses a signal it ships today, that
the material reached the segment. The wall coming up out of the ground says
nearly the same thing, and it says it for longer.

### Budget

Colonists move out of the shared `solids` layer into one of their own, sized
`MAX_COLONISTS * 6` — six being the working colonist's real box count, with the
tool's two tones costing two instances. Past a cap `put` drops silently, and that is only the
right failure when the layer belongs to one population: in the shared layer the
drop lands on whatever draws last, which is monsters and loose goods. Separated,
a colonist overflow costs a colonist.

Worth knowing while sizing it: **nothing in `sim/` caps population at
`MAX_COLONISTS`**. Beds keep being built and wanderers keep arriving, so 64 is
already a number the game can exceed — a pre-existing gap this change makes
more expensive per head, not one it introduces.

### The styleguide

`docs/STYLEGUIDE.md`'s Motion section says every moving thing picks one of
three classes and that "a fourth is a design decision, not a detail — pick one
of these or write the class down here first". The work swing is none of sway,
motes or fauna: it is sim-gated, it belongs to a figure that already crosses
the map, and it is information rather than ambience. It is written down as the
fourth class, with its two distinguishing rules — **gated on sim state** (so it
stops when the work does) and **not stilled by reduced motion** (because it is
game, not decoration) — and the existing reduced-motion sentence is left
exactly as it stands, since this change is an instance of it rather than an
exception to it.

## Alternatives considered

- **Driving the stroke from `c.work`.** Appealing, since the axe would swing
  exactly as the work accumulates and the phase would be deterministic. But
  `workTicks` returns 0, 1 or 2 per tick at 10 Hz, so the stroke would stutter
  and stall — a hungry colonist gets 0 on most ticks, so the stroke would
  freeze mid-arc. The clock is smooth and the *gate* is already sim-true.
  (`actRepair` adds `paid * REPAIR_HP_PER_SECOND` rather than `paid`, so its
  numbers differ; the objection is the same.)
- **Per-job tools and motions.** A knowledge export for the task kind, a tool
  per job, a rhythm per job. The ground already says which job it is, and a
  wrong rhythm on one job is a bug where one rhythm on all of them is a style.
- **Animating the body alone**, with no new geometry. Free, and it says
  "something is happening" without ever saying work — a figure bobbing at a
  tree reads as idling in place.
- **A vertical arc about a shoulder**, which is what a swing actually is. Not
  expressible: `Box.rot` is y-only and a tilted member needs new mesher
  machinery.
- **Drawing the carried log and the tool together** during wall building.
  Gives up nothing, and reads as a figure juggling a log above their head while
  swinging an implement.
- **A real shoulder pivot**, which `put` could express in two lines. Rejected
  to keep *Nothing leans* whole: one rule over all geometry beats one arm, and
  the first carve-out is the one every later prop cites.
- **Animating slot workers too.** They are not drawn at all, deliberately, and
  making them visible to animate them would reverse a decision about what a
  staffed workshop looks like.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One function in `src/render/movers.ts`, one new
  layer, one `Ambient` argument, and a styleguide class. Small, and the review
  of this spec found the gate wrong, the plumbing claim wrong, the budget
  arithmetic wrong and the central geometric claim wrong before a line was
  written — the numbers and the invariants here have earned suspicion.
- Read `docs/ARCHITECTURE.md`'s Gotchas and `src/render/CLAUDE.md`'s hard rules
  first, as that file requires. *Nothing leans* is the rule this design is
  shaped by, and it is deliberately kept rather than carved out.
- Not multi-agent, not ultracode: one file, nothing in `src/sim/`, no save
  version, no hash movement, and a `git revert` is the whole walk-back.

## Amendments

- 2026-09-17 — Three build findings, all spec defects the build resolved as now
  written. **"`src/sim/` untouched" was unsatisfiable**: the gate needs
  `Phase`, `know` did not re-export it, and the renderer may not read the truth
  modules — so the spec now names the one-line re-export and claims only that
  no behaviour, state or save format changes. **The budget is
  `MAX_COLONISTS * 6`, not `* 5`**: two sections disagreed, because `put`
  carries one tint per instance and the two-tone tool the spec describes is
  therefore two boxes, not one. And **the reload bullet over-claimed**: the
  stroke is a closed form of `worldTime`, which restarts at 0 on a page load,
  so there is no catch-up but there is a phase jump — the verifiable claim is
  the absence of accumulated state.
