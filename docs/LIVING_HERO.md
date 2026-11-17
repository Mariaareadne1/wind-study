# Living portfolio hero

`/?scene=portfolio-living` on branch `portfolio-living`. The approved landscape, separated into layers that each do what
they would do in the world:

- clouds drift on slow, independent loops;
- their shadows move with them;
- wind shows in the grass as light.

No pixel of the photo is displaced, so nothing can read as gel or a warped picture.

## What is layered and what is live

| Layer | Made | Live behaviour |
| --- | --- | --- |
| Land (`public/living/land.webp`) | once, `scripts/living-layers.mjs`: clouds lifted out, holes filled | never moves |
| Clouds (`cloud-N.png`) | once: each cloud's own premultiplied sprite and matte | drifts on its own loop (59–83 s, at most about 20 px) |
| Shadows (`shadow-N.png`) | once: each cloud's silhouette, softened and flattened | the plate's shadow is divided out of the light and re-applied where the cloud now is |
| Grass light | live, in the shader (`src/living/scene.ts`) | bands of gust light travel downwind; only light changes, only on grass |
| Pointer wind | live: Wind Study's gust simulation (hover soft, drag strong) | local gust light along the pointer's path, fading as the grass springs settle |
| Glass and text | live: the shared compositor glass under HTML | refracts the scene behind the panel; text stays sharp |

## Run and check

```bash
npm run dev                                      # http://localhost:5428/?scene=portfolio-living
npx playwright test tests/e2e/living.spec.ts     # 7 tests: rest fidelity, land never moves, light only on grass,
                                                 # local pointer wind, panel, fallback, reduced motion, phone
node scripts/living-film.mjs artifacts/living    # real-time, 15× time-lapse and foreground zoom, no input
node scripts/living-layers.mjs                   # rebuild the layers (debug view: artifacts/living-layers-debug.png)
```

Switches:

- `?still`: no pointer wind.
- `?life=0…3`: how strongly the wind shows in the grass.
- `?compare&panel`: a fixed frame, for tests and captures.

## Putting it on mariashowalter.com

Copy these, keeping their layout, and render the hero with your real destinations:

- `src/living/` (`LivingHero`, `LivingApp`, `scene.ts`);
- the shared `src/hero/` (panel, content, glass hook, CSS);
- `src/hybrid/plate.ts` (cover fit) and `hybrid.css` (panel layout);
- `src/engine/`, the Wind Study wind modules (`src/wind/`, `src/interaction/`), and `src/state/{store,tuning}.ts`;
- `public/living/`, `public/hybrid/clean-landscape.webp` (still and fallback) and `public/hybrid/grass-mask.png`.

```tsx
<LivingHero content={{ ...DEFAULT_CONTENT, links: [...], arrow: {...} }} />
```

Fonts: `@fontsource-variable/inter-tight` and `@fontsource-variable/newsreader/opsz.css`. Unmounting releases
everything.

## Known limits

- **The grass life is light, not geometry:** gusts read as wind passing over a field, the way it looks from this
  distance. Individual blades do not whip.
- **Cloud drift is very slow by design:** in a few seconds it is barely perceptible, and obvious in the time-lapse.
- **Cloud bases at their furthest drift:** a couple of small smudges show there, most visible on a phone, where the crop
  magnifies the picture about 1.8×.
- **The plate:** a separate generation, very close to the approved image but not identical.
