import { PerspectiveCamera, Scene, Vector3, Vector4, WebGLRenderer } from 'three';
import { Compositor } from '../engine/Compositor';
import { buildFlowers, Flowers } from '../grass/flowers';
import { GrassField, makeGrassUniforms } from '../grass/GrassField';
import { buildGrass } from '../grass/tufts';
import { FADE, type InkLine, StrokeLine } from '../interaction/StrokeLine';
import { PointerSmoother } from '../interaction/stroke';
import { placeCamera, screenRays } from '../scene/framing';
import { buildGround } from '../scene/Ground';
import { buildPainting, type Painting } from '../scene/paint';
import { Terrain } from '../scene/terrain';
import { STRENGTH_GAIN, type Store } from '../state/store';
import { FIELD } from '../wind/grid';
import type { Gust } from '../wind/gust';
import { pattern, type PatternName, type ScriptedStroke } from '../wind/patterns';
import { SIM_DT, WindSim } from '../wind/WindSim';
import { WindTextures } from '../wind/WindTextures';

const MAX_DPR = 2;
/** Full quality strand budget at a 1440×900-like frame. */
const BASE_TUFTS = 60_000;
const FRAMES_PER_BUDGET_CHECK = 45;

export interface AppOptions {
  seed: number;
  tufts?: number;
  /** Fixed DPR for tests. */
  dpr?: number;
  /** Disable adaptive quality (tests, benchmarks). */
  fixedQuality?: boolean;
  reducedMotion?: boolean;
}

interface ActiveLine extends InkLine {
  gust: Gust;
}

