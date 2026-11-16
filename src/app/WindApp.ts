import { PerspectiveCamera, Scene, Vector3, Vector4, WebGLRenderer } from 'three';
import { Compositor } from '../engine/Compositor';
import { buildFlowers, Flowers } from '../grass/flowers';
import { GrassField, makeGrassUniforms } from '../grass/GrassField';
import { buildGrass } from '../grass/tufts';
import { FADE, type InkLine, StrokeLine } from '../interaction/StrokeLine';
import { PointerSmoother } from '../interaction/stroke';
import { placeCamera, screenRays } from '../scene/framing';
import { MEADOW, type SceneProfile } from '../scene/profiles';
import { bakeCloudShadow, buildPuffs, Clouds, makeShadowTexture } from '../scene/Clouds';
import { makeFlow, makeSwirl } from '../scene/swirl';
import { bakeTerrainLight, terrainLightTexture } from '../scene/terrainLight';
import { Cyclist } from '../scene/Cyclist';
import { sampleGrid } from '../wind/grid';
import type { DataTexture } from 'three';
import { buildGround } from '../scene/Ground';
import { buildPainting, type Painting } from '../scene/paint';
import { Terrain } from '../scene/terrain';
import { STRENGTH_GAIN, type Store } from '../state/store';
import { DEFAULT_TUNING } from '../state/tuning';
import { FIELD } from '../wind/grid';
import type { Gust } from '../wind/gust';
import { DEMO_TIMELINE, pattern, type PatternName, type Point2, scaleStroke, type ScriptedStroke } from '../wind/patterns';
import { frameMargin, type Tuning } from '../state/tuning';
import { SIM_DT, WindSim } from '../wind/WindSim';
import { WindTextures } from '../wind/WindTextures';

const MAX_DPR = 2;
/** Full quality strand budget at a 1440×900-like frame. */
const BASE_TUFTS = 60_000;
const FRAMES_PER_BUDGET_CHECK = 45;
/** Half the world width across the middle of the 16:10 frame the patterns were composed in. */
const LANDSCAPE_HALF_WIDTH = 15.5;
/** Half the depth those patterns span, read as a height on the screen. */
const PATTERN_HALF_DEPTH = 13;

