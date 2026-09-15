# The rail shows one section at a time, and fits

Twenty-three tools no longer fit the left column: at 1280×720 the rail gets
about 211px of a column Stores has already taken 423px of, and 57px of that is
chrome outside the scroller (12px of rail padding and the 45px caption strip).
The 156px left over holds the Orders head, both its rows, the Build head and
**one** row of buildings — so of the fifteen build tools, two are on screen and
the Hive is nowhere near. A player who builds one cannot see it. This makes the three section heads a **tab
strip** with exactly one section open, so the rail's height stops depending on
how many buildings exist; and it buys back the height that makes the open
section fit at the minimum supported viewport, by putting Build's tools in
three columns and Stores' goods in two.

## Outcome

**What you get:**

- The rail shows one section at a time — Orders, Build or Walls, chosen from a
  tab strip — opening on Build, so the first thing you see is buildings.
- Every tool in the open section is visible at 1280×720 without scrolling,
  with room for about one more row of buildings before that stops being true —
  and a closed section costs nothing however long it grows.
- Stores still shows every good and every count, in two columns.

**How to verify:**

- At exactly 1280×720, open the game: the Build tab is selected and all
  fifteen build tools are visible at once, with no scrollbar in the rail and
  Stores fully visible below it. Switch to Orders and to Walls: each shows its
  four tools, and the rail does not change height under the pointer.
- Pick the Hive, then switch to the Walls tab: the caption strip still names
  Hive, and clicking the map still places one. Press Escape: the tool clears
  and the open tab does not change.
- No Stores row wraps and no count collides with its name at the shipped
  width — check the longest, Clothes, with a three-digit count, **and check it
  with the web font blocked**, which is what every load shows before Barlow
  arrives and what an offline player sees always.
- Hold a tool from one section and switch to another: a gold dot marks the tab
  the held tool belongs to. Tab to the strip and press Left / Right: the
  selection moves between the three tabs, and Tab from there goes into the open
  section's tools and never into a closed one's.
- Reload the page: the rail opens on Build regardless of which tab was open.

## Key decisions

- **One section open, and the heads become a tab strip** (new). Three stacked
  heads cost ~77px of the exact height under contention, and "one at a time" is
  what a tab set *is* — so Orders / Build / Walls become one ~30px row of three
  tabs above the grid, rather than three disclosure headings. The rail is then
  **one section tall**: a closed section costs nothing however long it grows,
  which no layout change can promise. The open one still grows — with ~65px of
  slack at 720, Build has room for about one more row, so roughly three more
  buildings before the rail scrolls again. That is the honest bound; "forever"
  would apply only to Orders and Walls.
- **The open section is a field on `Hud`, not persisted, and never storage**
  (reuses). Beside `tool_` (`hud.ts:343`) and `selected` (`:349`). Nothing in
  the HUD persists today — there is no `localStorage` anywhere in `src/ui/` or
  `src/app/` — and this is view state, not game state: it belongs in neither the
  save nor the command log, and the codebase's first storage read should not
  arrive as a side effect of a layout fix. **Every session opens on Build**, the
  section that grows and the one a player reaches for most.
- **Build's grid goes to three columns; the rail goes 96px → 145px**
  (extends). Fifteen tools fall from eight rows to five, ~99px. 145px is what
  keeps the cell at its current width — `(96−1)/2 = 47.5px` today,
  `(145−2)/3 = 47.7px` after — so the tool button, its 2px pressed left edge
  and the icon are all untouched. 136px would have fitted three columns too,
  by shrinking every cell 3px. Orders and
  Walls have four tools each and become two rows of three plus one empty cell,
  which the styleguide's "an odd count leaves one empty cell" already covers.
- **Stores' good rows go to two columns, and Stores goes 150px → 220px**
  (diverges). Thirteen rows become seven, ~114px. The width is forced, not
  chosen, and twice over: a row is pip + name + count, so "Clothes 123" needs
  ~82px against the ~63px a half-cell gives at 150px — and it needs ~89px in
  the **fallback font**, because `index.html` loads Barlow with `display=swap`,
  so the non-condensed Arial stack renders during every load and permanently
  offline. 220px is sized for that case, not the condensed one. Truncating
  instead was rejected outright: `Cloth` and `Clothes` are both goods, and an
  ellipsis makes their rows identical. **This breaks the Labour mirror** that
  `2026-09-08-stores-panel-and-icon-rail` set — Stores and Labour were the two
  bottom corners at one width — and the left column's footprint over the map
  goes from 150px to 200px. Taken deliberately: the mirror is a visual rhyme,
  and being able to see the buildings is not.
