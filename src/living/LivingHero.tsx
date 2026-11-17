import { useEffect, useRef, useState } from 'react';
import { IntroPanel } from '../hero/IntroPanel';
import { DEFAULT_CONTENT, type HeroContent } from '../hero/content';
import { useGlassPanel } from '../hero/useGlassPanel';
import { LivingApp } from './LivingApp';
import '../hero/hero.css';
import '../hybrid/hybrid.css';


const LAYERS = '/living';
/** The glass's optics in CSS pixels at the reference panel width (478 at 1672 wide). */
const GLASS = { referenceWidth: 478, radius: 48, bevel: 34, thickness: 26, maxRadius: 64 };

type Props = {
  content?: HeroContent;
  options?: { compare?: boolean; showPanel?: boolean; dpr?: number; interactive?: boolean; life?: number };
  onReady?: (app: LivingApp) => void;
};

type Phase = 'loading' | 'live' | 'fallback';

/** Where the crop centres on narrower windows: the clouds sit right of the middle. */
function focusFor(aspect: number): [number, number] {
  return aspect < 1 ? [0.66, 0.5] : [0.5, 0.5];
}

/**
 * The living hero: the approved landscape, separated into layers that each do what they would in the world
 * (clouds drifting, their shadows moving with them, wind showing as light in the grass), under refractive glass,
 * with the introduction in real HTML. Without WebGL the plate itself shows as a still with a frosted panel.
 */
export function LivingHero({ content = DEFAULT_CONTENT, options = {}, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const appRef = useRef<LivingApp | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [focus] = useState(() => focusFor(window.innerWidth / Math.max(window.innerHeight, 1)));
  const showPanel = options.showPanel ?? !options.compare;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let app: LivingApp | null = null;
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
      app = new LivingApp(canvas, { base: LAYERS, focus, dpr: options.dpr, reducedMotion, interactive: options.interactive, life: options.life });
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
    <div className={`hero hybrid living ${phase}`} style={{ ['--focus-x' as string]: `${focus[0] * 100}%`, ['--focus-y' as string]: `${focus[1] * 100}%` }}>
      <div className="hero-still" aria-hidden="true" />
      <canvas ref={canvasRef} className="hero-canvas" aria-label="Rolling hills of long grass under three low clouds. Move the pointer across the grass to stir a breeze; drag for a stronger gust." />
      {showPanel && <IntroPanel ref={panelRef} content={content} isLiveGlass={phase === 'live'} {...glassHandlers} />}
    </div>
  );
}
