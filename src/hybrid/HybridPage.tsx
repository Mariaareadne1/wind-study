import { useEffect } from 'react';
import { HybridHero } from './HybridHero';
import { contentFromQuery } from '../hero/content';
import { Store } from '../state/store';
import type { WindApp } from '../app/WindApp';

/**
 * The image-directed hero as a standalone page (?scene=portfolio-hybrid). Switches:
 *   compare   no animation loop, no panel (add `panel` to include it); step it from tests
 *   debug=1   show the grass mask (red: held still); debug=2 the wind's bend field; debug=3 strand directions
 *   strength=2   move the grass further (0–4, default 1), to make the effect easy to see
 *   motion=sheet   the earlier motion, the detail moving as one layer (default: blade by blade)
 *   dpr       fixed device pixel ratio
 */
export function HybridPage() {
  const q = new URLSearchParams(location.search);
  const compare = q.has('compare');

  useEffect(() => {
    document.documentElement.classList.add('hero-mode');
    return () => document.documentElement.classList.remove('hero-mode');
  }, []);

  return (
    <div className="hero-page">
      <HybridHero
        content={contentFromQuery(q)}
        options={{ compare, showPanel: compare ? q.has('panel') : true, dpr: Number(q.get('dpr')) || undefined, debug: Number(q.get('debug')) || 0, motion: q.get('motion') === 'sheet' ? 'sheet' : 'blade', strength: Math.min(4, Math.max(0, Number(q.get('strength')) || 1)) }}
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
