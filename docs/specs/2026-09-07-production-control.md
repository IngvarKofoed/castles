# Production control: limits and filters

The colony's workshops run without brakes — a staffed sawmill plus
input-hauling converts every log on the island into planks. This adds the
brake and finishes an old deferral in one small step: **per-item
production limits** (a global ceiling per produced type, "make planks
until N exist", unlimited by default) and the **stockpile filter toggles**
whose fields have been enforced on inflow since step 2 with their panel UI
explicitly deferred. Building this drains the production-brakes item from
`docs/CLAUDE_TODO.md`, and it must land before 5b, whose mill and oven
would otherwise drain grain and flour the same way.

## Outcome

**What you get:**

- The brake: set "produce until N" on any workshop and the colony stops
  converting past it — logs stay logs once enough planks exist, and
  production restarts by itself when the stock is spent.
- Organizable stockpiles: per-type accept toggles on every stockpile
  panel, so a log-yard by the wall project and a plank-store by the
  housing row are one click each.
- 5b-ready brakes: any future workshop with a recipe obeys ceilings with
  no new machinery.
- Nothing changes until you act: all limits default to unlimited, old
  saves migrate untouched.

**How to verify:**

- Staff the sawmill, set its ceiling to just above the current plank
  count: it mills up to the ceiling and stops, its panel reading "at
  limit"; build a house (spending planks) and milling resumes unaided.
  (The ceiling must cover the house's cost — below it, the counting
  rule stalls that build until the ceiling is raised; see Key
  decisions.)
- Set the ceiling below the current count: no new milling starts, the
  unit in progress finishes, nothing is cancelled or dropped.
- Toggle a stockpile to accept only logs: planks stop arriving there but
  the sawmill still pulls its logs from it — filters route, ceilings
  brake, as the panel's own note says.
- Load a pre-limit save: it plays identically until a ceiling is set.
  The golden script gains a set-limit and a toggle-filter and re-records
  its pinned hash once, per the documented ladder; the drift test's two
  runs of the new script are identical; tests and lint pass.

## Key decisions

- **The brake is a global per-item ceiling, not a per-workshop one**
  (new). `sim.limits: number[]` indexed by `ItemType`, `-1` = unlimited
  (the default everywhere, so migrated saves and untouched workshops
  behave exactly as today). One number per type is one decision per good;
  two sawmills sharing a plank ceiling is the correct semantics (the
  player cares how many planks exist, not which mill made them), and it
  is Banished-proven. Scales to 5b free of charge: any workshop with a
  `recipeOf()` obeys the ceiling for its output type. **Ceilings apply to
  produced goods only** — logs and rock need none, because designations
  are already finite, player-bounded orders (mark thirty trees, get
  thirty logs, done; nothing re-designates), and the UI offers the row
  only for workshop outputs, so a raw-good ceiling cannot even be set.
  5b inherits the same split: if grain grows from field designations
  rather than a recipe, the fields are their own throttle.
- **The ceiling gates generation and processing, not hauling in flight**
  (extends). `generateHaulToInput` skips a workshop whose recipe output
  is at or over its ceiling, and the workshop's processing step doesn't
  start a new unit while over it — a unit already milling finishes (the
  carried-until-completion spirit: no half-states). Counting is **all
  items of the type, any location** — stored, ground, carried — because
  the player's question is "how many exist", and a definition that skips
  carried items oscillates as haulers walk. In-flight hauls complete;
  nothing is cancelled by a ceiling change. "Any location" includes
  materials already delivered to a blueprint — they exist until the
  build consumes them at completion — so a ceiling **below a single
  building's cost stalls that build**: the site holds planks that still
  count, and waits for planks the mill won't make. Accepted: both
  panels name the state, raising the ceiling clears it, and the
  discount alternative is rejected below.
- **Filters are routing, not brakes — and the spec says so** (extends).
  The panel gains one toggle row per item type on stockpiles, writing the
  existing `acceptLog`/`acceptPlank`/`acceptRock`/`acceptBlock` fields
  that `freeCapacity` already enforces on inflow. Outflow is untouched:
  workshops still pull from any stockpile. A player who wants a hoard
  the mills can't touch gets it with a ceiling, not a filter — one
  sentence in the panel's own wording keeps the two ideas apart. And the
  ceiling decision's symmetry, stated: a filter toggled off
  **grandfathers** what the pile already holds (stored items aren't
  loose, so nothing re-homes them; sites and workshops drain them
  naturally), and a haul already in flight delivers the refused type —
  nothing is cancelled, and the panel's per-type counts keep it visible.
- **The limit control lives on the workshop panel** (extends the
  styleguide's panel anatomy). A workshop's panel gains a "produce until"
  row for its output type: the colony-wide count against the ceiling
  ("planks in colony 14 / 20") with quiet −/+ steppers and an
  "unlimited" state at the top of the range. The landings matter: from
  unlimited, the first − lands on the **current count** rounded up to
  the step of 5 — so "pause this good" is one click, which is what
  makes the Non-goals' "a ceiling is the same lever as pause" claim
  true — then fives below; + past `LIMIT_MAX` (100, a tuning constant)
  returns to unlimited. The "in colony" wording is load-bearing: the
  row sits under the per-building output-buffer count, and without it
  two unlabelled plank numbers — one local, one global — share a
  panel. Editing the row edits the global number; a second sawmill's
  panel shows the same row. Each press sends the **relative**
  `stepLimit (type, dir)` command, which the sim resolves against the
  live ceiling and count when the tick applies it. An absolute value
  computed from the panel's snapshot is wrong here: commands land a
  tick later at the earliest and queue while the game is paused, so a
  − then + inside one tick would land one step up, and three presses
  queued while paused would move the ceiling once. `set-limit` stays
  absolute, for scripts, replays and tests.
- **A ceiling-idle workshop says so, calmly** (reuses the house voice).
  A staffed workshop paused by its ceiling shows "at limit (20 planks
  in the colony)" as its panel note row — the same quiet voice as
  "waiting for logs".
  The slot worker stays put (unstaffing remains the player's lever for
  reclaiming the pair of hands); no readout, no alert.
- **SAVE_VERSION 7** (reuses the ladder). The migration adds `limits`
  filled with `-1`. Fixtures v1–v6 keep loading; a v7 fixture joins.
  Filter fields already exist in every save — the toggles are pure UI.

## Goals

- The player can hold a stock of any **produced** good: set a plank
  ceiling and logs stop draining the moment enough planks exist,
  resuming by themselves when planks are spent (houses will eat them;
  5b's colonists will eat bread). Raw goods are throttled by their
  designations — you chop what you marked and no more.
- Stockpiles become organizable: a log-yard by the wall project, a
  plank-store by the housing row — the filter fields finally have hands.
- 5b inherits working brakes: the mill and oven obey ceilings on day one
  with zero new machinery.

## Non-goals

- No per-workshop pause toggle — a ceiling at the current count is the
  same lever with better semantics, and unstaffing already exists for
  reclaiming the worker.
- No outflow filters ("don't take from here") — a second bookkeeping
  surface for a need the ceiling covers; explicitly rejected so nobody
  adds it as a "completion" of the filter UI.
- No priority or ratio systems between workshops, no per-stockpile
  capacity tuning, no global production screen — the panels are the
  whole UI.

## Design

### Store and migration

`sim.limits: number[]`, one slot per `ItemType` value, `-1` unlimited.
The v7 migration adds it filled with `-1`. Three commands join the set,
all plain commands at tick boundaries so the golden log stays
deterministic: `set-limit` (type, value; clamped to `-1` or
`0..LIMIT_MAX`) — absolute, for scripts, replays and tests;
`stepLimit` (type, dir) — relative, what the steppers send, resolved
by the sim against the live ceiling and count at apply time (the
limit-control decision says why absolute presses misbehave); and
`toggle-filter` (building id, type).

The append ritual, stated for 5b's author: every future `ItemType`
appends a `-1` to `limits` in its own migration rung — miss it and an
old v7 save reads `limits[Grain]` as `undefined`, breaking the store's
no-`undefined` rule and the hash. It is the same ritual `goods.ts`
already documents for the stockpile accept fields.

### The ceiling in the sim

A helper `typeCount(sim, type)` counts items of the type in any
location (the derived-index pattern if scanning shows up in profiles;
plain scan first — item counts are hundreds, not thousands).
`generateHaulToInput` adds one guard: skip the workshop when its
recipe's output type has a ceiling and `typeCount ≥ limit`. The
workshop's processing step adds the same guard before *starting* a new
unit; a unit in progress completes and delivers. Ceilings never cancel
tasks or dump carried items — a limit lowered mid-haul simply stops
*new* work, and the system settles within one delivery. Setting a
ceiling below the current count is legal and means "stop producing";
the count drifting down (consumption, construction) restarts production
with no hysteresis band — task generation is idempotent and cheap.
One bounded quirk, accepted: at the ceiling, up to `inputCap` logs
(currently two) sit locked in the workshop's input buffer, since
inputs are never taken back out — visible in the panel's buffer row,
released the moment production resumes.

### The panels

Stockpile panel: one row per item type — the type's name, the stored
count in this stockpile, and an accept toggle writing the existing
field. The panel's note row carries the routing/brake distinction in
one sentence ("filters choose what this pile accepts — to stop a good
being made, set its limit on the workshop"). Workshop panel: the
"produce until" row per the Key decisions — count / ceiling, −/+ in
fives, unlimited at the top; plus the "at limit" note state. Rows and
notes reuse the styleguide's panel anatomy; the −/+ steppers and the
accept toggles are two interactive shapes the styleguide doesn't have
yet — both are built from the secondary-button recipe (`line` border,
ink-dim, 11px caps) so the one-gold-element rule holds, and the build
adds their recipes to `docs/STYLEGUIDE.md` in the same change. No new
colors.

### Tests

Unit: ceiling stops haul-to-input generation at the threshold and
resumes below it; an in-flight unit completes; `-1` behaves as today;
filters still gate inflow (existing tests) and the toggle command flips
them. Golden: the scripted log gains a set-limit and a toggle-filter
command; the drift test runs through them.

## Alternatives considered

- **Filters as the brake** — they gate inflow only; sourcing pulls from
  any stockpile, so a log-only pile feeds the mill happily. Making them
  brake needs a per-stockpile outflow flag: more bookkeeping, worse
  mental model. Rejected, and recorded so it isn't "completed" later.
- **Per-workshop limits** — with two sawmills the player would tune two
  numbers to control one good; the global ceiling is the question they
  are actually asking. Rejected.
- **A pause toggle per workshop** — strictly weaker than a ceiling set
  to the current count, and a second control meaning almost the same
  thing. Rejected.
- **Discounting blueprint-committed materials from the count** — would
  let any build finish under any ceiling, but the panel's number would
  disagree with the ribbon's and with what a cancelled blueprint hands
  back, and "committed" is a class distinction the any-location rule
  exists to avoid. The stall it prevents plateaus, is named by both
  panels, and is cleared by raising the ceiling. Rejected.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** The sim guard, the two commands, the v7
  migration and the two panel rows all touch the same handful of files
  in sequence; nothing splits into independent streams.
- Natural order: store + migration + commands first (with the v7
  fixture and the golden-script extension), then the sim guards in
  `generateHaulToInput` and processing, then the two panels plus the
  styleguide recipes for the stepper and toggle.
- The change that lands this **deletes the production-brakes item from
  `docs/CLAUDE_TODO.md`** — that item is completed by this build, per
  the Owed follow-ups convention in `CLAUDE.md`.

## Amendments

- 2026-09-08 — Two build findings folded back (implemented in
  `docs/changelog/2026-09-07-production-limits-and-filters.md`): the
  steppers send a relative `stepLimit (type, dir)` command resolved by
  the sim at apply time — the spec's absolute `set-limit` misbehaves
  across queued and paused presses and is kept for scripts and
  replays; and the counting rule's blueprint consequence is now stated
  and accepted (a ceiling below one building's cost stalls that
  build), with the Outcome bullet qualified and the discount
  alternative recorded as rejected.
