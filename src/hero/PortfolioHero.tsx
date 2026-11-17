import { useEffect, useRef, useState } from 'react';
import { Store } from '../state/store';
import { WindApp } from '../app/WindApp';
import { PORTFOLIO } from '../scene/profiles';
import { IntroPanel } from './IntroPanel';
import { DEFAULT_CONTENT, type HeroContent } from './content';
import { useGlassPanel } from './useGlassPanel';
import './hero.css';

/** The glass's optics in CSS pixels at the reference panel width (553 at 1914 wide); they scale with the panel. */
const GLASS = { referenceWidth: 553, radius: 68, bevel: 50, thickness: 34, maxRadius: 80 };

type Props = {
  content?: HeroContent;
  seed?: number;
  /** Comparison and test switches, normally read from the address. */
  options?: { compare?: boolean; showPanel?: boolean; tufts?: number; dpr?: number; fixed?: boolean; bare?: boolean };
  /** Called once the renderer exists (tests and QA reach it through window.__wind). */
  onReady?: (app: WindApp, store: Store) => void;
};

type Phase = 'loading' | 'live' | 'fallback';

/**
 * A full-bleed landscape of long grass with an introduction on thick glass. The landscape is the
 * Wind Study renderer on its portfolio profile; the glass is drawn by its compositor, refracting
 * the live scene behind the panel; the text is HTML. Without WebGL the panel still reads, over a
 * still of the same landscape.
 */
export function PortfolioHero({ content = DEFAULT_CONTENT, seed = 7, options = {}, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const appRef = useRef<WindApp | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const showPanel = options.showPanel ?? !options.compare;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const store = new Store();
    store.set({ framed: false, uiHidden: true, hint: false, scene: 'portfolio' });
    let app: WindApp | null = null;
    let disposed = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // let the still and the panel paint first: building the grass takes a moment
    const handle = window.setTimeout(() => {
      try {
        app = new WindApp(canvas, store, {
          seed,
          profile: PORTFOLIO,
          tufts: options.tufts,
          dpr: options.dpr,
          fixedQuality: options.fixed,
          bare: options.bare,
          reducedMotion,
        });
        appRef.current = app;
        store.set({ loading: false });
        onReady?.(app, store);
        if (options.compare) app.renderFrame();
        else app.start();
        if (!disposed) setPhase('live');
      } catch (e) {
        console.error(e);
        if (!disposed) setPhase('fallback');
      }
    }, 30);
    // a lost graphics context shows the still and the frosted panel until the renderer recovers
    const unsubscribe = store.subscribe(() => {
      if (disposed || !appRef.current) return;
      setPhase(store.get().error ? 'fallback' : 'live');
    });
    return () => {
      disposed = true;
      clearTimeout(handle);
      unsubscribe();
      app?.dispose();
      appRef.current = null;
    };
    // the renderer is built once per mount; options are read at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const glassHandlers = useGlassPanel(appRef, panelRef, canvasRef, phase === 'live', showPanel, GLASS);

  return (
    <div className={`hero ${phase}`}>
      <div className="hero-still" aria-hidden="true" />
      <canvas ref={canvasRef} className="hero-canvas" aria-label="Rolling hills of long grass under three low clouds. Move the pointer across the grass to stir a breeze; drag for a stronger gust." />
      {showPanel && (
        <IntroPanel
          ref={panelRef}
          content={content}
          isLiveGlass={phase === 'live'}
          {...glassHandlers}
        />
      )}
    </div>
  );
}
