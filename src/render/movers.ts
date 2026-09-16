import {
  BoxGeometry,
  BufferAttribute,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from "three";
import {
  BuildingKind,
  BuildingState,
  Loc,
  buildings,
  chopLayer,
  colonists,
  footprint,
  insideLayer,
  items,
  mineLayer,
  razeLayer,
  terraformLayer,
  monsters,
  BUILDING_DEFS,
  MonsterKind,
  type Building,
  type BuildingKindValue,
  type ItemTypeValue,
  type MonsterKindValue,
  type Sim,
} from "../sim/know";
import { hash } from "../sim/world/noise";
import { WORLD_SIZE, tileIndex } from "../sim/world/world";
import { Fauna, FaunaKind, type Herd } from "./fauna";
import { boxBounds, type SelectionBox } from "./pick";
import { createMoverMaterial } from "./materials";
import { GOOD_HEX, OVERLAY, PROP } from "./palette";
import { BH, BUFFER_Y, DECK_Y } from "./props";

/**
 * The dynamic layer: everything that moves or changes every few ticks, drawn
 * as per-frame `InstancedMesh`es rather than baked into chunk geometry.
 *
 * Colonists, the goods they carry, the pile on a stockpile and a mill's buffer
 * contents belong here; trees and building structure do not (they bake — see
 * props.ts). The split is by *rate of change*, not by kind.
 *
 * Colonist positions interpolate between the previous tick and the current one
 * by the app loop's leftover accumulator fraction, so a 10 Hz sim never looks
 * like 10 Hz.
 */

/** Shared unit cube. It carries a white `color` attribute because instanced
 *  tinting only reaches the fragment stage under `USE_COLOR` — see
 *  `createMoverMaterial`. */
function unitBox(): BoxGeometry {
  const box = new BoxGeometry(1, 1, 1);
  box.setAttribute("color", new BufferAttribute(new Float32Array(box.attributes.position.count * 3).fill(1), 3));
  // Props take the same contact shading as terrain: 0 at the box's own base,
  // 1 at its top, exactly as the mockup's unit-cube props did.
  const pos = box.attributes.position;
  const blockY = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) blockY[i] = pos.getY(i) > 0 ? 1 : 0;
  box.setAttribute("aBlockY", new BufferAttribute(blockY, 1));
  return box;
}

const BOX = unitBox();
const FLAT = new BoxGeometry(1, 1, 1);

/** The styleguide's in-world overlay grammar: gold = player intent, sage =
 *  valid, rust = invalid. No alarm red, ever. Tokens live in palette.ts so the
 *  baked canopy tint and these overlays cannot drift apart. */
const { gold: GOLD, sage: SAGE, rust: RUST, keyline: KEYLINE } = OVERLAY;

/**
 * Overlay line weights, in tiles.
 *
 * The styleguide specifies the ghost's border in *screen* pixels ("2px
 * border", "grid lines at 0.5 alpha"), which a world-space overlay has to
 * translate. At the opening zoom a tile is roughly 20px tall, so 2px is about
 * a tenth of a tile. Thinner than this and the line falls under a pixel and
 * alpha-blends away entirely — which is how a sage ghost on bright grass ends
 * up invisible even though it is being drawn.
 */
const BORDER = 0.11;
const GRID_LINE = 0.05;
const MARK_LINE = 0.08;
/**
 * The enclosure boundary. Dialed by eye against real grass at the opening
 * zoom: 0.07 measured as a hairline that read as dark rather than as sage,
 * because the keyline under it is wider than the sage on top of it. At 0.11 —
 * the same weight as a placement ghost's border — the sage wins and the
 * keyline goes back to being what it is for.
 */
const INSIDE_LINE = 0.11;

/**
 * Every overlay line sits on a dark keyline in the styleguide's `ground`
 * token, because the meaning colours alone do not survive the world.
 *
 * Sage `#8fbf52` and the terrain's grass `#7ec043` are within a few percent of
 * each other: a *fully opaque* sage border on grass measures under 15/255 per
 * channel against its background, which is to say invisible. The guide's
 * palette was dialed against dark moss-glass panels, where sage is brilliant.
 * The keyline keeps the meaning colours exactly as specified and buys them a
 * background to read against — see docs/STYLEGUIDE.md, in-world overlay
 * grammar, which now records this.
 */
const KEYLINE_GROWTH = 0.05;

/**
 * Folk wear the mockup's cloth colours — world colours, so they read against
 * grass. Pool-vs-slot is the HUD's labour meter's job, not the model's.
 *
 * **The rotation is what being clothed looks like.** An unclothed colonist
 * wears `PROP.drab` instead: one undyed tone against these three, so dressing
 * the colony literally brings colour to it and the difference reads at map
 * distance with no HUD readout anywhere — no ribbon count and no per-colonist
 * panel, per the calm doctrine (docs/specs/2026-09-10-sheep-and-clothes.md).
 */
const CLOTH = [PROP.tunic, PROP.wool, PROP.smock];

const MAX_COLONISTS = 64;
/** Two boxes each, and the lair pass targets a couple of dozen dens — sized
 *  well clear of that so a denser map never silently drops one. */
const MAX_MONSTERS = 128;
const MAX_ITEMS = 1024;
const MAX_OVERLAY = 8192;
/**
 * The enclosure wash is one plate per enclosed tile, so its ceiling is the
 * biggest colony the wash can cover whole — a ~128×128 enclosure. Past that
 * the fill goes partial while the boundary line, which is what the player
 * actually reads, stays complete: the boundary gets its own layers for exactly
 * that reason.
 *
 * **The area tools' drag box reuses both**, because it is the same shape of
 * overlay — a filled region under a traced boundary — and wants the same
 * division of failure. Here that division is a *guarantee* rather than a hope:
 * a `w × h` box costs `2w + 2h` bars (its corners are double-visited inside the
 * four runs, exactly as `SQUARE_BARS` counts them), which peaks at 1,024 for a
 * box covering the whole 256² map and so cannot reach `MAX_BOUNDARY`, while the
 * fill costs `w × h` plates and goes partial above roughly 128×128 as the wash
 * does. That is what makes the box safe to diverge from `drawWatchRange`'s
 * refuse-the-square-whole rule: a watch square drawn short claims less reach
 * than the tower has, which is a false statement, whereas a box whose interior
 * stops shading is merely less pretty — its border still says what it covers.
 */
const MAX_INSIDE = 16384;
const MAX_BOUNDARY = 4096;
/**
 * The reach boundaries — a Watchtower's watch square and a Hive's flower reach,
 * one layer pair for both — and the tool shows every tower, or every hive, on
 * the map at once. Sized for a few dozen of either, well past what a colony
 * builds, and past the cap a rectangle is refused **whole** rather than
 * truncated, because a half-drawn boundary is worse than a missing one: it
 * claims a smaller reach than the building actually has.
 *
 * The ghost's own rectangle is queued **first** by the caller for exactly that
 * reason: if a budget ever runs out it must not be the overlay the player is
 * actively aiming with that goes missing (the `ghostKeyline` lesson).
 */
const MAX_REACH = 8192;
/**
 * Bars one reach rectangle costs, in each of its two layers: a run along each
 * of the four sides, with the four corner tiles visited twice — a corner needs
 * a bar on both of its outward faces. A tower's 49×49 square is 196; a 2×2
 * hive at `HIVE_REACH` 6 is a 14×14 rectangle, so 56.
 */
