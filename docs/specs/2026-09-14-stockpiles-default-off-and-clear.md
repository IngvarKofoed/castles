# Stockpiles start closed, and a good can be cleared out of one

A new stockpile accepts nothing until the player turns goods on, reversing the
accept-all default that has stood since step 2. And every good's row on a
stockpile panel gains a `clear` control: pressing it puts the pile into a
**standing clear state** for that good — a third value of the existing accept
flag — under which the pile refuses the good and the colony's ordinary tidy-up
hauls carry out what it holds, and anything that lands there later, to the
nearest other pile that will take it. Nothing is ever dropped on the ground and
nothing outranks real work: clearing is housekeeping, priced in labour at the
lowest priority there is.

## Outcome

**What you get:**

- A new stockpile accepts nothing until you turn goods on — which you can do
  from the moment it is placed, on its blueprint panel, so a pile is configured
  before it is built. Piles in existing saves keep the filters they had.
- Every good's row on a stockpile panel has a `clear` control. Pressing it makes
  the pile refuse that good and carry out what it holds — and anything that
  lands there later — to other piles as they have room, at the lowest labour
  priority. Nothing is ever dropped on the ground.
- `all` / `none` on the Stored row set every filter in one press; `none` leaves
  a good that is clearing alone.
- The panel says why a pile stays empty — `accepts nothing yet — turn on what
  this pile should take` — and why a clear is stuck — `clearing planks — no
  other pile will take them`.

**How to verify:**

- Place a stockpile and click the blueprint: the toggle rows and `all`/`none`
  are there, every toggle `off`, with the "accepts nothing yet" note. Turn logs
  `on` before it is built: the finished pile takes logs at once. Leave another
  untouched: chopped logs stay on the ground until you turn logs on. Load a save
  made before this change: its piles' filters are as they were.
- With two piles accepting planks and one holding several, press `clear` on its
  plank row: the toggle reads `off`, the button reads `clearing`, and the planks
  arrive at the other pile over the following minutes with none on the ground.
  Turn planks back `on`: the movement stops.
- Press `clear` on a good no other pile accepts: the goods stay put and the note
  reads `clearing <good> — no other pile will take them`; turn that good `on` at
  another pile and they start moving.
- Press `all` on a pile: every toggle reads `on`. Press `none`: every toggle
  reads `off`, and a row that was `clearing` still is.

## Key decisions

- **A new stockpile accepts nothing** (diverges). `place()` in
  `src/sim/commands.ts` stamps every accept flag `0` for a Stockpile instead of
  `1`; other building kinds keep their (unused) `1`s so the change is confined.
  This reverses the accept-all default `docs/specs/2026-09-01-tick-and-labour.md`
  shipped "with the filter fields present in the store" — the fields have had
  hands since production control, and a pile that takes everything is the one
  configuration a player who curates piles never wants. Saved piles keep their
  flags; no migration.
- **"Clear" is a third value of the accept flag, not a new field** (extends).
  `accept = 2` means *refusing, and expelling*. `stockpileAccepts`
  (`goods.ts:86`, `=== 1`) already refuses it and `toggleFilter`
  (`commands.ts:190`, `=== 1 ? 0 : 1`) already turns it back to on — neither
  changes. Eleven `clearX` fields would have been a migration rung and a state
  that can contradict `acceptX`; a spare value of the flag it already lives in
  is neither.
- **Clearing rides the tidy-up hauls that already exist** (reuses). `isLoose`
  (`src/sim/labour/tasks.ts:394`) gains one clause — stored in a stockpile whose
  flag for that good is `2` — and `generateHaulToStore`, `nearestStore` (which
  already refuses to send an item back to its own holder) and `HaulToStore`'s
  last place in `TASK_PRIORITY` do everything else, including retrying while no
  other pile has room. No new task kind, no new colonist behaviour.
- **Clearing is standing, not one-shot, and does not revert by itself** (new).
  The flag stays `2` until the player turns the good on — even once the pile
  holds none of the good, when the panel simply shows it as `off`. A haul
  already in flight when they pressed delivers (the unchanged rule) and is
  pushed out next tick, which is exactly what a self-reverting flag would miss. A one-shot would have made
  exactly as many hauls as other piles could take at that instant and then
  stopped — a button that often has to be pressed twice.
- **Grandfathering stands, and this is not an outflow filter** (extends
  `docs/specs/2026-09-07-production-control.md`). `0` still means *refuse, and
  keep what is here*; `2` is the explicit override the player presses for.
  "Don't take from here" remains rejected: workshops and sites still pull from a
  clearing pile through `sourceForSite`, which only helps it drain.
