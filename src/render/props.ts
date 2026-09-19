import { hash } from "../sim/world/noise";
import {
  BuildingKind,
  BuildingState,
  isGateway,
  isStoneWall,
  wallIsBlueprint,
  type Building,
  type BuildingKindValue,
} from "../sim/know";
import { DAMAGE_SHADE, DESIGNATED_TINT, OVERLAY, PROP, PROP_JITTER, lerpHex } from "./palette";

/**
 * The voxel props baked into chunk geometry: trees, buildings and walls.
 *
 * All three are *static world content* — a tree stands until it is chopped, a
 * building changes shape three times in its life, a wall segment twice — so
 * they belong in the chunk mesh next to terrain rather than in a second
 * per-frame instanced path. A change bumps `chunkVersion` and one chunk
 * rebuilds (docs/changelog/2026-09-01-dirty-chunk-neighbours.md).
 *
 * Models are ported from `mockups/mockup3d.html`: a prop is a box at
 * (x, groundY + height/2, z) sized (sx, height, sz), optionally spun about y.
 * Decorative props take a rotation; buildings never do, so the grid still
 * reads — the mockup's own rule.
 */

export interface Box {
  /** Centre in world units. */
  x: number;
  y: number;
  z: number;
  /** Full extents. */
  sx: number;
  sy: number;
  sz: number;
  /** Rotation about +y, radians. */
  rot: number;
  color: number;
  /** Multiplies the colour — cheap shading between a prop's own parts. */
  shade: number;
  /**
   * Where the per-prop colour wobble is keyed from, defaulting to the box's
   * own centre. A member that spans a tile in *pieces* — a palisade rail, now
   * that it is built as arms meeting at the centre post — has to anchor all its
   * pieces to one point, or each piece draws its own wobble and the join shows
   * as a colour seam mid-tile.
   */
  jx: number;
  jz: number;
  /**
   * How hard this box leans in the wind, 0 for everything that should not move
   * at all. The mesher multiplies it by the same top-vertex mask it already
   * computes for `aBlockY`, so a swaying box keeps its feet and bends its head;
   * the shader's amplitude is a fraction of a tile at weight 1.
   *
   * Zero on trunks, walls, buildings and ground — **by world height would have
   * been free and wrong**, because it waves the tops of walls and roofs
   * (docs/specs/2026-09-15-ambient-life.md).
   */
  sway: number;
}

const TREE_SALT = 0x1b873593;
const WALL_SALT = 0xc2b2ae35;

function box(x: number, base: number, z: number, sx: number, sy: number, sz: number, color: number, rot = 0, shade = 1): Box {
  return { x, y: base + sy / 2, z, sx, sy, sz, rot, color, shade, jx: x, jz: z, sway: 0 };
}

/** Wobble this box's colour as if it sat at (jx, jz). See `Box.jx`. */
function anchorJitter(b: Box, jx: number, jz: number): Box {
  b.jx = jx;
  b.jz = jz;
  return b;
}

/** Let this box lean in the wind, at `weight`. See `Box.sway`. */
function swaying(b: Box, weight: number): Box {
  b.sway = weight;
  return b;
}

/**
 * Sway weights, by what is doing the swaying.
 *
 * A canopy leans hardest and a tip harder than the branch under it; a bush is
 * knee-high and a furrow ridge and a bloom head are small boxes whose *tops*
 * carry the whole displacement, so both take a fraction or the lean reads as a
 * shear. Nothing structural appears here at all.
 *
 * `cloth` is the lightest of the lot: a tarp lashed at its foot against a
 * building site's frame **stirs, it does not toss**, and it is the one entry
 * here that is not a growing thing.
 */
const SWAY = {
  canopyLow: 0.8,
  canopyMid: 1.0,
  canopyTop: 1.2,
  bush: 0.5,
  crop: 0.5,
  bloom: 0.6,
  cloth: 0.4,
} as const;

/** Block height in world units — one voxel step. Shared with the mesher. */
export const BH = 0.5;

/**
 * Where a building's stored goods ride, above its ground, once it is finished.
 *
 * A workshop's buffers sit on its **roofline** because its walls are solid —
 * and a roofline is a property of the *model*, so it lives here beside the
 * geometry rather than as one constant in the mover layer. That constant was
 * the sawmill's (2.38·BH) applied to "anything with a recipe", which was true
 * while every workshop was a shed and became a lie the moment a workshop was a
 * flat field or a dome: grain and bread drew in mid-air above both.
 *
 * A stockpile and everything unfinished keep the deck height, which is the
 * plate `deck()` and the blueprint plot both lay down. Every kind has a row so
 * a new building cannot silently inherit a shed's roof.
 */
export const BUFFER_Y: Record<BuildingKindValue, number> = {
  [BuildingKind.Stockpile]: 0.16 * BH,
  [BuildingKind.Sawmill]: 2.38 * BH,
  [BuildingKind.Mason]: 2.38 * BH,
  // A House holds nothing; it takes the deck so the table is total.
  [BuildingKind.House]: 0.16 * BH,
  // On the worked earth inside the fence, not on the hut's roof: the plot is
  // where a sack of grain would actually be standing.
  [BuildingKind.Farm]: 0.26 * BH,
  [BuildingKind.Mill]: 2.38 * BH,
  // The dome's shoulder — two courses, no roof.
  [BuildingKind.Oven]: 1.4 * BH,
  // A Watchtower holds nothing at all — its output is knowledge, not goods —
  // so it takes the deck like a House and the table stays total.
  [BuildingKind.Watchtower]: 0.16 * BH,
  // The Pasture is the Farm's case: fleece sits on the grazed ground inside the
  // fence, not on a roof it does not have.
  [BuildingKind.Pasture]: 0.26 * BH,
  // The cloth chain's three sheds share the timber-workshop model (see
  // `buildingBoxes`), so they share its roofline.
  [BuildingKind.Dairy]: 2.38 * BH,
  [BuildingKind.Weaver]: 2.38 * BH,
  [BuildingKind.Tailor]: 2.38 * BH,
  // On the stand between the skeps, not on a roof the hive does not have —
  // the Farm's case, where the goods sit on the worked ground inside the fence.
  [BuildingKind.Hive]: 0.28 * BH,
  // Flowers hold nothing at all — a passive plot with no buffer — so they take
  // the deck like a House and the table stays total.
  [BuildingKind.Flowers]: 0.16 * BH,
  // The Meadery shares the timber-workshop model, so it shares its roofline.
  [BuildingKind.Meadery]: 2.38 * BH,
};

/** The deck a stockpile's pile and a blueprint's materials stack on. */
export const DECK_Y = 0.16 * BH;

/**
 * The site frame's proportions.
 *
 * `SITE_INSET` is the binding number, and it stands **outboard of where the
 * corner stakes used to**. A blueprint's delivered materials and its shortfall
 * ghosts do not sit at tile centres: `lattice` offsets them ±0.18 and a good's
 * box is 0.34 across, so a corner slot reaches to **0.15 from the footprint
 * edge**, spanning heights 0.08–0.49. The old 0.14-section stake at a 0.18
 * inset overlapped that by 0.10 × 0.10 in plan and escaped notice only because
 * it was ankle-high and grazed the lower lattice level; anything taller at that
 * inset pierces both. A member at 0.07 spans 0.00–0.14 and clears the cubes
 * with a hair to spare — on a 1×1 plot too, where the four slots span 0.15–0.49
 * and 0.51–0.85. That binds **every future prop sharing a plot with
 * materials**, not just this one (docs/specs/2026-09-16-site-scaffolding.md).
 */