function reachBars(r: ReachRect): number {
  return 2 * (r.x1 - r.x0 + 1) + 2 * (r.y1 - r.y0 + 1);
}
/**
 * A wall drag is an L, so its two legs together reach at most twice a map edge
 * — and each tile draws four bars. Sized for the whole L: a cap that only
 * covered one leg would silently drop the far end of the very overlay the
 * player is aiming with.
 */
const MAX_RUN = 2 * WORLD_SIZE;

/**
 * How far from the camera focus, in tiles, an anchor still gets its motes and
 * its herd. **Population is bounded by the camera, not by the map**, so cost
 * tracks what is on screen rather than what is on a 256² island.
 *
 * Generous rather than tight: the widest zoom shows on the order of a hundred
 * tiles of ground, and a bee at that distance is well under a pixel, so the
 * number that matters is the one at which a *flock* would visibly pop in as the
 * player pans. Fauna state is **kept** when an anchor falls outside it, never
 * discarded — re-deriving would teleport a flock every time the player panned
 * away and back, which is far more visible than the reload case derivation is
 * argued from.
 */
const AMBIENT_RADIUS = 80;

const TAU = Math.PI * 2;

/**
 * Bees: a few specks per anchor that **hover, dart, and hover again**.
 *
 * A smooth orbit was what shipped first, and it read as machinery — a bee does
 * not fly in circles. The closed form is unchanged and still binding; what
 * changed is the shape of it. The segment index is `floor(time × rate + phase)`
 * and the endpoints are hashed from it, so the flight is piecewise and
 * unpredictable while staying a pure function of `(anchor, index, time)`:
 * nothing integrated, nothing saved, a reload still correct.
 *
 * **The path does not merely fail to close — it has no period at all**, since
 * the endpoint sequence is keyed to an unbounded integer rather than to a
 * frequency. Rate and phase come off the mote's own index, so four bees on one
 * hive are never in step.
 */
const BEE_SPECKS = 4;
/**
 * How far from its anchor a bee's endpoints are picked. Every point of every
 * segment is a convex blend of two of them, so **the neighbourhood bound holds
 * by construction** rather than by tuning — which is what keeps the boundedness
 * rule true of a motion that is otherwise deliberately unpredictable.
 */
const BEE_RANGE = 1;
/** Segments per second, and how far apart two bees' rates may be. */
const BEE_RATE_MIN = 0.55;
const BEE_RATE_SPAN = 0.5;
/** The fraction of a segment spent crossing. The rest of it is the hover. */
const BEE_DART = 0.34;
/** Where the cloud sits above its anchor, and how far it spreads vertically. */
const BEE_RISE = 0.42;
const BEE_LIFT = 0.3;
/** A hover is not a freeze: the quiver that keeps a held bee alive, on a
 *  frequency of its own and small enough not to blur the dart. */
const BEE_HOVER = 0.022;
const BEE_HOVER_RATE = 6.3;
const BEE_SIZE = 0.1;
/** Three salts for the endpoint draws and a fourth for the per-bee constants,
 *  so no two of the four are ever the same call for some value of `s`. */
const BEE_SALT_A = 0x9e3779b9;
const BEE_SALT_B = 0x85ebca6b;
const BEE_SALT_C = 0xc2b2ae35;
const BEE_SALT_SELF = 0x27d4eb2d;

/**
 * Smoke: a column of four puffs, each rising, drifting and **shrinking to
 * nothing** over one fixed period, its phase a function of its index. Not a
 * particle system — nothing is integrated, so a load or a tab-wake places the
 * column correctly with no catch-up.
 *
 * Shrink rather than fade, because a `Layer` carries one opacity for the whole
 * mesh and `put` exposes a matrix and a tint and nothing else: fading one
 * instance would mean the first non-`put` material in this file, which is not
 * worth a puff of smoke.
 */
const SMOKE_PUFFS = 4;
const SMOKE_LIFE = 3.4;
const SMOKE_RISE = 1.5;
const SMOKE_DRIFT = 0.55;
const SMOKE_SIZE = 0.3;

/**
 * Where a workshop's fire leaves the building, relative to its footprint
 * origin, and how high above its ground.
 *
 * **The Oven is the only entry, and that is the content rather than a
 * placeholder**: it is the one building whose model has a chimney at all
 * (`props.ts`), and the six timber workshops that share one silhouette have no
 * fire in their fiction — smoke off a Weaver would be saying something untrue
 * about it. A partial record on purpose, so the next workshop that burns adds a
 * row and nothing else.
 */
const CHIMNEY: Partial<Record<BuildingKindValue, readonly [number, number, number]>> = {
  // The stub off the dome's back corner, at its top: 1.4·BH + its own 0.7·BH.
  [BuildingKind.Oven]: [0.42, 2.1 * BH, 0.42],
};

/**
 * Birds: a flock on one wide slow circuit that **breathes**, well above
 * anything on the ground.
 *
 * Deliberately much calmer than the bees — a circling bird is the one thing
 * here meant to read as unhurried — so the circuit survives and only its radius
 * and its plane move, plus a small per-bird drift within the formation. The
 * flock stays a flock and the circuit stays a circuit; it is simply never twice
 * the same.
 */
const BIRDS = 5;
const BIRD_CIRCUIT = 7.5;
const BIRD_HEIGHT = 6.5;
const BIRD_RATE = 0.2;
const BIRD_BEAT = 5.5;
/** The circuit is an ellipse rather than a circle: the camera is oblique. */
const BIRD_SQUASH = 0.75;
/**
 * The golden ratio, and the reason every modulation below is written as the
 * circuit's own rate divided by a power of it.
 *
 * **Every ratio here has to be irrational or the path closes**, which is the
 * whole defect this replaces: a single frequency repeats exactly and reads as
 * machinery. Writing them as `BIRD_RATE / φ²` rather than as decimals is what
 * makes that property inspectable instead of a coincidence of tuning — the
 * water shader's 1.10 / 0.80 / 0.6 are the in-repo precedent and are in fact
 * commensurable, with a period of about a minute.
 */
const PHI = (1 + Math.sqrt(5)) / 2;
/** Two slow terms swell and shrink the circuit's radius. */
const BIRD_SWELL = [
  { rate: BIRD_RATE / (PHI * PHI), amp: 0.26 },
  { rate: BIRD_RATE / (PHI * PHI * PHI), amp: 0.15 },
] as const;
/** A third tips the plane of it, and a fourth turns which way it is tipped. */
const BIRD_TILT_RATE = BIRD_RATE / (PHI * Math.SQRT2);
const BIRD_TILT_TURN = BIRD_RATE / (PHI * PHI * Math.SQRT2);
const BIRD_TILT = 1.1;
/** And each bird drifts a little within the formation, on a fifth. */
const BIRD_DRIFT_RATE = BIRD_RATE * Math.SQRT2;
const BIRD_DRIFT = 0.7;

/**
 * The two grazing models, at the scale that tells them apart from everything
 * else on the map. Both are four low legs under a body with a head out front —
 * a silhouette nothing else in this game has, which is what keeps a deer from
 * ever being read as a monster (orcs and trolls stand at folk height on two).
 */
interface FaunaModel {
  readonly body: { w: number; h: number; len: number; color: number };
  readonly head: { w: number; h: number; color: number };
  readonly leg: { h: number; color: number };
  /** Half-spacing of the legs, across and fore-aft. */
  readonly stance: readonly [number, number];
}

