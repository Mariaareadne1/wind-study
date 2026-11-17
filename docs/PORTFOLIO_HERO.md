# Portfolio hero: integration notes

The hero is a self-contained React component inside Wind Study, ready to move into mariashowalter.com.
Standalone, it runs at `/?scene=portfolio`.

## Using it

```tsx
import { PortfolioHero } from './hero/PortfolioHero';
import { DEFAULT_CONTENT } from './hero/content';

<PortfolioHero
  content={{
    ...DEFAULT_CONTENT,
    year: '’26',
    links: [
      { label: 'Work', href: '/work' },
      { label: 'Playground', href: '/playground' },
      { label: 'About', href: '/about' },
    ],
    arrow: { label: 'Get in touch', href: 'mailto:…' },
  }}
/>
```

- `content` is plain data. Hrefs pass through `safeHref`, which allows only http(s), mailto, `#`, `?` and `/` links.
- The hero fills its parent's width and `100dvh` height, and lets the page scroll on past it.
- Its lifecycle is complete. Unmounting disposes the renderer, its render targets, textures, materials, listeners, timers
  and animation frame.

## What to copy

| Path | What it is |
| --- | --- |
| `src/hero/` | `PortfolioHero`, `IntroPanel`, `content.ts`, `hero.css` (and `HeroPage.tsx` as an example page) |
| `src/app/WindApp.ts` and its imports (`src/engine`, `src/grass`, `src/scene`, `src/wind`, `src/interaction`, `src/state/store.ts`, `src/state/tuning.ts`) | The renderer. The hero uses the `PORTFOLIO` profile from `src/scene/profiles.ts`. |
| `public/hero/still-wide.webp`, `still-tall.webp` | Stills of the same landscape, shown while loading and without WebGL |

Dependencies are `three`, `react`, `@fontsource-variable/inter-tight` and `@fontsource-variable/newsreader`, both OFL.
Import the fonts once in the app entry:

```ts
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/newsreader/opsz.css';
```

## How it is built

- **Landscape:** the Wind Study renderer on the `PORTFOLIO` profile (`src/scene/portfolio.ts`): rolling swells, combed
  long grass, three baked raymarched clouds with cast shadows, linear light with an ACES finish.
- **Glass:** `src/engine/glass.ts`, drawn inside the compositor's final pass. It refracts the live scene texture
  directly, with no extra copy of the frame and no reads back to the CPU. The panel's box is measured from the DOM
  (`ResizeObserver`, font load, window resize) and passed to `app.setGlass()` in CSS pixels.
- **Text:** ordinary HTML over the glass. It stays sharp, selectable and accessible.
- **Wind:** a mouse moving over the land without pressing makes a soft breeze (`src/interaction/HoverBreeze.ts`); a
  drag makes a full gust. The panel blocks both. On touch, vertical swipes scroll the page.

## Fallbacks

- **Loading:** the still and a frosted CSS panel show at once, and the live scene fades in when ready.
- **No WebGL, or a failed start:** the still and frosted panel stay; text and links work.
- **Lost graphics context:** the hero shows the still until the context is restored, then returns to live.
- **`prefers-reduced-motion`:** no hover breeze and no cloud drift; the ambient breeze is damped; a drag still works.

## Checking it

```bash
npm run dev            # then open http://localhost:5428/?scene=portfolio
npx playwright test tests/e2e/hero.spec.ts
scripts/hero.sh name panel               # render at the reference size, stacked under the target
node scripts/hover-check.mjs out hover   # pointer response against a control run
node scripts/hero-perf.mjs 1440 900 2    # live frame timing
```

Comparison switches on `?scene=portfolio`:

- `compare`: a fixed, unanimated frame with no panel.
- `panel`: shows the panel in compare mode.
- `bare`: the land without grass.
- `tufts`, `dpr`, `seed`: as elsewhere in Wind Study.

## Before it goes on the live site

- The stills are captures from the renderer. Re-capture them after any visual change:

  ```bash
  SCENE=portfolio W=1920 H=1080 DPR=1 node scripts/vs.mjs artifacts/vs/still-wide 600
  ```

  Do the same at 390 × 844, DPR 2, for `still-tall`.
- The bundle is about 240 kB gzipped, mostly three.js. On the portfolio, load the hero with `React.lazy` if it is not
  the first thing on the page.
