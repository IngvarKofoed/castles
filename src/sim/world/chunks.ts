/** Chunk math. The world is chunked 16×16; everything per-chunk keys off this. */
export const CHUNK = 16;

/** Chunks per side for a square world of `size` tiles (size must be a multiple of CHUNK). */
export function chunksPerSide(size: number): number {
  return size / CHUNK;
}

/** Total chunk count for a square world of `size` tiles. */
export function chunkCount(size: number): number {
  const n = chunksPerSide(size);
  return n * n;
}

/** Chunk index owning tile (x, y). */
export function chunkOf(x: number, y: number, size: number): number {
  return Math.floor(y / CHUNK) * chunksPerSide(size) + Math.floor(x / CHUNK);
}

/** Chunk-grid coordinates of chunk index `c`. */
export function chunkCoords(c: number, size: number): { cx: number; cy: number } {
  const n = chunksPerSide(size);
  return { cx: c % n, cy: Math.floor(c / n) };
}

/** Tile-space origin (top-left tile) of the chunk at chunk-grid (cx, cy). */
export function chunkOrigin(cx: number, cy: number): { x: number; y: number } {
  return { x: cx * CHUNK, y: cy * CHUNK };
}
