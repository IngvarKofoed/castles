import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng";
import { hash } from "./noise";

describe("mulberry32", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("hash", () => {
  it("is deterministic, seed-sensitive, and in [0, 1)", () => {
    expect(hash(3, 7, 42)).toBe(hash(3, 7, 42));
    expect(hash(3, 7, 42)).not.toBe(hash(3, 7, 43));
    expect(hash(3, 7, 42)).not.toBe(hash(7, 3, 42));
    for (let i = -50; i < 50; i++) {
      const v = hash(i, i * 31, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
