import { useEffect } from 'react';
import { LivingHero } from './LivingHero';
import { contentFromQuery } from '../hero/content';
import { Store } from '../state/store';
import type { WindApp } from '../app/WindApp';

/**
 * The living hero as a standalone page (?scene=portfolio-living). Switches:
 *   compare       no animation loop, no panel (add `panel` to include it); step it from tests
 *   interactive   pointer wind on the grass (off while the ambient scene is judged on its own)
 *   life=1.5      how strongly the wind shows in the grass (0–3, default 1)
 *   dpr           fixed device pixel ratio
 */
export function LivingPage() {
  const q = new URLSearchParams(location.search);
  const compare = q.has('compare');

  useEffect(() => {
    document.documentElement.classList.add('hero-mode');
    return () => document.documentElement.classList.remove('hero-mode');
  }, []);

  return (
    <div className="hero-page">
      <LivingHero
        content={contentFromQuery(q)}
        options={{ compare, showPanel: compare ? q.has('panel') : true, dpr: Number(q.get('dpr')) || undefined, interactive: q.has('interactive'), life: q.has('life') ? Math.min(3, Math.max(0, Number(q.get('life')) || 0)) : undefined }}
        onReady={(app) => {
          const store = new Store();
          store.set({ loading: false });
          // the same hooks the other scenes expose, so the capture and QA scripts work here too
          window.__wind = { app: app as unknown as WindApp, store, lib: {} as never };
        }}
      />
      {!compare && (
        <main>
          <section id="work" aria-labelledby="work-title">
            <h2 id="work-title">Work</h2>
            <p>Selected projects appear here when the hero is placed on the portfolio.</p>
          </section>
          <section id="playground" aria-labelledby="playground-title">
            <h2 id="playground-title">Playground</h2>
            <p>Experiments and studies, including the full Wind Study.</p>
          </section>
          <section id="about" aria-labelledby="about-title">
            <h2 id="about-title">About</h2>
            <p>A short introduction goes here on the portfolio.</p>
          </section>
        </main>
      )}
    </div>
  );
}
