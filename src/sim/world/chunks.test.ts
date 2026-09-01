import { describe, expect, it } from "vitest";
import { CHUNK, chunkCoords, chunkCount, chunkOf, chunkOrigin, chunksPerSide } from "./chunks";

describe("chunk math", () => {
  const SIZE = 256;

  it("splits a 256 world into 16×16 chunks", () => {
    expect(chunksPerSide(SIZE)).toBe(16);
    expect(chunkCount(SIZE)).toBe(256);
  });

  it("round-trips chunk index ↔ chunk coords", () => {
    for (let c = 0; c < chunkCount(SIZE); c++) {
      const { cx, cy } = chunkCoords(c, SIZE);
      expect(cy * chunksPerSide(SIZE) + cx).toBe(c);
    }
  });

  it("maps a tile to the chunk whose origin contains it", () => {
    for (const [x, y] of [
      [0, 0],
      [15, 15],
      [16, 0],
      [0, 16],
      [255, 255],
      [130, 47],
    ]) {
      const c = chunkOf(x, y, SIZE);
      const { cx, cy } = chunkCoords(c, SIZE);
      const origin = chunkOrigin(cx, cy);
      expect(x).toBeGreaterThanOrEqual(origin.x);
      expect(x).toBeLessThan(origin.x + CHUNK);
      expect(y).toBeGreaterThanOrEqual(origin.y);
      expect(y).toBeLessThan(origin.y + CHUNK);
    }
  });
});
