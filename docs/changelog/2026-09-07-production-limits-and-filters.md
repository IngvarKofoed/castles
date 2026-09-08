# Production ceilings and stockpile filter toggles: the brake and the router

A workshop's output now has a **global per-good ceiling** — "make planks until N
exist", counted over every plank anywhere — set from a `−`/`+` row on the
workshop panel, unlimited by default; a mill at its ceiling stops ordering
logs and starting batches, says "at limit" in the panel, and restarts by
itself when planks are spent. Every stockpile panel gained per-good accept
toggles over the filter fields shipped in step 2. `SAVE_VERSION` is 7.
Implements `docs/specs/2026-09-07-production-control.md`.

## Detail

**Ceilings are global, not per workshop, and gate only what *starts*** — the
haul that feeds an input buffer and the batch a workshop begins. Nothing in
flight is ever cancelled: a batch under way finishes and delivers, a haul on
its way arrives, and up to `inputCap` logs then sit parked in the buffer until
the count drops (inputs are never taken back out — the spec's accepted quirk,
visible in the panel's Input row). Per-workshop ceilings and a pause toggle
were rejected in the spec; don't reintroduce either. The count is **every item
of the type in any location** — stored, loose, carried — so it cannot flicker
as haulers walk.

**A consequence of that definition, found while writing the fixture's run-on
test and left standing:** planks delivered to a blueprint still exist until the
build completes, so a ceiling *below one building's cost* stalls that build —
a House under a plank ceiling of 2 holds the colony's two planks, still counts
them, and waits for two more the mill will not make. Both panels say so
("at limit (2 planks in the colony)", "waiting for planks (2 / 4)") and the
fix is to raise the ceiling, so it plateaus rather than spirals; the Outcome's
"build a house and milling resumes" holds whenever the ceiling covers the
house. Not repaired, because the alternative — discounting items committed to
a site — would make the count disagree with the ribbon and with what a
cancelled blueprint gives back.

**Filters are routing, never a brake, and the panel says so in one sentence.**
The toggles write the existing `acceptX` fields, which gate inflow only; a
log-only pile still feeds the sawmill, a toggled-off good is grandfathered
where it lies, and a haul already generated delivers (`freeCapacity` is asked
at generation, not arrival). "Filters as the brake" and outflow filters were
rejected in the spec — recorded so nobody adds "don't take from here" as a
completion of this UI.

**`sim.limits` is append-only like the enums it indexes, and the v7 rung
writes four literal `-1`s** — not `unlimitedLimits()` — so a v6 save migrated
after some later good exists still arrives at that good's own rung with
exactly four slots. Every future `ItemType` appends its `-1` in its own rung;
`assertSim` refuses a save whose `limits` is not an array of numbers, which is
what a missed rung looks like. Fixtures v1–v6 are untouched and their pinned
hashes moved once for the rung (v1 `ab0c5574` → `d01e0770`, v2 → `28d26444`,
v3 → `30f9a9a0`, v4 → `65b5106b`, v5 → `3fb33394`, v6 → `e0d58baa`);
`v7.castles` joins them at `0ca62ff1`, holding a ceiling of 2 with the mill
standing at it, two logs parked, and a stockpile refusing rock.

**The stepper's landings live in `sim/economy/limits.ts`, not the HUD, and a
press is a *relative* command.** From unlimited the first `−` lands on the
current count rounded up to `LIMIT_STEP`, so "stop making this" is one press;
`+` past `LIMIT_MAX` returns to unlimited; `−` stops at 0 and `+` at
unlimited, and the panel disables the button at each end. The steppers send
`stepLimit (type, dir)`, which the sim resolves against the **live** ceiling
and count when the tick applies it — not the spec's absolute `set-limit`,
which is kept for scripts, replays and tests but is what the HUD first sent.
Review caught why that was wrong: commands land a tick later at the earliest
and queue for as long as the game is paused, so an absolute target computed
from the panel's snapshot replayed that snapshot — two quick presses (`−`
then `+`) both sent the same number and landed one step *up*, and three
presses while paused moved the ceiling once. Press by press against live
state they land where a live panel's presses would. `LIMIT_MAX` 100 and
`LIMIT_STEP` 5 are tunables outside every save; `setLimit` clamps on arrival,
so a replayed command lands on the same number whatever the range is tuned to.
The panel display still lags while paused — the pre-existing "pause blocks
your own intent" limit (`2026-09-01-tick-and-labour`), unchanged here.

