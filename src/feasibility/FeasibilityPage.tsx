import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { WindSweptGrass } from './vendor/WindSweptGrass';
import { SoftGrass } from './SoftGrass';
import { hillHeight, hillMesh, hillTerrain } from './hillside';

/**
 * Grass feasibility experiment (?scene=grass-feasibility). One hillside, one fixed camera, one sun; only the grass
 * renderer changes between candidates, so captures compare like with like.
 *   candidate=a   WindSweptGrass as published (wind strength patch only)
 *   candidate=b   SoftGrass: WindSweptGrass's architecture with coherent flow, finer blades and soft lighting
 *   wind=calm|breeze|gust
 *   compare       no animation loop: render frames on request (window.__grass.render(t))
 */
const WIND = { calm: 0.08, breeze: 1, gust: 2.3 } as const;
type WindMode = keyof typeof WIND;

/** Sun from the upper left and a little behind, as in the reference. */
const SUN = new Vector3(-0.6, 0.55, -0.58).normalize();

declare global {
  interface Window {
    __grass?: { render(t: number): void; setWind(mode: WindMode): void; canvas: HTMLCanvasElement; info(): Record<string, unknown> };
  }
}

export function FeasibilityPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const q = new URLSearchParams(location.search);
    const candidate = q.get('candidate') === 'b' ? 'b' : 'a';
    const compare = q.has('compare');
    const dpr = Number(q.get('dpr')) || Math.min(window.devicePixelRatio || 1, 2);
    let wind: WindMode = (['calm', 'breeze', 'gust'] as const).find((m) => m === q.get('wind')) ?? 'breeze';

    const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const scene = new Scene();
    const haze = new Color('#a8bd98');
    scene.background = haze;
    scene.fog = new Fog(haze, 55, 140);
    // a moderately raised, fixed view across the ridge and down into the valley
    const camera = new PerspectiveCamera(34, 1, 0.5, 400);
    camera.position.set(0, 26, 34);
    camera.lookAt(0, 3, -6);
    const sun = new DirectionalLight('#ffe9c4', 4.3);
    sun.position.copy(SUN).multiplyScalar(100);
    scene.add(sun, new HemisphereLight('#d6e6ee', '#46602f', 0.8));
    const ground = hillMesh();
    scene.add(ground);

    const terrain = hillTerrain();
    const grass = candidate === 'b'
      ? new SoftGrass({ terrain, quality: 'high', seed: 9237, windDirection: new Vector2(0.86, 0.5) })
      : new WindSweptGrass({ terrain, quality: 'high', seed: 9237, windDirection: new Vector2(0.86, 0.5) });
    grass.setSunDirection(SUN);
    if (candidate === 'a') {
      // tuned through its own colour uniforms: the published palette is brighter and more saturated than the reference
      (grass.uniforms.uRootColor.value as Color).set('#5E8236');
      (grass.uniforms.uTipColor.value as Color).set('#BCCB68');
      (grass.uniforms.uFarColor.value as Color).set('#6B8C40');
    }
    scene.add(grass.object3d);
    // the detail field centres on the part of the hill the camera looks at
    // a little up the hill, so the dense near layer reaches from the foreground to beyond the ridge
    const focus = new Vector3(0, hillHeight(0, -3), -3);
    const setWind = (m: WindMode) => {
      wind = m;
      (grass.uniforms.uWindScale as { value: number }).value = WIND[m];
    };
    setWind(wind);

    const resize = () => {
      const w = canvas.parentElement!.clientWidth;
      const h = canvas.parentElement!.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    let elapsed = 0;
    const frame = (dt: number) => {
      elapsed += dt;
      grass.setFlatteners([{ id: 'focus', position: focus, radius: 0.001, strength: 0 }]);
      grass.update(dt, elapsed);
      renderer.render(scene, camera);
    };
    window.__grass = {
      canvas,
      render(t: number) {
        elapsed = t;
        frame(0);
      },
      setWind,
      info: () => ({ candidate, wind, blades: (grass as { bladeCount?: number }).bladeCount, ...renderer.info.render, telemetry: grass.telemetry }),
    };
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      frame(Math.min((now - last) / 1000, 0.05));
      last = now;
    };
    if (compare) frame(0);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      grass.dispose();
      ground.geometry.dispose();
      (ground.material as { dispose(): void }).dispose();
      renderer.dispose();
      delete window.__grass;
    };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#a8bd98' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="A grassy hillside in a breeze (grass rendering experiment)" />
    </div>
  );
}