const FAUNA_MODELS: Record<number, FaunaModel> = {
  [FaunaKind.Sheep]: {
    body: { w: 0.34, h: 0.26, len: 0.5, color: PROP.fleece },
    head: { w: 0.2, h: 0.18, color: PROP.door },
    leg: { h: 0.16, color: PROP.door },
    stance: [0.11, 0.16],
  },
  [FaunaKind.Deer]: {
    body: { w: 0.28, h: 0.3, len: 0.56, color: PROP.deerHide },
    head: { w: 0.18, h: 0.17, color: PROP.deerRump },
    leg: { h: 0.26, color: PROP.deerHide },
    stance: [0.1, 0.18],
  },
};

/** How far a leg slides fore-and-aft at full stride, and how fast the gait
 *  cycles per tile walked. `put` spins about +y only, so a leg cannot be
 *  hinged — sliding is what reads as a step at this size. */
const STRIDE = 0.075;
const GAIT_RATE = 9;
/** How far the head drops and reaches forward while grazing. */
const GRAZE_DROP = 0.5;
const GRAZE_REACH = 0.12;

/** Three sheep a pasture and three deer a herd, at six boxes each, over as many
 *  anchors as ever stand inside the camera radius at once. */
const MAX_FAUNA = 384;

interface Layer {
  mesh: InstancedMesh;
  used: number;
}

const M = new Matrix4();
const P = new Vector3();
const Q = new Quaternion();
const S = new Vector3();
const UP = new Vector3(0, 1, 0);
const TINT = new Color();

function solidLayer(scene: Scene, max: number, shadows = true): Layer {
  const mesh = new InstancedMesh(BOX, createMoverMaterial(), max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  // A puff of smoke and a bee do not cast shadows: a shadow is a claim that
  // something solid is standing there, which is the one thing a mote is not.
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  // Allocate the colour buffer up front: setColorAt would allocate it lazily,
  // and the first frame's tints would be dropped.
  mesh.instanceColor = null;
  mesh.setColorAt(0, TINT.setHex(0xffffff));
  scene.add(mesh);
  return { mesh, used: 0 };
}

function overlayLayer(scene: Scene, max: number, color: number, opacity: number): Layer {
  const mesh = new InstancedMesh(
    FLAT,
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false }),
    max,
  );
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);
  return { mesh, used: 0 };
}

function put(
  l: Layer,
  x: number,
  baseY: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rot: number,
  tint?: number,
): void {
  if (l.used >= l.mesh.instanceMatrix.count) return;
  Q.setFromAxisAngle(UP, rot);
  M.compose(P.set(x, baseY + sy / 2, z), Q, S.set(sx, sy, sz));
  l.mesh.setMatrixAt(l.used, M);
  if (tint !== undefined) l.mesh.setColorAt(l.used, TINT.setHex(tint));
  l.used++;
}

/** Colonist proportions, ported from the mockup's folk: body, head, carry box. */
const BODY = { w: 0.44, h: 0.5, y: 0 };
const HEAD = { w: 0.32, h: 0.26, y: 0.5 };
const CARRY = { w: 0.32, h: 0.26, y: 0.8 };

/**
 * The Wilds, at folk scale so the comparison is immediate.
 *
 * The two kinds have to be tellable apart across the map, because reading them
 * is the player's entire toolkit (docs/CONCEPT.md): an **orc** is a lean green
 * figure of about a colonist's height, a **troll** is a bulky grey one half
 * again taller. Silhouette and hue, not decoration — nothing here is outlined,
 * tinted rust, or marked in any HUD colour, because a monster is a thing in the
 * world rather than a warning about one.
 */
interface MonsterModel {
  /** Trunk, and the head that sits on it — the colonist's two boxes, restyled. */
  readonly body: { w: number; h: number; color: number };
  readonly head: { w: number; h: number; color: number };
}

const MONSTER_MODELS: Record<MonsterKindValue, MonsterModel> = {
  [MonsterKind.Orc]: {
    body: { w: 0.38, h: 0.52, color: PROP.orcRag },
    head: { w: 0.29, h: 0.24, color: PROP.orcHide },
  },
  [MonsterKind.Troll]: {
    body: { w: 0.62, h: 0.78, color: PROP.trollRag },
    head: { w: 0.46, h: 0.36, color: PROP.trollHide },
  },
};

/**
 * How a resting monster draws: squat and spread, so "asleep" reads without a
 * single HUD element saying so — and shifted to the **mouth of its den**.
 *
 * The shift is not decoration. A hunched figure is shorter than the den mound
 * it shares a tile with, so drawn on its stored position it is simply inside
 * the prop and invisible — a monster the player cannot see is the one thing
 * this game must never have. At the mouth it lies in front of the mound, which
 * is both visible and the better picture.
 */
const DORMANT_SQUASH = 0.5;
const DORMANT_SPREAD = 1.25;
/**
 * **Must stay under half a tile.** A resting monster sits at exactly
 * `lair + 0.5`, so anything from 0.5 up pushes the drawn figure into the *next*
 * tile — and two things then read from the wrong one: `monsterAtTile` matches
 * on the monster's own floored position, so clicking the sleeper you can see
 * selects nothing; and the ground height under it is sampled a tile south, so
 * on a slope it floats or sinks. At 0.45 the figure still clears the den mound
 * (which ends 0.4 out) and still belongs to its own tile.
 */
const DORMANT_FRONT = 0.45;

/** One tile of a placement preview, and whether it may actually be placed. */
/**
 * A reach boundary in tile coordinates, inclusive at both ends — the caller
 * grows the footprint, because the radius is the caller's business (a tower's
 * `WATCH_RANGE`, a hive's `HIVE_REACH`) and the overlay's is drawing a box.
 */
export interface ReachRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface GhostTile {
  x: number;
  y: number;
  valid: boolean;
}

/**
 * What the placement tool is aiming at.
 *
 * A building ghost is one footprint with a single verdict; a wall ghost is a
 * *run*, and its tiles are judged one by one — a bad tile in the middle of a
 * drag ghosts rust and is skipped on release rather than killing the run.
 */
export type Ghost =
  | { kind: "building"; building: BuildingKindValue; x: number; y: number; valid: boolean }
  | { kind: "wall"; tiles: readonly GhostTile[] };

/**
 * What the ambient classes need and nothing else in `sync` had access to.
 *
 * It rides second in the argument list rather than last so it cannot be
 * forgotten behind the optional overlays: every one of these is required for
 * the world to be alive at all.
 */
export interface Ambient {
  /**
   * Elapsed **game** seconds — real seconds × speed. Ambient motion runs on the
   * world's clock, so at ×0 every mote holds and at ×4 all of it runs fast
   * (docs/specs/2026-09-15-ambient-life.md).
   */
  time: number;
  /** Game seconds this frame, off the loop's already-clamped `dt`. */
  dt: number;
  /** Where the camera is looking, in tiles. Bounds what gets populated. */
  fx: number;
  fz: number;
  /** `prefers-reduced-motion`: motes hold and herds stand, folk and monsters
   *  do not — they are the game rather than its decoration. */
  still: boolean;
}

export class MoverRenderer {
  private readonly solids: Layer;
  private readonly markKeyline: Layer;
  private readonly markFill: Layer;
  private readonly markEdge: Layer;
  private readonly ghostKeyline: Layer;
  private readonly ghostFill: Layer;
  private readonly ghostEdge: Layer;
  private readonly badFill: Layer;
  private readonly badEdge: Layer;
  private readonly insideFill: Layer;
  private readonly insideKeyline: Layer;
  private readonly insideEdge: Layer;
  private readonly watchKeyline: Layer;
  private readonly watchEdge: Layer;
  private readonly selFill: Layer;
  private readonly selKeyline: Layer;
  private readonly selEdge: Layer;
  private readonly bees: Layer;
  private readonly smoke: Layer;
  private readonly birds: Layer;
  private readonly herds: Layer;
  private readonly fauna: Fauna;
  /**
   * Where the flock circles, and the chunk-version total it was computed at.
   *
   * Refreshed when the world changes rather than per frame: the centre is a
   * scan of a 65,536-tile layer. Every enclosure change is a wall change and
   * every wall change bumps a chunk version, so the total is a conservative but
   * exact-enough signal — it also fires on a felled tree, which costs one scan.
   */
  private flockCentre: { x: number; z: number } | null = null;
  private flockSeen = -1;