const SITE_INSET = 0.07;
const SITE_SECTION = 0.14;
/**
 * Post height: **one storey, the same for every site**, whatever it becomes.
 *
 * The sawmill's own wall height, so a frame is a storey in this game's own
 * vocabulary. **Deriving it from the finished building was tried and
 * abandoned**: the Stockpile tops out at 0.55·BH and the Flowers plot at
 * 0.54·BH, so any frame kept under those stood about 0.22 — shorter than a
 * delivered material cube (0.08–0.28) and unreadable as a frame at all.
 * Several buildings therefore finish *lower* than the frame that wrapped them,
 * which is both true of real scaffolding and the better read: a deck emerging
 * from a taller frame is scaffolding coming down, not a building shrinking.
 */
const SITE_TOP = 1.5 * BH;
/**
 * Rail heights as fractions of the **post**, never as absolute heights. The
 * Pasture's fence supplies the two numbers (0.34·BH and 0.66·BH on a 0.85·BH
 * post), but not its absolutes — a site has to keep its proportions at one
 * fixed height rather than borrow a pasture's.
 */
const SITE_RAILS = [0.4, 0.78] as const;
const SITE_RAIL_DEPTH = 0.1 * BH;
/**
 * The diagonal brace: what makes this scaffolding rather than a fence.
 *
 * Posts plus horizontal rails is literally `pasture()`'s grammar and reads as a
 * fence; a fence never carries a diagonal and scaffolding almost always does.
 * **It is drawn as a stepped run of short boxes, because a tilted member is not
 * expressible**: `Box.rot` spins about +y only and `emitBox` rotates about no
 * other axis, so the alternative is new mesher machinery. Stepping it is also
 * the voxel answer — everything else in this world is axis-aligned too.
 *
 * Lighter than a rail on purpose: at the rails' own 0.14 section a diagonal on
 * every face closes the frame into a solid.
 */
const SITE_BRACE = 0.09;
/** How many boxes a bay's stepped diagonal is drawn with. */
const SITE_BRACE_STEPS = 4;
/** How far the brace stands out from the face it crosses. */
const SITE_BRACE_PROUD = 0.05;
/** How far the walkway's planking hangs outboard of the far face. */
const SITE_WALK_OUT = 0.16;

/**
 * One tree on tile (tx, ty), standing on ground of height `h` blocks.
 *
 * Three builds from the mockup — tall pine, round tree, bush — chosen by a
 * per-tile hash, with the same per-tile rotation jitter, so a wood reads as
 * varied without any of it being stored.
 *
 * `designated` tints the canopy — not the trunk, which stays wood-coloured so
 * the shift reads as leaves catching the light rather than as a painted post.
 * Because the tree is baked into chunk geometry, marking one has to bump its
 * chunk version; `designate()` in the sim does that.
 */
export function treeBoxes(
  tx: number,
  ty: number,
  h: number,
  seed: number,
  out: Box[],
  designated = false,
): void {
  const v = treeStyle(tx, ty, seed);
  const rot = (v - 0.5) * 0.55;
  const x = tx + 0.5;
  const z = ty + 0.5;
  const g = h * BH;
  const leaf = (colour: number): number =>
    designated ? lerpHex(colour, OVERLAY.gold, DESIGNATED_TINT) : colour;

  if (v > 0.7) {
    out.push(box(x, g, z, 0.24, 1.15 * BH, 0.24, PROP.trunk, rot));
    out.push(swaying(box(x, g + 1.15 * BH, z, 0.9, 1.05 * BH, 0.9, leaf(PROP.leafA), rot), SWAY.canopyLow));
    out.push(swaying(box(x, g + 2.2 * BH, z, 0.62, 0.85 * BH, 0.62, leaf(PROP.leafB), rot), SWAY.canopyMid));
    out.push(swaying(box(x, g + 3.05 * BH, z, 0.32, 0.55 * BH, 0.32, leaf(PROP.leafA), rot), SWAY.canopyTop));
    return;
  }
  if (v > 0.3) {
    out.push(box(x, g, z, 0.28, 0.95 * BH, 0.28, v > 0.52 ? PROP.trunk : PROP.birch, rot));
    out.push(
      swaying(
        box(x, g + 0.95 * BH, z, 1.0, 1.35 * BH, 1.0, leaf(v > 0.46 ? PROP.leafB : PROP.leafC), rot),
        SWAY.canopyLow,
      ),
    );
    out.push(
      swaying(box(x + 0.1, g + 2.3 * BH, z - 0.08, 0.58, 0.62 * BH, 0.58, leaf(PROP.leafA), -rot), SWAY.canopyMid),
    );
    return;
  }
  // A bush is all canopy — there is no trunk to leave alone, so both boxes
  // lean, and at a knee-high weight: they are wider than they are tall, and a
  // canopy's lean on one would read as the whole shrub shearing.
  out.push(swaying(box(x, g, z, 0.68, 0.5 * BH, 0.68, leaf(PROP.leafB), rot), SWAY.bush));
  out.push(swaying(box(x + 0.2, g, z - 0.16, 0.46, 0.38 * BH, 0.46, leaf(PROP.leafC), -rot), SWAY.bush));
}

/**
 * One building, in whatever state it is in. Blueprint is four stakes and a
 * marked-out plot; under construction is the stakes plus half a body; active
 * is the finished thing. Nothing about it flashes or pulses — a starved site
 * says so in its panel, never on the ground (docs/STYLEGUIDE.md, Tone).
 */
export function buildingBoxes(b: Building, h: number, out: Box[]): void {
  const g = h * BH;
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;

  if (b.state === BuildingState.Blueprint || b.state === BuildingState.Building) {
    // Marked-out plot: a scraped plate, and the site's timber frame over it.
    //
    // **Every footprint, the 1×1 Watchtower included.** The posts' 0.07 inset
    // spans 0.00–0.14 while a single tile's four material slots span 0.15–0.49
    // and 0.51–0.85, so the geometry holds at one tile — and with the near face
    // open it reads as a frame rather than as a cage. The tower is also the
    // tallest thing the colony builds, so a storey-tall frame is the one thing
    // it cannot overshadow.
    out.push(box(cx, g, cz, b.w - 0.1, 0.06, b.h - 0.1, PROP.stake, 0, 0.85));
    siteFrame(g, b, out);
    // **`Building` adds nothing, and the two states draw the same.** A
    // featureless timber slab made sense on a bare plot as the only sign that
    // materials were in; inside a frame it is a blank block standing among the
    // delivered cubes, which stay visible until the build completes. Gone — and
    // the Stockpile's half-`deck` with it — a stocked site now differs from a
    // waiting one by exactly the true statement, that no empty slot is left.
    // It lasts four seconds.
    return;
  }

  if (b.kind === BuildingKind.Stockpile) {
    deck(cx, g, cz, b, out);
    return;
  }
  if (b.kind === BuildingKind.House) {
    house(cx, g, cz, b, out);
    return;
  }
  if (b.kind === BuildingKind.Farm) {
    farm(cx, g, cz, b, out);
    return;
  }
  if (b.kind === BuildingKind.Oven) {
    oven(cx, g, cz, b, out);
    return;
  }
  if (b.kind === BuildingKind.Watchtower) {
    watchtower(cx, g, cz, out);
    return;
  }
  if (b.kind === BuildingKind.Pasture) {
    pasture(cx, g, cz, b, out);
    return;
  }
  if (b.kind === BuildingKind.Hive) {
    hive(cx, g, cz, b, out);
    return;
  }
  if (b.kind === BuildingKind.Flowers) {
    flowers(g, b, out);
    return;
  }
  // The Dairy, the Weaver, the Tailor and the Meadery fall through to the
  // timber workshop,
  // exactly as the Mill shares it with the Mason and the Sawmill: three 2×2
  // sheds with the same carpentry and the same plank cost, and a distinct prop
  // per workshop is polish this step did not buy
  // (docs/changelog/2026-09-08-bread-economy.md records the same trade for the
  // Mill). What tells them apart is the panel and the goods on the roof. The
  // Meadery is the seventh sharer, and `docs/CLAUDE_TODO.md` carries that.
  sawmill(cx, g, cz, b, out);
}

