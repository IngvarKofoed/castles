import { BufferAttribute, BufferGeometry, Mesh, type Material, type Object3D, type Scene as ThreeScene } from "three";
import { chunkCoords, chunkCount } from "../sim/world/chunks";
import {
  buildings,
  chopLayer,
  damageLayer,
  graveLayer,
  lairs,
  mineLayer,
  razeLayer,
  wallLayer,
  type Sim,
} from "../sim/know";
import { meshChunk, meshWaterChunk, type ChunkGeometry, type Scene, type WaterGeometry } from "./mesher";

/**
 * Owns one terrain Mesh per chunk (and one water mesh per chunk that has wet
 * tiles). The renderer never writes sim state: it keeps its own last-seen
 * copy of the sim's chunkVersion array and rebuilds chunks whose versions
 * moved — which on first sync is all of them, since generation leaves every
 * version at 1 and nothing has been seen yet.
 *
 * Trees, buildings and wall segments bake into these meshes, so felling a
 * tree, finishing a building or raising a palisade only shows up because the
 * sim bumped that chunk's version.
 */
export class ChunkRenderer {
  private readonly lastSeen: Uint32Array;
  private readonly terrain: (Mesh | null)[];
  private readonly water: (Mesh | null)[];
  /** Cached `pickTargets`, invalidated whenever a chunk mesh is replaced —
   *  the getter is read on every pointer move. */
  private targets: Object3D[] | null = null;

  constructor(
    private readonly scene: ThreeScene,
    private readonly sim: Sim,
    private readonly terrainMaterial: Material,
    private readonly waterMaterial: Material,
  ) {
    const n = chunkCount(sim.world.size);
    this.lastSeen = new Uint32Array(n);
    this.terrain = new Array<Mesh | null>(n).fill(null);
    this.water = new Array<Mesh | null>(n).fill(null);
  }

  /** The meshes picking raycasts against. */
  get pickTargets(): Object3D[] {
    this.targets ??= this.terrain.filter((m): m is Mesh => m !== null);
    return this.targets;
  }

  /**
   * Drop every mesh this renderer owns. Called when a load replaces the sim
   * under it: the `Sim` was captured at construction, so the renderer is
   * rebuilt rather than re-pointed.
   *
   * The materials are *not* disposed — they are created once by the app and
   * shared across every session, so disposing them here would leave the next
   * session drawing with a destroyed program.
   */
  dispose(): void {
    for (const list of [this.terrain, this.water]) {
      for (let c = 0; c < list.length; c++) {
        const mesh = list[c];
        if (!mesh) continue;
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        list[c] = null;
      }
    }
    this.targets = null;
  }

  /** Rebuild every chunk whose sim-side version moved. Per-chunk, never per-world. */
  sync(): void {
    const versions = this.sim.world.chunkVersion;
    for (let c = 0; c < versions.length; c++) {
      if (versions[c] === this.lastSeen[c]) continue;
      this.rebuild(c);
      this.lastSeen[c] = versions[c];
    }
  }

  private rebuild(c: number): void {
    this.targets = null;
    const world = this.sim.world;
    const { cx, cy } = chunkCoords(c, world.size);
    const input: Scene = {
      world,
      buildings: buildings(this.sim),
      chopMap: chopLayer(this.sim),
      mineMap: mineLayer(this.sim),
      wallMap: wallLayer(this.sim),
      razeMap: razeLayer(this.sim),
      damageMap: damageLayer(this.sim),
      graveMap: graveLayer(this.sim),
      lairs: lairs(this.sim),
    };

    const terrainGeom = toGeometry(meshChunk(input, cx, cy));
    this.terrain[c] = this.replace(this.terrain[c], terrainGeom, this.terrainMaterial, true);

    const waterData = meshWaterChunk(input, cx, cy);
    this.water[c] = this.replace(
      this.water[c],
      waterData ? toWaterGeometry(waterData) : null,
      this.waterMaterial,
      false,
    );
  }

  private replace(old: Mesh | null, geometry: BufferGeometry | null, material: Material, shadows: boolean): Mesh | null {
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
    }
    if (!geometry) return null;
    const mesh = new Mesh(geometry, material);
    if (shadows) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.scene.add(mesh);
    return mesh;
  }
}

function toGeometry(data: ChunkGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setAttribute("aBlockY", new BufferAttribute(data.blockY, 1));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  // Each chunk's own bounding sphere is what gives per-chunk frustum culling.
  geometry.computeBoundingSphere();
  return geometry;
}

function toWaterGeometry(data: WaterGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
