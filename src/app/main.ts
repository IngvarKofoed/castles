import { CameraRig } from "../render/camera";
import { ChunkRenderer } from "../render/chunks";
import { createTerrainMaterial, createWaterMaterial, waveTime } from "../render/materials";
import { MoverRenderer, type Ghost } from "../render/movers";
import { Picker, rectFrom, rectSpan, treeTilesInRect, wallRun, wallTilesInRect } from "../render/pick";
import { createStage } from "../render/scene";
import {
  canPlace,
  canPlaceWall,
  buildingAtTile,
  hasTree,
  hasWall,
  isDesignated,
  isRazeMarked,
  readout,
  type BuildingKindValue,
} from "../sim/know";
import type { Command } from "../sim/commands";
import { hashSim } from "../sim/hash";
import { createSim, type Sim } from "../sim/store";
import { SAVE_VERSION, decode, encode } from "../sim/save/codec";
import { advanceTick } from "../sim/tick";
import { DAY_TICKS, MAX_TICKS_PER_FRAME, TICK_HZ } from "../sim/tuning";
import { WORLD_SIZE } from "../sim/world/world";
import { Hud, isMarqueeTool, isWallTool } from "../ui/hud";
import { Menu } from "../ui/menu";
import { showBlockingNotice } from "../ui/notice";
import { VERSION } from "../version";
import {
  AUTOSAVE_SLOTS,
  autoKey,
  downloadSave,
  exportName,
  holdColonyLock,
  manualKey,
  nameFromFile,
  now,
  openStorage,
  pickSaveFile,
  randomSeed,
  type SaveMeta,
  type SaveStorage,
} from "./storage";

/**
 * Bootstrap and the frame loop.
 *
 * Everything here divides into two lifetimes. The **stage** — canvas, scene,
 * camera rig, materials, the menu, the save store — is built once and lives
 * for the page. A **session** is everything that captured a particular `Sim`:
 * the two renderers, the HUD, the pointer handlers, the command queue. Loading
 * a save disposes the session and builds a new one around the decoded store,
 * rather than threading a mutable `sim` reference through every consumer —
 * which is the cheapest correct thing, and makes a stale capture impossible
 * (docs/specs/2026-09-01-persistence.md).
 */

// Missing, non-numeric, or NaN seed falls back to a fixed default, so the
// default world is shared and screenshot-comparable.
const DEFAULT_SEED = 20260901;

/**
 * `?seed=` means "give me this exact world", so it always starts fresh and
 * **never writes autosaves**: a debug world must not be able to evict the
 * player's ring, nor become the newest save and hijack the next plain boot.
 * Manual saves still work — an interesting debug world is worth keeping.
 */
const seedParam = seedFromQuery();
const debugWorld = seedParam !== null;

function seedFromQuery(): number | null {
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? DEFAULT_SEED : n;
}