function corners(b: Building): [number, number][] {
  return [
    [b.x + 0.18, b.y + 0.18],
    [b.x + b.w - 0.18, b.y + 0.18],
    [b.x + 0.18, b.y + b.h - 0.18],
    [b.x + b.w - 0.18, b.y + b.h - 0.18],
  ];
}

/**
 * The timber frame every site wears: four posts a storey tall, rails on all
 * four faces, a walkway along the far one, and a rolled tarp stirring against a
 * post.
 *
 * **It stands from `Blueprint`, not from `Building`.** Fiction says you raise
 * scaffolding when work starts, but `BUILD_TICKS` makes `Building` four
 * seconds, so a prop that waited for it would be one nobody ever sees. A site
 * waiting on its haulers is the longest anything in this game stays unfinished
 * and the emptiest thing on the map to look at; the frame covers the minutes
 * rather than the seconds, and comes down when the building goes up.
 *
 * **The frame is closed on all four faces**; an open near face was tried and
 * rejected, and the rails loop below records why. Which face is *near* still
 * matters, because the walkway sits on the far one, and it is settled **by
 * rule, never by hash**: south is the one the camera can always see, the rule
 * the House's door and the Oven's mouth already follow. So the walkway is on
 * the far side of every site in the colony, and a site cannot rearrange itself
 * between two looks — which is also why `buildingBoxes` receiving no seed costs
 * nothing here.
 */
function siteFrame(g: number, b: Building, out: Box[]): void {
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;
  const west = b.x + SITE_INSET;
  const east = b.x + b.w - SITE_INSET;
  const far = b.y + SITE_INSET;
  const near = b.y + b.h - SITE_INSET;

  // Four posts, the old corner stakes moved outboard and raised.
  for (const ox of [west, east]) {
    for (const oz of [far, near]) out.push(box(ox, g, oz, SITE_SECTION, SITE_TOP, SITE_SECTION, PROP.stake));
  }
  // Two rails on **every** face, the near one included. They span `b.w`/`b.h`,
  // so a 3×3 Farm site and a 2×2 House site are one object at two sizes with no
  // second set of numbers anywhere.
  //
  // **The near face was open once and is closed now.** Three sides answered a
  // camera-occlusion worry that never survived a screenshot: every material
  // lands on the footprint's *first* tile, which is the far one, so at a 38°
  // view the near members clear the cubes by a whole tile on any footprint
  // larger than 1×1 — and on a 1×1 the lower near rail grazes the back edge of
  // the near cubes' tops and nothing else. What the missing side did buy was a
  // frame that read as broken rather than as deliberately open.
  for (const f of SITE_RAILS) {
    const y = g + f * SITE_TOP;
    for (const oz of [far, near]) {
      out.push(box(cx, y, oz, b.w - 2 * SITE_INSET, SITE_RAIL_DEPTH, SITE_SECTION, PROP.timber, 0, 0.92));
    }
    for (const ox of [west, east]) {
      out.push(box(ox, y, cz, SITE_SECTION, SITE_RAIL_DEPTH, b.h - 2 * SITE_INSET, PROP.timber, 0, 0.92));
    }
  }
  // One diagonal across each face's single bay, all four circling the plot the
  // same way, so the bracing reads as deliberate from any angle rather than as
  // four unrelated sticks.
  brace(g, west, far, east, far, true, -1, out);
  brace(g, east, far, east, near, false, 1, out);
  brace(g, east, near, west, near, true, 1, out);
  brace(g, west, near, west, far, false, -1, out);
  // The walkway: planking resting **on** the upper far rail and laid outboard of
  // that face, where real scaffold boards go. One plank wide is wider than the
  // 0.14 section the clearance above buys, and the surplus goes outboard rather
  // than in over the plot — the 0.07 budget is the whole reason the frame clears
  // the material slots, and a member that reached back inboard would spend it.
  //
  // **It sits a rail's thickness above the rail, not at the rail's own base.**
  // Flush, the plank's x and y extents are exactly the far rail's and its z
  // range a superset, so the rail is swallowed whole — no visible surface, four
  // coplanar faces decided by draw order, and "two rails on every face" stops
  // being true of what renders. Stacked, the deck reads as planking on a ledger
  // and clears the lattice's 0.49 ceiling by even more (0.64 against 0.59).
  //
  // The 0.16 overhang reaches neither `canPlace`, which tests the footprint, nor
  // pathing, whose occupancy is footprint-based — but it is **not** free.
  // `Picker.tileAt` floors the hit position, so a click on the overhang selects
  // the tile beyond the far face; a framed site measured about a fifth of its
  // own clickable area gone (docs/changelog/2026-09-16-no-leaning-geometry.md).
  const walk = SITE_WALK_OUT + SITE_SECTION;
  out.push(
    box(
      cx,
      g + SITE_RAILS[1] * SITE_TOP + SITE_RAIL_DEPTH,
      b.y + SITE_SECTION - walk / 2,
      b.w - 2 * SITE_INSET,
      SITE_RAIL_DEPTH,
      walk,
      PROP.plank,
      0,
      0.96,
    ),
  );
  // The tarp: rolled, stood on its foot against the far corner post, outside
  // the frame line where it hides nothing and the camera sees it whole.
  //
  // **Bottom-rooted is not a style choice.** `emitBox` writes the sway weight
  // through the same top-vertex mask it uses for `aBlockY`, pinning a box's
  // bottom and moving its top — so a strip *hung* from a rail would swing at
  // its lashing and hold still at its free end, backwards. Standing it on its
  // foot leans it the way the mask already moves, which is why this is sway and
  // not a fourth motion class (docs/STYLEGUIDE.md, Motion).
  out.push(
    swaying(
      box(b.x + b.w + 0.06, g, b.y + 0.24, SITE_SECTION, 0.82 * SITE_TOP, 0.26, PROP.linen, 0, 0.92),
      SWAY.cloth,
    ),
  );
}

/**
 * The diagonal bracing along one face, from (x0, z0) to (x1, z1).
 *
 * **A face is split into roughly square bays first**, and each bay gets its own
 * diagonal, alternating direction so the run zigzags. One diagonal corner to
 * corner was built first and does not work: a 2×2 face is 1.86 long and a storey
 * is 0.75, so the member lies at 22° and reads as a third rail — which is
 * exactly the fence the brace exists to stop the frame being. Bays about as wide
 * as the frame is tall put it near 50°, which is both what real scaffolding
 * looks like and unmistakable at map distance.
 *
 * **Each diagonal is a stepped run of boxes, because a tilted member does not
 * exist here**: `Box.rot` spins about +y and `emitBox` knows no other axis, so a
 * true diagonal would mean new mesher machinery for one prop. A staircase is
 * what a voxel world draws instead. The steps overlap — each is taller than its
 * own rise — so the run has no daylight in it, and the end ones land exactly on
 * the ground and on the post head.
 *
 * `alongX` says which way the face runs, because a box's two horizontal extents
 * are not interchangeable: a brace is `SITE_BRACE` thin across the face and one
 * step long down it. `outward` is which way is *away* from the plot on that
 * face, since nothing about the endpoints says which side of them the world is.
 */
