import { MeshLambertMaterial } from "three";

/**
 * The two shader injections ported from mockup3d.html, proven on three
 * r160. Both go into MeshLambertMaterial so they keep three's lighting,
 * fog and colour management for free. The instancing branches are kept
 * verbatim even though the merged chunk meshes aren't instanced — the
 * non-instancing fallbacks read `transformed` directly, which is correct
 * because chunk vertices are baked in world coordinates.
 */

/**
 * The ambient clock, shared by the water wave and the sway injection. The app
 * loop writes **game** seconds into it, not wall-clock seconds: at ×0 the world
 * holds completely still and at ×3 it runs three times as fast. Pause is when a
 * player stops to read the map, and a paused world whose only motion is the
 * motion that does not matter stands the boundedness rule on its head
 * (docs/specs/2026-09-15-ambient-life.md).
 */
export const waveTime = { value: 0 };

/**
 * How hard anything ambient leans, 1 normally and **0 under
 * `prefers-reduced-motion`** — which is the rest pose.
 *
 * Reduced motion cannot be served by holding the clock, the way the water's is:
 * at `uTime = 0` the sway's two-sine is a *fixed non-zero* number, so a stilled
 * forest would stand permanently leaning. Amplitude is the only handle that has
 * a rest position. Colonists and monsters are untouched by it either way — a
 * player asking for less motion is not asking to stop seeing the orc.
 */
export const swayAmp = { value: 1 };

/**
 * How far a full-weight vertex leans, in world units, at the peak of the wave.
 * Well under a tile on purpose: a lean, not a sweep.
 */
const SWAY_REACH = 0.13;

// Fake contact shading: dim each block toward its base, tint low ground
// warm-dark. This is most of the "cosy" and it costs one multiply. The one
// substitution from the mockup: vBlockY is fed by the geometry's aBlockY
// attribute (0 at a column's base, 1 at its top) instead of the unit-cube
// position — the fragment multiply happens after colour-space conversion,
// in sRGB space, which is why it can't ride the linear-space vertex colors.
const COZY_VERT_HEAD = `
  attribute float aBlockY;
  attribute float aSway;
  uniform float uTime;
  uniform float uSwayAmp;
  varying float vBlockY;
  varying float vWorldY;
`;
// The sway rides here rather than on a material of its own so every cosy
// material keeps one compiled program and `customProgramCacheKey` stays "cosy".
// Geometry with no `aSway` — the mover layer's shared box — reads 0 and is left
// stock still, exactly as an absent colour attribute reads black.
//
// Two sines of *world* position, so a wood leans as one gust rather than each
// tree on its own beat, and the phase is continuous across a chunk seam. The
// weight arrives already masked to the box's top vertices (mesher.ts), which is
// what keeps feet on the ground and bloom heads on their stems.
const COZY_VERT_BODY = `
  #include <begin_vertex>
  vBlockY = aBlockY;
  #ifdef USE_INSTANCING
    vec3 cosyWorld = ( instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
  #else
    vec3 cosyWorld = transformed;
  #endif
  vWorldY = cosyWorld.y;
  float cosyGust = sin( cosyWorld.x * 0.35 + uTime * 0.9 ) * 0.6
                 + sin( cosyWorld.z * 0.27 + uTime * 0.55 ) * 0.4;
  float cosyLean = aSway * uSwayAmp * cosyGust * ${SWAY_REACH.toFixed(3)};
  transformed.x += cosyLean;
  transformed.z += cosyLean * 0.55;
`;
const COZY_FRAG_HEAD = `
  varying float vBlockY;
  varying float vWorldY;
`;
const COZY_FRAG_BODY = `
  float ao = mix( 0.79, 1.0, clamp( vBlockY, 0.0, 1.0 ) );
  float lift = clamp( ( vWorldY + 0.4 ) / 3.4, 0.0, 1.0 );
  vec3 cosy = mix( vec3( 0.94, 0.88, 0.78 ), vec3( 1.03, 1.02, 1.0 ), lift );
  gl_FragColor.rgb *= ao * cosy;
  #include <fog_fragment>
`;

export function cozify(material: MeshLambertMaterial): MeshLambertMaterial {
  material.onBeforeCompile = (shader) => {
    if (
      !shader.vertexShader.includes("#include <begin_vertex>") ||
      !shader.fragmentShader.includes("#include <fog_fragment>")
    ) {
      console.warn("Castles: shader anchor missing, contact shading skipped");
      return;
    }
    shader.uniforms.uTime = waveTime;
    shader.uniforms.uSwayAmp = swayAmp;
    shader.vertexShader =
      COZY_VERT_HEAD + shader.vertexShader.replace("#include <begin_vertex>", COZY_VERT_BODY);
    shader.fragmentShader =
      COZY_FRAG_HEAD + shader.fragmentShader.replace("#include <fog_fragment>", COZY_FRAG_BODY);
  };
  material.customProgramCacheKey = () => "cosy";
  return material;
}

/** Terrain: Lambert with baked per-tile vertex colors plus contact shading. */
export function createTerrainMaterial(): MeshLambertMaterial {
  return cozify(new MeshLambertMaterial({ vertexColors: true }));
}

/**
 * The dynamic layer's material: one instanced mesh whose per-instance colour
 * picks the log/plank/tunic tone, sharing the terrain's contact shading so a
 * colonist doesn't read as cut out of a different game.
 *
 * `vertexColors: true` is load-bearing and not decorative. three's
 * `color_fragment` chunk only multiplies `vColor` into the diffuse under
 * `USE_COLOR`, which `vertexColors` is what defines — an InstancedMesh's
 * `instanceColor` alone reaches `vColor` in the vertex stage and is then
 * thrown away in the fragment stage. The geometry therefore has to carry a
 * white `color` attribute too, or the missing attribute defaults to black.
 */
export function createMoverMaterial(): MeshLambertMaterial {
  return cozify(new MeshLambertMaterial({ vertexColors: true }));
}

/**
 * Water: a Lambert surface with the wave folded into its diffuse colour, so
 * it still takes the sun, the sky bounce and the fog. Driven by world
 * position so each tile ripples on its own beat; displacement stays small
 * enough never to dip below the seabed.
 */
export function createWaterMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    color: 0x54a8cf,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    // Same guard as cozify: without it a three upgrade that renames either
    // anchor would leave both replaces as silent no-ops and the water would
    // just stop moving, with nothing said.
    if (
      !shader.vertexShader.includes("#include <begin_vertex>") ||
      !shader.fragmentShader.includes("#include <color_fragment>")
    ) {
      console.warn("Castles: shader anchor missing, water wave skipped");
      return;
    }
    shader.uniforms.uTime = waveTime;
    shader.vertexShader =
      `
      uniform float uTime;
      varying float vWave;
    ` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 wpos = instanceMatrix * vec4( transformed, 1.0 );
      #else
        vec4 wpos = vec4( transformed, 1.0 );
      #endif
      float w = sin( wpos.x * 1.7 + uTime * 1.10 ) * 0.34
              + sin( wpos.z * 1.9 - uTime * 0.80 ) * 0.34
              + sin( ( wpos.x + wpos.z ) * 1.15 + uTime * 0.6 ) * 0.32;
      vWave = w;
      transformed.y += w * 0.05;
    `,
      );
    shader.fragmentShader =
      `
      varying float vWave;
    ` +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
      #include <color_fragment>
      float crest = smoothstep( -0.9, 1.0, vWave );
      diffuseColor.rgb = mix( diffuseColor.rgb * 0.86, diffuseColor.rgb * 1.14, crest );
    `,
      );
  };
  material.customProgramCacheKey = () => "water";
  return material;
}