- **The control is a secondary `clear` button in the row's cluster** (extends
  the styleguide's control-row anatomy). The toggle stays binary; `clear` sits
  beside it whenever the pile holds any of the good and is not already clearing
  it, and reads `clearing`, disabled, while it is. A stockpile panel has no
  action button, so the one-gold-element rule is untouched.
- **Filters are settable from the blueprint** (extends). A stockpile's blueprint
  and under-construction panels carry the same toggle rows and `all`/`none` as
  the finished pile — toggles only, no counts and no `clear`. `toggleFilter`
  already accepts a non-active stockpile (`commands.ts:192` checks kind alone);
  the panel simply stops hiding it. This is what keeps default-off from meaning
  "every first pile goes active accepting nothing": the click a player makes to
  check on the site is where they configure it.
- **`all` / `none` on the Stored row, as one command** (new). Default-off makes
  a general-purpose pile eleven presses; `setAllFilters { building, on }` and
  two secondary buttons make it one. `none` writes `0` only over `1`s and leaves
  a `2` alone — "refuse everything" must not silently cancel a clear the player
  is watching.
- **No `SAVE_VERSION` bump** (diverges from the ladder's reflex). `2` is a new
  legal value of a field every save already carries; `assertSim` does not pin
  the flags, every existing rung stamps `1`s, and an older build reading a `2`
  sees "not on" and refuses inflow — which is right. Of the pinned hashes, only
  `tick.test.ts`'s golden moves — the one script whose *assertions* had to
  change; every other scripted stockpile, fixture recipes included, is opened
  with one `setAllFilters` the tick after placement, which restores exactly the
  state those hashes were pinned against (see Design). The golden gains a
  `clearFilter` so the third value sits inside the determinism pin.

## Goals

- A new pile takes only what the player tells it to.
- One press sends a good out of a pile, and the colony finishes the job by
  itself as room appears elsewhere.
- Nothing is lost, dropped or hurried: clearing costs pool labour at the lowest
  priority and never touches what a workshop or site is already pulling.

## Non-goals

- Outflow filters — "don't take from here" was rejected in production control
  and stays rejected.
- Evicting on toggle-off. `0` keeps; only `2` clears.
- Choosing *where* cleared goods go. They go to the nearest other accepting
  pile with room, as any loose item does.
- Clearing a workshop's buffers, a blueprint's delivered materials, or a whole
  pile in one press. A whole pile is one `clear` per row it holds.
- Any change to capacity, filters' inflow semantics, or ceilings.

## Design

### The default

The stockpile branch of `place()` writes `0` to all eleven accept flags. That is
the whole of the sim change for this half. `createSim` places no stockpile, so
the first pile a new player builds accepts nothing until they open its panel —
and placing does not open it: `main.ts:417` queues the `place` command and
`hud.select` fires only on a click. This brushes CONCEPT's *nothing punishes
inattention*: loose logs stay on the ground, which plateaus rather than spirals,
but the player has to be told why, and told early. Three things do it: the
blueprint panel carries the filters from the moment the pile is placed (below),
the panel note says what an empty pile is waiting for, and `all` makes the
common answer one press.

Saves need nothing: the flags are in every building record already, and the
migrations ladder stamps `1` on piles that predate a good, which is the correct
value for a pile that existed before the good did.

**Default-off reaches every test that places a stockpile by command — eight
files — and the fixture recipes may be edited.** `tick.test.ts`,
`settlers.test.ts` (two golden runs), `economy/bread.test.ts`,
`economy/cloth.test.ts`, `economy/limits.test.ts`, `economy/workshop.test.ts`,
`threats/encounter.test.ts` and `save/fixtures/recipe.ts` all do. Every pile
they place now refuses everything, and the fixture *shape* tests fail outright
rather than drift: a v1 replay ends with zero tasks, so `shapeOf` has nothing
to compare. The rule for all of them but the golden: **open the pile with one
`setAllFilters { on: true }` on the tick after placement.** That is
behaviourally invisible — an accept-all pile is exactly what each run had
before — so every pinned hash holds and v7's "rock filter off" still means what
its prose says. The recipes are scripts, not committed bytes; they are as
editable as any test, and this is the edit. `test-sim.ts` builds its stockpile
as a literal and is unaffected.

**`tick.test.ts` is the one whose assertions change, and its hash moves once.**
It places its pile at tick 5 and toggles planks *off* at 1260 so the mill's two
planks stay in its buffer; under default-off that toggle turns planks *on*,
inverting the buffer assertion. The rewrite turns **logs and bread** on right
after placement, keeps planks refused, and adds a `clearFilter` on a good the
pile holds so the third value is pinned; the exact ticks are the implementer's.
Bread is load-bearing, not decoration: with logs the only accepted good, the
wall drag at 1420 and the mill drain the pile through `sourceForSite`, storage
is empty at tick 1500, and the file's "goods ended up in storage rather than
scattered on the ground" assertion fails. Bread is the good the run produces
that is still in the pile at 1500. Pinned is all the `clearFilter` is: the
script has one stockpile, and `nearestStore` skips the holder, so it can never
generate a haul. The behaviour — haul-out, the nowhere-to-go stall, toggle-on
stopping it — is only observable with two piles, which the golden does not
have.

### The clear state in the sim

One new command, `clearFilter { building, type }`, refused for anything but an
active stockpile and an unknown good, writes `2` to the good's flag. Nothing
else is written anywhere — but two comments stop being true and are rewritten
with the change: `Building`'s "filters, 0/1 … nothing re-homes them"
(`store.ts:377`) and the `toggleFilter` command's "what it already holds stays
put" (`commands.ts:106`). Both now describe `0`, not the flag.

`isLoose` becomes: on the ground; or in a workshop's output buffer; or
`Loc.Stored` in an **active** stockpile whose flag for `item.type` is `2`. The
state check is load-bearing: a blueprint's delivered logs are `Loc.Stored` in
it too, and without it a `2` on a half-built pile would have the tidy-up hauls
strip the site of its own materials. From there the existing machinery does the
rest, and each of its properties is inherited rather than designed:

- **Destination.** `nearestStore` picks the nearest active stockpile with
  `freeCapacity − reservedIncoming > 0` and skips `b.id === item.holder`, so a
  cleared plank never re-homes into its own pile and only ever lands in one
  that accepts planks.
- **Nowhere to go.** When `nearestStore` returns null — no other active pile
  accepts the good, *or* every one that does is full — the item stays where it
  is, unreserved, and is asked again next tick. Goods are **never** dropped on
  the ground to satisfy a clear. `tasks.ts` exports that verdict as
  `canRehome(sim, item)` (`nearestStore(sim, item) !== null`) so the panel's
  stuck note below reads the very predicate the haul uses; a note computed from
  the flags alone would fall silent in the full-but-accepting case, which is the
  one a player is most likely to be looking at.
- **Priority.** `HaulToStore` is last in `TASK_PRIORITY`, so a clear never
  takes a pool worker from construction, wall work or feeding a workshop.
- **Reservations.** An item a live task already owns — a `HaulToInput` pulling
  that very plank to the mill — fails `isFree` and is left to that task.
  Workshops and sites keep pulling from the pile through `sourceForSite`; a
  clearing pile drains faster for it.
- **Ending it.** `toggleFilter` on a `2` writes `1`: the good is accepted again
  and nothing further is generated. Hauls already made complete — they were
  legitimate moves to a pile that wanted the good. From `1` the toggle writes
  `0` as today, so the toggle never produces a `2`; only `clearFilter` does, and
  a player who wants plain `off` after a clear goes through `on`.
- **Finishing.** Nothing happens. When the pile holds none of the good the
  clause in `isLoose` matches nothing and the flag sits at `2` unread until a
  haul lands or the player toggles. No revert, no condition to get wrong.

### The panel

`StoredGood` (`src/sim/know/index.ts:309`) gains `clearing: boolean`, true when
the flag is `2`, and `stuck: boolean` (below); `accepted` stays `=== 1`, so a clearing good's toggle reads
`off`. `filterRow` grows a third element in its cluster: `count  toggle  clear`.

- `clear` is the secondary recipe in 11px caps, rendered whenever `count > 0`
  and the good is not already clearing — from `on` or `off` alike, so "empty
  this pile of planks" is one press whatever the toggle says. It sends
  `clearFilter`.
- While clearing and `count > 0`, the button reads `clearing`, disabled and
  `ink-faint` — the steppers' end-of-range treatment, quiet rather than gone.
  When `count` reaches 0 the button is not rendered: a `2` with nothing stored
  is indistinguishable from `off` in the panel, which is the point.
- `stuck` is `clearing && count > 0 && !canRehome(...)` for any one of the
  pile's items of that good — they share a holder, so they share the answer.
- **Both new flags join the panel's rebuild signature** (`hud.ts:836`, today
  `${count}${accepted ? "+" : "-"}` per good). Without that, pressing `clear`
  on an `off` good changes neither count nor `accepted`, the panel never
  repaints, the button keeps reading `clear` and the stuck note never appears.