function brace(
  g: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  alongX: boolean,
  outward: -1 | 1,
  out: Box[],
): void {
  // **Proud of the face, and in the walkway's pale plank rather than the rails'
  // timber.** Flush and in the same tone the brace merges with the two rails it
  // crosses into one plane of wood, and the diagonal stops being legible at all
  // — measured on screen, not guessed. Standing it out by `SITE_BRACE_PROUD`
  // puts it unambiguously in front, and **outward** rather than inward because
  // inward is where the material slots are and the 0.07 budget is spoken for.
  const ox = alongX ? 0 : outward * SITE_BRACE_PROUD;
  const oz = alongX ? outward * SITE_BRACE_PROUD : 0;
  const span = Math.abs(alongX ? x1 - x0 : z1 - z0);
  const bays = Math.max(1, Math.round(span / SITE_TOP));
  // One box per step of the stair, each exactly its own rise and run with a
  // fifth over for the overlap. Sized as a step rather than as a bar is the
  // whole difference between a diagonal and a thick vertical smear: a box much
  // taller than its rise overlaps its neighbours into a continuous band.
  //
  // The `+ 0.2` is what makes the run *end* on the post head rather than a
  // fifth of a step above it: boxes are placed by their **base**, so the top of
  // the last is `(steps - 1 + 1.2) · rise`, and dividing the storey by
  // `steps + 0.2` is what makes that come to exactly `SITE_TOP`. Spacing stays
  // `rise` against a height of `1.2 · rise`, so the overlap is untouched.
  const rise = SITE_TOP / (SITE_BRACE_STEPS + 0.2);
  const long = (span / bays / SITE_BRACE_STEPS) * 1.2;
  for (let bay = 0; bay < bays; bay++) {
    // Alternate, so the bracing zigzags along the face instead of reading as a
    // row of parallel sticks.
    const up = bay % 2 === 0;
    for (let i = 0; i < SITE_BRACE_STEPS; i++) {
      const t = (i + 0.5) / SITE_BRACE_STEPS;
      const along = (bay + (up ? t : 1 - t)) / bays;
      out.push(
        box(
          x0 + (x1 - x0) * along + ox,
          g + i * rise,
          z0 + (z1 - z0) * along + oz,
          alongX ? long : SITE_BRACE,
          rise * 1.2,
          alongX ? SITE_BRACE : long,
          PROP.plank,
          0,
          0.94,
        ),
      );
    }
  }
}

/**
 * Stockpile: a timber deck with corner posts. Its goods are drawn on top, by
 * the dynamic layer, because they change every few seconds.
 *
 * **Only a finished stockpile draws it.** A site under construction used to get
 * a half-height copy, which is what the old `scale` argument was for; the site
 * frame replaced it, and drawing both would have worn two frames on one
 * perimeter — its posts sit at these same `corners()` and its rails on these
 * same lines. So the deck emerges at full height when the frame comes down,
 * standing lower than the frame that wrapped it, which is the intended read.
 */
function deck(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  out.push(box(cx, g, cz, b.w - 0.12, 0.16 * BH, b.h - 0.12, PROP.timber));
  for (const [ox, oz] of corners(b)) {
    out.push(box(ox, g, oz, 0.16, 0.55 * BH, 0.16, PROP.stake));
  }
  // Two rails along the long sides, so a full pile still reads as contained.
  out.push(box(cx, g + 0.45 * BH, b.y + 0.18, b.w - 0.36, 0.1 * BH, 0.1, PROP.timber, 0, 0.92));
  out.push(box(cx, g + 0.45 * BH, b.y + b.h - 0.18, b.w - 0.36, 0.1 * BH, 0.1, PROP.timber, 0, 0.92));
}

/**
 * Sawmill: stone plinth, timber walls, one stepped roof slab. One roof, not
 * per-cell overhangs — per-cell roofs overlap and their shaded undersides read
 * as a dark waffle grid (docs/ARCHITECTURE.md, Gotchas).
 */
function sawmill(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  out.push(box(cx, g, cz, b.w - 0.06, 0.3 * BH, b.h - 0.06, PROP.stone));
  out.push(box(cx, g + 0.3 * BH, cz, b.w - 0.24, 1.5 * BH, b.h - 0.24, PROP.timber));
  // Stepped roof: two slabs, the lower one overhanging the walls.
  out.push(box(cx, g + 1.8 * BH, cz, b.w + 0.16, 0.3 * BH, b.h + 0.16, PROP.clay));
  out.push(box(cx, g + 2.1 * BH, cz, b.w - 0.5, 0.28 * BH, b.h - 0.5, PROP.clay, 0, 0.94));
  // Door on the south face, where the slot worker's station is.
  out.push(box(cx, g + 0.3 * BH, b.y + b.h - 0.13, 0.44, 0.95 * BH, 0.1, PROP.door));
  // A stack of cut timber against the west wall says what happens here.
  out.push(box(b.x + 0.26, g + 0.3 * BH, cz, 0.32, 0.3 * BH, b.h - 0.7, PROP.plank, 0, 0.96));
}

/**
 * House: timber walls under a pale gable, with a plank door and a shutter.
 *
 * Deliberately the sawmill's grammar with the workshop taken out — no stone
 * plinth, no timber stack, a narrower body and a lighter roof — because the two
 * have to be tellable apart across the map while still reading as the same
 * colony's carpentry. The door is `plank` rather than the workshop's dark
 * `door`: a House is what the sawmill's output is *for*, and saying so in the
 * one part of it a player looks at costs nothing.
 */
function house(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  out.push(box(cx, g, cz, b.w - 0.3, 1.4 * BH, b.h - 0.3, PROP.timber));
  // A gable rather than the sawmill's stepped clay slabs: two courses, the
  // upper one drawn in, so the silhouette comes to a ridge instead of a block.
  out.push(box(cx, g + 1.4 * BH, cz, b.w - 0.1, 0.3 * BH, b.h - 0.1, PROP.linen, 0, 0.96));
  out.push(box(cx, g + 1.7 * BH, cz, b.w - 0.7, 0.3 * BH, b.h - 0.7, PROP.linen, 0, 0.88));
  // Door on the south face, which is the face everything in this game walks up
  // to — the sawmill's rule, and where a wanderer arrives.
  out.push(box(cx + 0.3, g, b.y + b.h - 0.16, 0.4, 0.95 * BH, 0.1, PROP.plank));
  // One shuttered window beside it, in the darker door timber so it reads as a
  // recess rather than a panel.
  out.push(box(b.x + 0.45, g + 0.75 * BH, b.y + b.h - 0.16, 0.3, 0.32 * BH, 0.08, PROP.door));
}

/**
 * Farm: worked earth in furrows, inside a low fence, with the farmer's hut at
 * the south edge where the work tile is.
 *
 * Deliberately **flat** — it is the biggest footprint in the game, and a 3×3
 * building with a body and a roof would loom over the colony it feeds. The
 * furrows are what say "this ground is worked": one low ridge per row of the
 * footprint, so a 3×3 reads as three furrows and a future 4×4 would read as
 * four with nothing here to change. Crop growth stages are later polish; this
 * is the footprint saying what it is.
 */
function farm(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  out.push(box(cx, g, cz, b.w - 0.1, 0.1 * BH, b.h - 0.1, PROP.soil, 0, 0.96));
  // One furrow per row, short of the fence on both sides.
  for (let r = 0; r < b.h - 1; r++) {
    // The last row is the yard: the hut and the path stand there instead.
    const z = b.y + r + 0.5;
    // The standing green leans; the turned earth it stands in does not.
    out.push(swaying(box(cx, g + 0.1 * BH, z, b.w - 0.5, 0.16 * BH, 0.34, PROP.crop, 0, 0.94), SWAY.crop));
  }
  // A fence of low posts round the plot — a farm has a boundary, and it is what
  // keeps a flat prop from reading as a stain on the grass.
  for (const [ox, oz] of corners(b)) {
    out.push(box(ox, g, oz, 0.13, 0.6 * BH, 0.13, PROP.stake));
  }
  out.push(box(cx, g + 0.42 * BH, b.y + 0.18, b.w - 0.4, 0.08 * BH, 0.08, PROP.timber, 0, 0.92));
  out.push(box(cx, g + 0.42 * BH, b.y + b.h - 0.18, b.w - 0.4, 0.08 * BH, 0.08, PROP.timber, 0, 0.92));
  // The hut, in the south-east corner beside the work tile: small, one gable,
  // enough to say somebody works here.
  const hx = b.x + b.w - 0.75;
  const hz = b.y + b.h - 0.75;
  out.push(box(hx, g, hz, 1.0, 1.0 * BH, 1.0, PROP.timber));
  out.push(box(hx, g + 1.0 * BH, hz, 1.16, 0.26 * BH, 1.16, PROP.clay, 0, 0.94));
  out.push(box(hx, g, hz + 0.46, 0.34, 0.7 * BH, 0.08, PROP.door));
}

