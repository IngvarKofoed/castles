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
  WATCH_RANGE,
  type BuildingKindValue,
  type ItemTypeValue,
  type MonsterKindValue,
  type Sim,
} from "../sim/know";
import { WORLD_SIZE, tileIndex } from "../sim/world/world";
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
 */
const MAX_INSIDE = 16384;
const MAX_BOUNDARY = 4096;
/**
 * The watch-range boundaries: `SQUARE_BARS` per tower, and the tool shows every
 * tower on the map at once. Sized for a few dozen towers — well past what a
 * colony builds — and past the cap a square is refused **whole** rather than
 * truncated, because a half-drawn square is worse than a missing one: it claims
 * a smaller reach than the tower actually has.
 *
 * The ghost's own square is queued **first** by the caller for exactly that
 * reason: if a budget ever runs out it must not be the overlay the player is
 * actively aiming with that goes missing (the `ghostKeyline` lesson).
 */
const MAX_WATCH = 8192;
/** Bars one watch square costs, in each of its two layers: four runs of
 *  `2·WATCH_RANGE + 1`, which is one per ring tile plus a second on each of the
 *  four corners — a corner needs a bar on both of its outward faces. */
const SQUARE_BARS = 4 * (2 * WATCH_RANGE + 1);
/**
 * A wall drag is an L, so its two legs together reach at most twice a map edge
 * — and each tile draws four bars. Sized for the whole L: a cap that only
 * covered one leg would silently drop the far end of the very overlay the
 * player is aiming with.
 */
const MAX_RUN = 2 * WORLD_SIZE;

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

function solidLayer(scene: Scene, max: number): Layer {
  const mesh = new InstancedMesh(BOX, createMoverMaterial(), max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
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
    this.watchKeyline = overlayLayer(scene, MAX_WATCH, KEYLINE, 0.5);
    this.watchEdge = overlayLayer(scene, MAX_WATCH, SAGE, 0.85);
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
    ghost: Ghost | null,
    showEnclosure = false,
    watch: readonly { x: number; y: number }[] = [],
  ): void {
    for (const l of this.layers) l.used = 0;
    this.drawColonists(alpha);
    this.drawMonsters(alpha);
    this.drawGoods();
    this.drawDesignations();
    if (showEnclosure) this.drawEnclosure();
    // Before the ghost, and in the order the caller gave: the ghost's own
    // square leads the list, so a starved layer drops a distant tower's
    // boundary rather than the one being aimed with.
    for (const tower of watch) this.drawWatchRange(tower.x, tower.y);
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
   * One Watchtower's reach: a keylined sage **square outline** at Chebyshev
   * `WATCH_RANGE` around its tile, shown only while the tower tool is held or
   * a tower is selected — never permanently.
   *
   * **A square, because a square is what the predicate tests.** Coverage is
   * Chebyshev distance from the tower to a den, so a circle of radius 24 would
   * draw a picture that excluded covered diagonal dens — the overlay denying
   * knowledge the player has already paid a pair of hands for.
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
  private drawWatchRange(cx: number, cy: number): void {
    const size = this.sim.world.size;
    const r = WATCH_RANGE;
    // Refuse a square that will not fit **whole**. `put` drops instances one at
    // a time, and the four runs are laid interleaved per `d`, so a square that
    // merely ran out of budget would render as an open box stopping short on
    // all four sides — a boundary claiming *less* ground than the predicate
    // covers, which is the one thing this overlay may never do. The ghost is
    // queued first, so what a full layer refuses is always a distant tower.
    if (this.watchKeyline.used + SQUARE_BARS > MAX_WATCH) return;
    for (let d = -r; d <= r; d++) {
      // The two horizontal runs then the two vertical ones. The four corner
      // tiles are visited twice on purpose — each needs a bar on both of its
      // outward faces, or the square has four notches in it.
      this.watchBar(cx + d, cy - r, 0, -1, size);
      this.watchBar(cx + d, cy + r, 0, 1, size);
      this.watchBar(cx - r, cy + d, -1, 0, size);
      this.watchBar(cx + r, cy + d, 1, 0, size);
    }
  }

  private watchBar(x: number, y: number, dx: number, dy: number, size: number): void {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    this.edgeBar(this.watchKeyline, this.watchEdge, x, y, this.groundY(x, y) + 0.02, dx, dy);
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