**`assertSim` sizes `limits` like a tile layer** — exactly as many slots as the
build has goods, each `UNLIMITED` or a whole count — rather than merely "an
array of numbers", which is what it said at first: review found that a
`limits` short a slot loaded clean, with `limitOf` answering "unlimited" for
the newest good and `setLimit` silently refusing to set it, so the missed-rung
alarm the comment promised did not exist, and that a stray negative value (a
state no command can write) would have read as "always at limit" forever. A
value above today's `LIMIT_MAX` still loads: the range is a tunable, the
ceiling is in the save.

**Keyboard focus survives a panel rebuild.** The steppers and toggles are the
first controls on the inspector a player presses repeatedly, and every press
rebuilds the panel, destroying the button just pressed; focus now carries over
to the new node with the same label, so a second press does not first mean
tabbing back in. Pointer users see nothing of this. **With a fallback, because
the matching node can come back disabled:** walking a ceiling down to zero on
the keyboard disables the `−` it was pressed with, and `focus()` on a disabled
button silently drops focus to the document body — so when the twin is dead,
focus moves to the other control in the same `.ctl` cluster.

**`.toggle:hover` sits *after* the two `aria-pressed` rules, deliberately.**
`.toggle:hover` and `.toggle[aria-pressed="…"]` have equal specificity, so a
hover rule written above them loses to whichever state the button is in: an
`off` toggle kept its faint ink under the cursor and never brightened. Don't
group it back with `.stepper:hover` for tidiness — the ordering is the fix.
Ditto the `overLimit(limit, count)` split in `economy/limits.ts`: the panel
prints the count and asks the verdict in one breath, and `atLimit` would have
walked every item in the colony a second time to answer.

**`stall` gained `at-limit`, and it outranks `output-full`**: when the ceiling
is what holds the mill, the player's own setting is the reason worth reading
first. Two new panel shapes — the stepper and the toggle — are both the
styleguide's secondary recipe with state carried by ink weight and fill, so a
panel still has exactly one gold element; `docs/STYLEGUIDE.md` records both
recipes and the control-row anatomy. No new colours.

**Golden hash `50083138` → `ade08d30`, shape and behaviour, deliberately:** the
store gained `limits`, and the script sets a plank ceiling of 2 at tick 1250
and turns the stockpile's plank filter off at 1260. The plank assertion moved
from "more than none" to "exactly the ceiling, mill at limit, both planks in
its own buffer", which is what says the number moved for the brake. The
settling, death-en-route and encounter pins moved for shape only (`limits`
sits on `Sim`, so the encounter moved this time where v6 left it alone).

**Drains the production-brakes item from `docs/CLAUDE_TODO.md`**, which this
build completes.

Verified: 334 tests (21 new across `economy/limits.test.ts`, the v7 fixture,
the migration rung and the `limits` refusal), lint, `tsc`, production build.
In the browser, the
committed `v7.castles` imported through the menu logged `load — tick 1000,
hashSim 0ca62ff1` — the number the fixture test pins — with the sawmill panel
reading `Planks in colony − 2 / 2 +` and `at limit (2 planks in the colony)`;
`+` resumed the mill, `+` past 100 read `unlimited` with `+` disabled, `−` from
unlimited landed on `6 / 10`, `−` walked to `6 / 0` with `−` disabled while the
batch under way still finished (`7 / 5`, then at limit); the stockpile's four
toggles flipped `on`/`off` in place with rock already `off` from the file; a
House placed by hand took four planks (7 → 3) and the mill read `working`
again unaided. One gold element per panel measured, no row overflow at 246px,
console clean (0 errors, 0 warnings). Re-verified after the review fixes: a
`−` `+` burst inside one tick left the ceiling where it was (5 → 5, where the
absolute command landed at 10), three presses queued while paused walked 20
down to 5 on unpausing (the absolute command would have stopped at 15), and
Enter pressed twice on a focused `+` stepped 5 → 10 → 15 with focus still on
the button after each rebuild.

**Not covered.** Nothing tests two staffed sawmills sharing one ceiling — the
sharing is by construction (one number, read by both) but no run has two. The
mason's block ceiling is unit-tested, not driven in the browser. The steppers
and toggles have no DOM test, as with the rest of `src/ui/`.