/**
 * The Hive: two straw skeps on a low timber stand, with a landing board.
 *
 * A prop of its own rather than a seventh shed, and deliberately: a hive is one
 * of the two buildings this game *invites* the player to put outside the wall,
 * so whether it is safe is something read off the map at distance. A silhouette
 * shared with the sawmill would have made that read impossible
 * (docs/specs/2026-09-14-hives-and-mead.md).
 */
function hive(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  // The stand: a plank table on four short legs, the deck grammar at half size.
  out.push(box(cx, g, cz, b.w - 0.5, 0.22 * BH, b.h - 0.5, PROP.timber));
  for (const [ox, oz] of corners(b)) {
    out.push(box(ox, g, oz, 0.12, 0.22 * BH, 0.12, PROP.stake));
  }
  // Two skeps **side by side across the stand**, not on the diagonal: at 2×2
  // the diagonal puts them 0.6 apart and they merge into one stepped pile.
  // Each is three tapering courses of coiled straw — the game's only stepped
  // cone, so the shape alone tells a hive from a shed at map distance.
  for (const ox of [b.x + 0.55, b.x + b.w - 0.55]) {
    const oz = cz;
    out.push(box(ox, g + 0.22 * BH, oz, 0.5, 0.26 * BH, 0.5, PROP.grain));
    out.push(box(ox, g + 0.48 * BH, oz, 0.38, 0.26 * BH, 0.38, PROP.grain, 0, 0.94));
    out.push(box(ox, g + 0.74 * BH, oz, 0.24, 0.22 * BH, 0.24, PROP.grain, 0, 0.88));
    // The landing board: a dark slot on the south face, which is what reads as
    // a *door* and keeps the cone from looking like a haystack.
    out.push(box(ox, g + 0.3 * BH, oz + 0.26, 0.22, 0.1 * BH, 0.06, PROP.door, 0, 0.9));
  }
}

/**
 * Flowers: a fenced 3×3 plot of bloom, the Pasture's rail grammar over a
 * blossom-speckled bed.
 *
 * Its own prop for the Hive's reason — fields are the other thing a player is
 * invited to put outside — and it is the one building in the game with no
 * worker and no door, so there is nothing else about it to read.
 */
function flowers(g: number, b: Building, out: Box[]): void {
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;
  out.push(box(cx, g, cz, b.w - 0.1, 0.1 * BH, b.h - 0.1, PROP.crop, 0, 0.82));
  for (const [ox, oz] of corners(b)) {
    out.push(box(ox, g, oz, 0.11, 0.5 * BH, 0.11, PROP.stake));
  }
  // One rail, low: a field is fenced against nothing, so it reads as a border
  // rather than as a pen.
  out.push(box(cx, g + 0.32 * BH, b.y + 0.18, b.w - 0.36, 0.07 * BH, 0.07, PROP.timber, 0, 0.92));
  out.push(box(cx, g + 0.32 * BH, b.y + b.h - 0.18, b.w - 0.36, 0.07 * BH, 0.07, PROP.timber, 0, 0.92));
  out.push(box(b.x + 0.18, g + 0.32 * BH, cz, 0.07, 0.07 * BH, b.h - 0.36, PROP.timber, 0, 0.92));
  out.push(box(b.x + b.w - 0.18, g + 0.32 * BH, cz, 0.07, 0.07 * BH, b.h - 0.36, PROP.timber, 0, 0.92));
  // Nine blooms on a fixed lattice. **The head leans, the stem does not** —
  // the head's own bottom vertices are masked to zero displacement, so it stays
  // seated on the stem instead of sliding off it, which is the whole reason the
  // sway weight is per vertex rather than per box.
  const bloom = [PROP.honey, PROP.mead, PROP.bolt] as const;
  for (let i = 0; i < 9; i++) {
    const ox = b.x + 0.55 + (i % 3) * 0.95;
    const oz = b.y + 0.55 + Math.floor(i / 3) * 0.95;
    out.push(box(ox, g + 0.1 * BH, oz, 0.08, 0.3 * BH, 0.08, PROP.crop, 0, 0.7));
    out.push(swaying(box(ox, g + 0.4 * BH, oz, 0.26, 0.14 * BH, 0.26, bloom[i % 3]), SWAY.bloom));
  }
}

/**
 * Pasture: grazed turf inside a rail fence, with a few sheep standing on it and
 * the shepherd's hut at the south edge where the work tile is.
 *
 * The Farm's grammar with the furrows taken out — flat for the same reason (a
 * 3×3 with a body and a roof would loom over the colony) and fenced for the
 * same reason (it is what keeps a flat prop from reading as a stain on the
 * grass), but a proper rail fence rather than the Farm's two low bars, because
 * a pasture's whole job is to hold something in.
 *
 * **The sheep are no longer baked here.** They came out when they started
 * walking: the flock is per-frame fauna in `render/fauna.ts`, bounded to this
 * footprint, so the fence is still the promise and it is now a promise you can
 * watch being kept. That reverses `docs/changelog/2026-09-11-sheep-and-clothes.md`,
 * which baked three static sheep in and closed the door on renderer-owned
 * animation state; what kept it shut was scope, not principle
 * (docs/specs/2026-09-15-ambient-life.md). Nothing in the sim knows they exist
 * either way — and a blueprint or half-built pasture still has no flock,
 * exactly as it had no baked sheep.
 */
function pasture(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  out.push(box(cx, g, cz, b.w - 0.1, 0.1 * BH, b.h - 0.1, PROP.crop, 0, 0.9));
  // A post at each corner and one midway along each side, with two rails
  // between them — a fence that reads as a fence at map distance.
  for (const [ox, oz] of corners(b)) {
    out.push(box(ox, g, oz, 0.13, 0.85 * BH, 0.13, PROP.stake));
  }
  for (const h of [0.34, 0.66]) {
    out.push(box(cx, g + h * BH, b.y + 0.18, b.w - 0.36, 0.08 * BH, 0.08, PROP.timber, 0, 0.92));
    out.push(box(cx, g + h * BH, b.y + b.h - 0.18, b.w - 0.36, 0.08 * BH, 0.08, PROP.timber, 0, 0.92));
    out.push(box(b.x + 0.18, g + h * BH, cz, 0.08, 0.08 * BH, b.h - 0.36, PROP.timber, 0, 0.92));
    out.push(box(b.x + b.w - 0.18, g + h * BH, cz, 0.08, 0.08 * BH, b.h - 0.36, PROP.timber, 0, 0.92));
  }
  // The hut, in the south-east corner beside the work tile: the Farm's, one
  // shade lighter on the roof so the two 3×3 plots are tellable apart.
  const hx = b.x + b.w - 0.75;
  const hz = b.y + b.h - 0.75;
  out.push(box(hx, g, hz, 1.0, 1.0 * BH, 1.0, PROP.timber));
  out.push(box(hx, g + 1.0 * BH, hz, 1.16, 0.26 * BH, 1.16, PROP.linen, 0, 0.94));
  out.push(box(hx, g, hz + 0.46, 0.34, 0.7 * BH, 0.08, PROP.door));
}

/**
 * Oven: a stone dome with a black mouth and a stub of chimney.
 *
 * The only building in the game made of *cut stone* — which is also what it
 * costs — so it reads as the mason's work rather than the carpenter's, and it
 * is unmistakable beside the timber Mill next to it. Two courses stepping in,
 * two courses rather than one, for a dome without a real one.
 */
