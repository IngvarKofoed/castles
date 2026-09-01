# Dirty-chunk marking covers the neighbours a tile's geometry reaches into

`markChunkDirty(world, x, y)` now bumps every chunk within one tile of (x, y),
not just the owning one — up to two at a chunk edge and four at a chunk
corner. Chunk geometry is not a function of the chunk alone: the mesher reads
4-neighbour heights across the seam for its step faces and the renderer's
baked AO reads all 8, so the old single-chunk bump would have left stale
faces and stale shading next door on every border edit. Narrows
`2026-09-01-bootstrap-world`, which landed the seam with nothing yet driving
it.

## Detail
- Caught by review before anything mutates the world, so no visual artifact
  was ever observed — the seam is still unused (build-order step 2+ is what
  starts bumping versions). The tests pin the fan-out shape instead: interior
  tile → 1 chunk, edge tile → 2, corner tile → 4, world corner → 1.
- The radius is set by the *widest* reader, which is the AO kernel's
  diagonals (`src/render/palette.ts`), not the mesher's 4-neighbour height
  lookup. If a future reader widens past Chebyshev distance 1 — a larger AO
  kernel, smoothed normals, cross-tile props — this function has to widen
  with it, and nothing enforces that link.
- Implemented as a clamped chunk-coordinate range rather than a deduplicated
  3×3 tile scan, so it allocates nothing: this runs on every tile mutation.
- Out-of-bounds tiles return without touching anything, rather than throwing
  or bumping a wrapped index.