function fnv1a(buf: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ------------------------------------------------------------------ stage

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const stage = createStage(canvas);
const terrainMaterial = createTerrainMaterial();
const waterMaterial = createWaterMaterial();
const picker = new Picker(canvas);

/** The live session, or null before boot finishes. */
let session: Session | null = null;

const rig = new CameraRig(
  canvas,
  WORLD_SIZE,
  (frustum, elevation) => stage.setFogForView(frustum, elevation),
  // While a rail tool is active the left-drag belongs to the tool.
  () => session === null || session.hud.tool.kind === "none",
);

/** ×0 is pause. Speed multiplies ticks per real second; it is not a command,
 *  because the same log at ×1 and ×4 must produce the same colony. */
let speed = 1;
/** What to go back to when the menu closes. Opening forces pause. */
let speedBeforeMenu = 1;

// ---------------------------------------------------------------- session

interface Session {
  readonly sim: Sim;
  readonly hud: Hud;
  readonly chunks: ChunkRenderer;
  readonly movers: MoverRenderer;
  /** Hand the queued commands to the caller and start a fresh queue. */
  takeCommands(): Command[];
  ghost(): Ghost | null;
  dispose(): void;
}

function buildSession(sim: Sim): Session {
  const chunks = new ChunkRenderer(stage.scene, sim, terrainMaterial, waterMaterial);
  const movers = new MoverRenderer(stage.scene, sim);
  // One controller for every listener this session puts on the canvas or the
  // window: a load has to take all of them off again, and forgetting one is
  // silent — the old handler keeps firing against the old sim.
  const events = new AbortController();
  const signal = events.signal;

  /**
   * Commands queue here and are handed to the sim at the next tick boundary —
   * never applied straight from an event handler, which is what keeps a replay
   * of the same log reproducible.
   */
  let queued: Command[] = [];

  const hud = new Hud(sim, {
    send: (command) => {
      queued.push(command);
    },
    setSpeed: (value) => {
      speed = value;
    },
    getSpeed: () => speed,
    toggleMenu: () => menu.toggle(),
    menuOpen: () => menu.isOpen,
  });

  // ---------------------------------------------------------------- input

  let hover: [number, number] | null = null;

  function tileFrom(e: PointerEvent | MouseEvent): [number, number] | null {
    return picker.tileAt(e, rig.camera, chunks.pickTargets);
  }

  canvas.addEventListener(
    "pointermove",
    (e) => {
      hover = tileFrom(e);
    },
    { signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      hover = null;
    },
    { signal },
  );

  // A press that travels under a few pixels is a click, not a drag — the
  // mockup's rule, ported. Above it, an area tool draws a marquee, the wall
  // tool draws a run, and every other tool ignores the motion.
  const CLICK_SLOP = 6;
  let down: { x: number; y: number; id: number } | null = null;
  let marqueeing = false;
  /** The tile a wall drag started on, and the live far end of the run. */
  let runFrom: [number, number] | null = null;
  let runTo: [number, number] | null = null;

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      runFrom = hud.tool.kind === "wall" ? tileFrom(e) : null;
      runTo = runFrom;
      // The rig already declined this drag (canOrbit is false while a tool is
      // active), so capturing here takes the gesture without fighting it.
      if (hud.tool.kind !== "none") canvas.setPointerCapture(e.pointerId);
    },
    { signal },
  );

  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (!down) return;
      if (runFrom) {
        // The run's far end follows the cursor and the axis is re-picked every
        // move, so the preview may flip between horizontal and vertical right
        // up to release.
        runTo = tileFrom(e) ?? runTo;
        return;
      }
      if (!isMarqueeTool(hud.tool)) return;
      const rect = rectFrom(down, { x: e.clientX, y: e.clientY });
      if (!marqueeing && rectSpan(rect) <= CLICK_SLOP) return;
      marqueeing = true;
      hud.showMarquee(rect);
    },
    { signal },
  );

  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (!down || e.button !== 0) return;
      const start = down;
      const wasMarquee = marqueeing;
      const from = runFrom;
      const to = runTo;
      down = null;
      marqueeing = false;
      runFrom = null;
      runTo = null;
      hud.hideMarquee();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

      if (wasMarquee) {
        // One command for the whole box, applied at the next tick boundary: a
        // gesture is one entry in the log, never several hundred.
        const rect = rectFrom(start, { x: e.clientX, y: e.clientY });
        if (hud.tool.kind === "raze") {
          const tiles = wallTilesInRect(sim, rig.camera, canvas, rect);
          if (tiles.length) queued.push({ kind: "designateRaze", tiles });
          return;
        }
        const tiles = treeTilesInRect(sim, rig.camera, canvas, rect);
        if (tiles.length) queued.push({ kind: "designateChop", tiles });
        return;
      }
      if (from) {
        // One place-wall command carrying the whole run, valid tiles only — a
        // press under the click slop leaves from === to and places one segment.
        const tiles = wallRun(from, to ?? from, WORLD_SIZE)
          .filter(([x, y]) => canPlaceWall(sim, x, y))
          .map(([x, y]) => y * WORLD_SIZE + x);
        if (tiles.length) queued.push({ kind: "placeWall", tiles });
        return;
      }
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;
      const tile = tileFrom(e);
      if (tile) applyTool(tile[0], tile[1]);
    },
    { signal },
  );

  const cancelDrag = (): void => {
    if (down && canvas.hasPointerCapture(down.id)) canvas.releasePointerCapture(down.id);
    down = null;
    marqueeing = false;
    runFrom = null;
    runTo = null;
    hud.hideMarquee();
  };
  canvas.addEventListener("pointercancel", cancelDrag, { signal });

  // Right-click drops the active tool, which hands the left-drag back to the
  // orbit. Escape does the same, from the HUD.
  canvas.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
      cancelDrag();
      hud.clear();
    },
    { signal },
  );

  // Escape has to abandon the gesture as well as walk the HUD's ladder. The
  // HUD owns the ladder and hides its own marquee, but the drag state lives
  // here — without this the box vanishes on Escape and the whole selection
  // still lands on release.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") cancelDrag();
    },
    { signal },
  );

  function applyTool(x: number, y: number): void {
    const tool = hud.tool;
    if (tool.kind === "chop") {
      if (!hasTree(sim, x, y)) return;
      // Clicking a marked tree again unmarks it — the marquee only ever adds,
      // so this stays the way to take one back.
      queued.push(
        isDesignated(sim, x, y) ?
          { kind: "cancelChop", x, y }
        : { kind: "designateChop", tiles: [y * WORLD_SIZE + x] },
      );
      return;
    }
    if (tool.kind === "build") {
      if (!canPlace(sim, tool.building, x, y)) return;
      queued.push({ kind: "place", building: tool.building, x, y });
      return;
    }
    if (tool.kind === "wall") {
      // Only reached when the press missed the terrain, so the drag never got
      // a start tile and the run path below could not fire. Without this the
      // click falls through to the selection branch and silently changes what
      // the inspector is showing while a build tool is held.
      if (!canPlaceWall(sim, x, y)) return;
      queued.push({ kind: "placeWall", tiles: [y * WORLD_SIZE + x] });
      return;
    }
    if (tool.kind === "gate") {
      // A single tile: converting a standing palisade into a gate is
      // raze-then-place, not a special case.
      if (!canPlaceWall(sim, x, y)) return;
      queued.push({ kind: "placeGate", tiles: [y * WORLD_SIZE + x] });
      return;
    }
    if (tool.kind === "raze") {
      if (!hasWall(sim, x, y)) return;
      // Clicking a marked segment again unmarks it — the marquee only ever
      // adds, exactly as with chop.
      queued.push(
        isRazeMarked(sim, x, y) ?
          { kind: "cancelRaze", x, y }
        : { kind: "designateRaze", tiles: [y * WORLD_SIZE + x] },
      );
      return;
    }
    const building = buildingAtTile(sim, x, y);
    hud.select(building ? building.id : -1);
  }

  function ghost(): Ghost | null {
    const tool = hud.tool;
    if (tool.kind === "build") {
      if (!hover) return null;
      const building = tool.building as BuildingKindValue;
      return {
        kind: "building",
        building,
        x: hover[0],
        y: hover[1],
        valid: canPlace(sim, building, hover[0], hover[1]),
      };
    }
    if (tool.kind === "wall" || tool.kind === "gate") {
      // While a wall drag is held the preview is the whole run; otherwise it
      // is the single tile under the cursor, as the build tool's is.
      const run =
        runFrom && tool.kind === "wall" ? wallRun(runFrom, runTo ?? runFrom, WORLD_SIZE)
        : hover ? [hover]
        : [];
      if (!run.length) return null;
      return {
        kind: "wall",
        tiles: run.map(([x, y]) => ({ x, y, valid: canPlaceWall(sim, x, y) })),
      };
    }
    return null;
  }

  return {
    sim,
    hud,
    chunks,
    movers,
    takeCommands: () => {
      const out = queued;
      queued = [];
      return out;
    },
    ghost,
    dispose: () => {
      events.abort();
      hud.dispose();
      movers.dispose();
      chunks.dispose();
    },
  };
}