  constructor(
    private readonly scene: Scene,
    private readonly sim: Sim,
  ) {
    this.solids = solidLayer(scene, MAX_COLONISTS * 3 + MAX_MONSTERS * 2 + MAX_ITEMS);
    this.markKeyline = overlayLayer(scene, MAX_OVERLAY, KEYLINE, 0.5);
    this.markFill = overlayLayer(scene, MAX_OVERLAY, GOLD, 0.13);
    this.markEdge = overlayLayer(scene, MAX_OVERLAY, GOLD, 0.85);
    // The ghost gets its own keyline layer rather than sharing the marks'.
    // A drag-box over a wood can mark thousands of trees, and a shared layer
    // would run out of instances on the designations and silently drop the
    // ghost's outline — the one overlay the player is actively aiming with.
    this.ghostKeyline = overlayLayer(scene, MAX_RUN * 4 + 4, KEYLINE, 0.5);
    this.ghostFill = overlayLayer(scene, MAX_RUN, SAGE, 0.22);
    this.ghostEdge = overlayLayer(scene, MAX_RUN * 4 + 4, SAGE, 0.85);
    // Valid and invalid are separate layers rather than one layer whose
    // material colour gets rewritten per frame, because a wall run shows both
    // at once — one material can only be one colour.
    this.badFill = overlayLayer(scene, MAX_RUN, RUST, 0.22);
    this.badEdge = overlayLayer(scene, MAX_RUN * 4 + 4, RUST, 0.85);
    // Enclosure: boundary-first. The styleguide's own measurement is that a
    // faint sage fill alone is invisible against grass, so the line carries
    // the read and the wash only says which side of it is inside.
    // 0.14 is where the wash first registers as a tint against grass without
    // reading as a colour the ground has been given — dialed by eye, and
    // deliberately still too weak to carry the read on its own.
    this.insideFill = overlayLayer(scene, MAX_INSIDE, SAGE, 0.14);
    this.insideKeyline = overlayLayer(scene, MAX_BOUNDARY, KEYLINE, 0.5);
    this.insideEdge = overlayLayer(scene, MAX_BOUNDARY, SAGE, 0.85);
    // A watch range is the enclosure boundary's recipe with **no wash under
    // it**: 49 tiles across, a fill would tint the world rather than mark a
    // limit, and the world is the hero (docs/STYLEGUIDE.md, Tone).
    this.watchKeyline = overlayLayer(scene, MAX_REACH, KEYLINE, 0.5);
    this.watchEdge = overlayLayer(scene, MAX_REACH, SAGE, 0.85);
    // The drag box is **gold**, because gold is player intent. Sage and rust
    // are the ghost's validity colours and would be a lie here: the box makes
    // no claim about whether anything inside it can actually be worked — the
    // marks that appear on release are what say that.
    //
    // 0.10 against the designation marks' 0.13, the styleguide's own value for
    // a selection that can cover half the view. Its own layers rather than the
    // marks', because the box is drawn *over* marked ground and a box over a
    // marked wood must not spend the marks' budget.
    this.selFill = overlayLayer(scene, MAX_INSIDE, GOLD, 0.1);
    this.selKeyline = overlayLayer(scene, MAX_BOUNDARY, KEYLINE, 0.5);
    this.selEdge = overlayLayer(scene, MAX_BOUNDARY, GOLD, 0.85);
    // The motes. Past a cap `put` silently drops the instance, which is the
    // right failure for ambience and deliberately **not** the refuse-the-shape-
    // whole rule `drawReach` follows: a missing bee says nothing false, whereas
    // half a watch square claims less reach than the tower has.
    this.bees = solidLayer(scene, 16 * BEE_SPECKS, false);
    this.smoke = solidLayer(scene, 8 * SMOKE_PUFFS, false);
    this.birds = solidLayer(scene, BIRDS * 2);
    this.herds = solidLayer(scene, MAX_FAUNA);
    this.fauna = new Fauna(sim);
  }

  /**
   * Drop every layer this renderer owns — a load rebuilds the whole sim-bound
   * stack around the decoded store.
   *
   * Each layer made its own material, so those go; `BOX` and `FLAT` are shared
   * module-level geometries and deliberately do not.
   */
  dispose(): void {
    for (const l of this.layers) {
      this.scene.remove(l.mesh);
      (l.mesh.material as { dispose(): void }).dispose();
      l.mesh.dispose();
    }
  }

  /**
   * Draw one frame. `alpha` is the leftover tick fraction from the app loop —
   * 0 at the tick just simulated, approaching 1 at the next.
   */
  sync(
    alpha: number,
    ambient: Ambient,
    ghost: Ghost | null,
    showEnclosure = false,
    reach: readonly ReachRect[] = [],
    box: SelectionBox | null = null,
  ): void {
    for (const l of this.layers) l.used = 0;
    this.drawColonists(alpha);
    this.drawMonsters(alpha);
    this.drawGoods();
    // Reduced motion holds the clock rather than emptying the layers: a mote is
    // a closed form in `time`, so a frozen clock *is* its rest pose, and the
    // hives keep their bees and the oven its column.
    this.drawMotes(ambient.still ? 0 : ambient.time, ambient.fx, ambient.fz);
    // Reduced motion stands the herds where they are: a zero delta means no
    // step is integrated and no target is picked, so they hold mid-pasture
    // rather than vanishing.
    this.drawFauna(ambient.still ? 0 : ambient.dt, ambient.fx, ambient.fz);
    this.drawDesignations();
    if (showEnclosure) this.drawEnclosure();
    // After the enclosure, because Raze is both an area tool and a wall tool:
    // the sage wash and a gold box genuinely do draw together, and the box is
    // the one being aimed with.
    if (box) this.drawSelection(box);
    // Before the ghost, and in the order the caller gave: the ghost's own
    // square leads the list, so a starved layer drops a distant tower's
    // boundary rather than the one being aimed with.
    for (const rect of reach) this.drawReach(rect);
    if (ghost) this.drawGhost(ghost);
    for (const l of this.layers) {
      l.mesh.count = l.used;
      l.mesh.instanceMatrix.needsUpdate = true;
      if (l.mesh.instanceColor) l.mesh.instanceColor.needsUpdate = true;
    }
  }

  private get layers(): Layer[] {
    return [
      this.solids,
      this.markKeyline,
      this.markFill,
      this.markEdge,
      this.ghostKeyline,
      this.ghostFill,
      this.ghostEdge,
      this.badFill,
      this.badEdge,
      this.insideFill,
      this.insideKeyline,
      this.insideEdge,
      this.watchKeyline,
      this.watchEdge,
      this.selFill,
      this.selKeyline,
      this.selEdge,
      this.bees,
      this.smoke,
      this.birds,
      this.herds,
    ];
  }

  /** An overlay border and the dark keyline that makes it readable. */
  private edge(
    keyline: Layer,
    l: Layer,
    a: { x: number; y: number; w: number; h: number },
    top: number,
    t: number,
  ): void {
    outlineArea(keyline, a, top, t + KEYLINE_GROWTH);
    outlineArea(l, a, top + 0.01, t);
  }

