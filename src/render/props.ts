import { hash } from "../sim/world/noise";
import { BuildingKind, BuildingState, isGateway, isStoneWall, wallIsBlueprint, type Building } from "../sim/know";
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
}

const TREE_SALT = 0x1b873593;
const WALL_SALT = 0xc2b2ae35;

function box(x: number, base: number, z: number, sx: number, sy: number, sz: number, color: number, rot = 0, shade = 1): Box {
  return { x, y: base + sy / 2, z, sx, sy, sz, rot, color, shade, jx: x, jz: z };
}

/** Wobble this box's colour as if it sat at (jx, jz). See `Box.jx`. */
function anchorJitter(b: Box, jx: number, jz: number): Box {
  b.jx = jx;
  b.jz = jz;
  return b;
}

/** Block height in world units — one voxel step. Shared with the mesher. */
export const BH = 0.5;

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
    out.push(box(x, g + 1.15 * BH, z, 0.9, 1.05 * BH, 0.9, leaf(PROP.leafA), rot));
    out.push(box(x, g + 2.2 * BH, z, 0.62, 0.85 * BH, 0.62, leaf(PROP.leafB), rot));
    out.push(box(x, g + 3.05 * BH, z, 0.32, 0.55 * BH, 0.32, leaf(PROP.leafA), rot));
    return;
  }
  if (v > 0.3) {
    out.push(box(x, g, z, 0.28, 0.95 * BH, 0.28, v > 0.52 ? PROP.trunk : PROP.birch, rot));
    out.push(box(x, g + 0.95 * BH, z, 1.0, 1.35 * BH, 1.0, leaf(v > 0.46 ? PROP.leafB : PROP.leafC), rot));
    out.push(box(x + 0.1, g + 2.3 * BH, z - 0.08, 0.58, 0.62 * BH, 0.58, leaf(PROP.leafA), -rot));
    return;
  }
  // A bush is all canopy — there is no trunk to leave alone.
  out.push(box(x, g, z, 0.68, 0.5 * BH, 0.68, leaf(PROP.leafB), rot));
  out.push(box(x + 0.2, g, z - 0.16, 0.46, 0.38 * BH, 0.46, leaf(PROP.leafC), -rot));
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
    // Marked-out plot: a scraped plate and a stake at each corner.
    out.push(box(cx, g, cz, b.w - 0.1, 0.06, b.h - 0.1, PROP.stake, 0, 0.85));
    for (const [ox, oz] of corners(b)) {
      out.push(box(ox, g, oz, 0.14, 0.5 * BH, 0.14, PROP.stake));
    }
    if (b.state === BuildingState.Building) {
      // Materials are in: the shape starts coming up out of the ground.
      if (b.kind === BuildingKind.Stockpile) deck(cx, g, cz, b, out, 0.5);
      else out.push(box(cx, g + 0.06, cz, b.w - 0.35, 0.7 * BH, b.h - 0.35, PROP.timber, 0, 0.9));
    }
    return;
  }

  if (b.kind === BuildingKind.Stockpile) {
    deck(cx, g, cz, b, out, 1);
    return;
  }
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

/** Stockpile: a timber deck with corner posts. Its goods are drawn on top,
 *  by the dynamic layer, because they change every few seconds. */
function deck(cx: number, g: number, cz: number, b: Building, out: Box[], scale: number): void {
  out.push(box(cx, g, cz, b.w - 0.12, 0.16 * BH, b.h - 0.12, PROP.timber));
  for (const [ox, oz] of corners(b)) {
    out.push(box(ox, g, oz, 0.16, 0.55 * BH * scale, 0.16, PROP.stake));
  }
  // Two rails along the long sides, so a full pile still reads as contained.
  out.push(box(cx, g + 0.45 * BH * scale, b.y + 0.18, b.w - 0.36, 0.1 * BH, 0.1, PROP.timber, 0, 0.92));
  out.push(box(cx, g + 0.45 * BH * scale, b.y + b.h - 0.18, b.w - 0.36, 0.1 * BH, 0.1, PROP.timber, 0, 0.92));
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

const LAIR_SALT = 0x9e3779b1;

/**
 * A den on tile (tx, ty): a dark mound of turned earth with a black mouth in
 * it and a couple of bones lying about.
 *
 * A landmark rather than a warning. It is baked into the chunk mesh like a tree
 * because it never moves — one monster per lair and monsters cannot be killed,
 * so this is as static as world content gets — and it reads at distance by
 * silhouette and by being the one dark thing on open grass. Nothing about it
 * pulses or glows: the world is the world, and the ribbon's meter is where the
 * game says anything about danger (docs/STYLEGUIDE.md, Tone).
 */
export function lairBoxes(tx: number, ty: number, h: number, seed: number, out: Box[]): void {
  const g = h * BH;
  const x = tx + 0.5;
  const z = ty + 0.5;
  const j = hash(tx, ty, seed ^ LAIR_SALT);
  const rot = (j - 0.5) * 0.6;

  // The mound, in two courses so it domes rather than reading as a slab. It is
  // narrower than a full tile on purpose: the bones below have to sit *outside*
  // it or they are enclosed geometry nobody ever sees.
  out.push(box(x, g, z, 0.8, 0.52 * BH, 0.8, PROP.den, rot));
  out.push(box(x, g + 0.52 * BH, z, 0.52, 0.36 * BH, 0.52, PROP.den, rot, 0.9));
  // The mouth: a dark hollow cut into the south face, which is the face the
  // camera can see at every tilt the game allows. It overhangs the mound a
  // little so it reads as an opening rather than as a shadow.
  out.push(box(x, g, z + 0.32, 0.38, 0.42 * BH, 0.3, PROP.denMouth, rot, 0.8));
  // Bones. Two, small, and at opposite corners clear of the mound — enough to
  // say what lives here without turning a landmark into a diorama.
  out.push(box(x - 0.42, g, z - 0.3, 0.26, 0.1 * BH, 0.08, PROP.bone, rot + 0.7));
  out.push(box(x + 0.38, g, z + 0.32, 0.2, 0.09 * BH, 0.08, PROP.bone, rot - 1.1));
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
  const j = hash(tx, ty, seed ^ LAIR_SALT);
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