- **A tool stays active while its section is closed** (reuses). Switching tabs
  never clears the tool; the caption strip already names whatever is held and
  sits outside the scroller (`hud.ts:753`, and the rule at `hud.css:349`), so
  the held tool is still readable with its button hidden. **The tab owning it
  carries a small gold dot**, so the player can also see *where* it is and get
  back to it — the only gold the rail grows here, and legitimately so: the
  "never gold" rule above is about which tab is *selected*, a view, whereas the
  dot points at the tool being held, which is intent. Escape's ladder (`hud.ts`, `escape()`) is
  untouched — a tab is not an in-flight action and earns no rung.
- **No save, no command, no sim change** (reuses). This is `src/ui/` and
  `docs/STYLEGUIDE.md` only: no `SAVE_VERSION`, no golden hash, nothing in
  `src/sim/`.

## Goals

- A building added by the next chain is visible without hunting for it.
- The rail's height stops growing with the number of tools.
- Every tool in the open section is visible at 1280×720 with no scrolling.

## Non-goals

- Hiding or collapsing Stores' counts — they are a glance, and the user
  rejected putting them behind a click.
- Moving Stores out of the left column, or changing the Labour panel.
- Search, filter, favourites, or keyboard shortcuts for tools.
- Changing which tools exist, their order, their icons, or their sections.
- Making the rail scroll-free at heights below 720; the styleguide's floor is
  the target, not every window.

## Design

### The tab strip

`buildRail` (`hud.ts:679`) keeps its three sections and its `railGrid` calls.
What changes is that the three `rail-label` spans become one `rail-tabs` row of
three buttons, and each grid is shown or hidden against the open section.

- **It is a real tablist, because it is called a tab strip.** The row takes
  `role="tablist"`, each button `role="tab"` with `aria-selected` and
  `aria-controls`, each grid `role="tabpanel"`; the strip owns a **roving
  tabindex** (the selected tab is `tabindex="0"`, the others `-1`) and Left /
  Right move between tabs. `aria-expanded` is the disclosure pattern and would
  be wrong here: it announces three independent collapsibles where the player
  has one of three, and gives a screen-reader user no signal that choosing one
  closes the others.
- The closed grids take the `hidden` attribute **and a rule to make it bite** —
  `.rail-grid[hidden] { display: none; }`. Without it the closed sections stay
  on screen: `[hidden]` is a user-agent rule and `.rail-grid { display: grid }`
  (`hud.css:284`) is an author rule, which wins on origin whatever the
  specificity. With it, the hidden buttons leave the tab order for free.
- **The tab row sits outside `.rail-scroll`**, a sibling of the scroller and
  the caption strip (`hud.ts:753`). Inside it, the tabs would scroll out of
  reach at exactly the heights this change exists for, and the ~87px chrome
  figure below would be wrong.
- The tab row is the styleguide's 10px caps section-head type, unchanged — the
  same words in the same face, laid across instead of down. The open tab reads
  `ink` on **`rgba(0, 0, 0, 0.25)`**, the neutral wash the styleguide already
  gives a two-state control ("On is `ink` on `rgba(0,0,0,0.25)`"); closed tabs
  read `ink-faint` on nothing. **Not the tool button's pressed fill**, which is
  `rgba(220, 162, 60, 0.13)` under gold text (`hud.css:400`) — that is gold, and
  the rail's one gold element is the caption strip naming the active tool. A
  tab is a view, not an intent, and its state is carried by ink weight and fill
  rather than by a colour.
- `buildRail` runs once at construction (`hud.ts:613`) and the rail is synced
  rather than rebuilt, so switching tabs is a class-and-attribute change on
  nodes that already exist. No node is created or destroyed after startup, and
  nothing about focus survival has to be arranged.

**All three sections are tabs**, including Orders and Walls at four tools each,
neither of which grows: a rail whose sections behave differently from one
another is harder to learn than one that does not, and Walls has grown once
already (timber, then stone).

### What fits, and the number to check

The rail's natural chrome — the part that is not tool rows — falls from ~134px
(three stacked heads at ~78px, the 45px caption strip, 12px of padding) to
~87px (a ~30px tab row in their place, the same caption, the same padding).
Only 57px of today's figure is *fixed*: the three heads live inside
`.rail-scroll` (`hud.ts:683, 693, 739`) and scroll away with the tools, which
is why they cost the player their visibility rather than the rail its height.
Build open in three columns is five rows at ~33px, so the rail wants **~253px**.
Stores at two columns wants **~313px**, leaving `646 − 313 − 12 = **321px**` at
1280×720 — comfortably more than the rail asks for, where today it gets 211px
against a 531px rail. The slack is ~65px, which is the number the durability
claim above is measured against.

