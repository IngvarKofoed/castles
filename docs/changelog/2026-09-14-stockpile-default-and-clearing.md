# A new stockpile accepts nothing, and a good can be cleared out of one

A pile is now placed refusing every good and is configured from its **blueprint**
panel, reversing the accept-all default step 2 shipped. Every good's row gains
`clear` — a third value (`2`) of the accept flag that refuses the good *and*
hands what the pile holds to the ordinary tidy-up hauls, which carry it to the
nearest other pile and never drop it. `all` / `none` set every filter in one
press. No `SAVE_VERSION` bump: saved piles keep exactly the flags they had.
Implements `docs/specs/2026-09-14-stockpiles-default-off-and-clear.md`.

## Detail

**The clear is the machinery that already existed, plus one clause.** `isLoose`
(`labour/tasks.ts`) now also calls a good loose when an **active** stockpile's
flag for it is `2`; `generateHaulToStore`, `nearestStore` — which already skips
the item's own holder — and `HaulToStore`'s last place in `TASK_PRIORITY` do
everything else, including retrying while every other pile is full. No new task
kind, no new colonist behaviour, and clearing never outranks real work. The
`Active` check is load-bearing twice over: a blueprint's delivered logs are
`Loc.Stored` in it too, so `clearFilter` refuses a non-active pile *and*
`isLoose` refuses the flag on one — two locks, pinned separately, because either
alone would let a `2` strip a building site of its own materials.

**Four alternatives are rejected and should not come back.** A one-shot `empty`
command (it would make only as many hauls as other piles could take at that
instant, then stop); toggling-off evicting (it reverses production control's
grandfathering wholesale — `0` still means *refuse and keep*); eleven `clearX`
fields (a migration rung, and a state that can contradict `acceptX`); and
dropping a cleared good on the ground when nowhere will take it (the tidy-up
hauls would carry it straight back to the only pile that wanted it). A finished
clear also **does not revert itself** — the flag sits at `2` with the panel
showing it as plain `off`, so a haul that was in flight at press time is pushed
back out next tick instead of landing and sitting grandfathered.

**The stuck note asks the haul's own predicate, not the flags.** `canRehome`
(exported from `tasks.ts`) is `nearestStore(...) !== null`, so
`clearing planks — no other pile will take them` also appears when every other
pile *accepts* planks and is full — the case a note computed from filters alone
would have been silent about.

**The golden hash moved once, `cb721faa` → `3216d1b3`, and for behaviour with no
shape change at all** — the reverse of the last two moves. `tick.test.ts` now
turns logs and bread on the tick after placing its pile, never turns planks on,
and presses `clear` on ten stored logs at 1210. **Every other scripted run and
every fixture recipe holds its old number**, because each opens its pile with
one `setAllFilters` on the tick *after* placement, while it is still a blueprint
and nothing reads its filters. That is also why touching the frozen recipes in
`save/fixtures/recipe.ts` is not an edit to what any of them means: each was
written when a new pile accepted everything, and v7's rock toggle would
otherwise have meant the opposite of its own prose.

**`.mini` was already taken.** The menu's small buttons own that class, with
`flex: 1` and a rust `armed` state; the panel's `clear` / `all` / `none` are
`.word` instead. Sharing it would have stretched them across the cluster and
lent a delete-confirm colour to a filter. `docs/STYLEGUIDE.md` records the word
button, the three-control cluster (125px measured, label 111px, no wrap at
246px) and the stockpile's second note row.

**Gaps, stated rather than implied.** A site's `all` / `none` row is labelled
`Accepts` — the spec named no label, and `Stored` would have been a lie about
construction materials. The panel itself has no DOM test, as with the rest of
`src/ui/`; `stockNote` is unit-tested and the rows were driven in the browser.
And a first colony whose pile accepts nothing leaves its logs on the ground
until the player turns them on — that is the default working, and it plateaus
rather than spiralling, but it is why the note and `all` exist.

Verified: 451 tests (16 new across the command rules, the two-pile haul, the
nowhere-to-go stall, the blueprint lock, the default and the note), lint, `tsc`,
production build. In the browser (seed 20260901, 1280×800): a freshly placed
pile's blueprint panel showing `Accepts ALL NONE` over eleven `OFF` toggles with
no counts and no `CLEAR`, plus *accepts nothing yet*; logs turned `ON` from that
blueprint at `Logs delivered 1 / 2` and still `ON` when the pile went active; a
pile opened to logs taking all thirteen loose ones within seconds while a closed
one beside it held none; `ALL` filling every toggle in one press; `CLEAR` on the
log row flipping the toggle to `OFF` and the button to a disabled `CLEARING`
with *clearing logs — no other pile will take them*;
`NONE` then setting every other row off and leaving the clearing row alone;
opening logs at a second pile and watching all eleven move across with Stores
still reading `Log 11` and none on the ground; the button gone once the count
reached 0; keyboard focus surviving the rebuild on the toggle and falling back
to the live neighbour when `clear` came back disabled. The committed
**pre-change `v10.castles`** imported through the menu loaded with all eleven
filters still `ON` and `CLEAR` on exactly the four rows holding something.
Console clean (0 errors, 0 warnings).
