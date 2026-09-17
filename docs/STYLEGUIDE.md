# Castles — HUD style guide

*Last updated 2026-09-15. Distilled from the approved visual mock
(https://claude.ai/code/artifact/fa8e50e2-7a08-422e-890b-23e3f262711c — the
live, editable reference), the HUD refit canvas
(https://claude.ai/code/artifact/abc3851b-250b-48b1-8406-6871d5816c66 — the
Stores panel, the slim ribbon and the icon rail), and the HUD proven in
`mockups/mockup3d.html`. Every session doing UI work copies from here; nothing
visual gets invented per-session.*

**The minimum supported viewport is 1280×720.** Every region below fits at that
size without wrapping or scrolling, except the rail, which is allowed to scroll
inside itself below 720px of window height. Nothing is designed for narrower or
shorter than that.

## Tone

The game promises calm; the UI must keep it:

- Nothing flashes, bounces, or glows. No animation except what physically
  moves in the world.
- State changes are quiet text in panels — never toasts, badges, or sounds.
  ("Waiting for logs 0 / 2" is the house voice.)
- Each color means exactly one thing (below). No pure red anywhere, ever.
- **Danger is rust, and rust is not an alarm.** When threats arrived, the
  choice was a fourth color or a wider reading of an existing one; rust
  widened, from "slots & invalidity" to *the costly things* — a slot worker,
  a refused placement and an approaching troll are all the same statement:
  this will cost you. A fourth color would have been a fourth thing to learn,
  and alarm red is expressly banned. The meter moves; nothing shouts.
- Panels are moss glass: dark, translucent, hairline borders, 2px corners,
  blur behind. The world is the hero — panels hug the screen edges, the
  centre belongs to the game.
- At most one gold element per region: gold is scarce or it is nothing.

### Motion

"No animation except what physically moves in the world" is the licence above,
and everything that moves picks one of **four classes**. A fifth is a design
decision, not a detail — pick one of these or write the class down here first.

- **Sway** — baked geometry displaced *in place* by the shader: crop furrows,
  bloom heads, tree canopies, a building site's tarp. It leans well under a tile
  and never travels. Structure never sways; a wall or a roof that waved its top
  would be a lie about what wind does to a building — the tarp is the exception
  that proves it, because cloth lashed to a frame is the one thing on a site
  that *should* move.
- **Motes** — instanced specks on a closed path around an anchor: bees over a
  hive or a field, chimney smoke, the flock on its circuit. Position is a pure
  function of (anchor, index, time) — nothing is integrated and nothing is
  saved, so a load or a suspended tab cannot desynchronise them.
- **Fauna** — creatures that walk, bounded to a home radius: the Pasture's
  sheep, the deer of the wilds. They integrate, so they take the frame's
  clamped delta.
- **Work** — a colonist's tool swing. Closed form off (id, time) like a mote,
  but it belongs to a figure that does cross the map, and two rules separate it
  from the three above. It is **gated on sim state**: arms and a tool appear
  only while somebody is working a stint and go the moment it ends, so a busy
  colony and a stalled one look different from across the map with no panel
  open. And it is **not stilled by reduced motion** — it says work is
  happening, which is information rather than decoration, so it sits with
  walking and prowling on the game side of the line below. One motion for every
  job: the place says which job it is.

**The rule between the first three: only colonists and monsters cross the map.**
Everything ambient is tied to an anchor and stays near it — a sheep does not
leave its pasture, a deer does not cross the island, a flock does not migrate.
Reading the map is the player's entire threat toolkit, and translation across
open ground is what makes something read as *alive and consequential*; spend it
on decoration and the reading is gone.

**All of it runs on the world's clock, the water included.** At ×0 the world
holds completely still and at ×4 all of it runs fast. Pause is when a player
stops to read the map, so a paused world whose only motion is the motion that
does not matter is the boundedness rule standing on its head.

**`prefers-reduced-motion` stills everything ambient and nothing else.**
Colonists still walk and monsters still prowl: someone asking for less motion
is not asking to stop seeing the orc.

## Palette

