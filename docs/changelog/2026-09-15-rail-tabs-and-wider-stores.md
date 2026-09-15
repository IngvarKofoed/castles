# The rail shows one section at a time, and the left column fits again

Orders / Build / Walls are now a **tab strip** with exactly one section open,
opening on Build every session. The rail is therefore **one section tall** — a
closed section costs nothing however long it grows. Build's tools sit three to a
row in a 145px rail and Stores' goods two to a row in a 220px panel, so every
tool of the open section is on screen at 1280×720 with nothing scrolling.
Implements `docs/specs/2026-09-15-rail-sections-and-fit.md`.

## Detail

**The thing that was broken was visibility, not tidiness.** At 1280×720 the rail
got 211px of a column Stores had already taken 423px of, and 57px of that was
chrome outside the scroller — so of fifteen build tools, two were on screen and
the Hive was nowhere near. A player who built one could not see it.

**It is a real tablist, and `aria-expanded` is rejected rather than merely not
used.** `role="tablist"` / `tab` / `tabpanel`, a roving tabindex, Left / Right
with automatic activation and wrapping. Disclosure semantics would announce three
independent collapsibles where the player has one of three, and would give a
screen-reader user no signal that choosing one closes the others. Three
independently collapsible heads were rejected at design time for the same reason
they do not bound anything: all three open is today's rail.

**`.rail-grid[hidden] { display: none }` is load-bearing, not tidying.**
`[hidden]` is a user-agent rule and `.rail-grid { display: grid }` is an author
rule, which wins on origin whatever the specificity — without the explicit rule
the closed sections stay on screen. With it, the closed buttons leave the tab
order for free, which is the whole of "Tab never enters a closed section".

**The open section lives on `Hud` and is never persisted.** It is view state, so
it belongs in neither the save nor the command log; and nothing in the HUD
persists today — there is no `localStorage` anywhere in `src/ui/` or `src/app/`,
and the codebase's first storage read should not arrive as a side effect of a
layout fix. Every session opens on **Build**, the section that grows.

**A tool stays active while its section is closed, and the tab owning it carries
a 4px gold dot.** That is the rail's *second* gold element, and deliberately so:
the "a tab is never gold" rule is about which tab is *selected*, a view, whereas
the dot points at the tool being held, which is intent. Verified: Hive held,
Walls open, the caption strip still reading `Hive / 4 logs` in gold and a click
on the map still placing one. Escape's ladder is untouched — a tab is not an
in-flight action and earns no rung, so Escape clears the tool and leaves the open
tab where it was.

**The tab cells are content-sized (`flex: 1 1 auto`), not equal thirds, and that
was measured rather than chosen.** `ORDERS` in the styleguide's 10px caps needs
51px in the **fallback** stack against the 48px an even split of 145px gives — so
equal tabs spill their label on every load before Barlow arrives (`display=swap`)
and permanently offline. Content-sized, the three fit in every stack measured;
the widest, Verdana, wants 131px of the 145px available. The type is the
styleguide's section head unchanged, which is what this preserves.

**Stores' 220px is forced, not chosen, and it breaks the Labour mirror that
`2026-09-08-stores-panel-and-icon-rail` set** — Stores and Labour were the two
bottom corners at one width, and are no longer. `Clothes 123` needs a half-cell
wider than a narrow panel gives, in the fallback font. Taken deliberately: the
mirror is a visual rhyme, and being able to see the buildings is not.

**Three rejections that should stay rejected**, all now recorded in
`docs/STYLEGUIDE.md` rather than offered there as future repairs: truncating good
names (`Cloth` and `Clothes` are both goods, and an ellipsis makes their rows
identical); collapsible Stores groups, which put counts a player reads constantly
behind a click; and layout alone with no sections, which buys ~213px and still
leaves the rail ~110px short at 720. The `.leftcol` and `buildRail` comments that
advertised the first two as unbuilt repairs are gone.

**Measured at exactly 1280×720**, a fresh colony on seed 20260901: rail
62..302 (240px, Build open, fifteen tools in five rows, no scrollbar), Stores
395..708 (313px, thirteen goods in seven rows), **81px of slack** between them —
room for two more rows of buildings before the rail scrolls again. Orders and
Walls each shrink the rail to 156px and Stores never moves. The tool cell is
48×33px, the width it already had (`(96−1)/2` and `(145−2)/3` are both ~47.6px),
so the button, its 2px pressed left edge and the icon are untouched. No Stores
row wraps and no count collides with its name at three digits, checked **with the
web font blocked** (7px of clearance on the longest row). Hovering a tool leaves
the rail at 240px. Console clean, 0 errors and 0 warnings.

**Gaps, stated rather than implied.** None of this is unit-tested: `src/ui/` has
no DOM test, so the tablist, the roving tabindex, the `hidden` panels and the
gold dot rest on the browser pass alone — the existing `hud.test.ts` covers only
the pure functions, and nothing in this change is one. The strip answers Left and
Right but **not Home / End**, which the ARIA pattern lists as optional and the
spec did not ask for. The fallback-font measurements are Chromium's on macOS
plus a Verdana probe standing in for a wide stack; no other platform's fonts were
loaded. And the durability claim — room for one more row — is the honest bound
for **Build**: Orders and Walls have four tools each and cost the rail nothing
while closed, which is the property no re-columning could have promised.
