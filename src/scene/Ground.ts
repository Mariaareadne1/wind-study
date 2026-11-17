import { DataTexture, LinearFilter, Mesh, PlaneGeometry, RGBAFormat, ShaderMaterial, type Texture, UnsignedByteType, type IUniform, type Vector2, type Vector3, type Vector4 } from 'three';
import { CLOUD_SHADE_GLSL, HAZE_GLSL } from '../grass/clouds';
import type { Painting } from './paint';
import { WORLD, type Terrain } from './terrain';

/** The painted earth under the grass: the same pigment, dropped into its own shade. */
export function buildGround(
  terrain: Terrain,
  paint: Painting,
  flow: IUniform<Texture | null>,
  fieldRect: IUniform<Vector4>,
  haze: { uHaze: IUniform<Vector4>; uHazeRange: IUniform<Vector2> },
  realistic = false,
  light?: { uTerrainLight: IUniform<Texture | null>; uSun3: IUniform<Vector3>; uSunColor: IUniform<Vector3>; uSkyColor: IUniform<Vector3> },
): { mesh: Mesh; dispose: () => void } {
  const w = WORLD.maxX - WORLD.minX;
  const d = WORLD.maxZ - WORLD.minZ;
  const geo = new PlaneGeometry(w, d, 252, 174);
  geo.rotateX(-Math.PI / 2);
  geo.translate((WORLD.minX + WORLD.maxX) / 2, 0, (WORLD.minZ + WORLD.maxZ) / 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.height(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  const tex = new DataTexture(paint.pixels, paint.width, paint.height, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  const mat = new ShaderMaterial({
    glslVersion: '300 es' as never,
    defines: realistic ? { REALISTIC: 1 } : {},
    uniforms: { uPaint: { value: tex }, uFlow: flow, uFieldRect: fieldRect, uHaze: haze.uHaze, uHazeRange: haze.uHazeRange, uCanopy: { value: 1 }, ...(light ?? {}) },
    vertexShader: /* glsl */ `
      out vec2 vXZ;
      out float vDist;
      void main() {
        vXZ = position.xz;
        vDist = length(cameraPosition - position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vXZ;
      in float vDist;
      uniform vec4 uHaze;
      uniform vec2 uHazeRange;
      uniform sampler2D uPaint;
#ifdef REALISTIC
      uniform sampler2D uTerrainLight;
      uniform vec3 uSun3;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform float uCanopy; // light reaching the soil through the grass: 1 bare, lower under thick grass
#endif
      uniform sampler2D uFlow;
      uniform vec4 uFieldRect;
      out vec4 outColor;
      ${CLOUD_SHADE_GLSL}
      ${HAZE_GLSL}
      void main() {
        vec2 uv = (vXZ - vec2(${WORLD.minX.toFixed(1)}, ${WORLD.minZ.toFixed(1)})) / vec2(${w.toFixed(1)}, ${d.toFixed(1)});
        vec4 paint = texture(uPaint, uv);
        vec3 c = paint.rgb;
#ifdef REALISTIC
        // linear light: albedo × (sun through the land's own shadow + sky through its occlusion)
        vec4 tl = texture(uTerrainLight, uv);
        vec3 n = vec3(tl.b * 2.0 - 1.0, 0.0, tl.a * 2.0 - 1.0);
        n.y = sqrt(max(1.0 - n.x * n.x - n.z * n.z, 0.0));
        float clouds = texture(uFlow, (vXZ - uFieldRect.xy) * uFieldRect.zw).a;
        vec3 albedo = pow(c, vec3(2.2));
        float ndl = max(dot(n, uSun3), 0.0);
        // a cloud overhead also hides part of the sky
        vec3 lit = uSunColor * ndl * tl.g * (1.0 - clouds) + uSkyColor * tl.r * (1.0 - 0.45 * clouds);
        outColor = vec4(applyHaze(albedo * lit * uCanopy, vDist, uHaze, uHazeRange), 1.0);
        return;
#endif
        c = c * 0.62 + vec3(0.02, 0.05, 0.05);
        outColor = vec4(applyHaze(shadeCloud(c, texture(uFlow, (vXZ - uFieldRect.xy) * uFieldRect.zw).a), vDist, uHaze, uHazeRange), 1.0);
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  // drawn after the grass: depth testing then skips the many pixels it covers
  mesh.renderOrder = 5;
  return {
    mesh,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