  private groundY(x: number, y: number): number {
    const world = this.sim.world;
    const tx = Math.min(world.size - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(world.size - 1, Math.max(0, Math.floor(y)));
    return world.hmap[tileIndex(tx, ty, world.size)] * BH;
  }

  private drawColonists(alpha: number): void {
    for (const c of colonists(this.sim)) {
      // A slot worker who has stepped inside their workshop is not drawn —
      // their position is pinned within the footprint, and a figure standing
      // motionless at the door reads as loitering, not working. The
      // inspector's worker row and the labour meter say where they went.
      if (c.inside) continue;
      const x = c.px + (c.x - c.px) * alpha;
      const y = c.py + (c.y - c.py) * alpha;
      const base = this.groundY(x, y);
      // One tint decision, taken here in the per-frame mover draw: colonists
      // have no bake and no dirty machinery, so a garment donned or worn out
      // shows on the next frame with nothing to invalidate.
      const cloth = c.clothes > 0 ? CLOTH[c.id % CLOTH.length] : PROP.drab;
      put(this.solids, x, base + BODY.y, y, BODY.w, BODY.h, BODY.w, c.heading, cloth);
      put(this.solids, x, base + HEAD.y, y, HEAD.w, HEAD.h, HEAD.w, c.heading, PROP.linen);
      // The same box says "carrying something" and "walking in from the
      // coast": a wanderer has a pack, and a traveller with a bundle on their
      // shoulder is the whole of what marks them out. No new model, and
      // nothing in a HUD colour — an arrival is a thing in the world.
      if (c.carrying >= 0 || c.dest >= 0) {
        put(this.solids, x, base + CARRY.y, y, CARRY.w, CARRY.h, CARRY.w, c.heading, PROP.crate);
      }
    }
  }

  /**
   * The Wilds, interpolated between ticks exactly as the folk are — a monster
   * moves in the world, so it is drawn moving.
   *
   * It reads `sim/know`'s projection rather than the store: what comes back is
   * position, kind, heading and a two-way stance, and the exact clock a monster
   * is running never leaves the sim (docs/ARCHITECTURE.md, truth vs knowledge).
   * That is the whole reason the renderer cannot accidentally draw a countdown
   * over a den, which is what would quietly delete the watchtower mechanic.
   */
  private drawMonsters(alpha: number): void {
    for (const m of monsters(this.sim)) {
      const model = MONSTER_MODELS[m.kind as MonsterKindValue] ?? MONSTER_MODELS[MonsterKind.Orc];
      // Asleep at the den: squat, spread, and drawn at its mouth rather than on
      // top of it — so the difference between a monster that can hurt you and
      // one that cannot is visible from across the map without the HUD saying a
      // word.
      const dormant = m.stance === "dormant";
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha + (dormant ? DORMANT_FRONT : 0);
      const base = this.groundY(x, y);
      const squash = dormant ? DORMANT_SQUASH : 1;
      const spread = dormant ? DORMANT_SPREAD : 1;
      const bodyH = model.body.h * squash;
      put(
        this.solids,
        x,
        base,
        y,
        model.body.w * spread,
        bodyH,
        model.body.w * spread,
        m.heading,
        model.body.color,
      );
      put(
        this.solids,
        x,
        base + bodyH,
        y,
        model.head.w * spread,
        model.head.h * squash,
        model.head.w * spread,
        m.heading,
        model.head.color,
      );
    }
  }

  /**
   * Goods on the ground and goods inside a building — a stockpile's pile, a
   * blueprint's delivered logs, a mill's input and output buffers. Piles use a
   * fixed 8-slot lattice per tile, so a filling stockpile visibly fills.
   */
  private drawGoods(): void {
    const perTile = new Map<number, number>();
    const perBuilding = new Map<number, number>();

    for (const item of items(this.sim)) {
      // One colour table for every good (palette.ts), so a rock pile and a
      // block pile are told apart by the same rule the Stores panel's pips
      // use — the pip and the pile are one object seen twice.
      const tint = GOOD_HEX[item.type as ItemTypeValue] ?? PROP.crate;
      if (item.loc === Loc.Ground) {
        const key = tileIndex(item.x, item.y, this.sim.world.size);
        const n = perTile.get(key) ?? 0;
        perTile.set(key, n + 1);
        const [ox, oy, oz] = lattice(n);
        put(this.solids, item.x + 0.5 + ox, this.groundY(item.x, item.y) + oy, item.y + 0.5 + oz, 0.34, 0.2, 0.34, 0, tint);
        continue;
      }
      if (item.loc !== Loc.Stored) continue;

      const b = buildings(this.sim).find((x) => x.id === item.holder);
      if (!b) continue;
      const n = perBuilding.get(b.id) ?? 0;
      perBuilding.set(b.id, n + 1);
      const cell = Math.floor(n / 8) % (b.w * b.h);
      const [ox, oy, oz] = lattice(n % 8);
      // A finished building's goods ride at its own model's height (props.ts's
      // `BUFFER_Y`); anything unfinished stacks on the marked-out plot. Keyed
      // on the **kind** rather than on having a recipe: one shared roofline was
      // the sawmill's, and it drew the farm's grain and the oven's bread a
      // metre above both of them.
      const deck = b.state === BuildingState.Active ? BUFFER_Y[b.kind as BuildingKindValue] : DECK_Y;
      put(
        this.solids,
        b.x + (cell % b.w) + 0.5 + ox,
        this.groundY(b.x, b.y) + deck + oy,
        b.y + Math.floor(cell / b.w) + 0.5 + oz,
        0.34,
        0.2,
        0.34,
        0,
        tint,
      );
    }
  }

  /**
   * The motes: bees working the hives and the fields, smoke off the oven, and
   * a flock of birds on one wide circuit over the colony.
   *
   * **Every one of them is a closed form** — position is a pure function of
   * (anchor, index, time), never integrated frame to frame. Nothing is saved,
   * nothing drifts out of sync after a suspended tab, and a load places them
   * all correctly with no catch-up. This is the mockup's chimney-smoke trick
   * generalised.
   *
   * **Every one of them is anchored**, which is the rule the whole class exists
   * under: a bee never leaves its hive's neighbourhood and the flock's circuit
   * is centred and does not migrate, so "something is travelling across open
   * ground" keeps meaning colonists and monsters and nothing else
   * (docs/specs/2026-09-15-ambient-life.md).
   */
  private drawMotes(time: number, fx: number, fz: number): void {
    for (const b of buildings(this.sim)) {
      // A blueprint has no bees and a cold oven no smoke: the building has to
      // be finished and working for there to be anything to see.
      if (b.state !== BuildingState.Active) continue;
      if (!near(b.x + b.w / 2, b.y + b.h / 2, fx, fz)) continue;
      if (b.kind === BuildingKind.Hive || b.kind === BuildingKind.Flowers) this.drawBees(b, time);
      const vent = CHIMNEY[b.kind as BuildingKindValue];
      if (vent) this.drawSmoke(b, vent, time);
    }
    this.drawBirds(time);
  }

  /**
   * Hover, dart, hover. Each bee crosses from one hashed point to the next over
   * the first `BEE_DART` of its segment and holds there for the rest of it,
   * quivering; the endpoints chain (`s` to `s + 1`), so it never jumps.
   *
   * Everything that distinguishes one bee from another — its rate, its phase,
   * its endpoints — is hashed off its own index and its anchor's tile, so two
   * bees on one hive are never in step and two hives are never in lockstep,
   * with nothing stored anywhere.
   */
  private drawBees(b: Building, time: number): void {
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    const base = this.groundY(b.x, b.y) + BUFFER_Y[b.kind as BuildingKindValue];
    const seed = this.sim.world.seed;
    const key = tileIndex(b.x, b.y, this.sim.world.size);
    for (let i = 0; i < BEE_SPECKS; i++) {
      const who = key + i * 977;
      const rate = BEE_RATE_MIN + hash(who, 1, seed ^ BEE_SALT_SELF) * BEE_RATE_SPAN;
      const t = time * rate + hash(who, 2, seed ^ BEE_SALT_SELF) * 64;
      const s = Math.floor(t);
      // Smoothstep across the dart, then pinned at 1 for the hover.
      const f = Math.min(1, (t - s) / BEE_DART);
      const u = f * f * (3 - 2 * f);
      const from = beePoint(who, s, seed);
      const to = beePoint(who, s + 1, seed);
      const q = Math.sin(time * BEE_HOVER_RATE + i * 2.1) * BEE_HOVER;
      put(
        this.bees,
        cx + from[0] + (to[0] - from[0]) * u + q,
        base + BEE_RISE + from[1] + (to[1] - from[1]) * u,
        cz + from[2] + (to[2] - from[2]) * u - q,
        BEE_SIZE,
        BEE_SIZE,
        BEE_SIZE,
        0,
        PROP.bee,
      );
    }
  }

  /** One column of puffs off a chimney: each rises, leans away and shrinks to
   *  nothing over `SMOKE_LIFE`, its phase fixed by its index. */
  private drawSmoke(b: Building, vent: readonly [number, number, number], time: number): void {
    const base = this.groundY(b.x, b.y);
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      // `((x % 1) + 1) % 1` rather than a bare modulo: `time` is never negative
      // today, but a phase that can go negative would drop a puff below the
      // chimney rather than wrapping it.
      const raw = time / SMOKE_LIFE + i / SMOKE_PUFFS;
      const p = ((raw % 1) + 1) % 1;
      const size = SMOKE_SIZE * (1 - p);
      put(
        this.smoke,
        b.x + vent[0] + p * SMOKE_DRIFT,
        base + vent[1] + p * SMOKE_RISE,
        b.y + vent[2] + p * SMOKE_DRIFT * 0.5,
        size,
        size,
        size,
        0,
        PROP.smoke,
      );
    }
  }

