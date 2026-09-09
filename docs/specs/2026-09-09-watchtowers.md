# Watchtowers: precision is buildable

Step 4b, cashing the boundary the monsters step recorded in five places:
**towers narrow the fuzz and the buckets, nothing else changes.** A
Watchtower is a slot-manned building that produces no goods — its whole
output is knowledge. While its watcher is inside, every monster whose
lair sits within `WATCH_RANGE` is *watched*: its rhythm estimate drops
the seeded error and buckets in tenths instead of fifths, and everything
downstream — the monster inspector's bar, the ribbon's threat meter and
caption — sharpens by itself. No new store fields; `SAVE_VERSION` 9
with an identity rung, purely so older builds refuse a tower save
politely instead of crashing on an unknown building kind.

## Outcome

**What you get:**

- A buildable answer to "when, exactly?": staff a Watchtower and every
  den within 24 tiles reads in exact tenths instead of fuzzy fifths —
  inspector bar, ribbon meter and verbal captions all sharpen, still
  in words and segments, never digits.
- Tower placement as map-reading: towers cover dens, not ground, so
  siting one is choosing which monsters to understand.
- The price is people, continuously: coverage exists only while the
  watcher stands inside, and unstaffing blurs the picture back the
  same frame.
- Nothing else moves: no alarms, no flee or notice changes; the save
  format gains only an identity version rung, there so an older build
  refuses a tower save politely instead of crashing on it.

**How to verify:**

- Build a Watchtower (4 planks) near dens and staff it: each covered
  monster's inspector shows a ten-segment bar and "a watcher knows its
  hours"; the tower panel reads "watching N dens"; a den at 25 tiles
  keeps its five coarse segments.
- Unstaff the tower: every covered monster returns to fifths at once.
- Activate the tower tool: a sage boundary square at Chebyshev 24
  appears around the ghost and around every standing tower; select a
  tower and only its own shows; deselect, and it is gone.
- Load a pre-tower save: it plays identically (the v9 rung is an
  identity; fixtures v1–v8 keep loading with no pinned hash moving).
  Save with a tower standing and reload: identical behaviour. Tests
  and lint pass; the browser console is clean.

## Key decisions

- **The Watchtower def** (extends `BUILDING_DEFS`).
  `BuildingKind.Watchtower` appends (= 7). 1×1 — the first 1×1
  footprint, which the def table and `canPlace` already support — cost
  4 planks, `hasSlot: true`, `recipe: null`, no beds. It is the first
  slot building with no recipe: `stepWorkshops` skips it (`recipeOf`
  is null), staffing and unstaffing work unchanged, and the labour
  meter counts the watcher as a slot like any other — a pair of hands
  spent on information, which is CONCEPT's "information is
  infrastructure" made literal.
- **Coverage is lair-anchored: den within `WATCH_RANGE` (24, Chebyshev)
  of the tower** (new — one predicate). A schedule is a property of the
  den — watching a monster's rounds is watching where it lives — so a
  prowler wandering past the tower changes nothing, and placement
  becomes the question the game wants asked: *which dens do I want to
  understand?* At `LAIR_SPACING` 10, one tower reads the three or four
  dens around one expansion front; several fronts cost several
  watchers.
- **Manned or nothing** (reuses the slot rules). Coverage requires the
  watcher *inside* — the same gate production uses (`worker` set,
  `slot` matching, `inside`) — so an unstaffed or walking watcher
  sharpens nothing, and unstaffing blurs the picture back to fifths
  the same frame. No partial effect, no memory: knowledge is rented
  with hands, never banked. Two consequences of that gate, stated as
  accepted texture rather than left for a playtest to report as bugs:
  the watcher takes meals like any slot worker, so coverage **pauses
  for lunch** — the picture coarsens for the walk and sharpens on
  return, the worker row the tell — and nothing requires a tower to
  stand inside the walls, so a forward watcher commutes to bread
  through the wilds every game-day: chosen risk, priced exactly as
  CONCEPT prices it.