Those figures are computed from the CSS rather than measured in a browser —
the spec phase cannot run one — but they are calibrated: the same model
reproduces the two figures that *were* measured (a 416px rail scroller at
twelve Build tools in `2026-09-11-sheep-and-clothes`, and 421px of Stores in
`2026-09-14-hives-and-mead`) to within 3px. **The Outcome's first verify bullet
is still the real check**, and if it fails the gap is small and the levers are
the tab row's padding and the Stores row's `padding: 1px 0`.

### Three columns, two columns

`.rail` goes to `145px` and `.rail-grid` to `repeat(3, minmax(0, 1fr))`
(`hud.css:262, 284`). `.stores` goes to `220px` and its good rows become a
two-column grid; the group heads stay full-width above their goods, which is
what keeps the five chains reading as chains rather than as a wall of
thirteen. `buildStores` (`hud.ts`) already walks `GROUP_ORDER` and emits an
`h5` per group then a row per good — the rows simply land in a grid container
per group instead of directly on the panel.

An odd good count leaves one empty cell in that group, exactly as an odd tool
count does in the rail. Wood, Stone and Drink have two goods each, Cloth three,
Food four: today that is one empty cell, in Cloth.

### The styleguide

`docs/STYLEGUIDE.md`'s **Build rail** entry (`:427–445`) is rewritten. Three
things in it stop being true and one becomes load-bearing:

- "a 10px caps section head, then that section's tools" becomes the tab strip.
- "two-column grid" becomes three for Build.
- The paragraph beginning "Two columns is what put all sixteen tools on screen
  at once" goes entirely: it states a value this change trades away, names a
  scroll-free floor that moved twice, and advertises two repairs, one of which
  is now built and the other of which is now rejected.
- The rule that **the rail may scroll while every other region may not**
  (`:12`) stays, but its number moves: it currently says the rail scrolls
  "below 768px of window height", and after this change the floor is 720.

The **Stores** entry (`:446`) takes the new width and the two-column rows, and
the sentence about mirroring Labour is corrected to say the mirror is broken
and why.

**Three comments in the code say things this change makes false**, and they are
in scope for it: `hud.css:221–228` (the `.leftcol` preamble, still advertising
"a three-column rail or collapsible Stores groups; neither is built" — one is
now built and the other is now rejected), `hud.ts:656–678` (`buildRail`'s doc,
"Each section is a two-column grid… Twenty no longer fit"), and `hud.ts:757–758`
(`railGrid`'s "two to a row… Build's twelve fill six rows exactly", already
stale at fifteen).

## Alternatives considered

- **Three disclosure headings, independently collapsible.** What "collapsible
  sections" first meant, and it does not bound anything: all three open is
  today's rail. One-at-a-time is the property that makes the height fixed, and
  once it is one-at-a-time a tab strip is the honest affordance and 47px
  cheaper.
- **Layout alone — three columns and two-column Stores, no sections.** Buys
  ~213px, and **still does not fit at 720**: the rail falls from 531px to about
  432px against the ~325px the column has once Stores is two-column, ~110px
  short. The rejection is stronger than it first looked, and the two layout
  changes are kept as the half of the answer that they are.
- **Collapsible Stores groups**, the code comment's own second candidate.
  Frees ~300px without touching the rail, and puts the counts a player reads
  constantly behind a click. Rejected by the user.
- **Moving Stores out of the left column** — to the bottom strip, or beside
  Labour. Frees the column entirely and is a HUD-layout change with no bound on
  its blast radius; the two corners were chosen deliberately.
- **A scroll affordance** (a fade at the cut edge) and nothing else. One CSS
  rule, tells the player there is more, and leaves them scrolling eight rows to
  reach a Meadery. Offered and declined.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** Two files and a doc — `src/ui/hud.ts`,
  `src/ui/hud.css`, `docs/STYLEGUIDE.md` — where the markup change, the CSS
  widths and the styleguide rewrite are three views of one decision. Nothing
  here splits into streams that do not read each other.
- Opus rather than Sonnet because two things have to be interpreted rather than
  transcribed: the tablist's roving tabindex against a rail that is synced and
  never rebuilt, and which of the styleguide's rail paragraph survives the
  change.
- Not ultracode: nothing leaves `src/ui/` and the styleguide — no save version,
  no command, no sim state, nothing persisted — so a `git revert` is the whole
  of the walk-back.

## Amendments

- 2026-09-15 — The open tab's fill is named as `rgba(0, 0, 0, 0.25)`, the
  styleguide's own two-state-control wash. The draft said the open tab reads
  `ink` "on the pressed fill" and, two sentences later, "not gold" — but the
  rail's only pressed fill is the tool button's gold `rgba(220, 162, 60, 0.13)`,
  so the two could not both be honoured. The build took "not gold" as binding
  and used a neutral wash at the same weight; the spec now says which wash.
