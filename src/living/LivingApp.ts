import { GLSL3, LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RawShaderMaterial, Scene, Texture, TextureLoader, Vector2, Vector4, WebGLRenderer } from 'three';
import { Compositor } from '../engine/Compositor';
import { HoverBreeze } from '../interaction/HoverBreeze';
import { PointerSmoother } from '../interaction/stroke';
import { DEFAULT_TUNING } from '../state/tuning';
import { FIELD } from '../wind/grid';
import type { Gust } from '../wind/gust';
import { WindSim } from '../wind/WindSim';
import { WindTextures } from '../wind/WindTextures';
import type { GlassRect } from '../app/WindApp';
import { coverFit, PLATE, type Fit } from '../hybrid/plate';
import { LIVING_FRAG, LIVING_VERT } from './scene';

/** Layer placements written by scripts/living-layers.mjs. */
export interface LayerManifest {
  clouds: { cloud: { x: number; y: number; w: number; h: number }; shadow: { x: number; y: number; w: number; h: number; depth: number } }[];
}

/**
 * Each cloud's slow wander: a long, gentle loop (plate px), different for each so they never move in step.
 * Amplitudes stay small (at most about twice ax from the picture's arrangement), so the composition holds and only a
 * thin rim of the filled land is ever uncovered; periods are long, so the motion is only noticed
 * by someone who stays a while.
 */
const DRIFT = [
  { ax: 10, ay: 2, px: 71, py: 53, phase: 0.3 },
  { ax: 11, ay: 2.5, px: 83, py: 61, phase: 2.1 },
  { ax: 7, ay: 2, px: 59, py: 47, phase: 4.0 },
] as const;

export function cloudDrift(k: number, t: number): [number, number] {
  const d = DRIFT[k];
  // starts at the picture's own arrangement (zero) and wanders from there
  const x = d.ax * (Math.sin((2 * Math.PI * t) / d.px + d.phase) - Math.sin(d.phase));
  const y = d.ay * (Math.sin((2 * Math.PI * t) / d.py + d.phase * 1.3) - Math.sin(d.phase * 1.3));
  return [x, y];
}

export interface LivingOptions {
  base: string;
  focus: readonly [number, number];
  dpr?: number;
  reducedMotion?: boolean;
  /** How strongly the wind shows in the grass (1 = as tuned). */
  life?: number;
  /** Pointer wind (milestone 5). Off: the scene lives on its own. */
  interactive?: boolean;
  seed?: number;
}

function loadTexture(url: string, mipmaps: boolean): Promise<Texture> {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(
      url,
      (t) => {
        t.flipY = false;
        t.generateMipmaps = mipmaps;
        t.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
        t.magFilter = LinearFilter;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      () => reject(new Error(`Could not load ${url}`)),
    );
  });
}