  /**
   * The flock: one wide slow circuit over the colony's centre, high enough
   * never to be mistaken for anything standing on the ground.
   *
   * Two boxes a bird — a body along its heading and a wingspan whose width
   * beats — because `put` spins about +y only, so a wing cannot be hinged and
   * folding is what reads as flapping at this size. Models face +z, so heading
   * is `atan2` of the circuit's own tangent.
   */
  private drawBirds(time: number): void {
    const centre = this.colonyCentre();
    if (!centre) return;
    const base = this.groundY(centre.x, centre.z) + BIRD_HEIGHT;
    // The circuit breathes. Radius, tilt and the tilt's own bearing are shared
    // by the whole flock — that is what keeps it one flock — and every rate is
    // an irrational fraction of the circuit's, so no lap is ever the last one
    // repeated.
    let swell = 1;
    for (const term of BIRD_SWELL) swell += Math.sin(time * term.rate) * term.amp;
    const radius = BIRD_CIRCUIT * swell;
    const tilt = Math.sin(time * BIRD_TILT_RATE) * BIRD_TILT;
    const bearing = time * BIRD_TILT_TURN;
    for (let i = 0; i < BIRDS; i++) {
      const a = time * BIRD_RATE + (i * TAU) / BIRDS;
      // Each bird's own small wander inside the formation, on a fifth rate.
      const d = time * BIRD_DRIFT_RATE + i * 1.7;
      const x = centre.x + Math.cos(a) * radius + Math.sin(d) * BIRD_DRIFT;
      const z = centre.z + Math.sin(a) * radius * BIRD_SQUASH + Math.cos(d * 0.83) * BIRD_DRIFT;
      // The tangent of the (squashed) circle, which is where the bird is going.
      const heading = Math.atan2(-Math.sin(a), Math.cos(a) * BIRD_SQUASH);
      // The plane's tip: one side of the ring rides higher than the other, and
      // which side turns slowly.
      const y = base + Math.cos(a - bearing) * tilt + Math.sin(d * 0.61) * BIRD_DRIFT * 0.5;
      const beat = Math.abs(Math.sin(time * BIRD_BEAT + i * 1.3));
      put(this.birds, x, y, z, 0.12, 0.09, 0.4, heading, PROP.bird);
      put(this.birds, x, y + 0.05, z, 0.24 + beat * 0.42, 0.05, 0.18, heading, PROP.bird);
    }
  }

  /**
   * Sheep grazing their pasture and deer roaming the wilds: the one class here
   * that actually integrates, and the reason `Ambient` carries a `dt`.
   *
   * The wander state lives in `fauna.ts`; this only draws what it hands back.
   * Every creature is four low legs under a body with a head out front — a
   * silhouette nothing else in the game has, so a deer is never read as a
   * monster — and the whole group turns to face its heading, models being built
   * facing +z as everything here is.
   */
  private drawFauna(dt: number, fx: number, fz: number): void {
    const centre = this.colonyCentre();
    const world = this.sim.world;
    for (const herd of this.fauna.step(
      dt,
      fx,
      fz,
      AMBIENT_RADIUS,
      centre?.x ?? world.size / 2,
      centre?.z ?? world.size / 2,
    )) {
      this.drawHerd(herd, fx, fz);
    }
  }

  private drawHerd(herd: Herd, fx: number, fz: number): void {
    if (!near(herd.hx, herd.hz, fx, fz)) return;
    const model = FAUNA_MODELS[herd.kind];
    for (const c of herd.creatures) {
      const base = this.groundY(c.x, c.z);
      const cos = Math.cos(c.heading);
      const sin = Math.sin(c.heading);
      // Local (across, forward) to world, the same mapping `emitBox` uses to
      // spin a prop about +y.
      const wx = (lx: number, lz: number): number => c.x + lx * cos + lz * sin;
      const wz = (lx: number, lz: number): number => c.z - lx * sin + lz * cos;

      const bodyY = base + model.leg.h;
      put(this.herds, c.x, bodyY, c.z, model.body.w, model.body.h, model.body.len, c.heading, model.body.color);

      // Head down and reaching while grazing, up and level while walking —
      // which is the only thing that says which of the two it is doing.
      const grazing = c.graze > 0;
      const reach = model.body.len / 2 + (grazing ? GRAZE_REACH : 0);
      const headY = grazing ? base + model.leg.h * (1 - GRAZE_DROP) : bodyY + model.body.h * 0.55;
      put(
        this.herds,
        wx(0, reach),
        headY,
        wz(0, reach),
        model.head.w,
        model.head.h,
        model.head.w,
        c.heading,
        model.head.color,
      );

      // Four legs. The diagonal pairs swing together, and the swing is a slide
      // fore-and-aft rather than a pivot, because `put` has no pivot to give.
      const swing = grazing ? 0 : Math.sin(c.gait * GAIT_RATE) * STRIDE;
      const [ax, az] = model.stance;
      for (const [lx, lz] of [
        [-ax, az],
        [ax, az],
        [-ax, -az],
        [ax, -az],
      ] as const) {
        const phase = lx * lz > 0 ? swing : -swing;
        put(
          this.herds,
          wx(lx, lz + phase),
          base,
          wz(lx, lz + phase),
          0.08,
          model.leg.h,
          0.08,
          c.heading,
          model.leg.color,
        );
      }
    }
  }

