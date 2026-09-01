import { WORLD_SIZE, generate } from "../sim/world/world";
import { CameraRig } from "../render/camera";
import { ChunkRenderer } from "../render/chunks";
import { createTerrainMaterial, createWaterMaterial, waveTime } from "../render/materials";
import { createStage } from "../render/scene";
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
const world = generate(seed);

document.title = `Castles — ${VERSION}`;
// The map hash makes seed determinism checkable straight off the console.
console.log(`Castles ${VERSION} — seed ${seed}, world ${fnv1a(world.hmap)}${fnv1a(world.tmap)}`);

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const stage = createStage(canvas);
const rig = new CameraRig(canvas, WORLD_SIZE, (frustum, elevation) => stage.setFogForView(frustum, elevation));
const chunks = new ChunkRenderer(stage.scene, world, createTerrainMaterial(), createWaterMaterial());

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

function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, now - last) / 1000);
  last = now;
  if (!still) waveTime.value = (now - t0) / 1000;
  rig.update(dt);
  stage.followFocus(rig.focus);
  chunks.sync();
  stage.renderer.render(stage.scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