function current(): Session {
  if (!session) throw new Error("no session");
  return session;
}

/**
 * Replace the running colony. Every consumer captured the old `Sim`, so the
 * whole sim-bound stack goes and is rebuilt — the camera deliberately does
 * not, so a load leaves you looking where you were looking.
 */
function adopt(sim: Sim, why: "load" | "new"): void {
  session?.dispose();
  session = buildSession(sim);
  owed = 0;
  lastDay = dayIndex(sim.tick);
  ringSuppressed = false;
  announce(why, sim);
}

/** The store hash on the console, which is what makes the drift check
 *  performable by eye as well as by test. */
function announce(what: "save" | "load" | "new", sim: Sim): void {
  console.log(`[castles] ${what} — tick ${sim.tick}, hashSim ${hashSim(sim)}`);
}

const dayIndex = (tick: number): number => Math.floor(tick / DAY_TICKS);

// ----------------------------------------------------------------- saving

let storage: SaveStorage | null = null;
/** Why saving is off entirely, or null. Disables the menu's save controls. */
let savingOff: string | null = null;
/** The last write failure, shown in the menu's note row when it next opens. */
let writeNote: string | null = null;
/** A boot that fell back to a fresh world suppresses ring writes until this
 *  world's own first day rollover — see `frame`. */
