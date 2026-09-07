# Castles — HUD style guide

*Last updated 2026-09-01. Distilled from the approved visual mock
(https://claude.ai/code/artifact/fa8e50e2-7a08-422e-890b-23e3f262711c — the
live, editable reference) and the HUD proven in `mockups/mockup3d.html`.
Every session doing UI work copies from here; nothing visual gets invented
per-session.*

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

## Buttons, tags, meters

- **Primary**: transparent, 1px gold border, gold text; hover adds
  `rgba(220,162,60,0.08)` fill; pressed `0.16`. Disabled: `line` border,
  `ink-faint` text.
- **Secondary**: `line` border, `ink-dim` text.
- **Rail tools**: borderless, 2px transparent left edge; pressed = gold
  text, gold left edge, `rgba(220,162,60,0.13)` fill.
- **Tags** (10px caps, 2px radius): POOL sage on `rgba(143,191,82,0.16)`;
  SLOT `#e08a72` on `rgba(184,80,58,0.18)`; BLUEPRINT ink-dim on
  `rgba(126,122,104,0.18)`.
- **Meters**: 6px tall, `line-soft` trough; gold fill for progress; the
  labour meter is one segment per colonist, sage for pool, rust for slots.
- **Resource icons**: 9px squares rotated 45°, filled with the resource's
  color.

### The threat meter, and the rhythm bar

Two widgets, one recipe, both **five segments of rust in a `line-soft`
trough**, 2px gaps, 6px tall — the labour meter's anatomy with a fixed
segment count. Unlit segments are the trough, not a dimmer rust: a meter that
is never fully off would read as a permanent low alarm.

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
spend the watchtower's whole product before it exists, and a digit invites
arithmetic the estimate cannot support. Fifths is also why there is no
transition: the bar steps, and a step is not animation. It is also why a long
phase never reads *any moment now* — a fifth of a three-day rest is well over
a day, and the estimate honestly does not know.

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
- **Selection marquee** (drag-box for area tools; screen-space, not
  world-space): 1px gold border over a 1px `ground` keyline,
  `rgba(220,162,60,0.10)` fill — lighter than the designation fill, since
  it can cover half the screen. Square corners, solid lines: never dashed,
  never animated — marching ants are motion, and nothing here moves. It
  exists only while the drag is held.
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

Three rules the world imposes on all three, added once the first overlays
were measured against real terrain (`2026-09-01-tick-and-labour`):

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

## Layout regions

- **Ribbon** — full-width top bar: brand, resource readouts (icon + value +
  faint caps label), a `line-soft` divider, folk/idle counts, then
  right-aligned speed group (pause, ×1, ×2, ×4 — active gets the gold
  treatment) and the day/time caption.
- **Build rail** — left edge, 62px wide, below the ribbon: a 10px caps
  section head, then that section's vertical tools, repeating. Sections are
  by *what the tool does to the world* — **Orders** (tell people to work on
  what is already there), **Build** (put a building down), **Walls** (draw a
  line) — and each head after the first carries a `line-soft` rule above it.
  The rail is bounded by the viewport and scrolls inside itself rather than
  running off the bottom edge.
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
