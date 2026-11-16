import { useEffect, useRef, useState } from 'react';
import { Store, useStore } from '../state/store';
import { loadStored, saveStored, tuningFromQuery } from '../state/tuning';
import { Controls } from '../ui/Controls';
import { WindApp } from './WindApp';
import * as patterns from '../wind/patterns';
import { profileFor } from '../scene/profiles';
import { strandPoint, BEND_GLSL } from '../grass/bend';

const lib = { ...patterns, strandPoint, BEND_GLSL };

declare global {
  interface Window {
    __wind?: { app: WindApp; store: Store; lib: typeof lib };
  }
}

const query = () => new URLSearchParams(location.search);

/** Settings come from the URL, then from this browser's last visit, then the defaults. */
function initialStore(): Store {
  const store = new Store();
  const q = query();
  const stored = q.has('manual') ? { tuning: store.get().tuning, framed: false } : loadStored();
  const frameParam = q.get('frame');
  store.set({
    tuning: tuningFromQuery(q, stored.tuning),
    framed: frameParam === null ? stored.framed : frameParam === '1',
    scene: profileFor(q.get('scene')).id,
    // ?demo is a clean stage for screen recording
    uiHidden: q.has('demo'),
    hint: !q.has('demo'),
  });
  return store;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(initialStore);
  const [app, setApp] = useState<WindApp | null>(null);
  const loading = useStore(store, (s) => s.loading);
  const error = useStore(store, (s) => s.error);
  const framed = useStore(store, (s) => s.framed);
  const scene = useStore(store, (s) => s.scene);

  useEffect(() => {
    if (query().has('manual')) return;
    return store.subscribe(() => {
      const s = store.get();
      saveStored(s.tuning, s.framed);
    });
  }, [store]);

  // keep the address in step with the version, so a reload or a shared link opens the same one
  useEffect(() => {
    const q = query();
    if ((q.get('scene') ?? 'meadow') === scene) return;
    if (scene === 'meadow') q.delete('scene');
    else q.set('scene', scene);
    const search = q.toString();
    history.replaceState(null, '', search ? `?${search}` : location.pathname);
  }, [scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const q = query();
    let built: WindApp | null = null;
    setApp(null);
    store.set({ loading: true, error: null });
    // paint the loading note first: the land takes a moment to bake
    const handle = window.setTimeout(() => {
      try {
        built = new WindApp(canvas, store, {
          seed: Number(q.get('seed')) || 7,
          profile: profileFor(scene),
          tufts: Number(q.get('tufts')) || undefined,
          dpr: Number(q.get('dpr')) || undefined,
          fixedQuality: q.has('fixed'),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        window.__wind = { app: built, store, lib };
        setApp(built);
        store.set({ loading: false });
        if (q.has('manual')) built.renderFrame();
        else built.start();
      } catch (e) {
        console.error(e);
        store.set({ loading: false, error: e instanceof Error ? e.message : 'The meadow could not start.' });
      }
    }, 30);
    return () => {
      clearTimeout(handle);
      built?.dispose();
    };
  }, [store, scene]);

  return (
    <div className={framed ? 'stage framed' : 'stage'}>
      <canvas ref={canvasRef} data-testid="meadow" aria-label="A hand-painted meadow. Draw on it to make the wind blow; keyboard users can press 1 to 4 for ready-made gusts." />
      <Controls store={store} app={app} />
      {loading && <p className="status" role="status">{scene === 'hills' ? 'Painting the hills…' : scene === 'sunlit' ? 'Growing the grass…' : 'Painting the meadow…'}</p>}
      {error && <p className="status error" role="alert">{error}</p>}
    </div>
  );
}
