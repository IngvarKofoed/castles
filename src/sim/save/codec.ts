import { chunkCount } from "../world/chunks";
import type { Sim } from "../store";
import { MIGRATIONS } from "./migrations";

/**
 * The save codec: the whole sim store in, one gzipped byte string out.
 *
 * Pure, per docs/ARCHITECTURE.md's boundary — no IndexedDB, no downloads, no
 * clock. `CompressionStream` and `TextEncoder` are JS-runtime globals rather
 * than DOM, which is what keeps this file Vitest-testable (see
 * `src/sim/CLAUDE.md`); everything that needs a document lives in
 * `src/app/storage.ts`.
 *
 * **One byte format everywhere.** These bytes are what IndexedDB holds *and*
 * what a `.castles` file contains — export is a download of the same blob and
 * import is just a load, so there is no second serialization path to drift.
 *
 * Two invariants worth stating out loud, because both are easy to break later:
 *
 * - **`encode` snapshots synchronously, compresses asynchronously.** The
 *   `JSON.stringify` walk below runs to completion before anything awaits, so
 *   a save can never capture half of one tick and half of the next. That is
 *   why this is a plain function returning a promise and not an `async`
 *   function with the stringify buried after an await.
 * - **`decode` returns a whole store or throws.** Every failure path — bad
 *   gzip, bad JSON, a version from the future, a missing or wrong-sized
 *   field — raises `SaveError` with something the player can read. It never
 *   returns a partial store for the caller to discover later.
 */

/**
 * The save schema version. Bump it whenever the `Sim` shape changes, and add
 * the matching entry to `MIGRATIONS` — the fixture test in this folder fails
 * loudly if an old save stops loading, which is the point.
 */
export const SAVE_VERSION = 1;

/** A save that cannot be read, with a message meant for the menu's note row. */
export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

const NOT_A_SAVE = "that doesn't look like a Castles save";
const DAMAGED = "this save is damaged";
const FROM_THE_FUTURE = "this save was made by a newer version of Castles";

/**
 * The envelope around the store. `seed`, `tick` and `app` are informational —
 * for tooling and for a saves list that must not have to decode a save to
 * describe it. `state` is the sole authority on load.
 */
export interface SaveEnvelope {
  v: number;
  seed: number;
  tick: number;
  app: string;
  state: unknown;
}

/** Typed arrays travel as `{__ta, d}` with `d` holding base64 of the array's
 *  **little-endian** bytes. Pinned here in writing: this is the file format. */
type TypedArrayTag = "u8" | "u32";
interface TaggedArray {
  __ta: TypedArrayTag;
  d: string;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// ------------------------------------------------------------------ encode

/**
 * Snapshot the store, then gzip it. Not an `async function` on purpose: the
 * stringify below is the synchronous half, and making it the first statement
 * of an ordinary function is what structurally guarantees the ordering.
 */
export function encode(sim: Sim, app: string): Promise<Uint8Array> {
  const envelope: SaveEnvelope = {
    v: SAVE_VERSION,
    seed: sim.world.seed,
    tick: sim.tick,
    app,
    state: sim,
  };
  const json = JSON.stringify(envelope, replacer);
  return gzip(TEXT_ENCODER.encode(json));
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) return tag("u8", value);
  if (value instanceof Uint32Array) return tag("u32", u32ToBytes(value));
  if (ArrayBuffer.isView(value)) {
    // A new typed array kind in the store needs a tag and a migration, not a
    // silent `{"0":1,"1":2,…}` object that would decode as garbage.
    throw new SaveError(`the store holds a typed array the save format has no tag for`);
  }
  return value;
}

function tag(kind: TypedArrayTag, bytes: Uint8Array): TaggedArray {
  return { __ta: kind, d: toBase64(bytes) };
}

/** Explicit little-endian, so the format does not depend on the host's byte
 *  order — a save written on one machine must load on any other. */