- **The sharpening: error to zero, buckets five to ten** (extends
  `rhythm()` — the one function the boundary named). For a watched
  monster, `rhythm()` drops the per-monster seeded error and returns
  `WATCH_BUCKETS` (10) instead of `THREAT_BUCKETS` (5); `Rhythm` gains
  a `watched: boolean` so the panel keys its wording off a fact rather
  than a bucket-count comparison. `threat()` inherits sharpness
  through `rhythm()` untouched; the verbal captions keep their exact
  bands and vocabulary — **words, never digits**, per the styleguide's
  no-number law: the tower buys resolution, not arithmetic. The ribbon
  meter renders `buckets` from data and needs nothing; the monster
  inspector needs **two named edits**: its rebuild signature gains
  `buckets` and `watched` (today it omits both, so a staff/unstaff
  flip whose bucket value happens to coincide would redraw nothing —
  a stale bar defeating "returns to fifths the same frame"), and its
  hardcoded hours note keys off `watched`. The homeward branch is
  untouched: `GoingHome` has no clock for anyone, so it keeps its
  fixed five-bucket shape, with `watched` still reported honestly so
  the note stays true. The slim ribbon absorbs the ~55px wider bar
  (HUD-refit arithmetic).
- **Coverage is readable, in the existing grammar** (extends). The
  tower's range draws as a **keylined sage square outline at Chebyshev
  `WATCH_RANGE`** — the same shape the predicate tests, so the picture
  never denies knowledge the player has (a circle of radius 24 would
  exclude covered diagonal dens); outline only, no interior wash (a
  49-tile-wide fill would tint the world, and the world is the hero).
  Scope, pinned to the enclosure precedent of showing the whole layer
  while its tool is held: with the tower tool active, **every standing
  tower's boundary shows plus the ghost's**, so siting a new tower is
  done against existing coverage; a selected tower shows its own.
  The tower's panel is the generic building panel minus the recipe
  rows, plus one note in the house voice, **keyed off the worker
  state, never `staffed`, so the panel cannot lie**: "watching 3 dens"
  only while the watcher is inside; "3 dens in reach — the watcher is
  away" while they are walking or eating; "3 dens in reach — no
  watcher" when unstaffed; "the watcher sees no dens from here" when
  nothing is in range. `Inspection` gains `watching: number` (−1 for
  non-towers). A watched monster's inspector shows the ten-segment bar
  and its note changes from "its hours are read off the map, never
  exactly" to **"a watcher knows its hours"**.
- **Zero store changes — but `SAVE_VERSION` 9 anyway** (reuses the
  ladder). No new fields on any store type; the v9 rung is an
  **identity**, and coverage is derived per read like the population
  cap. The bump exists for the *older build*: without it, an old build
  loads a kind-7 save cleanly and then crashes on the first frame
  (`defOf` of an unknown kind is `undefined`), which is exactly the
  "loads garbage" ARCHITECTURE.md's versioning policy forbids — the
  future-version check is the one refusal mechanism already shipped,
  so a new kind rides it. Fixtures v1–v8 and their pinned hashes are
  untouched; a v9 fixture joins.

## Goals

- Precision is buildable and priced in the scarcest currency: a
  sharper picture costs a pair of hands, held for as long as the
  picture stays sharp.
- Tower placement is a map-reading decision — which dens matter to the
  next push — not a coverage checkbox.
- The base game's coarseness keeps meaning something: unwatched dens
  stay foggy fifths, exactly as shipped.

## Non-goals

- No alarms and no early warning — flee ranges, notice ranges and all
  sim behaviour are untouched, per the monsters spec's own non-goal
  list where alarms sit separately from towers. If an alarm mechanic
  ever comes, it is its own step.
- No line-of-sight, height bonuses, or terrain effects on coverage —
  range is one flat rule, readable at a glance.
- No watcher skill growth, no tower upgrades or tiers.
- No exact schedule display anywhere: tenths of a phase in words and
  segments is the ceiling, digits stay banned.
- No watcher figure drawn on the tower — a colonist `inside` is not
  rendered, by the existing rule; the panel's worker row is the tell.

## Design

### Def and panel

