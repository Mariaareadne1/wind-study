import {
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  Scene,
  Texture,
  TextureLoader,
  WebGLRenderer,
} from 'three';
import { Compositor } from '../engine/Compositor';
import { HoverBreeze } from '../interaction/HoverBreeze';
import { PointerSmoother } from '../interaction/stroke';
import { DEFAULT_TUNING } from '../state/tuning';
import { FIELD } from '../wind/grid';
import type { Gust } from '../wind/gust';
import { SIM_DT, WindSim } from '../wind/WindSim';
import { WindTextures } from '../wind/WindTextures';
import type { GlassRect } from '../app/WindApp';
import { coverFit, PLATE, PLATE_FRAG, PLATE_VERT, type Fit } from './plate';

/** How the hybrid hero feels. All of it is tuned against real captures (see PROGRESS.md). */
export const HYBRID_TUNING = {
  /** Plate pixels of detail shift per unit of grass bend. */
  shiftPx: 5,
  /** The mip level that counts as the hills; everything finer is grass detail. */
  detailLod: 2,
  /** The ambient breeze, relative to Wind Study's. */
  breeze: 0.45,
  /** A hover relative to a drag. */
  hover: 0.45,
  /** Plate px from a strand's root to its tip, for blade-level motion. */
  bladeLen: 110,
  /** Ceiling on device pixel ratio: the plate is 1672 wide, so more resolution adds nothing. */
  maxDpr: 2,
} as const;

export interface HybridOptions {
  plateUrl: string;
  maskUrl: string;
  flowUrl: string;
  /** 'blade' (default): strand by strand; 'sheet': the detail moves as one layer. */
  motion?: 'blade' | 'sheet';
  /** Focal point of the crop, as fractions of the plate. */
  focus: readonly [number, number];
  dpr?: number;
  reducedMotion?: boolean;
  /** 1: show the mask; 2: show the bend field. */
  debug?: number;
  seed?: number;
}

function loadTexture(url: string, mipmaps: boolean): Promise<Texture> {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(
      url,
      (t) => {
        // image rows top to bottom, like the plate coordinates in the shader
        t.flipY = false;
        t.generateMipmaps = mipmaps;
        t.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
        t.magFilter = LinearFilter;
        t.anisotropy = 1;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      () => reject(new Error(`Could not load ${url}`)),
    );
  });
}

/**
 * The image-directed hero: a photographic plate whose fine grass detail moves with Wind Study's
 * wind, under a glass panel that refracts it. The plate never warps as a whole; the hills,
 * shadows and clouds stay where the picture put them.
 */
export class HybridApp {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly sim: WindSim;
  private readonly windTex = new WindTextures();
  private readonly compositor = new Compositor(false);
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new PlaneGeometry(2, 2);
  private readonly material: RawShaderMaterial;
  private readonly opts: HybridOptions;
  private readonly hover: HoverBreeze | null;
  private fit: Fit = { scale: 1, x: 0, y: 0 };
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private glassRect: GlassRect | null = null;
  private running = false;
  private disposed = false;
  private raf = 0;
  private lastT = 0;
  private readonly afterFrame: (() => void)[] = [];
  private pointerId: number | null = null;
  private gust: Gust | null = null;
  private smoother = new PointerSmoother();
  private lastMoveT = 0;
  private readonly ro: ResizeObserver;
  private textures: Texture[] = [];

