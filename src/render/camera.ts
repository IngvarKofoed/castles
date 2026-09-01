import { OrthographicCamera, Vector3 } from "three";

/**
 * The mockup's hand-rolled orbit rig, ported: azimuth/elevation from pointer
 * drag, wheel-driven ortho frustum zoom. New here: a movable focus point —
 * WASD pans it across the map, screen-relative and clamped to world bounds —
 * because orbiting a fixed centre is useless at 256².
 *
 * With an orthographic camera the eye sits a fixed distance back; CAM_DIST
 * only anchors clipping and fog, so it is generous enough that near terrain
 * never crosses the near plane at any elevation and zoom.
 */
export const CAM_DIST = 400;

// Tilt floor ~28.6°. Below roughly this angle the ground is seen nearly
// edge-on, and vertical terrain structure dominates the image over forward
// scroll — so any horizontal pan reads as the image rising or falling. That
// is projection geometry, not a pan bug (the pan is a constant world-space
// rate: docs/changelog/2026-09-01-pan-constant-rate.md), and colony-builder
// cameras conventionally floor at 25–35° for exactly this reason.
const EL_MIN = 0.5;
const EL_MAX = 1.32;
// The mockup's 13–46 frustum is a keyhole at this scale (tuned by eye).
const FRUSTUM_MIN = 13;
const FRUSTUM_MAX = 120;
// Opening zoom. `2026-09-01-bootstrap-world` set this to 90 because 60 "opened
// on featureless grass" — that premise is gone now that the map has woods, a
// clearing and five colonists standing in it, and at 90 a colonist is a
// five-pixel speck. 46 frames the colony and the land it has to expand into.
const FRUSTUM_DEFAULT = 46;
const LOOK_HEIGHT = 1.2;
// Panning crosses about one screen-height of ground per second.
const PAN_RATE = 0.9;

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

export class CameraRig {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.5, 1200);
  readonly focus: Vector3;

  private az = Math.PI * 0.28;
  private el = 0.66;
  private frustum = FRUSTUM_DEFAULT;
  private readonly held = new Set<string>();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly offset = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly worldSize: number,
    /** Told the view shape whenever the rig places itself — zoom AND orbit move it. */
    private readonly onView: (frustum: number, elevation: number) => void,
    /**
     * Asked before a drag starts whether the orbit may have it. While a build
     * or chop tool is active the left-drag belongs to that tool — a chop
     * marquee and a camera orbit cannot share one gesture. Defaults to always
     * yes, so with no tool selected the orbit behaves exactly as before.
     * Zoom and WASD pan are never suspended; only the drag is.
     */
    private readonly canOrbit: () => boolean = () => true,
  ) {
    this.focus = new Vector3(worldSize / 2, LOOK_HEIGHT, worldSize / 2);
    this.bind();
    this.place();
  }

  /** Apply held pan keys; returns true if the camera moved. */
  update(dt: number): boolean {
    if (!this.held.size) return false;
    this.forward.set(-Math.cos(this.az), 0, -Math.sin(this.az)).normalize();
    this.right.crossVectors(this.forward, UP);
    // Constant world-space rate on both axes, deliberately independent of
    // elevation: W/S follow the camera's forward projected onto the ground
    // plane, and tilting the camera must never change where or how fast the
    // focus moves. This reversed an earlier sin(el) screen-rate compensation
    // (docs/changelog/2026-09-01-pan-constant-rate.md) — don't reintroduce it.
    const step = this.frustum * PAN_RATE * dt;
    for (const code of this.held) {
      const dir = PAN_KEYS[code];
      if (!dir) continue;
      this.focus.addScaledVector(this.right, dir[0] * step);
      this.focus.addScaledVector(this.forward, dir[1] * step);
    }
    this.focus.x = Math.max(0, Math.min(this.worldSize, this.focus.x));
    this.focus.z = Math.max(0, Math.min(this.worldSize, this.focus.z));
    this.place();
    return true;
  }

  place(): void {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const half = this.frustum / 2;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.offset.set(
      Math.cos(this.az) * Math.cos(this.el),
      Math.sin(this.el),
      Math.sin(this.az) * Math.cos(this.el),
    );
    this.camera.position.copy(this.focus).addScaledVector(this.offset, CAM_DIST);
    this.camera.lookAt(this.focus);
    this.camera.updateProjectionMatrix();
    this.onView(this.frustum, this.el);
  }

  private bind(): void {
    const cv = this.canvas;
    let drag: { x: number; y: number; id: number } | null = null;

    // One drag at a time, keyed by pointer id: with `touch-action: none` a
    // second finger otherwise overwrites the drag anchor while both pointers
    // keep feeding it deltas, which spins the camera wildly.
    cv.addEventListener("pointerdown", (e) => {
      if (drag) return;
      if (!this.canOrbit()) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      cv.setPointerCapture(e.pointerId);
      cv.classList.add("dragging");
    });
    cv.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      this.az -= (e.clientX - drag.x) * 0.007;
      this.el = Math.max(EL_MIN, Math.min(EL_MAX, this.el + (e.clientY - drag.y) * 0.005));
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.place();
    });
    const endDrag = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return;
      // The browser releases capture implicitly on up/cancel; releasing an
      // already-released pointer throws, so ask before releasing.
      if (cv.hasPointerCapture(drag.id)) cv.releasePointerCapture(drag.id);
      drag = null;
      cv.classList.remove("dragging");
    };
    cv.addEventListener("pointerup", endDrag);
    cv.addEventListener("pointercancel", endDrag);

    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.frustum = Math.max(
          FRUSTUM_MIN,
          Math.min(FRUSTUM_MAX, this.frustum * (1 + wheelPixels(e) * 0.0011)),
        );
        this.place();
      },
      { passive: false },
    );

    window.addEventListener("keydown", (e) => {
      // hasOwn, not `in`: `in` walks Object.prototype, so a code like
      // "constructor" would enter `held` and turn the focus into NaN.
      if (Object.hasOwn(PAN_KEYS, e.code)) this.held.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.held.delete(e.code);
    });
    window.addEventListener("blur", () => this.held.clear());
  }
}

const UP = new Vector3(0, 1, 0);

// Wheel deltas arrive in pixels, lines or pages depending on the browser and
// OS — Firefox on Windows/Linux reports lines (≈3 per notch), so reading
// deltaY raw made a notch zoom ~30× less than it does in a pixel-mode
// browser. Normalise to pixels before applying the zoom factor.
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * WHEEL_PAGE_PX;
  return e.deltaY;
}