let ringSuppressed = false;
let lastDay = 0;
let autosaveInFlight = false;

function requireStorage(): SaveStorage {
  if (!storage) throw new Error(savingOff ?? "saving is unavailable");
  return storage;
}

function metaFor(sim: Sim, key: string, name: string, kind: "auto" | "manual"): SaveMeta {
  const r = readout(sim);
  return {
    key,
    name,
    kind,
    savedAt: now(),
    day: r.day,
    population: r.folk,
    seed: sim.world.seed,
    version: SAVE_VERSION,
    app: VERSION,
  };
}

/**
 * Write the live store to a slot.
 *
 * `encode` is called *first* and its synchronous half — the whole JSON
 * snapshot — runs before this function awaits anything, so the bytes are one
 * coherent tick even though the slot lookup and the write are async.
 */
async function writeSave(key: string, name: string, kind: "auto" | "manual"): Promise<void> {
  const store = requireStorage();
  const sim = current().sim;
  const bytes = encode(sim, VERSION);
  const meta = metaFor(sim, key, name, kind);
  announce("save", sim);
  await store.put(key, await bytes, meta);
}

/** The ring slot to write next: an empty one, else the oldest by `savedAt` —
 *  read from storage rather than from an in-memory counter, so a reload
 *  cannot restart the rotation and clobber the newest save. */
async function ringSlot(store: SaveStorage): Promise<string> {
  const metas = await store.list();
  for (let i = 0; i < AUTOSAVE_SLOTS; i++) {
    const key = autoKey(i);
    if (!metas.some((m) => m.key === key)) return key;
  }
  const autos = metas.filter((m) => m.kind === "auto").sort((a, b) => a.savedAt - b.savedAt);
  return autos[0]?.key ?? autoKey(0);
}

async function autosave(): Promise<void> {
  if (!storage || debugWorld || ringSuppressed || autosaveInFlight || !session) return;
  autosaveInFlight = true;
  const sim = session.sim;
  const bytes = encode(sim, VERSION);
  // Metadata is read here, beside the snapshot, not after the awaits below —
  // the day and population a save advertises must be the ones it contains.
  const meta = metaFor(sim, "", "Autosave", "auto");
  announce("save", sim);
  try {
    const key = await ringSlot(storage);
    await storage.put(key, await bytes, { ...meta, key });
    writeNote = null;
  } catch (error) {
    // A refused write is something the player should be able to read, not
    // something the console swallows. It surfaces next time the menu opens.
    writeNote = `the last autosave could not be written — ${messageOf(error)}`;
  } finally {
    autosaveInFlight = false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "unknown reason";
}

// ------------------------------------------------------------------- menu

const menu = new Menu({
  list: async () => (await requireStorage().list()).sort((a, b) => b.savedAt - a.savedAt),
  save: (name) => writeSave(manualKey(name), name, "manual"),
  load: async (key) => {
    const bytes = await requireStorage().get(key);
    adopt(await decode(bytes), "load");
    menu.close();
  },
  exportSave: async (key) => {
    const store = requireStorage();
    const meta = (await store.list()).find((m) => m.key === key);
    const bytes = await store.get(key);
    downloadSave(exportName(meta?.day ?? 1, meta?.seed ?? 0), bytes);
  },
  remove: (key) => requireStorage().delete(key),
  importSave: async () => {
    const picked = await pickSaveFile();
    if (!picked) return;
    // Decode before anything else changes: a garbage file must leave the
    // running game exactly as it was, with only the note row to show for it.
    const sim = await decode(picked.bytes);
    adopt(sim, "load");
    menu.close();
    // Importing keeps a local copy, so the file is not the only one there is.
    const name = nameFromFile(picked.name);
    if (storage) {
      try {
        await storage.put(manualKey(name), picked.bytes, metaFor(sim, manualKey(name), name, "manual"));
      } catch (error) {
        writeNote = `loaded, but could not be kept — ${messageOf(error)}`;
      }
    }
  },
  newColony: () => {
    // A fresh random seed, because dealing the identical default map to every
    // "new" colony reads as broken. Boot fallbacks and `?seed=` keep the
    // deterministic worlds; this is the one place variety enters.
    adopt(createSim(randomSeed()), "new");
    menu.close();
  },
  unavailable: () => savingOff,
  note: () => savingOff ?? writeNote,
  onOpenChange: (open) => {
    if (open) {
      speedBeforeMenu = speed;
      speed = 0;
    } else {
      speed = speedBeforeMenu;
    }
  },
});

// ------------------------------------------------------------------ frame

function resize(): void {
  const r = canvas.getBoundingClientRect();
  // Re-read devicePixelRatio here too: dragging the window to a display with
  // a different DPI fires resize but not a reload, and a stale ratio leaves
  // the canvas rendering at the wrong resolution.
  stage.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.renderer.setSize(r.width, r.height, false);
  rig.place();
}
resize();

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 120);
});

