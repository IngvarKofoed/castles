import { CameraRig } from "../render/camera";
import { ChunkRenderer } from "../render/chunks";
import { createTerrainMaterial, createWaterMaterial, waveTime } from "../render/materials";
import { MoverRenderer, type Ghost } from "../render/movers";
import { Picker, rectFrom, rectSpan, treeTilesInRect } from "../render/pick";
import { createStage } from "../render/scene";
import { canPlace, buildingAtTile, hasTree, isDesignated, type BuildingKindValue } from "../sim/know";
import type { Command } from "../sim/commands";
import { createSim } from "../sim/store";
import { advanceTick } from "../sim/tick";
import { MAX_TICKS_PER_FRAME, TICK_HZ } from "../sim/tuning";
import { WORLD_SIZE } from "../sim/world/world";
import { Hud } from "../ui/hud";
import { VERSION } from "../version";

// Missing, non-numeric, or NaN seed falls back to a fixed default, so the
// default world is shared and screenshot-comparable.
const DEFAULT_SEED = 20260901;

function seedFromQuery(): number {
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw === null) return DEFAULT_SEED;
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

const seed = seedFromQuery();
const sim = createSim(seed);
const world = sim.world;

document.title = `Castles — ${VERSION}`;
// The map hash makes seed determinism checkable straight off the console.
console.log(`Castles ${VERSION} — seed ${seed}, world ${fnv1a(world.hmap)}${fnv1a(world.tmap)}`);

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const stage = createStage(canvas);
const rig = new CameraRig(
  canvas,
  WORLD_SIZE,
  (frustum, elevation) => stage.setFogForView(frustum, elevation),
  // While a rail tool is active the left-drag belongs to the tool.
  () => hud.tool.kind === "none",
);
const chunks = new ChunkRenderer(stage.scene, sim, createTerrainMaterial(), createWaterMaterial());
const movers = new MoverRenderer(stage.scene, sim);
const picker = new Picker(canvas);

/**
 * Commands queue here and are handed to the sim at the next tick boundary —
 * never applied straight from an event handler, which is what keeps a replay
 * of the same log reproducible.
 */
let queued: Command[] = [];

/** ×0 is pause. Speed multiplies ticks per real second; it is not a command,
 *  because the same log at ×1 and ×4 must produce the same colony. */
let speed = 1;

const hud = new Hud(sim, {
  send: (command) => queued.push(command),
  setSpeed: (value) => {
    speed = value;
  },
  getSpeed: () => speed,
});

// ------------------------------------------------------------------ input

let hover: [number, number] | null = null;

function tileFrom(e: PointerEvent | MouseEvent): [number, number] | null {
  return picker.tileAt(e, rig.camera, chunks.pickTargets);
}

canvas.addEventListener("pointermove", (e) => {
  hover = tileFrom(e);
});
canvas.addEventListener("pointerleave", () => {
  hover = null;
});

// A press that travels under a few pixels is a click, not a drag — the
// mockup's rule, ported. Above it, the chop tool draws a marquee and every
// other tool ignores the motion.
const CLICK_SLOP = 6;
let down: { x: number; y: number; id: number } | null = null;
let marqueeing = false;

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  // The rig already declined this drag (canOrbit is false while a tool is
  // active), so capturing here takes the gesture without fighting it.
  if (hud.tool.kind !== "none") canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!down || hud.tool.kind !== "chop") return;
  const rect = rectFrom(down, { x: e.clientX, y: e.clientY });
  if (!marqueeing && rectSpan(rect) <= CLICK_SLOP) return;
  marqueeing = true;
  hud.showMarquee(rect);
});

canvas.addEventListener("pointerup", (e) => {
  if (!down || e.button !== 0) return;
  const start = down;
  const wasMarquee = marqueeing;
  down = null;
  marqueeing = false;
  hud.hideMarquee();
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

  if (wasMarquee) {
    // One command for the whole box, applied at the next tick boundary: a
    // gesture is one entry in the log, never several hundred.
    const tiles = treeTilesInRect(sim, rig.camera, canvas, rectFrom(start, { x: e.clientX, y: e.clientY }));
    if (tiles.length) queued.push({ kind: "designateChop", tiles });
    return;
  }
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return;
  const tile = tileFrom(e);
  if (tile) applyTool(tile[0], tile[1]);
});

const cancelDrag = (): void => {
  if (down && canvas.hasPointerCapture(down.id)) canvas.releasePointerCapture(down.id);
  down = null;
  marqueeing = false;
  hud.hideMarquee();
};
canvas.addEventListener("pointercancel", cancelDrag);

// Right-click drops the active tool, which hands the left-drag back to the
// orbit. Escape does the same, from the HUD.
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  cancelDrag();
  hud.clear();
});

// Escape has to abandon the gesture as well as the tool. The HUD owns the key
// and hides its own marquee, but the drag state lives here — without this the
// box vanishes on Escape and the whole selection still lands on release.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cancelDrag();
});

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
  const building = buildingAtTile(sim, x, y);
  hud.select(building ? building.id : -1);
}

function ghost(): Ghost | null {
  const tool = hud.tool;
  if (tool.kind !== "build" || !hover) return null;
  const kind = tool.building as BuildingKindValue;
  return { kind, x: hover[0], y: hover[1], valid: canPlace(sim, kind, hover[0], hover[1]) };
}

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

function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, now - last) / 1000);
  last = now;
  if (!still) waveTime.value = (now - t0) / 1000;

  owed += dt * speed * TICK_HZ;
  // A suspended tab wakes owing thousands of ticks; run a few and drop the
  // rest rather than freezing the page catching up.
  let budget = MAX_TICKS_PER_FRAME;
  while (owed >= 1 && budget-- > 0) {
    advanceTick(sim, queued);
    queued = [];
    owed -= 1;
  }
  if (owed >= 1) owed = 0;

  rig.update(dt);
  stage.followFocus(rig.focus);
  chunks.sync();
  // At ×0 the world is frozen, so there is nothing between two ticks to
  // interpolate: pin the fraction rather than letting it drift.
  movers.sync(speed === 0 ? 1 : owed, ghost());
  hud.update();
  stage.renderer.render(stage.scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
