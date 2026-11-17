/** What the introduction panel says and where its links go. Everything is plain data, so a host page can supply its own. */
export interface HeroLink {
  label: string;
  href: string;
}

export interface HeroContent {
  name: string;
  /** The short year mark opposite the name, e.g. ’26. */
  year: string;
  title: readonly string[];
  description: readonly string[];
  links: readonly HeroLink[];
  /** The arrow at the end of the navigation: a real destination, with an accessible label. */
  arrow: HeroLink;
}

/**
 * Standalone defaults. The links are anchors on this page and the arrow opens the full Wind Study, so
 * nothing points at a route that does not exist; the portfolio passes its own destinations.
 */
export const DEFAULT_CONTENT: HeroContent = {
  name: 'Maria Showalter',
  year: `’${String(new Date().getFullYear()).slice(-2)}`,
  title: ['Design', 'Engineering'],
  description: ['Interactive systems, creative tools,', 'and experiments in code.'],
  links: [
    { label: 'Work', href: '#work' },
    { label: 'Playground', href: '#playground' },
    { label: 'About', href: '#about' },
  ],
  arrow: { label: 'Open the full Wind Study', href: '?scene=sunlit' },
};

/** Only http(s), same-page anchors and relative paths are allowed as destinations. */
export function safeHref(href: string): string {
  if (href.startsWith('#') || href.startsWith('?') || href.startsWith('/')) return href;
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' ? href : '#';
  } catch {
    return '#';
  }
}

/** Optional overrides from the address, for trying destinations locally: ?work=…&playground=…&about=…&arrow=…&year=… */
export function contentFromQuery(q: URLSearchParams, base: HeroContent = DEFAULT_CONTENT): HeroContent {
  const pick = (key: string, fallback: string) => {
    const v = q.get(key);
    return v ? safeHref(v) : fallback;
  };
  const year = q.get('year');
  return {
    ...base,
    year: year && year.length <= 6 ? year : base.year,
    links: base.links.map((l) => ({ ...l, href: pick(l.label.toLowerCase(), l.href) })),
    arrow: { ...base.arrow, href: pick('arrow', base.arrow.href) },
  };
}