function u32ToBytes(values: Uint32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const o = i * 4;
    out[o] = v & 0xff;
    out[o + 1] = (v >>> 8) & 0xff;
    out[o + 2] = (v >>> 16) & 0xff;
    out[o + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

function bytesToU32(bytes: Uint8Array): Uint32Array {
  if (bytes.length % 4 !== 0) throw new SaveError(DAMAGED);
  const out = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  }
  return out;
}

// ------------------------------------------------------------------ decode

/** Read a save. Whole store or `SaveError` — never anything in between. */
export async function decode(bytes: Uint8Array): Promise<Sim> {
  const json = TEXT_DECODER.decode(await gunzip(bytes));

  let parsed: unknown;
  try {
    parsed = JSON.parse(json, reviver);
  } catch (cause) {
    if (cause instanceof SaveError) throw cause;
    throw new SaveError(NOT_A_SAVE);
  }

  const envelope = parsed as Partial<SaveEnvelope> | null;
  if (!envelope || typeof envelope !== "object" || !Number.isInteger(envelope.v)) {
    throw new SaveError(NOT_A_SAVE);
  }
  const from = envelope.v as number;
  if (from > SAVE_VERSION) throw new SaveError(FROM_THE_FUTURE);
  if (from < 1) throw new SaveError(NOT_A_SAVE);

  let state = envelope.state;
  for (let v = from; v < SAVE_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new SaveError(`this save is version ${v}, which this build can no longer read`);
    state = migrate(state);
  }
  return assertSim(state);
}

function reviver(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const t = value as Partial<TaggedArray>;
  if (typeof t.__ta !== "string") return value;
  if (typeof t.d !== "string") throw new SaveError(DAMAGED);
  const bytes = fromBase64(t.d);
  if (t.__ta === "u8") return bytes;
  if (t.__ta === "u32") return bytesToU32(bytes);
  throw new SaveError(DAMAGED);
}

/**
 * Structural check over the decoded state.
 *
 * Deliberately not a full schema walk of every colonist field: what this has
 * to catch is a file that is *not this game's store* — a truncated array, a
 * world whose layers no longer match its size, a hand-edited JSON. A save that
 * passes here can be handed to `advanceTick` without the rest of the sim
 * needing a single defensive read.
 */
function assertSim(raw: unknown): Sim {
  const s = object(raw);
  const world = object(s.world);

  const size = world.size;
  if (!Number.isInteger(size) || (size as number) <= 0) throw new SaveError(DAMAGED);
  const tiles = (size as number) * (size as number);

  layer(world.hmap, tiles);
  layer(world.tmap, tiles);
  layer(world.treeMap, tiles);
  layer(s.chopMap, tiles);
  if (!(world.chunkVersion instanceof Uint32Array) || world.chunkVersion.length !== chunkCount(size as number)) {
    throw new SaveError(DAMAGED);
  }

  number(world.seed);
  number(s.tick);
  number(s.rngState);
  number(s.nextId);
  for (const key of ["colonists", "items", "buildings", "tasks"] as const) {
    const list = s[key];
    if (!Array.isArray(list)) throw new SaveError(DAMAGED);
    for (const entry of list) if (!entry || typeof entry !== "object") throw new SaveError(DAMAGED);
  }

  return s as unknown as Sim;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SaveError(DAMAGED);
  return value as Record<string, unknown>;
}

function number(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SaveError(DAMAGED);
}

function layer(value: unknown, length: number): void {
  if (!(value instanceof Uint8Array) || value.length !== length) throw new SaveError(DAMAGED);
}

// ------------------------------------------------------------------- gzip

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(new CompressionStream("gzip"), bytes, DAMAGED);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(new DecompressionStream("gzip"), bytes, NOT_A_SAVE);
}

async function through(
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
  bytes: Uint8Array,
  failure: string,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Both promises are settled by the drain below; an unhandled rejection here
  // would otherwise outlive the error we actually throw.
  void writer.write(asBufferSource(bytes)).catch(() => {});
  void writer.close().catch(() => {});
  try {
    return await drain(transform.readable);
  } catch {
    throw new SaveError(failure);
  }
}

/**
 * `BufferSource` excludes views over a `SharedArrayBuffer`, which a save is
 * never backed by — but `Uint8Array` alone does not say so to the compiler.
 * The copy is the guard's else branch and does not run in practice.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ----------------------------------------------------------------- base64

// Hand-rolled rather than `btoa`: this is the file format forever, and it must
// behave identically in the browser, in Vitest, and in whatever the desktop
// wrap runs on — without depending on a global whose availability is a
// platform question.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INVERSE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
  return table;
})();

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
    // Flushing keeps the rope shallow on a 65k-tile layer.
    if (out.length >= 8192) {
      parts.push(out);
      out = "";
    }
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >>> 18) & 63]}${B64[(n >>> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >>> 18) & 63]}${B64[(n >>> 12) & 63]}${B64[(n >>> 6) & 63]}=`;
  }
  parts.push(out);
  return parts.join("");
}

function fromBase64(text: string): Uint8Array {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 61 /* = */) end--;
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? B64_INVERSE[code] : -1;
    if (v < 0) throw new SaveError(DAMAGED);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}