  /**
   * Where the colony is, for the flock to circle over — the centroid of
   * enclosed land, which is what "the colony" means once a wall exists.
   *
   * Falls back to the buildings and then to the folk, so a colony that has not
   * walled anything yet still has birds over it; with none of the three there
   * is nothing to circle and the flock does not fly. Cached against the
   * chunk-version total, because the enclosed case is a 65,536-tile scan and
   * this is called every frame.
   */
  private colonyCentre(): { x: number; z: number } | null {
    let seen = 0;
    for (const v of this.sim.world.chunkVersion) seen += v;
    if (seen === this.flockSeen) return this.flockCentre;
    this.flockSeen = seen;
    this.flockCentre = null;

    const size = this.sim.world.size;
    const inside = insideLayer(this.sim);
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < inside.length; i++) {
      if (!inside[i]) continue;
      const x = i % size;
      sx += x + 0.5;
      sz += (i - x) / size + 0.5;
      n++;
    }
    if (n === 0) {
      for (const b of buildings(this.sim)) {
        sx += b.x + b.w / 2;
        sz += b.y + b.h / 2;
        n++;
      }
    }
    if (n === 0) {
      for (const c of colonists(this.sim)) {
        sx += c.x;
        sz += c.y;
        n++;
      }
    }
    if (n === 0) return null;
    this.flockCentre = { x: sx / n, z: sz / n };
    return this.flockCentre;
  }

  /**
   * Gold outline over a faint gold fill on the ground tile a marked thing
   * stands on — at its base, not capping it. Every designation the game has
   * shares this one mark: trees to fell, outcrops to quarry, segments to
   * dismantle, ground to level. They are the same statement of player intent,
   * so they read the same, and the three that mark a *tall* thing also carry
   * it at distance by tinting the baked object (props.ts, mesher.ts).
   *
   * Levelling is the exception with nothing to tint — the marked thing *is*
   * the ground — so the diamond is the whole of its mark, which is also why
   * designating one dirties no chunk.
   *
   * The canopy does hide the back half of a tree's diamond at these camera
   * angles, and that is fine: the front half reads. A cap floating above the
   * crown solved the occlusion but read as a box hanging in mid-air, which is
   * worse than a partly hidden mark.
   */
  private drawDesignations(): void {
    const size = this.sim.world.size;
    // Walks the layers rather than a helper that builds a fresh array of every
    // marked tile: this runs once a frame.
    const chop = chopLayer(this.sim);
    const raze = razeLayer(this.sim);
    const mine = mineLayer(this.sim);
    const level = terraformLayer(this.sim);
    for (let i = 0; i < chop.length; i++) {
      if (!chop[i] && !raze[i] && !mine[i] && !level[i]) continue;
      const x = i % size;
      const y = (i - x) / size;
      const top = this.groundY(x, y) + 0.02;
      plate(this.markFill, x, y, top);
      this.edge(this.markKeyline, this.markEdge, { x, y, w: 1, h: 1 }, top + 0.01, MARK_LINE);
    }
  }

  /**
   * Enclosure, shown only while a wall-family tool is held: a keylined sage
   * line traced along the inside edge of the enclosing wall, over a very faint
   * interior wash. No permanent tint anywhere — the world stays the hero
   * (docs/STYLEGUIDE.md, Tone).
   *
   * Boundary-first because the styleguide's own measurement says so: sage and
   * grass are within a few percent of each other, so a faint fill alone is
   * invisible and only the keylined line survives the terrain. The line is
   * assembled per tile — a bar on every side whose neighbour is *not* enclosed
   * — which traces any shape the player drew without knowing anything about
   * the wall graph.
   */
  private drawEnclosure(): void {
    const size = this.sim.world.size;
    const inside = insideLayer(this.sim);
    for (let i = 0; i < inside.length; i++) {
      if (!inside[i]) continue;
      const x = i % size;
      const y = (i - x) / size;
      const top = this.groundY(x, y) + 0.015;
      plate(this.insideFill, x, y, top);
      if (y === 0 || !inside[i - size]) this.boundary(x, y, top, 0, -1);
      if (y === size - 1 || !inside[i + size]) this.boundary(x, y, top, 0, 1);
      if (x === 0 || !inside[i - 1]) this.boundary(x, y, top, -1, 0);
      if (x === size - 1 || !inside[i + 1]) this.boundary(x, y, top, 1, 0);
    }
  }

  /** One bar hugging the (dx, dy) edge of tile (x, y), from the inside. */
  private boundary(x: number, y: number, top: number, dx: number, dy: number): void {
    this.edgeBar(this.insideKeyline, this.insideEdge, x, y, top, dx, dy);
  }

  /** The bar itself, on whichever pair of layers is asking for it — the
   *  enclosure traces the wall's inside edge with it, a watch range traces the
   *  outer ring of its own square. */
  private edgeBar(
    keyline: Layer,
    edge: Layer,
    x: number,
    y: number,
    top: number,
    dx: number,
    dy: number,
  ): void {
    const t = INSIDE_LINE;
    const w = dx === 0 ? 1 : t;
    const h = dy === 0 ? 1 : t;
    const cx = x + (dx === 0 ? 0.5 : dx > 0 ? 1 - t / 2 : t / 2);
    const cy = y + (dy === 0 ? 0.5 : dy > 0 ? 1 - t / 2 : t / 2);
    const grow = KEYLINE_GROWTH;
    put(keyline, cx, top, cy, dx === 0 ? w : w + grow, 0.02, dy === 0 ? h : h + grow, 0);
    put(edge, cx, top + 0.01, cy, w, 0.02, h, 0);
  }

  /**
   * One building's reach: a keylined sage **rectangle outline** in tile
   * coordinates, shown only while its tool is held or one is selected — never
   * permanently. Two callers, one shape: a Watchtower's square is its footprint
   * (1×1) grown by `WATCH_RANGE`, a Hive's is its 2×2 plot grown by
   * `HIVE_REACH`, and a rectangle is what covers both
   * (docs/specs/2026-09-14-hives-and-mead.md).
   *
   * **A rectangle, because a rectangle is what the predicates test.** Both are
   * Chebyshev gaps — tower-tile to den for one, footprint to footprint for the
   * other — so a circle would draw a picture that excluded covered diagonal
   * dens and counted fields the hive cannot reach. The overlay may never deny
   * knowledge the player has paid for, nor promise a rate they will not get.
   *
   * **Outline only, no interior wash.** The enclosure's faint fill works
   * because it says which side of a line the colony's ground is on; 49 tiles
   * across, the same wash would simply tint the world.
   *
   * Traced per tile at each tile's own ground height, like the enclosure
   * boundary, so the line follows the terrain instead of cutting through a
   * rise. Tiles off the map are skipped: a tower near the coast really does
   * reach past the edge, and an open line is the honest picture of that.
   */
  private drawReach(rect: ReachRect): void {
    const size = this.sim.world.size;
    // Refuse a rectangle that will not fit **whole**. `put` drops instances one
    // at a time, and the four runs are laid interleaved, so a rectangle that
    // merely ran out of budget would render as an open box stopping short on
    // all four sides — a boundary claiming *less* ground than the predicate
    // covers, which is the one thing this overlay may never do. The ghost is
    // queued first, so what a full layer refuses is always a distant building.
    if (this.watchKeyline.used + reachBars(rect) > MAX_REACH) return;
    const { x0, y0, x1, y1 } = rect;
    // The two horizontal runs then the two vertical ones. The four corner
    // tiles are visited twice on purpose — each needs a bar on both of its
    // outward faces, or the rectangle has four notches in it.
    for (let x = x0; x <= x1; x++) {
      this.watchBar(x, y0, 0, -1, size);
      this.watchBar(x, y1, 0, 1, size);
    }
    for (let y = y0; y <= y1; y++) {
      this.watchBar(x0, y, -1, 0, size);
      this.watchBar(x1, y, 1, 0, size);
    }
  }

  private watchBar(x: number, y: number, dx: number, dy: number, size: number): void {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    this.edgeBar(this.watchKeyline, this.watchEdge, x, y, this.groundY(x, y) + 0.02, dx, dy);
  }

  /**
   * The area tools' drag box: a keylined **gold** outline over a faint gold
   * fill, traced per tile at each tile's own ground height, alive only while
   * the drag is held.
   *
   * **Per tile is the whole point.** The box this replaced was a DOM rectangle
   * over the viewport, which cut straight through a rise; laid on the ground
   * one tile at a time it steps over the rise instead, and what it covers is
   * what the release will take.
   *
   * **Gold, not sage or rust.** Gold is player intent; the ghost's validity
   * colours would claim the box knows whether the ground inside it can be
   * worked, and it does not — the marks appearing on release are what say that.
   * The outline is heavier than a designation mark's (`INSIDE_LINE`'s 0.11
   * against `MARK_LINE`'s 0.08) because the box now shares a hue and a
   * primitive with the marks it is drawn over, and weight is what keeps
   * "the region I am selecting" from reading as "more marks".
   *
   * `+0.025` clears every overlay this can share a frame with — the enclosure
   * wash at `+0.015` and the designation marks' plates at `+0.02` — and
   * `edgeBar`'s own `+0.01` puts the gold edge at `+0.035`. Over the sea the
   * plates sit under the water surface (`WATER_SURFACE_OFFSET` is 0.13), so a
   * box dragged out over water reads as submerged rather than floating, which
   * is the honest picture of ground that will select nothing.
   *
   * The fill runs first and stops at its budget; the outline has its own layers
   * and cannot truncate at this world size. See `MAX_INSIDE`.
   */
  private drawSelection(box: SelectionBox): void {
    // `boxBounds`, not a local min/max: a pick can name a tile one past the
    // east or south edge, and the selection clamps it there — so drawing has
    // to clamp it identically or the box would shade ground the release will
    // not take.
    const { x0, x1, y0, y1 } = boxBounds(box.from, box.to, this.sim.world.size);
    // Row granularity on the budget check: past the cap `put` drops silently,
    // and a map-wide box would otherwise pay 65k dropped calls every frame.
    for (let y = y0; y <= y1 && this.selFill.used < MAX_INSIDE; y++) {
      for (let x = x0; x <= x1; x++) plate(this.selFill, x, y, this.groundY(x, y) + 0.025);
    }
    // Two horizontal runs then two vertical ones, `drawWatchRange`'s pattern:
    // the four corner tiles are visited twice on purpose — each needs a bar on
    // both of its outward faces, or the box has four notches in it.
    for (let x = x0; x <= x1; x++) {
      this.selBar(x, y0, 0, -1);
      this.selBar(x, y1, 0, 1);
    }
    for (let y = y0; y <= y1; y++) {
      this.selBar(x0, y, -1, 0);
      this.selBar(x1, y, 1, 0);
    }
  }

  private selBar(x: number, y: number, dx: number, dy: number): void {
    this.edgeBar(this.selKeyline, this.selEdge, x, y, this.groundY(x, y) + 0.025, dx, dy);
  }

  /**
   * The placement ghost: sage where it may be placed, rust where it may not —
   * never alarm red. A building draws its footprint's grid lines per tile with
   * a heavier outer border; a wall run draws one keylined tile per segment,
   * each with its own verdict, because the run is judged segment by segment.
   */
  private drawGhost(ghost: Ghost): void {
    if (ghost.kind === "wall") {
      for (const tile of ghost.tiles) {
        const top = this.groundY(tile.x, tile.y) + 0.03;
        const fill = tile.valid ? this.ghostFill : this.badFill;
        const edge = tile.valid ? this.ghostEdge : this.badEdge;
        plate(fill, tile.x, tile.y, top);
        this.edge(this.ghostKeyline, edge, { x: tile.x, y: tile.y, w: 1, h: 1 }, top + 0.01, BORDER);
      }
      return;
    }
    const fill = ghost.valid ? this.ghostFill : this.badFill;
    const edge = ghost.valid ? this.ghostEdge : this.badEdge;
    const def = BUILDING_DEFS[ghost.building];
    const area = { x: ghost.x, y: ghost.y, w: def.w, h: def.h };
    for (const [tx, ty] of footprint(area)) {
      const top = this.groundY(tx, ty) + 0.03;
      plate(fill, tx, ty, top);
      this.edge(this.ghostKeyline, edge, { x: tx, y: ty, w: 1, h: 1 }, top + 0.01, GRID_LINE);
    }
    // The footprint's outer border, heavier than the interior grid lines.
    this.edge(this.ghostKeyline, edge, area, this.groundY(area.x, area.y) + 0.06, BORDER);
  }
}