function oven(cx: number, g: number, cz: number, b: Building, out: Box[]): void {
  out.push(box(cx, g, cz, b.w - 0.2, 0.9 * BH, b.h - 0.2, PROP.block));
  out.push(box(cx, g + 0.9 * BH, cz, b.w - 0.7, 0.5 * BH, b.h - 0.7, PROP.stoneWarm, 0, 0.96));
  // The doorway, on the south face the camera can always see at every tilt.
  out.push(box(cx, g + 0.1 * BH, b.y + b.h - 0.16, 0.5, 0.5 * BH, 0.12, PROP.doorway, 0, 0.85));
  // A short chimney off the back corner, and the fire's own glow is not drawn:
  // nothing in this game pulses (docs/STYLEGUIDE.md, Tone).
  out.push(box(b.x + 0.42, g + 1.4 * BH, b.y + 0.42, 0.26, 0.7 * BH, 0.26, PROP.stone, 0, 0.9));
}

/**
 * Watchtower: four battered legs, a braced shaft and a railed platform with a
 * shallow cap over it.
 *
 * **The tallest thing the colony builds, and the only one that is all
 * height** — it stands well over the stone gate, because a tower whose whole
 * product is seeing further has to read as looking over the wall from across
 * the map. That is the entire silhouette job: at 1×1 there is no footprint to
 * recognise it by, so the taper and the platform are what say *tower* rather
 * than *shed*.
 *
 * Timber and stake, no clay and no stone body: it is the carpenter's work, not
 * the mason's, which is also what it costs. Nobody is drawn on the platform —
 * a colonist `inside` is not rendered, by the existing rule, and the panel's
 * worker row is the tell (docs/specs/2026-09-09-watchtowers.md).
 */
function watchtower(cx: number, g: number, cz: number, out: Box[]): void {
  // A scraped stone footing, so the legs do not read as sticks pushed into
  // grass.
  out.push(box(cx, g, cz, 0.86, 0.16 * BH, 0.86, PROP.stone, 0, 0.92));
  // Four legs, set in from the tile edge so the platform above can overhang
  // them — the overhang is what makes the taper read at distance.
  const LEG = 0.26;
  const legs: [number, number][] = [
    [-LEG, -LEG],
    [LEG, -LEG],
    [-LEG, LEG],
    [LEG, LEG],
  ];
  for (const [ox, oz] of legs) {
    out.push(box(cx + ox, g + 0.16 * BH, cz + oz, 0.15, 3.1 * BH, 0.15, PROP.timber));
  }
  // Cross-bracing at two heights, one bar per axis — enough to say "framed"
  // without the pair of bars per side that would close the tower in.
  for (const h of [1.0, 2.2]) {
    out.push(box(cx, g + h * BH, cz - LEG, 2 * LEG, 0.1 * BH, 0.1, PROP.stake, 0, 0.94));
    out.push(box(cx - LEG, g + h * BH, cz, 0.1, 0.1 * BH, 2 * LEG, PROP.stake, 0, 0.94));
  }
  // The platform, overhanging the legs on every side — but **not its own
  // tile**, which is the one place this differs from the sawmill's roof.
  // Every other building overhangs a little (`b.w + 0.16` on a shed roof) and
  // pays nothing for it, because a 2×2 still has interior tiles whose top face
  // picks correctly. A 1×1 has none: the cap *is* the tile, so a rim hanging
  // over the neighbour makes `Picker.tileAt` (which floors the hit position)
  // resolve a click on the tower's most clickable surface to the tile next
  // door — and the tower is the only 1×1 target in the game. Everything above
  // the legs therefore stays inside 1.0.
  out.push(box(cx, g + 3.26 * BH, cz, 0.94, 0.22 * BH, 0.94, PROP.timber, 0, 0.96));
  // A rail round it: four low bars at the platform's edge.
  const R = 0.42;
  out.push(box(cx, g + 3.48 * BH, cz - R, 0.94, 0.4 * BH, 0.1, PROP.stake, 0, 0.9));
  out.push(box(cx, g + 3.48 * BH, cz + R, 0.94, 0.4 * BH, 0.1, PROP.stake, 0, 0.9));
  out.push(box(cx - R, g + 3.48 * BH, cz, 0.1, 0.4 * BH, 0.94, PROP.stake, 0, 0.9));
  out.push(box(cx + R, g + 3.48 * BH, cz, 0.1, 0.4 * BH, 0.94, PROP.stake, 0, 0.9));
  // A shallow cap on two short posts — shade, not a roof, so the watch post
  // still reads as open.
  out.push(box(cx - 0.34, g + 3.88 * BH, cz - 0.34, 0.1, 0.6 * BH, 0.1, PROP.timber));
  out.push(box(cx + 0.34, g + 3.88 * BH, cz + 0.34, 0.1, 0.6 * BH, 0.1, PROP.timber));
  out.push(box(cx, g + 4.48 * BH, cz, 0.98, 0.2 * BH, 0.98, PROP.plank, 0, 0.94));
}

/** Which way a segment's run goes, as a bitmask of neighbours holding wall. */
export const WallLink = { West: 1, East: 2, North: 4, South: 8 } as const;

/** Palisade height in world units, and the gate's taller frame. */
const WALL_TOP = 2.2 * BH;
const GATE_TOP = 2.9 * BH;
/** Stone stands a little taller than timber, and its gateway taller again —
 *  the permanent tier should read as the permanent tier from across the map. */
const STONE_TOP = 2.6 * BH;
const STONE_GATE_TOP = 3.2 * BH;

/**
 * A palisade's four possible arms.
 *
 * `s` is the stake-height key each arm borrows, and the pairing is deliberate:
 * West and North both take −1, East and South both take +1, which is exactly
 * what the old one-axis-per-tile code used for its two outer stakes. That makes
 * a straight run — horizontal or vertical — keep the identical stake heights it
 * had before this became corner-aware. The cost is that a four-way cross shows
 * two heights across its four arms rather than four; a straight run is most of
 * every wall and a cross is rare, so identity there is worth more.
 */
const ARMS = [
  { bit: WallLink.West, dx: -1, dz: 0, s: -1 },
  { bit: WallLink.East, dx: 1, dz: 0, s: 1 },
  { bit: WallLink.North, dx: 0, dz: -1, s: -1 },
  { bit: WallLink.South, dx: 0, dz: 1, s: 1 },
] as const;

/** Rail heights as fractions of the palisade, and its cross-section. */
const RAIL_HEIGHTS = [0.4, 0.76] as const;
const RAIL_THICK = 0.11;
const RAIL_DEPTH = 0.14 * BH;
const STAKE_THICK = 0.19;
/** How far from the tile centre a stake stands, along its arm. */
const STAKE_OUT = 0.32;
/**
 * How far an arm's rails reach *past* the tile centre. Without it two arms
 * meeting at a corner would each stop dead on the centre line and leave a
 * hairline of daylight at the join; with it they interpenetrate inside the
 * centre post, where the surplus faces are enclosed and never drawn.
 */
const RAIL_OVERLAP = 0.07;
const ARM_LEN = 0.5 + RAIL_OVERLAP;
const ARM_MID = (0.5 - RAIL_OVERLAP) / 2;

/**
 * One wall segment on tile (tx, ty).
 *
 * Built from the palette rather than from a recipe — the mockup's `fence()` is
 * a single low pole, inspiration only; `deck()` above is where the rail
 * assembly comes from. A gate is two heavier posts either side of the opening
 * under a lintel, leaving the middle open, because the gap runs *through* the
 * wall and that is the way folk walk.
 *
 * **A palisade is a centre post plus an arm per linked direction** — stakes and
 * rails per *arm*, never a run along one chosen axis. That is what makes
 * corners, T-junctions and crosses come out right; a straight run is the
 * two-opposite-arms case and looks exactly as it did before.
 *
 * `links` says which neighbours hold wall (any state, so a drawn line reads as
 * a line before it is raised). Gate and blueprint variants still take a single
 * dominant axis — a gateway has a side you walk through, so it has to choose.
 * `markChunkDirty` covers every chunk within one tile of an edit, which is
 * exactly the reach this function needs, so orientation propagates to the
 * neighbours of a new segment for free (docs/changelog/2026-09-01-dirty-chunk-neighbours.md).
 *
 * A raze-marked segment's timber bakes toward gold at the same strength a
 * designated canopy does: the base diamond is the precise mark, this is the one
 * visible from across the map.
 */