  constructor(canvas: HTMLCanvasElement, opts: HybridOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.autoClear = true;
    this.sim = new WindSim(opts.seed ?? 7);
    this.sim.onStep = () => this.windTex.ingest(this.sim);
    this.sim.applyTuning(DEFAULT_TUNING, HYBRID_TUNING.breeze * (opts.reducedMotion ? 0.35 : 1));
    // a photograph is already display colour: no grain, no lift, no softening, no vignette
    this.compositor.setFinish({ lift: 0, grain: 0, saturation: 1, soften: 0 });
    this.compositor.setVignette(0);
    // clear, dark, smoky glass with a soft bevel and only a light frost, after the reference
    this.compositor.setGlassLook([14, 0.32, 0.6, 0.13]);
    this.material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: PLATE_VERT,
      fragmentShader: PLATE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPlate: { value: null },
        uMask: { value: null },
        uBend: { value: this.windTex.bend },
        uFit: { value: [0, 0, 1] },
        uHeight: { value: 1 },
        uPlateSize: { value: [PLATE.width, PLATE.height] },
        // plate px -> field uv: the plate spans the field's width, from its top-left corner
        uFieldMap: { value: [1 / PLATE.width, FIELD.width / PLATE.width / FIELD.depth, 0, 0] },
        uDetailLod: { value: HYBRID_TUNING.detailLod },
        uShiftPx: { value: HYBRID_TUNING.shiftPx },
        uFlow: { value: null },
        uBlade: { value: opts.motion === 'sheet' ? 0 : 1 },
        uBladeLen: { value: HYBRID_TUNING.bladeLen },
        uDebug: { value: opts.debug ?? 0 },
      },
    });
    const quad = new Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    // with reduced motion, only a deliberate drag stirs the grass
    this.hover = opts.reducedMotion ? null : new HoverBreeze(this.sim, (x, y) => this.worldAt(x, y), () => this.gain(), { gain: HYBRID_TUNING.hover });
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  /** Resolves once the plate and mask are on the GPU. */
  async load(): Promise<void> {
    const loaded = await Promise.all([loadTexture(this.opts.plateUrl, true), loadTexture(this.opts.maskUrl, false), loadTexture(this.opts.flowUrl, false)]);
    if (this.disposed) {
      for (const t of loaded) t.dispose();
      return;
    }
    const [plate, mask, flow] = loaded;
    this.textures = loaded;
    this.material.uniforms.uPlate.value = plate;
    this.material.uniforms.uMask.value = mask;
    this.material.uniforms.uFlow.value = flow;
    this.sim.step();
    this.sim.step();
  }

  private gain(): number {
    return this.opts.reducedMotion ? 0.6 : 1;
  }

  /** Client pixels to the wind field's world coordinates, through the plate. Off the plate: null. */
  private worldAt(clientX: number, clientY: number): [number, number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const dx = (clientX - r.left) * this.dpr;
    const dy = (clientY - r.top) * this.dpr;
    const px = (dx - this.fit.x) / this.fit.scale;
    const py = (dy - this.fit.y) / this.fit.scale;
    if (px < 0 || py < 0 || px > PLATE.width || py > PLATE.height) return null;
    const k = FIELD.width / PLATE.width;
    return [FIELD.minX + px * k, FIELD.minZ + py * k, 0];
  }

  resize = (): void => {
    const parent = this.canvas.parentElement;
    this.cssW = Math.max(parent?.clientWidth ?? window.innerWidth, 1);
    this.cssH = Math.max(parent?.clientHeight ?? window.innerHeight, 1);
    this.dpr = Math.min(this.opts.dpr ?? (window.devicePixelRatio || 1), HYBRID_TUNING.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    this.compositor.setSize(w, h, this.dpr);
    this.fit = coverFit(w, h, this.opts.focus[0], this.opts.focus[1]);
    this.material.uniforms.uFit.value = [this.fit.x, this.fit.y, this.fit.scale];
    this.material.uniforms.uHeight.value = h;
    this.applyGlass();
    if (!this.running && !this.disposed && this.textures.length) this.renderFrame();
  };

  /** The glass panel, in CSS pixels relative to the canvas, or null. */
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
      this.sim.advance(Math.min((t - this.lastT) / 1000, 0.25));
      this.lastT = t;
      this.renderFrame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Deterministic stepping for tests and captures. */
  stepFrames(n: number): void {
    for (let i = 0; i < n; i++) this.sim.step();
    this.sim.alpha = 1;
    this.renderFrame();
  }

  onceAfterFrame(cb: () => void): void {
    this.afterFrame.push(cb);
    if (!this.running) this.renderFrame();
  }

  renderFrame(): void {
    if (this.disposed || !this.textures.length) return;
    const { renderer } = this;
    this.windTex.render(renderer, this.sim.alpha, this.sim.time);
    renderer.setRenderTarget(this.compositor.target);
    renderer.render(this.scene, this.camera);
    this.compositor.present(renderer);
    const cbs = this.afterFrame.splice(0);
    for (const cb of cbs) cb();
  }

  // ---- pointer: drag makes a full gust, a plain move a soft breeze (HoverBreeze) ----

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null || e.button !== 0) return;
    const at = this.worldAt(e.clientX, e.clientY);
    if (!at) return;
    this.hover?.end();
    // touch keeps vertical scrolling (touch-action: pan-y); a sideways drag still draws wind
    this.pointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers cannot always be captured; the gust still follows moves over the canvas
    }
    this.smoother = new PointerSmoother();
    this.smoother.push(e.clientX, e.clientY, 0);
    this.lastMoveT = e.timeStamp;
    this.gust = this.sim.begin(this.gain());
    this.gust.addPoint(at[0], at[1], 0);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.pointerId === null && e.pointerType === 'mouse' && e.buttons === 0 && this.hover) {
      this.hover.move(e);
      return;
    }
    if (e.pointerId !== this.pointerId || !this.gust) return;
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
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

  /** Mean grass bend across the field, for tests: it returns toward zero as the grass settles. */
  bendEnergy(): number {
    const b = this.sim.response.bend;
    let s = 0;
    for (let i = 0; i < b.length; i += 4) s += Math.hypot(b[i], b[i + 1]);
    return s / (b.length / 4);
  }

  static readonly stepSeconds = SIM_DT;

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
