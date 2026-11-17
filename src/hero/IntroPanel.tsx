import type { Ref } from 'react';
import { safeHref, type HeroContent } from './content';

type Props = {
  content: HeroContent;
  ref?: Ref<HTMLElement>;
  /** The live glass is drawn by the renderer; until then (or without WebGL) CSS gives a frosted stand-in. */
  isLiveGlass: boolean;
  onPointerMove?: (x: number, y: number) => void;
  onPointerPresence?: (inside: boolean) => void;
};

/**
 * The introduction: sharp, accessible HTML laid over the glass the renderer draws.
 * Pointer events here never reach the canvas, so reading or clicking makes no wind.
 */
export function IntroPanel({ content, ref, isLiveGlass, onPointerMove, onPointerPresence }: Props) {
  return (
    <section
      ref={ref}
      className={isLiveGlass ? 'intro live' : 'intro'}
      aria-labelledby="intro-title"
      onPointerMove={(e) => onPointerMove?.(e.clientX, e.clientY)}
      onPointerEnter={() => onPointerPresence?.(true)}
      onPointerLeave={() => onPointerPresence?.(false)}
    >
      <div className="intro-body">
        <header className="intro-meta">
          <p className="intro-name">{content.name}</p>
          <p className="intro-year">
            <span className="visually-hidden">Year </span>
            {content.year}
          </p>
        </header>
        <h1 id="intro-title" className="intro-title">
          {content.title.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p className="intro-description">
          {content.description.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
        <nav className="intro-nav" aria-label="Main">
          <ul>
            {content.links.map((l) => (
              <li key={l.label}>
                <a href={safeHref(l.href)}>{l.label}</a>
              </li>
            ))}
          </ul>
          <a className="intro-arrow" href={safeHref(content.arrow.href)} aria-label={content.arrow.label} title={content.arrow.label}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M6.5 17.5 17.5 6.5M8.5 6.5h9v9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </nav>
      </div>
    </section>
  );
}
