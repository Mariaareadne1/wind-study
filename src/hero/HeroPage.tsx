import { useEffect } from 'react';
import { PortfolioHero } from './PortfolioHero';
import { contentFromQuery } from './content';
import * as patterns from '../wind/patterns';
import { strandPoint, BEND_GLSL } from '../grass/bend';

/**
 * The hero as a standalone page (?scene=portfolio). Comparison switches:
 *   compare   fixed frame, no panel (add `panel` to include it), no animation
 *   bare      land without grass
 *   tufts, dpr, fixed, seed   as in the rest of Wind Study
 */
export function HeroPage() {
  const q = new URLSearchParams(location.search);
  const compare = q.has('compare');

  useEffect(() => {
    document.documentElement.classList.add('hero-mode');
    return () => document.documentElement.classList.remove('hero-mode');
  }, []);

  return (
    <div className="hero-page">
      <PortfolioHero
        content={contentFromQuery(q)}
        seed={Number(q.get('seed')) || 7}
        options={{
          compare,
          showPanel: compare ? q.has('panel') : true,
          tufts: Number(q.get('tufts')) || undefined,
          dpr: Number(q.get('dpr')) || undefined,
          fixed: compare || q.has('fixed'),
          bare: q.has('bare'),
        }}
        onReady={(app, store) => {
          window.__wind = { app, store, lib: { ...patterns, strandPoint, BEND_GLSL } };
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
