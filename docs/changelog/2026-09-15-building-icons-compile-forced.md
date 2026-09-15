# Every building has a rail icon, and a building without one no longer compiles

The Hive, Flowers and Meadery have rail icons — a banded skep, blooms on stems,
a cask on its side — where the drink chain shipped three blank clickable cells
that read as three missing buildings. The building half of `ICONS` is now
`BUILDING_ICONS: Record<BuildingKindValue, string>` read with no `??` fallback,
so the *next* building without one is a compile error. Completes
`2026-09-14-hives-and-mead`.

## Detail

**The bug was a missing forcing function, not a missed table row.** `ICONS` was
`Record<string, string>` keyed by `toolKey`'s loose string, and `toolButton`
rendered `ICONS[key] ?? ""` — so a building with no entry produced an empty
button rather than any kind of error. It was **the one per-kind table in this
codebase with nothing behind it**: `BUILDING_DEFS`, `GOODS`, `GOOD_VAR`,
`GOOD_GROUP` and `GOOD_HEX` are all already total `Record`s over their key type,
which is why every other append ritual fails loudly when a step is skipped.
Three blank buttons therefore passed `tsc`, a production build and two reviews.

**The split is along that line and no other.** `BUILDING_ICONS` is keyed by
`BuildingKindValue` and `toolButton` reads it directly on `tool.kind === "build"`
with no fallback; the orders and walls tools keep the loose string map, because
that set changes about once a year while the buildings change once a chain.
Proved rather than assumed: deleting the `Meadery` row makes `tsc` fail with
`Property '14' is missing in type … but required in type
'Record<BuildingKindValue, string>'`.

**The three drawings are each aimed away from the icon they could be mistaken
for**, which is the real constraint at 22px and the reason the spec named them:
the Hive is a *banded* skep with an arched entrance at its foot, not the Oven's
single dome with a rectangular door and a chimney curl; Flowers is blooms on
stems over a ground line, and circles-on-stems appear nowhere else in the set,
so it can be neither the Farm's furrows nor the Pasture's fence; the Meadery is a
cask *lying down* with two hoops and a spigot, where the Dairy's churn stands up.
All three in the table's idiom — 22×18 viewBox, `fill="none"`,
`stroke="currentColor"`, 1.4.

**No styleguide change, deliberately.** Nothing in `docs/STYLEGUIDE.md` became
false: it prescribes that the rail is icon-only and never enumerated the icons.
The rule this change adds is a typing rule, and its home is the compile error and
this entry, not the visual language.

Verified at 1280×720 on seed 20260901: the Build tab's fifteen tools with **no
blank cell**, the rail still not scrolling, and the three new marks legible at
22px and side by side with the Oven, Dairy and Farm they had to be told apart
from. All three placed from the rail and re-selected as `Hive [Blueprint]`,
`Flowers [Blueprint]` and `Meadery [Blueprint]`; the hive's reach rectangle drawn
around the ghost while the Hive tool is held, and around the standing hive —
with no ghost rectangle — while the Flowers tool is held. Console clean. 479
tests, lint, `tsc`, production build.

**What this does not cover.**

- **The icons are not tested, and cannot usefully be**: `src/ui/` has no DOM
  test, and a golden-image test for line marks would fail on every font or
  renderer change. What replaced the review that missed them is the type, not a
  test — a blank cell is now unreachable, but an icon that is merely *bad* is
  still only caught by looking.
- **`toolKey` still returns a lower-cased building name**, so `toolButtons`,
  `toolCaptions` and the caption strip are unchanged and still keyed by string.
  Only the icon lookup moved; unifying those on the kind would be a different
  change with no bug behind it.
- The **orders and walls map keeps its `?? ""`**, so a future wall material with
  no icon can still ship blank. Accepted: that set has grown twice in the life of
  the project, against a building chain roughly every week.