export function wallBoxes(
  tx: number,
  ty: number,
  h: number,
  seed: number,
  out: Box[],
  state: number,
  links: number,
  razeMarked = false,
  damage = 0,
): void {
  // Bite damage darkens the whole segment, in thirds, and takes its top rail
  // off once it is past two of them. `damage` is the *tier* rather than the raw
  // number, so the mesher only rebakes on a crossing — forty bites per palisade
  // would otherwise be forty chunk rebuilds for a change nobody can see.
  const tier = Math.min(DAMAGE_SHADE.length - 1, Math.max(0, damage));
  const first = out.length;
  wallMembers(tx, ty, h, seed, out, state, links, razeMarked, tier);
  if (tier === 0) return;
  const wear = DAMAGE_SHADE[tier];
  for (let i = first; i < out.length; i++) out[i].shade *= wear;
}

function wallMembers(
  tx: number,
  ty: number,
  h: number,
  seed: number,
  out: Box[],
  state: number,
  links: number,
  razeMarked: boolean,
  tier: number,
): void {
  const g = h * BH;
  const x = tx + 0.5;
  const z = ty + 0.5;
  const axisX = (links & (WallLink.West | WallLink.East)) !== 0 || (links & (WallLink.North | WallLink.South)) === 0;
  const mark = (colour: number): number =>
    razeMarked ? lerpHex(colour, OVERLAY.gold, DESIGNATED_TINT) : colour;
  // Along the run, and across it: every part below is placed in these two.
  const along = (d: number): number => (axisX ? x + d : x);
  const across = (d: number): number => (axisX ? z : z + d);
  const spanX = (long: number, short: number): number => (axisX ? long : short);
  const spanZ = (long: number, short: number): number => (axisX ? short : long);

  const stone = isStoneWall(state);
  const gate = isGateway(state);

  if (wallIsBlueprint(state)) {
    // The building blueprint's grammar, at one tile: a scraped plate and a
    // stake at each end of the run. A *gate* blueprint stands its stakes
    // taller and joins them with a crossbar, so a planned gate is visible as a
    // gate in a drawn line rather than only once it is standing. Stone
    // blueprints are the identical grammar in the stone palette — a drawn
    // stone line has to be tellable from a drawn timber one *before* anybody
    // spends a block on it.
    const post = gate ? 1.1 * BH : 0.55 * BH;
    const peg = stone ? PROP.stone : PROP.stake;
    out.push(box(x, g, z, 0.86, 0.06, 0.86, mark(peg), 0, 0.85));
    for (const s of [-1, 1]) {
      out.push(box(along(s * 0.34), g, across(s * 0.34), stone ? 0.17 : 0.13, post, stone ? 0.17 : 0.13, mark(peg)));
    }
    if (gate) {
      out.push(box(x, g + post, z, spanX(0.8, 0.1), 0.12 * BH, spanZ(0.8, 0.1), mark(peg), 0, 0.9));
    }
    return;
  }

  if (gate) {
    // A gateway is two piers either side of the opening under a lintel,
    // leaving the middle open, because the gap runs *through* the wall and
    // that is the way folk walk. Stone makes it a squared arch: heavier piers,
    // a deeper lintel, and a second course above it.
    const top = stone ? STONE_GATE_TOP : GATE_TOP;
    const pier = stone ? 0.3 : 0.24;
    for (const s of [-1, 1]) {
      out.push(
        box(
          along(s * 0.36),
          g,
          across(s * 0.36),
          spanX(pier, 0.34),
          top,
          spanZ(pier, 0.34),
          mark(stone ? PROP.stone : PROP.trunk),
          0,
          stone ? 0.97 : 1,
        ),
      );
    }
    // The lintel, spanning the two piers and overhanging them a little.
    out.push(
      box(x, g + top, z, spanX(1.0, 0.4), 0.36 * BH, spanZ(1.0, 0.4), mark(stone ? PROP.stoneWarm : PROP.timber), 0, 0.94),
    );
    if (stone) {
      // The capstone course: what turns two posts and a beam into an arch.
      out.push(box(x, g + top + 0.36 * BH, z, spanX(0.76, 0.3), 0.2 * BH, spanZ(0.76, 0.3), mark(PROP.stone), 0, 0.9));
    }
    return;
  }

  if (stone) {
    stoneCourses(tx, ty, g, seed, out, links, mark);
    return;
  }

  // A palisade is a centre post plus one arm per linked direction, never a run
  // along a single chosen axis. Picking one axis per tile is what made every
  // corner render as a straight segment — stakes across the turn instead of
  // along it, and the perpendicular run's rails stopping half a tile short of
  // the join, which left a hole at every corner and made T and cross junctions
  // wrong by construction. Arms cost nothing extra to get right: each one is
  // its own half-tile piece, so a corner, a T and a cross all just work.
  const stake = (ox: number, oz: number, s: number): void => {
    const j = hash(tx * 3 + s + 1, ty * 3 + s + 1, seed ^ WALL_SALT);
    out.push(
      box(x + ox, g, z + oz, STAKE_THICK, WALL_TOP * (0.88 + j * 0.24), STAKE_THICK, mark(PROP.trunk)),
    );
  };

  stake(0, 0, 0);
  // A lone segment has no arms to take orientation from, so it borrows the
  // east-west pair: that is what it looked like before, and a single click
  // should still read as a piece of wall rather than as a solitary post.
  const arms = links === 0 ? WallLink.West | WallLink.East : links;
  for (const arm of ARMS) {
    if (!(arms & arm.bit)) continue;
    stake(arm.dx * STAKE_OUT, arm.dz * STAKE_OUT, arm.s);
    for (const fy of RAIL_HEIGHTS) {
      // Past two thirds gone the upper rail is simply missing: darkening alone
      // reads as shadow at the opening zoom, and a gap in the silhouette is
      // what actually says "this is coming apart".
      if (tier >= 2 && fy === RAIL_HEIGHTS[RAIL_HEIGHTS.length - 1]) continue;
      out.push(
        anchorJitter(
          box(
            x + arm.dx * ARM_MID,
            g + fy * WALL_TOP,
            z + arm.dz * ARM_MID,
            arm.dx !== 0 ? ARM_LEN : RAIL_THICK,
            RAIL_DEPTH,
            arm.dz !== 0 ? ARM_LEN : RAIL_THICK,
            mark(PROP.timber),
            0,
            0.9,
          ),
          // Both of a run's rail halves wobble as one member, so the tile
          // centre never shows a colour seam where the arms meet.
          x,
          z,
        ),
      );
    }
  }
}

/** Stone wall cross-section, as fractions of a tile. */
const STONE_THICK = 0.66;
/** The capping lip, wider than the courses under it — the mockup's wall-walk
 *  lip, which is what stops a stone run reading as an extruded slab. */
const STONE_LIP = 0.78;
const STONE_LIP_DEPTH = 0.22 * BH;
/** Two courses under the lip. Three read as busy at the zoom the game opens
 *  at, one reads as a slab. */
const STONE_COURSES = 2;