- The cluster still never wraps. Count, toggle and `clear` come to roughly
  130px; the panel is 246px with 14px side padding and a 10px row gap, so the
  label keeps about 78px and flexes as it does today. `clearing` is wider than
  `clear`, which the label absorbs.
- Keyboard focus carries across the rebuild by `aria-label` (`hud.ts:1129`),
  so `clear` and the disabled `clearing` share one — `clear planks` — distinct
  from the toggle's `accept planks`; when the match comes back disabled, the
  existing fallback moves focus to the neighbouring control in the `.ctl`
  cluster.

**On a blueprint or a pile under construction** (`hud.ts:934–955`, which today
show only delivered / waiting / Cancel), the panel adds the toggle rows beneath
its existing rows — **toggles only**: no counts and no `clear`, because what
the site holds is its own construction materials, not stock — and, since a site
has no Stored row to carry them, an **`Accepts`** control row holding the
`all`/`none` pair. `Stored` would be a lie about construction materials, and
the pair needs a label that says what it governs. `toggleFilter` and `setAllFilters` accept a stockpile in any state, kind
being the only check, as `toggleFilter` already does; `clearFilter` keeps
refusing a non-active pile, and the state gate in `isLoose` is the second lock
on the same door. The "accepts nothing yet" note applies to a blueprint too.

