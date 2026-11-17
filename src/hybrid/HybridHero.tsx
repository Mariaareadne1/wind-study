import { useEffect, useRef, useState } from 'react';
import { IntroPanel } from '../hero/IntroPanel';
import { DEFAULT_CONTENT, type HeroContent } from '../hero/content';
import { useGlassPanel } from '../hero/useGlassPanel';
import { HybridApp } from './HybridApp';
import '../hero/hero.css';
import './hybrid.css';

const PLATE_URL = '/hybrid/clean-landscape.webp';
const MASK_URL = '/hybrid/grass-mask.png';
/** The glass's optics in CSS pixels at the reference panel width (478 at 1672 wide). */
const GLASS = { referenceWidth: 478, radius: 48, bevel: 34, thickness: 26, maxRadius: 64 };

type Props = {
  content?: HeroContent;
  options?: { compare?: boolean; showPanel?: boolean; dpr?: number; debug?: number };
  onReady?: (app: HybridApp) => void;
};

type Phase = 'loading' | 'live' | 'fallback';

/** Where the crop centres on narrower windows: the clouds sit right of the middle. */
function focusFor(aspect: number): [number, number] {
  return aspect < 1 ? [0.66, 0.5] : [0.5, 0.5];
}

/**
 * The image-directed hero: the approved landscape as a photographic plate whose fine grass moves with
 * the wind, under refractive glass, with the introduction in real HTML. Without WebGL, the same plate
 * shows as a still with a frosted panel.
 */
export function HybridHero({ content = DEFAULT_CONTENT, options = {}, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const appRef = useRef<HybridApp | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [focus] = useState(() => focusFor(window.innerWidth / Math.max(window.innerHeight, 1)));
  const showPanel = options.showPanel ?? !options.compare;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let app: HybridApp | null = null;
    let disposed = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lost = (e: Event) => {
      e.preventDefault();
      setPhase('fallback');
    };
    const restored = () => {
      if (!disposed) {
        setPhase('live');
        app?.renderFrame();
      }
    };
    try {
      app = new HybridApp(canvas, { plateUrl: PLATE_URL, maskUrl: MASK_URL, focus, dpr: options.dpr, reducedMotion, debug: options.debug });
      appRef.current = app;
      canvas.addEventListener('webglcontextlost', lost);
      canvas.addEventListener('webglcontextrestored', restored);
      app
        .load()
        .then(() => {
          if (disposed || !app) return;
          onReady?.(app);
          if (options.compare) app.renderFrame();
          else app.start();
          setPhase('live');
        })
        .catch((e: unknown) => {
          console.error(e);
          if (!disposed) setPhase('fallback');
        });
    } catch (e) {
      // no WebGL (or it would not start): the still and the frosted panel carry the page
      console.error(e);
      queueMicrotask(() => {
        if (!disposed) setPhase('fallback');
      });
    }
    return () => {
      disposed = true;
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      app?.dispose();
      appRef.current = null;
    };
    // built once per mount; options are read at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const glassHandlers = useGlassPanel(appRef, panelRef, canvasRef, phase === 'live', showPanel, GLASS);

  return (
    <div className={`hero hybrid ${phase}`} style={{ ['--focus-x' as string]: `${focus[0] * 100}%`, ['--focus-y' as string]: `${focus[1] * 100}%` }}>
      <div className="hero-still" aria-hidden="true" />
      <canvas ref={canvasRef} className="hero-canvas" aria-label="Rolling hills of long grass under three low clouds. Move the pointer across the grass to stir a breeze; drag for a stronger gust." />
      {showPanel && <IntroPanel ref={panelRef} content={content} isLiveGlass={phase === 'live'} {...glassHandlers} />}
    </div>
  );
}
