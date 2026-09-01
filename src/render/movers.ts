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
  ItemType,
  Loc,
  buildings,
  chopLayer,
  colonists,
  footprint,
  items,
  BUILDING_DEFS,
  type BuildingKindValue,
  type Sim,
} from "../sim/know";
import { tileIndex } from "../sim/world/world";
import { createMoverMaterial } from "./materials";
import { OVERLAY, PROP } from "./palette";
import { BH } from "./props";

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

/** Folk wear the mockup's cloth colours — world colours, so they read against
 *  grass. Pool-vs-slot is the HUD's labour meter's job, not the model's. */
const CLOTH = [PROP.tunic, PROP.wool, PROP.smock];

const MAX_COLONISTS = 64;
const MAX_ITEMS = 1024;
const MAX_OVERLAY = 8192;

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

/** What the placement tool is hovering, if anything. */
export interface Ghost {
  kind: BuildingKindValue;
  x: number;
  y: number;
  valid: boolean;
}

export class MoverRenderer {
  private readonly solids: Layer;
  private readonly markKeyline: Layer;
  private readonly markFill: Layer;
  private readonly markEdge: Layer;
  private readonly ghostKeyline: Layer;
  private readonly ghostFill: Layer;
  private readonly ghostEdge: Layer;

  constructor(
    scene: Scene,
    private readonly sim: Sim,
  ) {
    this.solids = solidLayer(scene, MAX_COLONISTS * 3 + MAX_ITEMS);
    this.markKeyline = overlayLayer(scene, MAX_OVERLAY, KEYLINE, 0.5);
    this.markFill = overlayLayer(scene, MAX_OVERLAY, GOLD, 0.13);
    this.markEdge = overlayLayer(scene, MAX_OVERLAY, GOLD, 0.85);
    // The ghost gets its own keyline layer rather than sharing the marks'.
    // A drag-box over a wood can mark thousands of trees, and a shared layer
    // would run out of instances on the designations and silently drop the
    // ghost's outline — the one overlay the player is actively aiming with.
    this.ghostKeyline = overlayLayer(scene, 256, KEYLINE, 0.5);
    this.ghostFill = overlayLayer(scene, 64, SAGE, 0.22);
    this.ghostEdge = overlayLayer(scene, 256, SAGE, 0.85);
  }

  /**
   * Draw one frame. `alpha` is the leftover tick fraction from the app loop —
   * 0 at the tick just simulated, approaching 1 at the next.
   */
  sync(alpha: number, ghost: Ghost | null): void {
    for (const l of this.layers) l.used = 0;
    this.drawColonists(alpha);
    this.drawGoods();
    this.drawDesignations();
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
      put(this.solids, x, base + BODY.y, y, BODY.w, BODY.h, BODY.w, c.heading, CLOTH[c.id % CLOTH.length]);
      put(this.solids, x, base + HEAD.y, y, HEAD.w, HEAD.h, HEAD.w, c.heading, PROP.linen);
      if (c.carrying >= 0) {
        put(this.solids, x, base + CARRY.y, y, CARRY.w, CARRY.h, CARRY.w, c.heading, PROP.crate);
      }
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
      const tint = item.type === ItemType.Log ? PROP.timber : PROP.plank;
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
      // A mill's buffers ride on its roofline, because the walls are solid;
      // everything else stacks on the deck or the marked-out plot.
      const deck =
        b.kind === BuildingKind.Sawmill && b.state === BuildingState.Active ? 2.38 * BH : 0.16 * BH;
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
   * Gold outline over a faint gold fill on the ground tile a marked tree
   * stands on — at its base, around the trunk, not capping its crown.
   *
   * The canopy does hide the back half of the diamond at these camera angles,
   * and that is fine: the front half reads, and the tree's own gold-shifted
   * canopy (props.ts) carries the mark at distances where the base is lost.
   * A cap floating above the crown solved the occlusion but read as a box
   * hanging in mid-air, which is worse than a partly hidden mark.
   */
  private drawDesignations(): void {
    const size = this.sim.world.size;
    // Walks the layer rather than `designations()`: that helper builds a fresh
    // array of every marked tile, and this runs once a frame.
    const marks = chopLayer(this.sim);
    for (let i = 0; i < marks.length; i++) {
      if (!marks[i]) continue;
      const x = i % size;
      const y = (i - x) / size;
      const top = this.groundY(x, y) + 0.02;
      plate(this.markFill, x, y, top);
      this.edge(this.markKeyline, this.markEdge, { x, y, w: 1, h: 1 }, top + 0.01, MARK_LINE);
    }
  }

  /**
   * The placement ghost: sage when the footprint is legal, rust when it is
   * not — never alarm red. The footprint's own grid lines are drawn per tile
   * and the border reads heavier because the outer edge is thicker.
   */
  private drawGhost(ghost: Ghost): void {
    const colour = ghost.valid ? SAGE : RUST;
    (this.ghostFill.mesh.material as MeshBasicMaterial).color.setHex(colour);
    (this.ghostEdge.mesh.material as MeshBasicMaterial).color.setHex(colour);
    const def = BUILDING_DEFS[ghost.kind];
    const area = { x: ghost.x, y: ghost.y, w: def.w, h: def.h };
    for (const [tx, ty] of footprint(area)) {
      const top = this.groundY(tx, ty) + 0.03;
      plate(this.ghostFill, tx, ty, top);
      this.edge(this.ghostKeyline, this.ghostEdge, { x: tx, y: ty, w: 1, h: 1 }, top + 0.01, GRID_LINE);
    }
    // The footprint's outer border, heavier than the interior grid lines.
    this.edge(this.ghostKeyline, this.ghostEdge, area, this.groundY(area.x, area.y) + 0.06, BORDER);
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