**Two notes, in the consequence voice.** `FILTER_NOTE` stays the panel's first
note. A second, italic faint, appears in exactly one of two states, which are
mutually exclusive by construction:

- some good is `stuck`: `clearing planks — no other pile will take them`,
  naming the first stuck good in `GOOD_LIST` order when more than one is;
- no flag is `1` and no good is `clearing` *with a count above zero*:
  `accepts nothing yet — turn on what this pile should take`. "Clearing" is
  defined that way here on purpose — a finished `2` is indistinguishable from
  `off` everywhere else in the panel, and it must not cost a pile its note.

The styleguide already allows a second note when it is a consequence rather
than a status; both of these are.

### The `all` / `none` pair

One command, `setAllFilters { building, on: boolean }`; `on: true` writes `1` to
every flag, `on: false` writes `0` to every flag that is `1` and leaves `2`s
alone — "refuse everything" should not silently cancel a clear the player is
watching. Two secondary buttons, `all` and `none`: on a finished pile they ride
the Stored row's cluster, so the row reads `Stored  3 / 32  all  none`; on a
site, which has no Stored row, they get a control row of their own labelled
`Accepts` (see *The panel*). Eleven goods make a general-purpose pile eleven
presses under default-off; this is the antidote, and it is one command.

## Alternatives considered

- **A one-shot `empty` command** that creates hauls for what is stored right
  now. No state, but `addTask` reserves destination room, so it makes only as
  many hauls as other piles can take at that instant, never retries, and with
  the filter still on the good flows straight back. Rejected.
- **Toggling off evicts.** No new control, but it reverses production control's
  grandfathering wholesale and makes every "stop taking planks" cost pool
  labour the player did not ask for. Rejected; the user asked for an option.
- **Eleven `clearX` fields.** A migration rung, and a state that can disagree
  with `acceptX` (`accept 1, clear 1`?). The flag already had a spare value and
  clearing is exclusive with accepting by definition. Rejected.
- **Dropping a cleared good on the ground when nowhere will take it.** Turns a
  tidy-up into litter, and a loose item on the ground is exactly what the
  tidy-up hauls exist to pick up — it would be carried straight back to the
  only pile that would have it, which is the one it left. Rejected.
- **Reverting a finished clear to `0` by itself.** A cleaner state space on
  paper, but one more sim condition, and it would let a haul that was already in
  flight at press time land and sit — grandfathered by the very state the player
  had just overridden. The panel shows a finished `2` as `off` anyway. Rejected.
- **Defaulting new piles to the nearest existing pile's filters.** Clever, and
  invisible: a player would not know why their new pile refuses rock. A flat
  default plus `all` is legible. Rejected.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread from the sim outward: the third flag
  value in `commands.ts` and the `isLoose` clause in `tasks.ts` decide what
  `know/index.ts` exposes, which decides what `hud.ts` renders — nothing here
  splits into streams that don't read each other's output. Ten files, but the
  golden-script rewrite and the styleguide's control-row amendment are each a
  consequence of the same decision, not separate work.
- Opus rather than Sonnet because two `(diverges)` decisions have to be
  interpreted, not transcribed: the default flip drives a rewrite of the
  scripted log around what it can still assert, and the `2` state needs its
  state gate placed where a blueprint's materials are safe.
- Not ultracode: nothing here is a one-way door. An older build reads a `2` as
  "not on" through `=== 1`, and walking the state back is one migration rung
  mapping `2 → 0`.

## Amendments

- 2026-09-14 — Three build findings folded back, all spec defects the
  implementer resolved as now written: default-off reaches eight test files and
  the fixture recipes, not `tick.test.ts` alone, and every scripted pile but the
  golden's is opened with a `setAllFilters` the tick after placement so its
  pinned hash holds; the golden rewrite must accept bread as well as logs, or
  the pile is drained empty by tick 1500 and the storage assertion fails; and a
  site panel has no Stored row, so its `all`/`none` pair lives in an `Accepts`
  control row.
