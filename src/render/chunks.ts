import { BufferAttribute, BufferGeometry, Mesh, type Material, type Scene } from "three";
import { chunkCoords, chunkCount } from "../sim/world/chunks";
import type { World } from "../sim/world/world";
import { meshChunk, meshWaterChunk, type ChunkGeometry, type WaterGeometry } from "./mesher";

/**
 * Owns one terrain Mesh per chunk (and one water mesh per chunk that has wet
 * tiles). The renderer never writes sim state: it keeps its own last-seen
 * copy of the sim's chunkVersion array and rebuilds chunks whose versions
 * moved — which on first sync is all of them, since generation leaves every
 * version at 1 and nothing has been seen yet.
 */
export class ChunkRenderer {
  private readonly lastSeen: Uint32Array;
  private readonly terrain: (Mesh | null)[];
  private readonly water: (Mesh | null)[];

  constructor(
    private readonly scene: Scene,
    private readonly world: World,
    private readonly terrainMaterial: Material,
    private readonly waterMaterial: Material,
  ) {
    const n = chunkCount(world.size);
    this.lastSeen = new Uint32Array(n);
    this.terrain = new Array<Mesh | null>(n).fill(null);
    this.water = new Array<Mesh | null>(n).fill(null);
  }

  /** Rebuild every chunk whose sim-side version moved. Per-chunk, never per-world. */
  sync(): void {
    const versions = this.world.chunkVersion;
    for (let c = 0; c < versions.length; c++) {
      if (versions[c] === this.lastSeen[c]) continue;
      this.rebuild(c);
      this.lastSeen[c] = versions[c];
    }
  }

  private rebuild(c: number): void {
    const { cx, cy } = chunkCoords(c, this.world.size);

    const terrainGeom = toGeometry(meshChunk(this.world, cx, cy));
    this.terrain[c] = this.replace(this.terrain[c], terrainGeom, this.terrainMaterial, true);

    const waterData = meshWaterChunk(this.world, cx, cy);
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
