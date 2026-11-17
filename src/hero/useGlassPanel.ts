import { useEffect, useRef, type RefObject } from 'react';
import type { GlassRect } from '../app/WindApp';

/** Anything that draws the glass: the 3D hero's WindApp and the image hero's HybridApp. */
export interface GlassHost {
  setGlass(rect: GlassRect | null): void;
  setGlassPointer(x: number, y: number, presence: number): void;
}

/** The glass's optics at a reference panel width, in CSS pixels; they scale with the panel. */
export interface GlassOptics {
  referenceWidth: number;
  radius: number;
  bevel: number;
  thickness: number;
  maxRadius: number;
}

/**
 * Keeps the drawn glass on the panel's box (resize, font load, any layout change), and eases a
 * faint highlight toward the pointer while it is over the panel. Returns the panel's pointer handlers.
 */
export function useGlassPanel(
  host: RefObject<GlassHost | null>,
  panel: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>,
  isLive: boolean,
  isShown: boolean,
  optics: GlassOptics,
) {
  useEffect(() => {
    const app = host.current;
    const el = panel.current;
    if (!isLive || !app) return;
    if (!el || !isShown) {
      app.setGlass(null);
      return;
    }
    const place = () => {
      const r = el.getBoundingClientRect();
      const c = canvas.current!.getBoundingClientRect();
      const k = r.width / optics.referenceWidth;
      app.setGlass({ x: r.left - c.left, y: r.top - c.top, width: r.width, height: r.height, radius: Math.min(optics.radius * k, optics.maxRadius), bevel: optics.bevel * k, thickness: optics.thickness * k });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    void document.fonts?.ready.then(place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
    // the optics are constants of each hero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, isShown]);

  const glow = useRef({ x: 0, y: 0, target: 0, value: 0, raf: 0 });
  useEffect(() => {
    const g = glow.current;
    return () => cancelAnimationFrame(g.raf);
  }, []);
  const ease = () => {
    const g = glow.current;
    g.value += (g.target - g.value) * 0.12;
    host.current?.setGlassPointer(g.x, g.y, g.value);
    g.raf = Math.abs(g.target - g.value) > 0.004 ? requestAnimationFrame(ease) : 0;
  };
  const nudge = () => {
    if (!glow.current.raf) glow.current.raf = requestAnimationFrame(ease);
  };
  return {
    onPointerMove: (x: number, y: number) => {
      glow.current.x = x;
      glow.current.y = y;
      nudge();
    },
    onPointerPresence: (inside: boolean) => {
      glow.current.target = inside ? 1 : 0;
      nudge();
    },
  };
}
