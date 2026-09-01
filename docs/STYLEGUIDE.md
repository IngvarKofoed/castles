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
| `rust` | `#b8503a` | **slots & invalidity**: slot workers, invalid placement (text: `#e08a72`) |
| `timber` | `#a9713f` | log resource icon |
| `plank` | `#d0b078` | plank resource icon |

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

## Layout regions

- **Ribbon** — full-width top bar: brand, resource readouts (icon + value +
  faint caps label), a `line-soft` divider, folk/idle counts, then
  right-aligned speed group (pause, ×1, ×2, ×4 — active gets the gold
  treatment) and the day/time caption.
- **Build rail** — left edge, 62px wide, below the ribbon: section label
  then vertical tools.
- **Inspector** — right edge, 246px, below the ribbon; a second panel may
  sit above the bottom edge.

## Dialed defaults

Panel opacity 0.88 and gold `#dca23c` are the values dialed in on the
reference mock. If they get re-dialed on the canvas, this file is updated
to match — the guide and the mock never disagree.
