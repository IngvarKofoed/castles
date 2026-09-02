/**
 * Everything the codec is not allowed to touch: IndexedDB, the download
 * anchor, the file picker, the clock, the single-instance lock.
 *
 * `src/sim/save/codec.ts` turns the store into bytes and back and knows
 * nothing about where those bytes live. This file is the other half, and it is
 * deliberately *one* file: when the desktop wrap arrives, `IndexedDbStorage`
 * is replaced by a real-files implementation of `SaveStorage` and the export /
 * import plumbing below is swapped with it — that is the whole change, which
 * is only true while all of it stays here (docs/ARCHITECTURE.md, Persistence).
 *
 * `Date.now` lives here for the same reason: sim time is the tick counter, so
 * timestamps are assigned outside the boundary and travel as save metadata.
 */

/** How a save describes itself in the menu, without anyone decoding it. */
export interface SaveMeta {
  /** Storage key. `auto-0..2` for the ring, `save-<name>` for a manual slot. */
  key: string;
  name: string;
  kind: "auto" | "manual";
  /** Wall-clock milliseconds. The saves list and the boot walk both sort on it. */
  savedAt: number;
  /** In-game day, 1-based, as the ribbon counts it. */
  day: number;
  population: number;
  seed: number;
  /** `SAVE_VERSION` of the bytes. */
  version: number;
  /** App version (`git describe`) that wrote it. */
  app: string;
}

/**
 * The seam the Tauri build implements. Deliberately four methods over opaque
 * bytes: anything richer would leak IndexedDB's shape into the caller and stop
 * the swap being boring.
 */
export interface SaveStorage {
  list(): Promise<SaveMeta[]>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array, meta: SaveMeta): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Autosave ring size. Three is enough to survive one bad save and one bad day. */
export const AUTOSAVE_SLOTS = 3;

export const autoKey = (slot: number): string => `auto-${slot}`;
export const manualKey = (name: string): string => `save-${name}`;

/** Wall-clock time, in one place, so nothing else in `app/` reaches for it. */
export const now = (): number => Date.now();

/**
 * A seed for a brand-new colony. Clock-derived, which is fine and even
 * required out here: dealing every "new colony" the identical default map
 * reads as broken. The seed rides the save, so the world stays reproducible
 * from the moment it exists.
 */
export const randomSeed = (): number => (Date.now() ^ (Date.now() >>> 7) ^ 0x5bf03635) >>> 0;

// -------------------------------------------------------------- IndexedDB

const DB_NAME = "castles";
const DB_VERSION = 1;
const STORE = "saves";

interface SaveRecord {
  key: string;
  meta: SaveMeta;
  blob: Uint8Array;
}

class IndexedDbStorage implements SaveStorage {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<SaveMeta[]> {
    const records = await request<SaveRecord[]>(this.tx("readonly").getAll());
    return records.map((r) => r.meta).filter((m): m is SaveMeta => !!m && typeof m.savedAt === "number");
  }

  async get(key: string): Promise<Uint8Array> {
    const record = await request<SaveRecord | undefined>(this.tx("readonly").get(key));
    if (!record?.blob) throw new Error("that save is no longer there");
    return record.blob;
  }

  async put(key: string, bytes: Uint8Array, meta: SaveMeta): Promise<void> {
    const store = this.tx("readwrite");
    store.put({ key, meta, blob: bytes } satisfies SaveRecord);
    await committed(store.transaction);
  }

  async delete(key: string): Promise<void> {
    const store = this.tx("readwrite");
    store.delete(key);
    await committed(store.transaction);
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = (): void => resolve(req.result as T);
    req.onerror = (): void => reject(req.error ?? new Error("the save store could not be read"));
  });
}

/**
 * Writes wait for the **transaction**, not the request.
 *
 * A `put` request can report success and the transaction still abort on
 * commit — which is exactly how a quota overrun arrives. Resolving on the
 * request would tell the player their colony was saved when it was not, so the
 * one failure mode that matters most is the one it would have hidden.
 */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (): void => reject(tx.error ?? new Error("the save store refused the write"));
    tx.oncomplete = (): void => resolve();
    tx.onerror = fail;
    tx.onabort = fail;
  });
}

/**
 * Open the save store, or `null` if this browser will not give us one —
 * private-mode lockdowns and blocked storage both land here. A null store is
 * not fatal: the game runs, and the menu says saving is unavailable rather
 * than pretending a save happened.
 */
export function openStorage(): Promise<SaveStorage | null> {
  return new Promise((resolve) => {
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    open.onupgradeneeded = (): void => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    open.onsuccess = (): void => resolve(new IndexedDbStorage(open.result));
    open.onerror = (): void => resolve(null);
    open.onblocked = (): void => resolve(null);
  });
}

// ------------------------------------------------------------ single tab

/**
 * Hold the colony lock for the life of the page.
 *
 * Two tabs sharing one autosave ring would take turns overwriting each other's
 * slots with divergent colonies, and neither would look wrong until a load. So
 * the second tab is told plainly instead. Resolves false when someone else
 * already holds it; true when we hold it, or when the browser has no Web Locks
 * at all (in which case single-instance is unenforceable and the game runs).
 */
export function holdColonyLock(): Promise<boolean> {
  if (!navigator.locks?.request) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    navigator.locks
      .request("castles-colony", { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        // Never resolving is how a Web Lock is held: the lock is released when
        // this promise settles, which for us means when the page goes away.
        return lock ? new Promise<void>(() => {}) : Promise.resolve();
      })
      .catch(() => resolve(true));
  });
}

// ------------------------------------------------------------ file in/out

/** The bytes in IndexedDB *are* the file, so export is a download and nothing else. */
export function downloadSave(filename: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking synchronously can race the download starting in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportName(day: number, seed: number): string {
  return `castles-day${day}-seed${seed}.castles`;
}

/** The stem of a filename, which is what an imported save gets called. */
export function nameFromFile(filename: string): string {
  const stem = filename.replace(/\.castles$/i, "").trim();
  return stem.slice(0, 48) || "imported";
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/** How long after focus returns a `change` event still counts as a selection. */
const PICKER_GRACE_MS = 1000;

/**
 * Ask for a `.castles` file. Resolves null if the player cancels — which
 * browsers report inconsistently, so both `cancel` and a change event with no
 * file count as a cancel, and the input is torn down either way.
 *
 * **This promise must always settle.** The menu holds its whole panel disabled
 * while an action is in flight, so a picker that never resolves does not just
 * lose an import — it bricks every button until the page is reloaded. `cancel`
 * on a file input is too young to lean on (WebKit only from 16.4, and absent in
 * several embedded webviews), hence the focus fallback below.
 */
export function pickSaveFile(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".castles,application/octet-stream";
    input.style.display = "none";
    document.body.append(input);

    let settled = false;
    /** Set synchronously by `change`, so the focus fallback can tell a real
     *  selection (whose bytes are still being read) from a dismissal. */
    let chosen = false;

    const finish = (value: PickedFile | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", refocused);
      input.remove();
      resolve(value);
    };

    // The window regains focus whether the dialog was used or dismissed, and
    // it regains it just *before* `change` fires — hence the grace period
    // rather than an immediate cancel.
    function refocused(): void {
      setTimeout(() => {
        if (!chosen) finish(null);
      }, PICKER_GRACE_MS);
    }
    window.addEventListener("focus", refocused, { once: true });

    input.addEventListener("cancel", () => finish(null));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      chosen = true;
      void file
        .arrayBuffer()
        .then((buffer) => finish({ name: file.name, bytes: new Uint8Array(buffer) }))
        .catch(() => finish(null));
    });
    input.click();
  });
}