/**
 * A stone segment: **courses of masonry, arm per linked side**, exactly the
 * structure the palisade uses — so corners, T-junctions and crosses come out
 * right for the same reason, and a stone line meeting a timber one lines up.
 *
 * What makes it read as stone rather than as timber in grey is the coursing: a
 * centre block and one half-tile block per arm, stacked twice with the two
 * courses in different tones and offset a hair in thickness, then capped by a
 * wider lip. The tones come off a per-tile hash, so a long wall weathers
 * unevenly without any of that being stored.
 */
function stoneCourses(
  tx: number,
  ty: number,
  g: number,
  seed: number,
  out: Box[],
  links: number,
  mark: (colour: number) => number,
): void {
  const x = tx + 0.5;
  const z = ty + 0.5;
  const arms = links === 0 ? WallLink.West | WallLink.East : links;
  const courseHeight = (STONE_TOP - STONE_LIP_DEPTH) / STONE_COURSES;

  for (let c = 0; c < STONE_COURSES; c++) {
    const j = hash(tx * 2 + c, ty * 2 + c, seed ^ WALL_SALT);
    // Alternating tone per course, with the hash deciding which way round —
    // so neighbouring tiles do not stripe in lockstep.
    const colour = (c + (j > 0.5 ? 1 : 0)) % 2 === 0 ? PROP.stone : PROP.stoneWarm;
    const shade = 0.94 + j * 0.08;
    // Each course sits a touch narrower than the one below: a straight batter,
    // which is what stops the silhouette reading as a printed slab.
    const thick = STONE_THICK - c * 0.05;
    const y = g + c * courseHeight;
    out.push(anchorJitter(box(x, y, z, thick, courseHeight, thick, mark(colour), 0, shade), x, z));
    for (const arm of ARMS) {
      if (!(arms & arm.bit)) continue;
      out.push(
        anchorJitter(
          box(
            x + arm.dx * ARM_MID,
            y,
            z + arm.dz * ARM_MID,
            arm.dx !== 0 ? ARM_LEN : thick,
            courseHeight,
            arm.dz !== 0 ? ARM_LEN : thick,
            mark(colour),
            0,
            shade,
          ),
          // One member, one wobble: the arms and the centre block are the same
          // course and must not show a seam where they meet.
          x,
          z,
        ),
      );
    }
  }

  // The lip, overhanging the courses on every linked side.
  const lipY = g + STONE_COURSES * courseHeight;
  out.push(anchorJitter(box(x, lipY, z, STONE_LIP, STONE_LIP_DEPTH, STONE_LIP, mark(PROP.stone), 0, 1), x, z));
  for (const arm of ARMS) {
    if (!(arms & arm.bit)) continue;
    out.push(
      anchorJitter(
        box(
          x + arm.dx * ARM_MID,
          lipY,
          z + arm.dz * ARM_MID,
          arm.dx !== 0 ? ARM_LEN : STONE_LIP,
          STONE_LIP_DEPTH,
          arm.dz !== 0 ? ARM_LEN : STONE_LIP,
          mark(PROP.stone),
          0,
          1,
        ),
        x,
        z,
      ),
    );
  }
}

const GRAVE_SALT = 0x9e3779b1;

/** How deep a beached hull sits, and how tall its mast stands — both as
 *  fractions of a block. The mast is where the silhouette comes from: it costs
 *  no horizontal area at all, which is what lets the hull stay inside its tile. */
const BOAT_H = 0.5;
const MAST_H = 1.8;

/**
 * A beached longship on tile (tx, ty): a tarred hull with an upturned prow and
 * stern, a pale trim along its sheer, and a mast carrying a square sail.
 *
 * **It is the whole of what "they came from there" means.** An incursion has one
 * landing site precisely so the direction is readable at a glance, and this is
 * the thing that is glanced at; it stands on the sand for as long as the storm
 * lasts and goes when the last monster leaves
 * (docs/specs/2026-09-17-incursions-from-the-sea.md). Nothing interacts with it.
 *
 * **It stays inside its own tile**, unlike almost every other prop here. A boat
 * lands on open sand where the nearest thing to click is more sand, but the rule
 * is the rule: anything standing proud of a footprint resolves a click on itself
 * to the tile next door, because `Picker.tileAt` floors the hit position
 * (src/render/CLAUDE.md). **The sail is what does the reading instead** — a pale
 * panel a mast-height up is visible across the map where a low dark hull on pale
 * sand is not, and neither of them costs a neighbouring tile anything.
 *
 * `rot` comes from the mesher, which knows which side the water is on, so a hull
 * lies **along the shore** rather than at a hash-picked angle. It is a quarter
 * turn at a time, so nothing here leans — `Box.rot` spins about +y and knows no
 * other axis (src/render/CLAUDE.md).
 */
export function boatBoxes(tx: number, ty: number, h: number, rot: number, out: Box[]): void {
  const g = h * BH;
  const x = tx + 0.5;
  const z = ty + 0.5;
  // Along the hull's length and across its beam, in world terms — one of the two
  // is always zero, since `rot` is only ever a quarter turn.
  const ax = Math.cos(rot);
  const az = -Math.sin(rot);
  // The hull, in two courses so it reads as a shell rather than as a crate: a
  // long keel with a shorter, paler gunwale course on top.
  out.push(box(x, g, z, 0.92, BOAT_H * BH, 0.42, PROP.hull, rot));
  out.push(box(x, g + BOAT_H * BH, z, 0.74, 0.14 * BH, 0.3, PROP.hullTrim, rot, 0.95));
  // Prow and stern, stepped up rather than tilted — the one way a curve can be
  // drawn in this renderer.
  out.push(box(x + ax * 0.4, g + BOAT_H * BH, z + az * 0.4, 0.14, 0.42 * BH, 0.26, PROP.hull, rot, 0.9));
  out.push(box(x - ax * 0.4, g + BOAT_H * BH, z - az * 0.4, 0.14, 0.3 * BH, 0.26, PROP.hull, rot, 0.9));
  // The mast, and the square sail hung along it — all of the height and none of
  // the width.
  out.push(box(x, g + BOAT_H * BH, z, 0.09, MAST_H * BH, 0.09, PROP.hullTrim, rot));
  out.push(box(x, g + (BOAT_H + MAST_H - 0.08) * BH, z, 0.68, 0.1 * BH, 0.1, PROP.hullTrim, rot, 0.9));
  out.push(box(x, g + (BOAT_H + 0.55) * BH, z, 0.6, 1.15 * BH, 0.07, PROP.sail, rot, 0.98));
}

/**
 * A grave on tile (tx, ty): turned earth and a leaning board.
 *
 * Small on purpose. CONCEPT is explicit that a death is *just the loss* — the
 * folk readout shrinking is the game's whole obituary — so this is a marker the
 * player may happen to walk past, not a monument that asks for anything. It
 * blocks nothing and clears silently under a building or a shovel.
 */
export function graveBoxes(tx: number, ty: number, h: number, seed: number, out: Box[]): void {
  const g = h * BH;
  const x = tx + 0.5;
  const z = ty + 0.5;
  const j = hash(tx, ty, seed ^ GRAVE_SALT);
  const lean = (j - 0.5) * 0.5;
  out.push(box(x, g, z, 0.46, 0.1 * BH, 0.62, PROP.graveEarth, lean, 0.95));
  out.push(box(x, g + 0.1 * BH, z - 0.16, 0.26, 0.44 * BH, 0.07, PROP.graveBoard, lean));
  out.push(box(x, g + 0.4 * BH, z - 0.16, 0.4, 0.09 * BH, 0.07, PROP.graveBoard, lean, 0.92));
}

function treeStyle(tx: number, ty: number, seed: number): number {
  return hash(tx, ty, seed ^ TREE_SALT);
}

/** Per-prop colour wobble, keyed to position so it never shimmers. */
export function propJitter(x: number, z: number, seed: number): number {
  const j = hash(Math.round(x * 4), Math.round(z * 4), seed ^ TREE_SALT);
  return 1 - PROP_JITTER * 0.5 + j * PROP_JITTER;
}