The def row per Key decisions; `canPlace`, blueprint/build states,
haul-to-site (4 planks via `costType`), staffing, eviction and the
labour meter all work by table. The inspector's workshop branch needs
one guard: a slot building with no recipe renders the worker row and
the staff/unstaff action but no chain chip, no input/output rows, no
produce-until row, and no stall note — the tower's note row is the
watching count instead. `Inspection.watching`: −1 unless the building
is a staffed-or-not Watchtower; counts dens in range regardless of
staffing, so an unstaffed tower's panel can honestly say what it
*would* watch ("3 dens in reach — no watcher") while `rhythm()`
sharpens only when manned. The build rail's Build section gains the
tower's button — a hand-drawn entry in the existing `ICONS` set, cost
caption off the def — filling the grid's empty eighth cell, so the
rail's height does not move.

### The knowledge seam

`tuning.ts` gains `WATCH_RANGE = 24` and `WATCH_BUCKETS = 10`.
`sim/know` gains the predicate (a monster is watched when any Active
Watchtower with its watcher inside has the monster's lair within
`WATCH_RANGE`, Chebyshev, of the tower tile) and `rhythm()` applies
it: error 0, buckets `WATCH_BUCKETS`, `watched: true`. `threat()`
and `when()` are untouched — they already consume `rhythm()`'s
buckets. Nothing new is exported that names a truth field; the
boundary rule holds: `render/` and `ui/` read only `know/`.

### Rendering

The tower bakes like any building — a tall 1×1, timber, per the
existing blueprint/under-construction/active grammar. The range
boundary is assembled like the enclosure boundary: screen-space ~2px
sage line on a `ground` keyline at 0.5, traced along the Chebyshev-24
boundary square around the tower tile, shown only while the tower
tool is active (all towers plus the ghost) or a tower is selected
(its own) — never permanently. **Both new recipes land in
`docs/STYLEGUIDE.md` with this change** — the guide currently pins
the meters at a fixed five segments, and the guide and the game never
disagree: the watched-meter tenths and the range-boundary overlay
each get their paragraph.

### Verification

Place a tower near dens and staff it: the covered monsters' inspector
bars go ten segments with "a watcher knows its hours", the ribbon
meter sharpens when its tracked monster's den is covered, and the
tower panel counts its dens. Unstaff: everything returns to fifths
the same frame. A den at 25 tiles stays coarse (the range edge is
exact). Save and reload with a tower standing: identical behaviour,
fixtures v1–v8 keep loading, no hash re-record beyond the golden
script's own extension if one is added. Browser pass per
`src/ui/CLAUDE.md`; know tests extend the existing fuzz suite
(watched = exact and finer, unwatched = unchanged, boundary at 24/25,
unstaffed = coarse).

## Alternatives considered

- **Fold in early warning** (larger flee trigger on covered ground) —
  revisits the recorded "nothing else changes" boundary, adds sim
  behaviour to a knowledge feature, and alarms are already a separate
  line in the monsters spec's non-goals. Rejected; an alarm step can
  exist later without touching this one.
- **Position-based coverage** (monster currently in range) — precision
  would flicker as monsters wander, and it answers the wrong question:
  schedules belong to dens, not to where the monster happens to stand.
  Rejected.
- **Tower as a workshop with a recipe** ("produces" watch-reports) —
  knowledge is not an item; a null recipe plus one predicate is
  smaller than a phantom good. Rejected.
- **Banked knowledge** (a once-watched den stays sharp) — breaks
  "manned or nothing" and quietly deletes the running labour price
  that makes information infrastructure. Rejected.

## Implementation strategy

*Not part of the design — a starting point for whoever builds this.*

- **Single agent, Opus 5.** One thread: the def row, the knowledge
  predicate and `rhythm()` change, the v9 identity rung with its
  fixture, the panel and inspector edits, the range-boundary overlay
  and the styleguide paragraphs all lean on each other; nothing
  splits. Opus over Sonnet because the overlay and the inspector
  interplay want the styleguide's grammar interpreted, not
  transcribed.
- Natural order: def + rail button + v9 rung and fixture first, then
  the knowledge seam with its unit tests (watched/unwatched, the 24/25
  boundary, unstaffed, homeward), then panels and the inspector's two
  named edits, then the overlay + styleguide, then the browser pass.