/** Runs the meadow: owns the renderer, the wind and the grass, and turns gestures into gusts. */
export class WindApp {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(26, 1, 2, 220);
  readonly scene = new Scene();
  readonly terrain: Terrain;
  readonly painting: Painting;
  readonly sim: WindSim;
  readonly grass: GrassField;
  readonly flowers: Flowers;
  readonly uniforms;
  private readonly compositor = new Compositor();
  private readonly windTex: WindTextures;
  private readonly line = new StrokeLine();
  private readonly lines: ActiveLine[] = [];
  private readonly groundDispose: () => void;
  private readonly timeUniform = { value: 0 };
  private raf = 0;
  private lastT = 0;
  private running = false;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private builtAspect = 0;
  private density = 1;
  private frames = 0;
  private spentMs = 0;
  private pendingRebuild = 0;
  private readonly scripted: { stroke: ScriptedStroke; gust: Gust | null; i: number; wait: number }[] = [];
  private pointerId: number | null = null;
  private activeGust: Gust | null = null;
  private lastMoveT = 0;
  private smoother = new PointerSmoother();
  private readonly ro: ResizeObserver;
  private disposed = false;
  private contextLost = false;
  private readonly seed: number;
  private readonly opts: AppOptions;
  private readonly store: Store;
  readonly canvas: HTMLCanvasElement;
  /** Set for a frame by capture so it can read back right after drawing. */
  private afterFrame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, store: Store, opts: AppOptions) {
    this.canvas = canvas;
    this.store = store;
    this.opts = opts;
    this.seed = opts.seed;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x7f9f66, 1);
    const gl = this.renderer.getContext();
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('This browser cannot render to floating-point textures, which the wind needs.');
    }

    this.terrain = new Terrain(this.seed);
    this.painting = buildPainting(this.terrain, this.seed);
    this.sim = new WindSim(this.seed);
    if (opts.reducedMotion) this.sim.ambient.amount = 0.35;
    this.windTex = new WindTextures();
    this.sim.onStep = () => this.windTex.ingest(this.sim);

    this.uniforms = makeGrassUniforms(new Vector4(FIELD.minX, FIELD.minZ, 1 / FIELD.width, 1 / FIELD.depth));
    this.uniforms.uBend.value = this.windTex.bend;
    this.uniforms.uFlow.value = this.windTex.flow;
    this.uniforms.uTime = this.timeUniform;

    this.grass = new GrassField(this.uniforms);
    const ground = buildGround(this.terrain, this.painting, this.uniforms.uFlow, this.uniforms.uFieldRect);
    this.groundDispose = ground.dispose;
    this.flowers = new Flowers(this.uniforms);
    this.scene.add(ground.mesh, this.grass.mesh, this.flowers.mesh);

    this.resize();
    this.rebuildGrass();
    // fill the raw textures with the state at t=0, so the first frame has wind data
    this.sim.step();
    this.sim.step();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('lostpointercapture', this.onUp);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private tuftBudget(): number {
    if (this.opts.tufts) return this.opts.tufts;
    // the same coverage of the frame whatever its size: coverage depends on css area ÷ size of a tuft on screen
    const area = (this.cssW * this.cssH) / (1440 * 900);
    const budget = BASE_TUFTS * Math.pow(area, 0.55);
    const coarse = matchMedia('(pointer: coarse)').matches;
    return Math.round(Math.min(budget * (coarse ? 0.75 : 1), 130_000));
  }

  rebuildGrass(): void {
    placeCamera(this.camera, this.cssW / this.cssH);
    const buffers = buildGrass(this.terrain, this.painting, screenRays(this.camera), { tufts: this.tuftBudget(), seed: this.seed });
    this.grass.setBuffers(buffers);
    this.grass.setDensity(this.density);
    this.flowers.setBuffers(buildFlowers(this.terrain, screenRays(this.camera), { flowers: 620, seedHeads: 260, seed: this.seed }));
    this.builtAspect = this.cssW / this.cssH;
    this.uniforms.uCamPos.value.copy(this.camera.position);
  }

  resize = (): void => {
    const parent = this.canvas.parentElement;
    this.cssW = Math.max(parent?.clientWidth ?? window.innerWidth, 1);
    this.cssH = Math.max(parent?.clientHeight ?? window.innerHeight, 1);
    this.dpr = this.opts.dpr ?? Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.applySize();
    placeCamera(this.camera, this.cssW / this.cssH);
    this.uniforms.uCamPos.value.copy(this.camera.position);
    if (this.builtAspect && Math.abs(this.cssW / this.cssH - this.builtAspect) / this.builtAspect > 0.05) {
      clearTimeout(this.pendingRebuild);
      this.pendingRebuild = window.setTimeout(() => this.rebuildGrass(), 180);
    }
    if (!this.running && !this.store.get().loading) this.renderFrame();
  };

  private applySize(): void {
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    this.compositor.setSize(w, h, this.dpr);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((t - this.lastT) / 1000, 0.25);
      this.lastT = t;
      if (this.contextLost) return;
      this.advance(dt);
      this.renderFrame();
      this.watchBudget(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Deterministic stepping for tests, demos and offline video: exactly n sim steps, then one frame. */
  stepFrames(n: number): void {
    for (let i = 0; i < n; i++) {
      this.feedScripted();
      this.sim.step();
    }
    this.sim.alpha = 1;
    this.tickLines(n * SIM_DT);
    this.renderFrame();
  }

  private advance(dt: number): void {
    const sim = this.sim;
    if (!sim.paused) {
      const before = sim.steps;
      sim.advance(dt);
      // scripted strokes feed one point per step; a slow frame may have run several steps at once
      for (let i = before; i < sim.steps; i++) this.feedScripted();
      this.tickLines(dt);
    }
    if (this.frames % 10 === 0) this.store.set({ active: sim.activeGusts + (this.activeGust ? 0 : 0) });
  }

  private tickLines(dt: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (l.gust.drawing) continue;
      l.fading = Math.max(l.fading, 0) + dt;
      if (l.fading > FADE * 1.4) this.lines.splice(i, 1);
    }
  }

  renderFrame(): void {
    const { renderer, sim } = this;
    this.timeUniform.value = sim.time + sim.alpha * SIM_DT;
    this.windTex.render(renderer, sim.alpha, this.timeUniform.value);
    this.line.update(this.lines, this.camera, this.terrain, this.cssW, this.cssH);
    renderer.setRenderTarget(this.compositor.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.compositor.present(renderer);
    renderer.autoClear = false;
    this.line.render(renderer);
    renderer.autoClear = true;
    this.frames++;
    if (this.afterFrame) {
      const f = this.afterFrame;
      this.afterFrame = null;
      f();
    }
  }

  /** Honest adaptive quality: lower resolution, then density, only when frames are really being missed. */
  private watchBudget(dt: number): void {
    if (this.opts.fixedQuality) return;
    this.spentMs += dt * 1000;
    if (this.frames % FRAMES_PER_BUDGET_CHECK !== 0) return;
    const avg = this.spentMs / FRAMES_PER_BUDGET_CHECK;
    this.spentMs = 0;
    this.store.set({ fps: Math.round(1000 / avg) });
    if (document.hidden || this.frames < FRAMES_PER_BUDGET_CHECK * 2) return;
    if (avg > 26) {
      if (this.dpr > 1.25) {
        this.dpr = Math.max(1.25, this.dpr * 0.84);
        this.applySize();
      } else if (this.density > 0.45) {
        this.density *= 0.82;
        this.grass.setDensity(this.density);
        // broader strands keep the coverage, so a lower density never looks sparse
        this.uniforms.uWidthScale.value = Math.min(Math.sqrt(1 / this.density), 1.45);
      }
    }
  }

  /** Runs a callback right after the next frame, while the drawing buffer is still valid. */
  onceAfterFrame(cb: () => void): void {
    this.afterFrame = cb;
    if (!this.running) this.renderFrame();
  }

  // ---- gestures ----

  private worldAt(clientX: number, clientY: number): [number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5);
    v.unproject(this.camera).sub(this.camera.position);
    const o = this.camera.position;
    const hit = this.terrain.raycast(o.x, o.y, o.z, v.x, v.y, v.z);
    return hit ? [hit[0], hit[2]] : null;
  }

  private gain(): number {
    return STRENGTH_GAIN[this.store.get().strength] * (this.opts.reducedMotion ? 0.6 : 1);
  }

  private beginGust(): Gust {
    const g = this.sim.begin(this.gain());
    this.lines.push({ gust: g, points: g.points, fading: -1 });
    this.store.set({ active: this.sim.activeGusts });
    return g;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.pointerId !== null || e.button !== 0) return;
    const at = this.worldAt(e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers can't always be captured; drawing still works over the canvas
    }
    this.smoother = new PointerSmoother();
    this.smoother.push(e.clientX, e.clientY, 0);
    this.lastMoveT = e.timeStamp;
    this.activeGust = this.beginGust();
    this.activeGust.addPoint(at[0], at[1], 0);
    this.store.set({ hint: false });
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || !this.activeGust) return;
    e.preventDefault();
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      const dt = Math.max((ev.timeStamp - this.lastMoveT) / 1000, 1 / 1000);
      this.lastMoveT = ev.timeStamp;
      const [sx, sy] = this.smoother.push(ev.clientX, ev.clientY, dt);
      const at = this.worldAt(sx, sy);
      if (at) this.activeGust.addPoint(at[0], at[1], dt);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const g = this.activeGust;
    this.activeGust = null;
    if (g) this.sim.end(g);
  };

  // ---- scripted gestures, through the same gust pipeline ----

  playStroke(stroke: ScriptedStroke): void {
    this.scripted.push({ stroke, gust: null, i: 0, wait: stroke.delay ?? 0 });
    this.store.set({ hint: false });
  }

  play(name: PatternName): void {
    for (const stroke of pattern(name)) this.playStroke(stroke);
  }

  private feedScripted(): void {
    for (let k = this.scripted.length - 1; k >= 0; k--) {
      const s = this.scripted[k];
      if (s.wait > 0) {
        s.wait--;
        continue;
      }
      s.gust ??= this.beginGust();
      const p = s.stroke.points[s.i++];
      s.gust.addPoint(p[0], p[1], SIM_DT);
      if (s.i >= s.stroke.points.length) {
        this.sim.end(s.gust);
        this.scripted.splice(k, 1);
      }
    }
  }

  // ---- controls ----

  setPaused(paused: boolean): void {
    this.sim.paused = paused;
    this.store.set({ paused });
    this.lastT = performance.now();
  }

  undo(): boolean {
    const g = this.sim.gusts[this.sim.gusts.length - 1];
    const done = this.sim.undoLatest();
    if (done && g) {
      const l = this.lines.find((x) => x.gust === g);
      if (l) l.fading = Math.max(l.fading, FADE * 0.7);
    }
    this.store.set({ active: this.sim.activeGusts });
    return done;
  }

  clearWind(): void {
    this.scripted.length = 0;
    this.activeGust = null;
    this.pointerId = null;
    this.sim.clear();
    for (const l of this.lines) l.fading = Math.max(l.fading, FADE * 0.7);
    this.store.set({ active: 0 });
  }

  resetScene(): void {
    this.scripted.length = 0;
    this.activeGust = null;
    this.pointerId = null;
    this.lines.length = 0;
    this.sim.reset();
    this.sim.step();
    this.sim.step();
    this.setPaused(false);
    this.store.set({ active: 0, strength: 'gust', hint: true });
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.store.set({ error: 'The graphics context was lost. Trying to restore it…' });
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    this.store.set({ error: null });
    this.lastT = performance.now();
  };

  dispose(): void {
    this.disposed = true;
    this.stop();
    clearTimeout(this.pendingRebuild);
    this.ro.disconnect();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('lostpointercapture', this.onUp);
    c.removeEventListener('webglcontextlost', this.onContextLost);
    c.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.grass.dispose();
    this.flowers.dispose();
    this.groundDispose();
    this.windTex.dispose();
    this.compositor.dispose();
    this.line.dispose();
    this.renderer.dispose();
  }
}