/**
 * One end of a bee's dart: a point in the disc of radius `BEE_RANGE` about its
 * anchor, hashed from the segment index.
 *
 * Keyed to `s` rather than to a frequency, which is what makes the flight have
 * no period at all — and three salts rather than three offsets of one, because
 * `hash(who, s * 2 + 3, …)` and `hash(who, (s + 1) * 2 + 1, …)` are the same
 * call, and a bee whose destination equals its next origin stands still.
 */
function beePoint(who: number, s: number, seed: number): [number, number, number] {
  const a = hash(who, s, seed ^ BEE_SALT_A) * TAU;
  const r = Math.sqrt(hash(who, s, seed ^ BEE_SALT_B)) * BEE_RANGE;
  return [Math.cos(a) * r, (hash(who, s, seed ^ BEE_SALT_C) - 0.5) * BEE_LIFT, Math.sin(a) * r];
}

/** Is this anchor close enough to the camera focus to be worth populating? */
function near(x: number, z: number, fx: number, fz: number): boolean {
  return Math.abs(x - fx) <= AMBIENT_RADIUS && Math.abs(z - fz) <= AMBIENT_RADIUS;
}

/** Eight slots per tile: a 2×2 grid, two layers high. */
function lattice(n: number): [number, number, number] {
  const i = n % 8;
  const level = Math.floor(i / 4);
  const cell = i % 4;
  return [(cell % 2) * 0.36 - 0.18, level * 0.21, Math.floor(cell / 2) * 0.36 - 0.18];
}

function plate(l: Layer, x: number, y: number, top: number): void {
  put(l, x + 0.5, top, y + 0.5, 0.96, 0.02, 0.96, 0);
}

/** Four thin bars forming the border of a rectangle of tiles. */
function outlineArea(
  l: Layer,
  a: { x: number; y: number; w: number; h: number },
  top: number,
  t: number,
): void {
  put(l, a.x + a.w / 2, top, a.y + t / 2, a.w, 0.02, t, 0);
  put(l, a.x + a.w / 2, top, a.y + a.h - t / 2, a.w, 0.02, t, 0);
  put(l, a.x + t / 2, top, a.y + a.h / 2, t, 0.02, a.h, 0);
  put(l, a.x + a.w - t / 2, top, a.y + a.h / 2, t, 0.02, a.h, 0);
}