/** The living hero: the approved landscape in layers, each doing what it would do in the world. */
export class LivingApp {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly sim: WindSim;
  private readonly windTex = new WindTextures();
  private readonly compositor = new Compositor(false);
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2);
  readonly material: RawShaderMaterial;
  private readonly opts: LivingOptions;
  private readonly hover: HoverBreeze | null;
  private fit: Fit = { scale: 1, x: 0, y: 0 };
  private dpr = 1;
  private glassRect: GlassRect | null = null;
  private running = false;
  private disposed = false;
  private raf = 0;
  private lastT = 0;
  /** Scene time in seconds: drives the clouds and the wind in the grass. */
  time = 0;
  private readonly afterFrame: (() => void)[] = [];
  private pointerId: number | null = null;
  private gust: Gust | null = null;
  private smoother = new PointerSmoother();
  private lastMoveT = 0;
  private readonly ro: ResizeObserver;
  private textures: Texture[] = [];

  constructor(canvas: HTMLCanvasElement, opts: LivingOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.sim = new WindSim(opts.seed ?? 7);
    this.sim.onStep = () => this.windTex.ingest(this.sim);
    // the pointer's wind only: the ambient wind is drawn as light in the grass, not through the springs
    this.sim.applyTuning(DEFAULT_TUNING, 0);
    this.compositor.setFinish({ lift: 0, grain: 0, saturation: 1, soften: 0 });
    this.compositor.setVignette(0);
    this.compositor.setGlassLook([14, 0.32, 0.6, 0.13]);
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: LIVING_VERT,
      fragmentShader: LIVING_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uLand: { value: null },
        uMask: { value: null },
        uCloud0: { value: null },
        uCloud1: { value: null },
        uCloud2: { value: null },
        uShadow0: { value: null },
        uShadow1: { value: null },
        uShadow2: { value: null },
        uCloudRect: { value: [new Vector4(), new Vector4(), new Vector4()] },
        uShadowRect: { value: [new Vector4(), new Vector4(), new Vector4()] },
        uShadowDepth: { value: [0, 0, 0] },
        uDrift: { value: [new Vector2(), new Vector2(), new Vector2()] },
        uFit: { value: [0, 0, 1] },
        uHeight: { value: 1 },
        uPlateSize: { value: [PLATE.width, PLATE.height] },
        uTime: { value: 0 },
        uLife: { value: opts.reducedMotion ? 0 : (opts.life ?? 1) },
        uGust: { value: this.windTex.bend },
        uFieldMap: { value: [1 / PLATE.width, FIELD.width / PLATE.width / FIELD.depth, 0, 0] },
        uGustGain: { value: 1.6 },
      },
    });
    const quad = new Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    const interactive = !!opts.interactive;
    this.hover = interactive && !opts.reducedMotion ? new HoverBreeze(this.sim, (x, y) => this.worldAt(x, y), () => 1, { gain: 0.5 }) : null;
    if (interactive) {
      canvas.addEventListener('pointerdown', this.onDown);
      canvas.addEventListener('pointermove', this.onMove);
      canvas.addEventListener('pointerup', this.onUp);
      canvas.addEventListener('pointercancel', this.onUp);
      canvas.addEventListener('pointerleave', this.onLeave);
    }
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  async load(): Promise<void> {
    const b = this.opts.base;
    const manifest = (await (await fetch(`${b}/layers.json`)).json()) as LayerManifest;
    const urls = [`${b}/land.webp`, '/hybrid/grass-mask.png', ...[0, 1, 2].map((k) => `${b}/cloud-${k}.png`), ...[0, 1, 2].map((k) => `${b}/shadow-${k}.png`)];
    const loaded = await Promise.all(urls.map((u, i) => loadTexture(u, i === 0)));
    if (this.disposed) {
      for (const t of loaded) t.dispose();
      return;
    }
    this.textures = loaded;
    const u = this.material.uniforms;
    [u.uLand.value, u.uMask.value, u.uCloud0.value, u.uCloud1.value, u.uCloud2.value, u.uShadow0.value, u.uShadow1.value, u.uShadow2.value] = loaded;
    manifest.clouds.forEach((m, k) => {
      (u.uCloudRect.value as Vector4[])[k].set(m.cloud.x, m.cloud.y, m.cloud.w, m.cloud.h);
      (u.uShadowRect.value as Vector4[])[k].set(m.shadow.x, m.shadow.y, m.shadow.w, m.shadow.h);
      (u.uShadowDepth.value as number[])[k] = m.shadow.depth;
    });
    this.sim.step();
    this.sim.step();
  }

  private worldAt(clientX: number, clientY: number): [number, number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const px = ((clientX - r.left) * this.dpr - this.fit.x) / this.fit.scale;
    const py = ((clientY - r.top) * this.dpr - this.fit.y) / this.fit.scale;
    if (px < 0 || py < 0 || px > PLATE.width || py > PLATE.height) return null;
    const k = FIELD.width / PLATE.width;
    return [FIELD.minX + px * k, FIELD.minZ + py * k, 0];
  }

  resize = (): void => {
    const parent = this.canvas.parentElement;
    const cssW = Math.max(parent?.clientWidth ?? window.innerWidth, 1);
    const cssH = Math.max(parent?.clientHeight ?? window.innerHeight, 1);
    this.dpr = Math.min(this.opts.dpr ?? (window.devicePixelRatio || 1), 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(cssW, cssH, false);
    const w = Math.round(cssW * this.dpr);
    const h = Math.round(cssH * this.dpr);
    this.compositor.setSize(w, h, this.dpr);
    this.fit = coverFit(w, h, this.opts.focus[0], this.opts.focus[1]);
    this.material.uniforms.uFit.value = [this.fit.x, this.fit.y, this.fit.scale];
    this.material.uniforms.uHeight.value = h;
    this.applyGlass();
    if (!this.running && !this.disposed && this.textures.length) this.renderFrame();
  };

  setGlass(rect: GlassRect | null): void {
    this.glassRect = rect;
    this.applyGlass();
    if (!this.running && !this.disposed && this.textures.length) this.renderFrame();
  }

  setGlassPointer(x: number, y: number, presence: number): void {
    this.compositor.setGlassPointer(x * this.dpr, y * this.dpr, presence);
  }

  private applyGlass(): void {
    const g = this.glassRect;
    const d = this.dpr;
    this.compositor.setGlass(g ? { x: g.x * d, y: g.y * d, width: g.width * d, height: g.height * d, radius: g.radius * d, bevel: g.bevel * d, thickness: g.thickness * d } : null);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((t - this.lastT) / 1000, 0.1);
      this.lastT = t;
      this.advance(dt);
      this.renderFrame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private advance(dt: number): void {
    // with reduced motion the clouds hold still; the scene is a quiet picture
    if (!this.opts.reducedMotion) this.time += dt;
    this.sim.advance(dt);
  }

  /** Deterministic stepping for tests and captures: n frames of 1/60 s. */
  stepFrames(n: number): void {
    for (let i = 0; i < n; i++) {
      if (!this.opts.reducedMotion) this.time += 1 / 60;
      this.sim.step();
    }
    this.sim.alpha = 1;
    this.renderFrame();
  }

  /** Jump the scene clock (seconds), for captures of the motion at chosen moments. */
  setTime(t: number): void {
    this.time = t;
    this.renderFrame();
  }

  onceAfterFrame(cb: () => void): void {
    this.afterFrame.push(cb);
    if (!this.running) this.renderFrame();
  }

  renderFrame(): void {
    if (this.disposed || !this.textures.length) return;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    (u.uDrift.value as Vector2[]).forEach((v, k) => v.set(...cloudDrift(k, this.time)));
    this.windTex.render(this.renderer, this.sim.alpha, this.sim.time);
    this.renderer.setRenderTarget(this.compositor.target);
    this.renderer.render(this.scene, this.camera);
    this.compositor.present(this.renderer);
    for (const cb of this.afterFrame.splice(0)) cb();
  }

  bendEnergy(): number {
    const b = this.sim.response.bend;
    let s = 0;
    for (let i = 0; i < b.length; i += 4) s += Math.hypot(b[i], b[i + 1]);
    return s / (b.length / 4);
  }

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null || e.button !== 0) return;
    const at = this.worldAt(e.clientX, e.clientY);
    if (!at) return;
    this.hover?.end();
    this.pointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers cannot always be captured
    }
    this.smoother = new PointerSmoother();
    this.smoother.push(e.clientX, e.clientY, 0);
    this.lastMoveT = e.timeStamp;
    this.gust = this.sim.begin(this.opts.reducedMotion ? 0.6 : 1);
    this.gust.addPoint(at[0], at[1], 0);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.pointerId === null && e.pointerType === 'mouse' && e.buttons === 0 && this.hover) {
      this.hover.move(e);
      return;
    }
    if (e.pointerId !== this.pointerId || !this.gust) return;
    for (const ev of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
      const dt = Math.max((ev.timeStamp - this.lastMoveT) / 1000, 1 / 1000);
      this.lastMoveT = ev.timeStamp;
      const [sx, sy] = this.smoother.push(ev.clientX, ev.clientY, dt);
      const at = this.worldAt(sx, sy);
      if (at) this.gust.addPoint(at[0], at[1], dt);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const g = this.gust;
    this.gust = null;
    if (g) this.sim.end(g);
  };

  private onLeave = (): void => {
    this.hover?.end();
  };

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onLeave);
    this.hover?.dispose();
    for (const t of this.textures) t.dispose();
    this.windTex.dispose();
    this.compositor.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.renderer.dispose();
  }
}
