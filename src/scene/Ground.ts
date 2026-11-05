import { DataTexture, LinearFilter, Mesh, PlaneGeometry, RGBAFormat, ShaderMaterial, UnsignedByteType, type IUniform } from 'three';
import { CLOUD_GLSL } from '../grass/clouds';
import type { Painting } from './paint';
import { WORLD, type Terrain } from './terrain';

/** The painted earth under the grass: the same pigment, dropped into its own shade. */
export function buildGround(terrain: Terrain, paint: Painting, time: IUniform<number>): { mesh: Mesh; dispose: () => void } {
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
    uniforms: { uPaint: { value: tex }, uTime: time },
    vertexShader: /* glsl */ `
      out vec2 vXZ;
      void main() {
        vXZ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vXZ;
      uniform sampler2D uPaint;
      uniform float uTime;
      out vec4 outColor;
      ${CLOUD_GLSL}
      void main() {
        vec2 uv = (vXZ - vec2(${WORLD.minX.toFixed(1)}, ${WORLD.minZ.toFixed(1)})) / vec2(${w.toFixed(1)}, ${d.toFixed(1)});
        vec3 c = texture(uPaint, uv).rgb;
        c = c * 0.62 + vec3(0.02, 0.05, 0.05);
        outColor = vec4(applyCloudShadow(c, vXZ, uTime), 1.0);
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