export interface AppOptions {
  seed: number;
  tufts?: number;
  /** Fixed DPR for tests. */
  dpr?: number;
  /** Disable adaptive quality (tests, benchmarks). */
  fixedQuality?: boolean;
  reducedMotion?: boolean;
  /** Hide the grass, to look at the land alone. */
  bare?: boolean;
  /** Which version to build. Defaults to the meadow. */
  profile?: SceneProfile;
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
  private readonly compositor: Compositor;
  private terrainLightTex: DataTexture | null = null;
  private readonly windTex: WindTextures;
  private readonly line = new StrokeLine();
  private readonly lines: ActiveLine[] = [];
  private readonly groundDispose: () => void;
  private clouds: Clouds | null = null;
  private cyclist: Cyclist | null = null;
  private shadowTex: DataTexture | null = null;
  private readonly cloudOffset = { value: new Vector3() };
  private swirlFn: ReturnType<typeof makeSwirl> | null = null;
  private readonly timeUniform = { value: 0 };
  private raf = 0;
  private lastT = 0;
  private running = false;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  /** Ceiling set by adaptive quality; survives resizes. */
  private dprCap = Infinity;
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
  private readonly unsubscribe: () => void;
  private appliedTuning: Tuning | null = null;
  private appliedFramed: boolean | null = null;
  private contextLost = false;
  private readonly seed: number;
  readonly profile: SceneProfile;
  private readonly opts: AppOptions;
  private readonly store: Store;
  readonly canvas: HTMLCanvasElement;
  /** Set for a frame by capture so it can read back right after drawing. */
  private readonly afterFrame: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, store: Store, opts: AppOptions) {
    this.canvas = canvas;
    this.store = store;
    this.opts = opts;
    this.seed = opts.seed;
    this.profile = opts.profile ?? MEADOW;
    this.compositor = new Compositor(!!this.profile.realistic?.finish.exposure);
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

    this.terrain = new Terrain(this.seed, this.profile.height, this.profile.marchRays);
    this.painting = buildPainting(this.terrain, this.seed, { patches: this.profile.patches, sun: this.profile.sun, look: this.profile.paint });
    this.sim = new WindSim(this.seed);
        this.windTex = new WindTextures();
    this.sim.onStep = () => this.windTex.ingest(this.sim);

    this.uniforms = makeGrassUniforms(new Vector4(FIELD.minX, FIELD.minZ, 1 / FIELD.width, 1 / FIELD.depth), this.profile.sun);
    this.uniforms.uBend.value = this.windTex.bend;
    this.uniforms.uFlow.value = this.windTex.flow;
    this.uniforms.uTime = this.timeUniform;
    const haze = this.profile.haze;
    this.uniforms.uHaze.value.set(haze.color[0], haze.color[1], haze.color[2], haze.amount);
    this.uniforms.uHazeRange.value.set(haze.near, haze.far);

    const look = this.profile.realistic;
    if (look?.finish.exposure) {
      this.terrainLightTex = terrainLightTexture(bakeTerrainLight(this.terrain, this.profile.sun));
      this.uniforms.uTerrainLight.value = this.terrainLightTex;
    }
    if (look) {
      this.uniforms.uSunColor.value.set(look.sunColor[0], look.sunColor[1], look.sunColor[2]);
      this.uniforms.uSkyColor.value.set(look.skyColor[0], look.skyColor[1], look.skyColor[2]);
      this.compositor.setFinish(look.finish);
    }
    this.grass = new GrassField(this.uniforms, !!look, !!look?.finish.exposure);
    const ground = buildGround(this.terrain, this.painting, this.uniforms.uFlow, this.uniforms.uFieldRect, this.uniforms, !!look, this.uniforms);
    this.groundDispose = ground.dispose;
    this.flowers = new Flowers(this.uniforms);
    this.scene.add(ground.mesh, this.grass.mesh, this.flowers.mesh);
    this.buildClouds();
    this.buildCyclist();
    // ?bare shows the land alone, to judge its shape and light without grass
    if (opts.bare) {
      this.grass.mesh.visible = false;
      this.flowers.mesh.visible = false;
    }

    this.resize();
    this.rebuildGrass();
    this.syncSettings();
    this.unsubscribe = store.subscribe(this.syncSettings);
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
    const budget = BASE_TUFTS * this.profile.grass.density * Math.pow(area, 0.55);
    const coarse = matchMedia('(pointer: coarse)').matches;
    return Math.round(Math.min(budget * (coarse ? 0.75 : 1), 130_000));
  }

  private get swirl(): ReturnType<typeof makeSwirl> {
    // linear-light scenes comb their grass along the land; the earlier look used painted eddies
    this.swirlFn ??= this.profile.realistic?.finish.exposure ? makeFlow(this.seed, (x, z) => this.terrain.height(x, z), this.profile.baseline) : makeSwirl(this.seed);
    return this.swirlFn;
  }

  /** Clouds and the shadows they cast, baked once along the sun. */
  private buildClouds(): void {
    const specs = this.profile.clouds;
    if (!specs?.length) return;
    const puffs = specs.flatMap(buildPuffs);
    const res = [304, 208] as const;
    this.shadowTex = makeShadowTexture(bakeCloudShadow(puffs, this.terrain, this.profile.sun, FIELD, res[0], res[1]), res[0], res[1]);
    this.windTex.setShadowMap(this.shadowTex);
    this.clouds = new Clouds(puffs, this.camera, this.profile.sun, this.cloudOffset);
    this.scene.add(this.clouds.mesh);
  }

  private buildCyclist(): void {
    const c = this.profile.cyclist;
    if (!c) return;
    this.cyclist = new Cyclist(c.path, (x, z) => this.terrain.height(x, z), c.span);
    this.scene.add(this.cyclist.mesh);
  }

  /** Clouds sway slowly; their shadows move with them. */
  private driftClouds(time: number): void {
    if (!this.clouds) return;
    const dx = Math.sin(time * 0.045) * 1.6;
    const dz = Math.sin(time * 0.031 + 1.3) * 0.6;
    this.cloudOffset.value.set(dx, Math.sin(time * 0.07) * 0.15, dz);
    this.windTex.setShadowShift(dx, dz);
  }

  rebuildGrass(): void {
    placeCamera(this.camera, this.cssW / this.cssH, this.profile.framing);
    const { refDist, sizeExponent, sizeScale, screenBias, combJitter } = this.profile.grass;
    const long = this.profile.long ? { ...this.profile.long, lay: this.swirl } : undefined;
    const buffers = buildGrass(this.terrain, this.painting, screenRays(this.camera), { tufts: this.tuftBudget(), seed: this.seed, refDist, sizeExponent, sizeScale, screenBias, combJitter, long });
    this.grass.setBuffers(buffers);
    this.grass.setDensity(this.density);
    this.flowers.setBuffers(buildFlowers(this.terrain, screenRays(this.camera), { ...(this.profile.flowers ?? { flowers: 620, seedHeads: 260 }), seed: this.seed, refDist, sizeExponent, scale: sizeScale }));
    this.builtAspect = this.cssW / this.cssH;
    this.uniforms.uCamPos.value.copy(this.camera.position);
  }

  resize = (): void => {
    const parent = this.canvas.parentElement;
    this.cssW = Math.max(parent?.clientWidth ?? window.innerWidth, 1);
    this.cssH = Math.max(parent?.clientHeight ?? window.innerHeight, 1);
    this.dpr = Math.min(this.opts.dpr ?? Math.min(window.devicePixelRatio || 1, MAX_DPR), this.dprCap);
    this.applySize();
    placeCamera(this.camera, this.cssW / this.cssH, this.profile.framing);
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
    this.applyFrame();
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
    this.driftClouds(this.timeUniform.value);
    this.cyclist?.update(this.timeUniform.value, this.camera, (x, z) => [sampleGrid(sim.totalU, x, z), sampleGrid(sim.totalV, x, z)]);
    this.windTex.render(renderer, sim.alpha, this.timeUniform.value);
    this.line.update(this.lines, this.camera, this.terrain, this.cssW, this.cssH);
    renderer.setRenderTarget(this.compositor.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.compositor.present(renderer);
    renderer.autoClear = false;
    // the ink stays on the painting, off the border
    const mat = this.store.get().framed ? frameMargin(this.cssW, this.cssH) : 0;
    renderer.setScissorTest(mat > 0);
    if (mat > 0) renderer.setScissor(mat, mat, this.cssW - 2 * mat, this.cssH - 2 * mat);
    this.line.render(renderer);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    this.frames++;
    if (this.afterFrame.length > 0) {
      const pending = this.afterFrame.splice(0);
      for (const f of pending) f();
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
    // changing the canvas size would break a recording in progress
    if (document.hidden || this.frames < FRAMES_PER_BUDGET_CHECK * 2 || this.store.get().recording) return;
    if (avg > 26) {
      if (this.dpr > 1.25) {
        this.dpr = Math.max(1.25, this.dpr * 0.84);
        this.dprCap = this.dpr;
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
    this.afterFrame.push(cb);
    if (!this.running) this.renderFrame();
  }

  /** False when no frame can be drawn: the graphics context is gone, or the app was disposed. */
  get canDraw(): boolean {
    return !this.contextLost && !this.disposed;
  }

  // ---- gestures ----

  private worldAt(clientX: number, clientY: number): [number, number, number] | null {
    const r = this.canvas.getBoundingClientRect();
    return this.worldAtNdc(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** The ground under a screen position, as x, z, and height. */
  private worldAtNdc(ndcX: number, ndcY: number): [number, number, number] | null {
    const v = new Vector3(ndcX, ndcY, 0.5);
    v.unproject(this.camera).sub(this.camera.position);
    const o = this.camera.position;
    const hit = this.terrain.raycast(o.x, o.y, o.z, v.x, v.y, v.z);
    return hit ? [hit[0], hit[2], hit[1]] : null;
  }

  /** Height to give the ink, only where hills can hide the ground under a straight stroke. */
  private inkHeight(y: number): number | undefined {
    return this.profile.marchRays ? y : undefined;
  }

  private gain(): number {
    const { strength, tuning } = this.store.get();
    return STRENGTH_GAIN[strength] * tuning.force * (this.opts.reducedMotion ? 0.6 : 1);
  }

  /** Applies whatever the tuning panel says. Runs on every store change, and only acts on a real change. */
  private syncSettings = (): void => {
    const { tuning, framed } = this.store.get();
    if (tuning === this.appliedTuning && framed === this.appliedFramed) return;
    this.appliedTuning = tuning;
    this.uniforms.uBendGain.value = tuning.lean;
    const motion = this.profile.motion ?? { breeze: 1, flutter: 1 };
    this.uniforms.uFlutter.value = tuning.flutter * motion.flutter;
    this.sim.applyTuning(tuning, (this.opts.reducedMotion ? 0.35 : 1) * motion.breeze);
    if (framed !== this.appliedFramed) {
      this.appliedFramed = framed;
      this.applyFrame();
    }
    if (!this.running && !this.store.get().loading) this.renderFrame();
  };

  private applyFrame(): void {
    const framed = this.store.get().framed;
    this.compositor.setMat(framed ? frameMargin(this.cssW, this.cssH) * this.dpr : 0);
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
    this.activeGust.addPoint(at[0], at[1], 0, this.inkHeight(at[2]));
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
      if (at) this.activeGust.addPoint(at[0], at[1], dt, this.inkHeight(at[2]));
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

  play(name: PatternName, delaySteps = 0): void {
    const fit = this.profile.screenPatterns ? 1 : this.patternFit();
    for (const stroke of pattern(name)) {
      const fitted = this.profile.screenPatterns ? this.dropOntoHills(stroke) : scaleStroke(stroke, fit);
      this.playStroke({ ...fitted, delay: (stroke.delay ?? 0) + delaySteps });
    }
  }

  /** Reads a gesture as a shape on the screen, then finds the ground under each point of it. */
  private dropOntoHills(stroke: ScriptedStroke): ScriptedStroke {
    const points: Point2[] = [];
    for (const [x, z] of stroke.points) {
      const ndcX = Math.max(-1.08, Math.min(1.08, x / LANDSCAPE_HALF_WIDTH));
      const ndcY = Math.max(-0.96, Math.min(0.96, -z / PATTERN_HALF_DEPTH));
      const hit = this.worldAtNdc(ndcX, ndcY);
      if (hit) points.push(hit);
    }
    return { ...stroke, points };
  }

  /** Ready-made gestures were composed for a landscape frame; a narrow frame shrinks them to fit. */
  private patternFit(): number {
    const left = this.worldAt(this.canvasLeft(), this.canvasMidY());
    const right = this.worldAt(this.canvasLeft() + this.cssW, this.canvasMidY());
    if (!left || !right) return 1;
    return Math.min(1, Math.max(0.3, Math.abs(right[0] - left[0]) / 2 / LANDSCAPE_HALF_WIDTH));
  }

  private canvasLeft(): number {
    return this.canvas.getBoundingClientRect().left;
  }

  private canvasMidY(): number {
    const r = this.canvas.getBoundingClientRect();
    return r.top + r.height / 2;
  }

  /** Restart from a calm meadow, then run the 20-second film through the real gesture pipeline. */
  playDemo(): void {
    this.scripted.length = 0;
    this.activeGust = null;
    this.pointerId = null;
    this.lines.length = 0;
    this.sim.reset();
    this.sim.step();
    this.sim.step();
    this.setPaused(false);
    this.store.set({ hint: false, active: 0 });
    for (const beat of DEMO_TIMELINE) this.play(beat.name, Math.round(beat.at / SIM_DT));
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
      s.gust.addPoint(p[0], p[1], SIM_DT, p[2]);
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
    const g = this.sim.undoLatest();
    if (!g) return false;
    const l = this.lines.find((x) => x.gust === g);
    if (l) l.fading = Math.max(l.fading, FADE * 0.7);
    // undoing the stroke still being drawn ends that drag; a pointer-up later does nothing
    if (g === this.activeGust) {
      this.activeGust = null;
      this.pointerId = null;
    }
    this.scripted.splice(0, this.scripted.length, ...this.scripted.filter((s) => s.gust !== g));
    this.showWhilePaused();
    this.store.set({ active: this.sim.activeGusts });
    return true;
  }

  clearWind(): void {
    this.scripted.length = 0;
    this.activeGust = null;
    this.pointerId = null;
    this.sim.clear();
    for (const l of this.lines) l.fading = Math.max(l.fading, FADE * 0.7);
    this.showWhilePaused();
    this.store.set({ active: 0 });
  }

  /** The wind textures refresh on sim steps, so a change made during a pause needs one to show. */
  private showWhilePaused(): void {
    if (this.sim.paused) this.sim.step();
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
    this.store.set({ active: 0, strength: 'gust', hint: true, tuning: DEFAULT_TUNING, demo: false });
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
    this.unsubscribe();
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
    this.clouds?.dispose();
    this.cyclist?.dispose();
    this.shadowTex?.dispose();
    this.terrainLightTex?.dispose();
    this.flowers.dispose();
    this.groundDispose();
    this.windTex.dispose();
    this.compositor.dispose();
    this.line.dispose();
    this.renderer.dispose();
  }
}