| Token | Value | Means |
| --- | --- | --- |
| `ground` | `#14170f` | page/app background outside the game view |
| `panel` | `rgba(26, 31, 19, 0.88)` | panel fill (with `backdrop-filter: blur(3px)`) |
| `line` | `#3a4030` | panel borders |
| `line-soft` | `#2a3020` | internal dividers, meter troughs |
| `ink` | `#f2ecd9` | primary text, values |
| `ink-dim` | `#b0aa93` | row labels, secondary text |
| `ink-faint` | `#7e7a68` | section heads, notes, disabled |
| `gold` | `#dca23c` | **player intent**: active tool, primary action, designation, progress |
| `gold-deep` | `#8c6a26` | quiet gold (chain arrows) |
| `sage` | `#8fbf52` | **pool & validity**: pool workers, valid placement, idle count |
| `rust` | `#b8503a` | **the costly things**: slot workers, invalid placement, danger (text: `#e08a72`) |
| `timber` | `#a9713f` | log resource icon |
| `plank` | `#d0b078` | plank resource icon |
| `rock` | `#8a9096` | rock resource icon (quarried rubble: cool, raw) |
| `block` | `#b3ab97` | block resource icon (cut stone: warmer, paler) |
| `grain` | `#a89b3e` | grain resource icon (straw: olive, so it is not the plank's tan) |
| `flour` | `#eae3cd` | flour resource icon (sacking: the palest pip in Stores) |
| `bread` | `#96552b` | bread resource icon (crust: **darker and redder than `timber`**, so a loaf pip and a log pip are not the same brown) |
| `wool` | `#ddd0b0` | wool resource icon (raw fleece: cream, warmer and darker than `flour`'s sacking) |
| `cloth` | `#7e93a3` | cloth resource icon (a woven bolt: the **only blue pip in Stores**, so a bolt is never a plank) |
| `clothes` | `#4d6d8e` | clothes resource icon (the bolt's blue, deepened — the `rock`/`block` move one chain over) |
| `cheese` | `#e0c765` | cheese resource icon (pale yellow, kept clear of `grain`'s olive **and of `gold`**, which means intent and which nothing in Stores may borrow) |
| `honey` | `#c07a1e` | honey resource icon (deep amber: **darker and redder than `gold`**, deliberately, the way `bread` is darker and redder than `timber` — gold means intent and no good may wear it) |
| `mead` | `#e8d79a` | mead resource icon (pale straw, lifted clear of `cheese`'s yellow and of the sand in the world palette) |

World colors live in `src/render/palette.ts` and are not UI colors.

## Type

Loaded from Google Fonts, with metric-close fallbacks:

- **Display** — `'Grenze Gotisch', 'Grenze', Georgia, serif`. Panel titles
  20px/500, the brand 19px.
- **Text** — `'Grenze', Georgia, serif`. Reading prose 15–16px (menus,
  story text; rare in the HUD).
- **UI** — `'Barlow Semi Condensed', 'Helvetica Neue', Arial, sans-serif`.
  Rows/values 13px, labels 11px caps `0.08em`, section heads 10px caps
  `0.14em`. Numerals always `font-variant-numeric: tabular-nums`.

## Panels

Anatomy, top to bottom: head (display 20px title + at most one tag,
hairline `line-soft` below) → label-left/value-right rows (13px, ink-dim
label, ink value) → italic faint note rows for quiet status → at most one
gold action button, full width, at the bottom. Fixed width 246px on the
right edge. Padding `12px 14px 14px`, vertical gap 12px, radius 2px.

**A control row** is the same label-left row with a small cluster on the
right in place of the bare value — a count, a toggle and a `CLEAR`
(`Plank  3  ON  CLEAR`), or a value between two steppers
(`Planks in colony  − 14 / 20 +`). The label may wrap; the cluster never
does, and at 246px a full three-control cluster leaves the label about 78px
to flex in. Three rows use it: every good on a stockpile's panel gets a
count-toggle-clear row, the stockpile's own `Stored` row carries an
`ALL` / `NONE` pair in place of steppers (`Stored  3 / 32  ALL  NONE`), and a
workshop's panel gets one "in colony" row for its output, under the
per-building output count — the wording is what keeps the local plank number
and the colony-wide one from reading as the same figure. The ceiling reads
`unlimited` at the top of its range; the row never shows `∞`. A workshop held
by its ceiling says so in the note row, in the house voice:
`at limit (20 planks in the colony)`. A stockpile's note row carries the one
sentence that keeps filters and ceilings apart — filters choose what a pile
accepts, ceilings stop a good being made.

**A stockpile that is still a blueprint carries the same filter rows**, minus
the counts and the `CLEAR` — its `ALL` / `NONE` row is labelled `Accepts`,
because what a site holds is its own construction materials and not stock. A
pile is configured before it is built, which is what a default of accepting
nothing needs in order not to be a trap.

**A chain chip may be one-sided.** A workshop whose recipe consumes nothing —
the Farm — draws `→ Grain` with no chip to the left of the arrow, rather than
an empty chip: nothing is missing, there is simply no input. Its panel drops
the `Input` row for the same reason, and its note row never says "waiting
for" anything.

**A panel may carry two note rows** when the second is a *consequence* rather
than a status: the House says `raises the cap by 2` under its beds row (the
number alone is a figure with nothing attached to it), and adds `no one will
come while the table is short` while the food gate — not the cap — is what
holds arrivals. A stockpile's second note is the same shape, and says either
why the pile stays empty (`accepts nothing yet — turn on what this pile
should take`) or why a clear is not moving (`clearing planks — no other pile
will take them`); the two can never both apply. All are the italic faint
recipe; none is an alarm.

## Buttons, tags, meters

- **Primary**: transparent, 1px gold border, gold text; hover adds
  `rgba(220,162,60,0.08)` fill; pressed `0.16`. Disabled: `line` border,
  `ink-faint` text.
- **Secondary**: `line` border, `ink-dim` text.
- **Steppers** (`−` / `+`, either side of a value): the secondary recipe in a
  20px square, the glyph at 13px; hover `ink` on `rgba(0,0,0,0.25)`; at the
  end of its range the button is `ink-faint` and disabled — quiet, not gone.
  Never gold: the panel's one gold element is its action button, and a
  ceiling is a setting, not an order.
- **Toggles** (a stockpile's accept filters): the secondary recipe reading
  `on` / `off` in 11px caps, `aria-pressed` carrying the state. On is `ink`
  on `rgba(0,0,0,0.25)`; off is `ink-faint` text on nothing; the `line`
  border is the same both ways so the row keeps its shape. **State is ink
  weight and fill, never a colour** — gold is intent, sage and rust already
  mean other things, and four toggles in one panel would otherwise be four
  gold elements. The toggle stays **binary** even where the underlying state
  has three values: a good being cleared out reads `off`, and the button
  beside it says what is really happening.
- **Word buttons** (`clear`, `all`, `none`, in a control row's cluster): the
  secondary recipe again in 11px caps, sized to the word rather than to a
  fixed box, since `clearing` is wider than `clear` and the row's label
  absorbs the difference. Distinct from the *menu's* small buttons, which
  share the recipe but stretch to fill their row and carry a rust armed
  state. While a
  clear is running its button reads `clearing`, disabled and `ink-faint` —
  the steppers' end-of-range treatment, quiet rather than gone — and it is
  not rendered at all once the pile holds none of the good. Never gold: like
  a ceiling, a filter is a setting and not an order.
- **Rail tools**: borderless, 2px transparent left edge; pressed = gold
  text, gold left edge, `rgba(220,162,60,0.13)` fill. **Icon only** — the name
  and cost live in the button's `aria-label` and `title` ("Stone wall — 1
  block") and in the caption strip below.
- **The rail's caption strip**: a fixed-height footer at the foot of the rail,
  over a `line-soft` rule — the tool's name at 11px above its cost in
  `ink-faint` 10px. **Always rendered, empty when there is nothing to name**,
  so the rail cannot change height under the pointer — and **outside the rail's
  scrolled box**, so a short window scrolls the tool sections and never clips
  the strip. It names the hovered or
  keyboard-focused tool first, else the active tool, else nothing — and the
  name is **gold only while it is naming the active tool**. A preview of some
  other tool reads in plain ink: hover is not intent. The rail's only other gold
  is the tab strip's held-tool dot, which points at the same intent from the
  other end — no tab, meter or button in the rail may take gold for anything
  else.
- **Tags** (10px caps, 2px radius): POOL sage on `rgba(143,191,82,0.16)`;
  SLOT `#e08a72` on `rgba(184,80,58,0.18)`; BLUEPRINT ink-dim on
  `rgba(126,122,104,0.18)`.
- **Meters**: 6px tall, `line-soft` trough; gold fill for progress; the
  labour meter is one segment per colonist, sage for pool, rust for slots.
- **Resource icons**: 9px squares rotated 45°, filled with the resource's
  color.

### The threat meter, and the rhythm bar

Two widgets, one recipe, both **rust segments in a `line-soft` trough**, 2px
gaps, 6px tall — the labour meter's anatomy, at whichever segment count the
estimate is honest to (five, or ten under a watcher; see below). Unlit
segments are the trough, not a dimmer rust: a meter that is never fully off
would read as a permanent low alarm.

- **Threat meter** — in the ribbon, after the enclosed count, with a faint
  caps caption beside it in the resource-label style. It tracks the colony's
  most relevant monster: while that monster rests the meter **fills** toward
  its waking (*time to monsters*), while it prowls the meter **drains** toward
  its going-home (*time until it is gone*).

  **The caption is the kind plus a coarse time in words** — `TROLL WAKES IN A
  DAY OR TWO`, `ORC PROWLING, GONE WITHIN THE DAY`, `ORC HEADING HOME` —
  prefixed `FAR WILDS:` when the den being tracked is beyond the meter's own
  range, which is how the bar says *this is the wilderness, not your
  doorstep*. **The meter is never blank while a monster exists**: with nothing
  near, it tracks the nearest den on the map rather than emptying, because
  *time to monsters* is the thing it is for. `WILDS QUIET` at `ink-faint`, bar
  empty, is reserved for a map with no monsters at all.
- **Rhythm bar** — the same five segments inside a monster's inspector panel,
  showing how far through its current phase that one monster is. This is what
  "watching a monster's rounds" looks like as a widget.

**Both are coarse on purpose, and neither ever shows a number** — not on the
bar and not in the caption, which is why the time is a phrase and not a
figure. CONCEPT's rule is that schedules show *approximately* and precision is
buildable, so fifths is the resolution the base game sells and a per-monster
error is baked into the estimate. A minutes-and-seconds readout here would
spend the watchtower's whole product, and a digit invites arithmetic the
estimate cannot support. Fifths is also why there is no transition: the bar
steps, and a step is not animation. It is also why a long phase never reads
*any moment now* — a fifth of a three-day rest is well over a day, and the
estimate honestly does not know.

**Under a watcher, both meters go to ten segments** — same rust, same trough,
same 2px gaps, twice as many of them, and **still not a digit anywhere**. A
monster whose den sits within a manned Watchtower's reach reads in exact
tenths: the seeded error is gone and the segment count doubles, so the bar is
finer *and* honest where the base game's is neither. Everything downstream
follows from that one change — the ribbon's meter, a monster's rhythm bar and
the verbal captions all keep their exact recipe and vocabulary, and a phrase
narrows because its bucket did, never because a new phrase was written. The
tower buys **resolution, not arithmetic**; the no-number law above is what it
must never buy past.

The segment count is data, so nothing about either widget hard-codes five. The
ribbon absorbs the ~55px a ten-segment bar adds and stays one line at 1280px.
A monster's inspector says which world it is in beneath the bar, in the house
voice: `its hours are read off the map, never exactly`, or **`a watcher knows
its hours`**. A *watcher*, not a tower — the price is the pair of hands, and
the sentence goes back the frame they step out.

**No alarm anywhere else.** A monster at the wall produces no banner, no
toast, no colour change on any other element, and no sound. The meter moving,
the folk readout shrinking and a grave in the grass are the entire vocabulary
the game has for this.

## Centre modal

**The one panel allowed in the middle of the screen**, and a deliberate,
named exception to the "panels hug the edges, the centre belongs to the game"
rule above. It earns the middle because **the game is paused behind it** —
there is no world in the way — so anything that wants the centre has to pause
first, or it does not get it.

- **Scrim**: `rgba(20, 23, 15, 0.55)` full-viewport, centring its panel.
  Clicking the scrim closes; clicking the panel does not.
- **Panel**: the standard anatomy at 320px instead of 246px — wide enough for
  a list row carrying three actions — `max-height: 80vh` and scrolling
  inside. Same fill, hairline border, 2px radius, blur.
- **Sections**: a display 20px title with the usual `line-soft` rule under
  it, then 10px caps section heads (`Save this colony`, `Saved colonies`).
- **One gold element still holds.** Save is the gold action; every other
  control — the per-row Load / Export / Delete, Import, New colony — is the
  secondary recipe (`line` border, ink-dim text, 11px caps).
- **Destructive actions are guarded by a second click, never a dialog.** The
  button re-labels itself in place (`Really — click again`, `Sure?`) and
  takes the rust text colour while armed, then reverts on its own after ten
  seconds. A modal on top of a modal is not this game's voice.
- **Errors are the panel's italic faint note row.** No toasts, no alerts, no
  colour change anywhere else — a save that will not load says so in one
  quiet line and the game behind it is untouched.

Escape runs one ladder, one rung per press: active tool → selection → menu.
The same key closes the modal, so the way out is always the way in.

## In-world overlay grammar

Drawn by `src/render/`, same vocabulary as the panels:

- **Valid placement ghost**: sage — `rgba(143,191,82,0.22)` fill, 2px
  `rgba(143,191,82,0.85)` border, footprint grid lines at `0.5` alpha.
- **Invalid placement**: rust, same recipe — never alarm red.
- **Designation (chop)**: gold outline, `rgba(220,162,60,0.13)` fill.
- **Selection box** (the drag-box for area tools — chop, mine, raze,
  level): a **keylined gold outline traced per tile on the ground**, at
  `0.85` alpha and ~0.11 tiles wide, over a **faint gold fill** at `0.10`.
  Square corners, solid lines: never dashed, never animated — marching ants
  are motion, and nothing here moves. It exists only while the drag is held.

  **World-space, not screen-space.** The box is two picked tiles and it is
  drawn at each tile's own ground height, so it steps over a rise instead of
  cutting through it — and the ground it covers is the ground the release
  takes, from every camera angle. A DOM rectangle over the viewport was
  tried and removed (`2026-09-13-map-space-selection-box`): it could not say
  the same thing twice from two angles, and its selection let a tree behind
  a ridge escape a box drawn over it.

  **Gold, and heavier than a mark.** Gold because gold is player intent; the
  ghost's sage and rust mean *valid* and *invalid*, and the box makes no
  claim about whether the ground inside it can be worked. The outline is
  ~0.11 tiles against a designation mark's ~0.08 for the same reason: the
  box shares a hue and a shape with the marks it is drawn over, so weight is
  what keeps "the region I am selecting" from reading as "more marks". The
  fill stays lighter than the designation's `0.13`, since a box can cover
  half the view.

  **The fill degrades before the outline does.** Past the instance budget
  the interior stops shading and the border stays complete — the enclosure
  wash's treatment, and deliberately *not* the watch range's refuse-the-
  square-whole rule: a boundary drawn short would claim less ground than the
  release will take, while an unshaded interior is merely less pretty.

  **Releasing a box says what it took** — `47 trees`, `no tiles` — in the
  rail's caption strip, outranking the caption naming the held tool and
  holding until a rail preview, a tool change or the next gesture claims the
  strip. That count is the only feedback that survives occlusion: a box laid
  across a ridge designates the far slope too, and those marks are behind
  the crest.
- **Enclosure** (which ground the wall has claimed): a **keylined sage
  boundary line traced along the inside edge of the enclosing wall**, at
  `0.85` alpha and ~0.11 tiles wide, over a **very faint sage interior
  fill** at `0.14`. Assembled per tile — a bar on every side of an enclosed
  tile whose neighbour is *not* enclosed — so it traces whatever shape the
  player drew.

  **Boundary-first, and the ordering is the point.** By this section's own
  measurement a faint sage fill against grass is invisible on its own, so
  the line is what carries the read and the wash only says which side of it
  is inside. Raising the fill instead is the wrong repair: at any strength
  where a wash reads by itself it is tinting the world, and the world is the
  hero.

  It is shown **only while a wall-family tool is active** (wall, gate,
  raze), never permanently. Sage is right here for the same reason it is
  right on a placement ghost — this is ground the colony may use — and the
  two never appear in conflict, because the run ghost sits on wall tiles and
  wall tiles are never enclosed ground.
- **Watch range** (how far a Watchtower reads): the enclosure boundary's
  recipe with **no wash under it** — a keylined sage line at `0.85` alpha and
  ~0.11 tiles wide, traced per tile along the boundary of the tower's
  Chebyshev-`WATCH_RANGE` square, at each tile's own ground height so it
  follows the terrain.

  **A square, not a circle, because a square is what the rule tests.**
  Coverage is Chebyshev distance from the tower to a monster's *den*, so a
  circle of radius 24 would exclude covered diagonal dens — the picture
  denying knowledge the player has already paid a pair of hands for. The
  overlay and the predicate are the same shape or the overlay is a lie.

  **Outline only.** The enclosure's faint interior fill earns its place by
  saying which side of a line the colony's ground is on; a square 49 tiles
  across is not a region the colony owns, and at any strength where such a
  wash read by itself it would be tinting the world.

  Shown **only while the tower tool is held** — every tower on the map plus
  the ghost's, so a new tower is sited against the coverage there is — or
  while **a tower is selected**, when it shows its own. Never permanently,
  and the ghost's square is drawn first so it is never the one a budget
  drops. A tile off the map edge is simply skipped: a tower near the coast
  really does reach past the shore, and an open line is the honest picture.

Three rules the world imposes on every overlay above, added once the first
of them were measured against real terrain (`2026-09-01-tick-and-labour`):

- **Every overlay line sits on a `ground` (`#14170f`) keyline at `0.5`,
  drawn one line-width wider underneath.** The meaning colours do not survive
  the terrain on their own: sage `#8fbf52` and the world's grass `#7ec043`
  are within a few percent of each other, so even a fully opaque sage border
  measures under 15/255 per channel against grass — invisible. The keyline
  changes no meaning colour; it gives them something to read against.
- **Border widths are screen-space.** 2px is roughly `0.1` tiles at the
  opening zoom; thinner than that and the line falls under a pixel and
  alpha-blends away. Grid lines are half that.
- **A mark on a tall thing is two marks: one at its base, one on the thing
  itself.** A chop designation sits as a gold diamond on the ground tile
  around the trunk — the tree's canopy hides its back half, and that is
  accepted, because the front half reads at every camera angle the game
  allows. What carries the mark at distance is the *object* tinting: a
  designated tree's canopy bakes ~15% toward `gold`, enough to pick a marked
  wood out across the map, small enough that it still reads as a tree.
  Floating the mark above the crown to dodge the occlusion was tried and
  removed — it reads as a box hanging in mid-air, which is worse than a
  partly hidden mark. Tinting a baked object means marking it is a geometry
  change: whatever bakes it has to be re-baked.

  The rule generalises to every mark whose subject stands up out of the
  ground, at the same 15%: a wall segment marked for dismantling gold-shifts
  its timber, and a rock outcrop marked for quarrying gold-shifts **its top
  face only** — the surface being worked warms up while the cliff faces stay
  rock, so it reads as a marked top rather than as a gold boulder. A mark on
  the *ground itself* has no second half, and that is not an omission: a
  levelling designation is the base diamond alone, and so is the one
  designation that dirties no chunk.
- **A clothed colonist wears colour; an unclothed one wears drab.** Folk are
  drawn in a three-way cloth rotation by id — `tunic` `#3f79ab`, `wool`
  `#c4763f`, `smock` `#5f9438`, all world colours from
  `src/render/palette.ts` — and that rotation **is** what being clothed looks
  like. Wearing nothing, a colonist is one undyed tone, `drab` `#8a8272`. So
  dressing the colony literally brings colour to it, and the read is available
  at map distance with the HUD saying nothing at all: there is **no clothed
  count on the ribbon and no per-colonist panel**, because the Stores panel's
  Clothes row is the stock signal and the map is the rest. Not a HUD colour and
  not an overlay — a colonist is a thing in the world, and equipment is
  something you can see them wearing.

  It is also not a bake: colonists are per-frame movers with no dirty
  machinery, so a garment donned or worn out shows on the very next frame.
- **A ghosted good is an absence.** A blueprint draws a faint empty slot for
  every material it is still owed, continuing the same stack its delivered
  items sit in, so a site two short and a site one short are told apart from
  the map. One pale neutral tone at low alpha — `smoke` `#c4bdae` at `0.42`
  — over the standard `ground` keyline, **never a good's own colour** (a
  building's cost is one item type, so the colour would say nothing the site
  does not already say) and **never sage, gold or rust** (those mean valid,
  intent and invalid, and a missing material claims none of the three). Not
  `stake`: that is the plot plate the slots stand on, the one background they
  could not read against.

  **It is a prop, not an overlay, and that is the distinction worth
  stating where a reader meets both.** A placement ghost is *proposed* and
  lives only while its tool is held; a material ghost is *owed* and stands
  until the material arrives — no tool gate, no selection gate, because a
  shortfall is a fact about the world rather than an answer to a question the
  player just asked. A dozen queued blueprints therefore show four dozen empty
  slots, which is the honest picture of a dozen queued blueprints. Nothing
  moves: the slots are static geometry keyed to a count, outside all three
  motion classes.
- **A site wears a braced frame, and the brace is what makes it scaffolding.**
  Every building site — every footprint, the 1×1 Watchtower included — stands a
  timber frame from the moment it is placed until the building replaces it: four
  posts, two rails on all four faces, **a diagonal brace across every bay**, a
  walkway along the far side, and a rolled tarp that stirs on the sway class.
  **The diagonal is not decoration.** Posts plus horizontal rails is literally
  the Pasture's fence grammar and reads as a fence; a fence never carries a
  diagonal and scaffolding almost always does. It only does its job if it is
  *steep* and *legible* — so a face is split into bays about as wide as the frame
  is tall before it is braced, and the brace stands proud of the rails it crosses
  in the paler plank tone. Flush, flat and in the rails' own timber it merges
  into one plane of wood and the frame reads as a pen again.

  An open near face was tried and rejected: it was aimed at a camera-occlusion
  worry that never survived a screenshot — every material lands on the
  footprint's *first* tile, which is the far one — and what it actually bought
  was a frame that read as broken rather than as deliberately open. Which face is
  near still matters, because the walkway sits on the far one, and that is
  settled **by rule, not by hash**: south is the face the camera can always see,
  the rule the House's door and the Oven's mouth already follow. So the walkway
  is on the same side of every site in the colony and a site cannot rearrange
  itself between two looks.

  **Nothing stands inside the frame but the materials.** The `Building` state
  adds no geometry of its own: a stocked site is the frame plus a full set of
  material cubes, and its honest difference from a waiting one is that no empty
  slot is left. The featureless timber slab that used to mark it was a blank
  block among the delivered cubes, and it lasted four seconds.

  **Every site stands the same height — one storey — and several buildings
  finish lower than the frame that wrapped them.** That is the read, not a
  defect: real scaffolding is routinely taller than what it is built around, and
  a Stockpile deck emerging from a taller frame says *scaffolding coming down*
  rather than *building shrinking*. Scaling the frame to what the site becomes
  was tried and rejected — the flattest kinds finish so low that a frame kept
  under them stood shorter than a delivered material cube. One height is also
  what lets a site read as a site before the player knows what is going up
  there.

## Layout regions

- **Ribbon** — full-width top bar, and **colony facts only**: brand, the folk
  count (with its hungry suffix), idle, a `line-soft` divider, the enclosed
  count, another divider, the threat meter and its caption, then the
  right-aligned clock group — speed buttons (pause, ×1, ×2, ×4 — active gets
  the gold treatment), the day caption and Menu, keeping their `margin-left:
  auto`.

  **It is one line at every supported width, and it does not grow with the
  economy.** Goods live in the Stores panel, so the only variable-width element
  is the threat caption; the worst case ("far wilds:" plus the longest phrase)
  is still inside the 1280px budget. `flex-wrap` stays as a safety net and
  should never fire.

  **The folk readout carries the game's one hunger signal**: a `· 2 hungry`
  suffix in **ink-dim**, shown only while somebody is actually *slowed* — not
  merely due a meal, which would flicker at every lunch walk. Ink-dim and
  never a colour: rust would read as an alarm, and there is nothing to react
  to. A colony with an empty larder is a slower colony and it recovers by itself the
  moment loaves exist again, so the suffix appears and disappears with the
  slowdown and says nothing else. No toast, no banner, no meter.

  **The idle count means *available for work***: a pool worker with no task
  claimed who is not away at a meal. It is the player's read on how much slack
  the pool has, so it reads as hands that could take work now rather than hands
  that merely hold nothing (`Readout.idle` is the definition it follows).
- **Build rail** — left edge, 145px wide, below the ribbon: a **tab strip** of
  the three sections, then the open section's tools in a **three-column grid**
  of icon-only buttons, with the caption strip as the last thing in the rail.
  An odd count leaves the trailing cells empty. Sections are by *what the tool
  does to the world* — **Orders** (tell people to work on what is already
  there), **Build** (put a building down), **Walls** (draw a line).

  **Exactly one section is open**, and the strip opens on **Build** every
  session — the section that grows, and the one a player reaches for most.
  Nothing about which tab was open is remembered: it is view state, and nothing
  in the HUD persists. One-at-a-time is what makes the rail *one section tall*,
  so a closed section costs nothing however long it grows — which no amount of
  re-columning can promise, and which is why three independently collapsible
  disclosure heads were rejected in favour of a tab set.

  **Tab strip anatomy**: one ~30px row across the head of the rail, outside the
  scroller, in the same 10px caps section-head type the stacked heads used, with
  a `line-soft` rule beneath. The open tab is `ink` on a neutral pressed fill;
  the closed two are `ink-faint`. **Never gold** — the rail's one gold element
  is the caption strip naming the active tool, and a tab is a view, not an
  intent. The one exception is a **4px gold dot** under the label of the tab
  owning the tool currently held, which points at intent rather than at a view:
  a tool stays active while its section is closed, and the dot is how the player
  sees *where* it is.

  It is a real tablist — `role="tablist"` / `tab` / `tabpanel`, a roving
  tabindex, Left / Right between tabs — never `aria-expanded`, which announces
  three independent collapsibles where the player has one of three.

  Three columns plus the strip is what puts every tool of the open section on
  screen at **1280×720**, with room for about one more row of buildings before
  that stops being true. 145px is the width that keeps the cell at its old size
  (`(96 − 1) / 2` and `(145 − 2) / 3` are both ~47.6px), so the button, its 2px
  pressed left edge and the icon are untouched. The rail never slides over
  Stores at any height, because the two share one left-edge flex column in which
  the rail is the item that gives.
- **Stores** — bottom-left, 220px wide. A 10px caps head, then per chain a 10px
  caps group label over a `line-soft` rule — **Wood**, **Stone**, **Food**,
  **Cloth**, **Drink**, in that fixed order, the first without a rule — then that
  group's goods **two to a line** in a 13px row each: the
  9px rotated resource pip in the good's colour, its name in ink-dim, its count
  right-aligned in ink and tabular. An odd count leaves one empty cell, as in the
  rail. **Every good the game has, named and counted**; a new good is one more
  cell and the ribbon never changes.

  **220px is forced, not chosen, and it breaks the Labour mirror.** Stores and
  Labour were the two bottom corners at one width; they no longer are. A row is
  pip + name + count, so the longest — `Clothes 123` — does not fit the half-cell
  a narrower panel gives, and it has to fit in the **fallback font**, since
  Barlow loads with `display=swap` and the non-condensed stack renders during
  every load and permanently offline. Truncating instead is rejected outright:
  `Cloth` and `Clothes` are both goods, and an ellipsis makes their rows
  identical. Hiding the counts behind a click — collapsible groups — is rejected
  too: they are a glance. The mirror is a visual rhyme, and being able to see the
  buildings is not.

  The order is **fixed here, never read off the enum**: `ItemType` is
  append-only, so a good's position in it says when it was added and nothing
  about what it is. Cheese is that case having actually happened — the newest
  good in the game, filed at the foot of Food, between Bread and Wool. A
  good's group is what a colonist *does* with it, not which building made it. **Cloth comes
  after Food** because the chain arrived after the bread chain and because it is
  the one group nothing eats or builds with, so the panel read top to bottom
  tells the colony's own story in the order it was built; **Drink comes after
  Cloth** for the same reason, and is a group of its own rather than a corner of
  Food because nobody eats honey or mead — what a colonist does with them is
  neither eating nor building.
- **Inspector** — right edge, 246px, below the ribbon; a second panel may
  sit above the bottom edge. It has **two shapes**: a building, and a
  monster — display-20px kind as the title, an `ORC` / `TROLL` tag in the
  rust tag style, a stance row (`resting` / `out`), and the rhythm bar. No
  action button: there is nothing a player may do to a monster, and an
  inspector with no button is the honest way to say so.

## Dialed defaults

Panel opacity 0.88 and gold `#dca23c` are the values dialed in on the
reference mock. If they get re-dialed on the canvas, this file is updated
to match — the guide and the mock never disagree.
