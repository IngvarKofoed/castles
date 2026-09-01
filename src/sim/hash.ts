import type { Sim } from "./store";

/**
 * A stable fingerprint of the whole sim store.
 *
 * The golden test's whole claim rests on this: same seed + same command log at
 * the same ticks = the same colony, byte for byte. So the walk below must be
 * *total* (nothing skipped, or a defect hides in the gap) and *canonical*
 * (object keys sorted, so a refactor that reorders a literal's fields doesn't
 * read as a behaviour change).
 *
 * FNV-1a over a canonical token stream, folded incrementally so a 65k-tile
 * world never becomes a 65k-character string.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

class Digest {
  private h = FNV_OFFSET;

  byte(b: number): void {
    this.h = Math.imul(this.h ^ (b & 0xff), FNV_PRIME);
  }

  text(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
    this.byte(0);
  }

  get hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}

function isTypedArray(v: unknown): v is ArrayLike<number> {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function walk(d: Digest, value: unknown): void {
  if (value === null) {
    d.text("null");
    return;
  }
  switch (typeof value) {
    case "number":
      // String form, not float bytes: -0 and 0 must fingerprint alike, and a
      // number that happens to be integral must not depend on its storage.
      d.text(`n:${Object.is(value, -0) ? "0" : String(value)}`);
      return;
    case "string":
      d.text(`s:${value}`);
      return;
    case "boolean":
      d.text(value ? "b:1" : "b:0");
      return;
    case "undefined":
      // Never legal in the store; hashed distinctly so a stray one is visible
      // as a hash change rather than silently equal to null.
      d.text("undef");
      return;
  }
  if (isTypedArray(value)) {
    d.text(`t:${value.length}`);
    for (let i = 0; i < value.length; i++) d.text(String(value[i]));
    return;
  }
  if (Array.isArray(value)) {
    d.text(`a:${value.length}`);
    for (const v of value) walk(d, v);
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  d.text(`o:${keys.length}`);
  for (const k of keys) {
    d.text(`k:${k}`);
    walk(d, obj[k]);
  }
}

/** Fingerprint the store. Equal hashes mean equal colonies. */
export function hashSim(sim: Sim): string {
  const d = new Digest();
  walk(d, sim);
  return d.hex;
}