// Reduced motion stills the water; the camera keeps responding regardless.
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const t0 = performance.now();
let last = t0;

/**
 * Accumulated game time owed to the sim, in ticks. Real seconds × speed ×
 * TICK_HZ go in; whole ticks come out, and the leftover fraction is what the
 * renderer interpolates colonist positions by.
 */
let owed = 0;

function frame(nowMs: number): void {
  const s = current();
  const dt = Math.min(0.1, Math.max(0, nowMs - last) / 1000);
  last = nowMs;
  if (!still) waveTime.value = (nowMs - t0) / 1000;

  owed += dt * speed * TICK_HZ;
  // A suspended tab wakes owing thousands of ticks; run a few and drop the
  // rest rather than freezing the page catching up.
  let budget = MAX_TICKS_PER_FRAME;
  while (owed >= 1 && budget-- > 0) {
    advanceTick(s.sim, s.takeCommands());
    owed -= 1;
  }
  if (owed >= 1) owed = 0;

  // Autosave on the day *index* changing, never on `tick % DAY_TICKS === 0`:
  // the catch-up loop above can step straight over that tick and skip a whole
  // day's save. The first rollover after a fallback boot is also what lifts
  // ring suppression — by then the player has visibly chosen this world.
  const day = dayIndex(s.sim.tick);
  if (day !== lastDay) {
    lastDay = day;
    ringSuppressed = false;
    void autosave();
  }

  rig.update(dt);
  stage.followFocus(rig.focus);
  s.chunks.sync();
  // At ×0 the world is frozen, so there is nothing between two ticks to
  // interpolate: pin the fraction rather than letting it drift.
  s.movers.sync(speed === 0 ? 1 : owed, s.ghost(), isWallTool(s.hud.tool));
  s.hud.update();
  stage.renderer.render(stage.scene, rig.camera);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------- boot

async function boot(): Promise<void> {
  document.title = `Castles — ${VERSION}`;

  if (!(await holdColonyLock())) {
    showBlockingNotice(
      "Castles is already open",
      "This colony is running in another tab. Two tabs would take turns overwriting each other's " +
        "autosaves, so this one stays out of the way — close the other tab and reload.",
    );
    return;
  }

  storage = await openStorage();
  if (!storage) savingOff = "this browser will not let the game store saves, so saving is off";

  let resumed: Sim | null = null;
  let bootFailure: string | null = null;
  if (storage && !debugWorld) {
    // Newest first, auto and manual alike: whatever the player was last in is
    // what they expect back.
    const metas = (await storage.list()).sort((a, b) => b.savedAt - a.savedAt);
    for (const meta of metas) {
      try {
        resumed = await decode(await storage.get(meta.key));
        break;
      } catch (error) {
        bootFailure ??= `“${meta.name}” could not be loaded — ${messageOf(error)}`;
      }
    }
  }

  if (resumed) {
    adopt(resumed, "load");
  } else {
    adopt(createSim(seedParam ?? DEFAULT_SEED), "new");
    // Nothing was resumed, so nothing here has earned the ring yet: hold every
    // write until this world's own first day rollover, or a corrupt newest
    // save plus a quick tab-hide would take a good older one with it.
    ringSuppressed = true;
  }

  const world = current().sim.world;
  // The map hash makes seed determinism checkable straight off the console.
  console.log(`Castles ${VERSION} — seed ${world.seed}, world ${fnv1a(world.hmap)}${fnv1a(world.tmap)}`);

  // Best-effort save on the way out. A killed tab can still lose it, which the
  // day ring bounds to at most one game-day of play.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void autosave();
  });

  if (bootFailure) {
    menu.open();
    menu.note(bootFailure);
  }

  requestAnimationFrame(frame);
}

void boot();
