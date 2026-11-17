import { PointerSmoother } from './stroke';
import type { Gust } from '../wind/gust';
import type { WindSim } from '../wind/WindSim';

/** How the hover breeze feels. */
export interface HoverTuning {
  /** Strength relative to a drawn gust at the same setting (1 = as strong as dragging). */
  gain: number;
}

/** A pause this long ends the current breath of wind; the next movement starts a new one. */
const IDLE_MS = 140;
/** Long sweeps are cut into pieces of about this length, in world units, so no gust grows without bound. */
const MAX_LENGTH = 26;
/** Shorter than this, a breeze is dropped quietly rather than becoming a tap's outward breath. */
const MIN_LENGTH = 0.9;

/**
 * Moving the mouse over the land, without pressing, stirs a soft breeze that follows the pointer:
 * the same gust pipeline as drawing, at a fraction of the strength, with no ink. Its direction is
 * the pointer's own, so the grass leans the way the hand moved, and it dies away on its own.
 */
export class HoverBreeze {
  private gust: Gust | null = null;
  private smoother = new PointerSmoother();
  private lastT = 0;
  private idle = 0;

  constructor(
    private readonly sim: WindSim,
    private readonly worldAt: (clientX: number, clientY: number) => [number, number, number] | null,
    private readonly gain: () => number,
    private readonly tuning: HoverTuning,
  ) {}

  move(e: PointerEvent): void {
    const events = e.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e]) {
      if (!this.gust) {
        const at = this.worldAt(ev.clientX, ev.clientY);
        if (!at) continue;
        this.gust = this.sim.begin(this.gain() * this.tuning.gain);
        this.smoother = new PointerSmoother();
        this.smoother.push(ev.clientX, ev.clientY, 0);
        this.gust.addPoint(at[0], at[1], 0);
        this.lastT = ev.timeStamp;
        continue;
      }
      const dt = Math.max((ev.timeStamp - this.lastT) / 1000, 1 / 1000);
      this.lastT = ev.timeStamp;
      const [sx, sy] = this.smoother.push(ev.clientX, ev.clientY, dt);
      const at = this.worldAt(sx, sy);
      if (at) this.gust.addPoint(at[0], at[1], dt);
      if (this.gust.arcLength > MAX_LENGTH) this.end();
    }
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => this.end(), IDLE_MS);
  }

  /** The pointer stopped, left the land, or started drawing: let this breath of wind run out. */
  end(): void {
    clearTimeout(this.idle);
    const g = this.gust;
    this.gust = null;
    if (!g) return;
    if (g.arcLength < MIN_LENGTH) g.silence();
    else this.sim.end(g);
  }

  dispose(): void {
    clearTimeout(this.idle);
    this.gust = null;
  }

  get active(): boolean {
    return this.gust !== null;
  }
}
