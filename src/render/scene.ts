import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { CAM_DIST } from "./camera";

const FOG_COLOR = 0x4c5f38;
// Fog is anchored to the far edge of the visible ground, not a fixed
// frustum fraction: Δ = frustum / (2·tan(elevation)) is the view-space
// depth from the focus to the ground at the top of the screen, so the band
// below scales with both zoom and drag elevation. The bootstrap formula
// (offsets linear in frustum alone) put a 100%-fog wall at the same screen
// fraction at every zoom, and its fogged land read as sky because the fog
// colour equals the clear colour — a false horizon. With far past the
// visible ground, on-screen land tops out around 40% fogged: haze that
// kisses the top of the screen but never walls it off (tuned by eye).
const FOG_NEAR_FRAC = 0.5;
const FOG_FAR_FRAC = 1.8;

/** Fixed morning light — the mockup's placeSun(0.35). */
const SUN_T = 0.35;

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  /**
   * Re-anchor fog to the current view; called by the camera rig whenever it
   * places itself, since both zoom and drag elevation move the fog band.
   */
  setFogForView(frustum: number, elevation: number): void;
  /**
   * Keep the sun's ~±24-unit shadow box centred on the camera focus, so
   * shadow sharpness is constant wherever you look — the mockup's fixed box
   * cannot cover 256 tiles.
   */
  followFocus(focus: Vector3): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  const fog = new Fog(new Color(FOG_COLOR), CAM_DIST - 4, CAM_DIST + 40);
  scene.fog = fog;

  // Lights port verbatim: warm sun, cool sky bounce, a whisper of fill.
  const sun = new DirectionalLight(0xfff1cf, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const sky = new HemisphereLight(0xa9cdf2, 0x6d8a3c, 1.15);
  scene.add(sky);
  scene.add(new AmbientLight(0xffe9c9, 0.45));

  // placeSun(SUN_T), split: colour and intensity apply once; the positional
  // part becomes an offset from the focus so the shadow box can travel.
  const a = Math.PI * (0.18 + SUN_T * 0.64);
  const height = 0.3 + Math.sin(SUN_T * Math.PI) * 0.7;
  const sunOffset = new Vector3(Math.cos(a) * 40, 13 + height * 16, Math.sin(a) * 32 + 6);
  const warmth = 1 - Math.sin(SUN_T * Math.PI);
  sun.color.setHSL(0.11 - warmth * 0.03, 0.28 + warmth * 0.32, 0.8);
  sun.intensity = 2.9 + Math.sin(SUN_T * Math.PI) * 1.5;
  sky.intensity = 1.05 + Math.sin(SUN_T * Math.PI) * 0.55;

  return {
    renderer,
    scene,
    setFogForView(frustum: number, elevation: number): void {
      const delta = frustum / (2 * Math.tan(elevation));
      fog.near = CAM_DIST + FOG_NEAR_FRAC * delta;
      fog.far = CAM_DIST + FOG_FAR_FRAC * delta;
    },
    followFocus(focus: Vector3): void {
      sun.position.copy(focus).add(sunOffset);
      sun.target.position.copy(focus);
    },
  };
}
