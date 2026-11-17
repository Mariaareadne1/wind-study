# Hybrid portfolio hero: integration notes

`/?scene=portfolio-hybrid` on branch `portfolio-hybrid`. The approved landscape is a photographic plate. Only its
fine grass detail moves with the wind; a refractive glass panel carries the introduction in real HTML.

## Run and test

```bash
npm run dev    # http://localhost:5428/?scene=portfolio-hybrid
npx playwright test tests/e2e/hybrid.spec.ts
node scripts/hybrid-patch.mjs artifacts/vs/patch drag   # one-patch proof: crops, diff, bend decay
node scripts/hybrid-film.mjs artifacts/hybrid-film       # real-time recording plus a 2× zoom of the patch
node scripts/plate-diff.mjs render.png                   # fidelity of a render against the clean plate
node scripts/hybrid-mask.mjs                             # re-author the grass mask (debug view in artifacts/)
node scripts/hybrid-flow.mjs                             # re-measure the strand directions (see the file for the final step)
```

Switches on the URL:

- `compare`: no animation loop and no panel; add `panel` to include it.
- `debug=1`: shows the mask.
- `debug=2`: shows the wind's bend field.
- `debug=3`: shows the strand directions.
- `motion=sheet`: the earlier single-layer motion.
- `dpr`: sets the pixel density.
- `?work=…&playground=…&about=…&arrow=…&year=…`: override the destinations and the year.

## Putting it on mariashowalter.com

1. Copy these into the site, keeping their relative layout:
   - `src/hybrid/` (`HybridHero`, `HybridApp`, `plate.ts`, `hybrid.css`);
   - `src/hero/` (`IntroPanel`, `content.ts`, `useGlassPanel.ts`, `hero.css`);
   - `src/engine/` (`Compositor`, `glass.ts`);
   - from `src/wind/`: `WindSim`, `WindTextures`, `field`, `response`, `gust`, `ambient`, `grid`;
   - `src/interaction/` (`HoverBreeze`, `stroke`);
   - from `src/state/`: `tuning.ts` and `store.ts` (only the defaults are used);
   - `public/hybrid/` (the plate, the mask and the strand direction field).
2. Dependencies are `three`, `react`, `@fontsource-variable/inter-tight` and `@fontsource-variable/newsreader`.
   Import the two fonts in the entry: `opsz.css` for Newsreader.
3. Render it with your real destinations:

   ```tsx
   <HybridHero content={{ ...DEFAULT_CONTENT, links: [...], arrow: {...} }} />
   ```

   It fills its parent's width and `100dvh`. Unmounting releases the renderer, textures, render targets, listeners
   and animation frame.
4. The still and the no-WebGL fallback are the plate itself, placed by CSS at the same crop. Nothing else is needed.

## What came from where

- **Wind Study (this repository):**
  - the wind simulation (fixed 60 Hz, gusts, two-spring grass response, ambient breeze) and its GPU textures;
  - the hover breeze;
  - the compositor;
  - the intro panel and its typography.
- **The author's `glass-studies` (MIT, own code):** the glass optics in `src/engine/glass.ts`: squircle bevel,
  IOR 1.52 refraction, dispersion, frosted body, milky rim, streak, hairline. Ported and adapted, with credit in the
  file.
- **The hybrid prototype bundle (the author's):** the clean plate and approved reference, and the idea of warping
  only high-pass detail. Not used: its `grass-detail.png` (the detail is computed from the plate's mip levels), its
  global green mask (replaced by an authored mask), its global sine motion and its CPU spring field (replaced by
  Wind Study's).
- **Read, no code used:**
  - liquidGL (MIT): it captures the DOM for its backdrop; ours samples our own render target.
  - threejs-field-grass (MIT): its wake and recovery ideas match what Wind Study's gusts already do.
- **Not opened:** parallax-maker (AGPL-3.0). No layer separation was needed, since the clouds stay in the plate.
- **Fonts:** Newsreader and Inter Tight, both SIL Open Font License, bundled through Fontsource.

No third-party source code is copied into this branch, so no extra licence notices are needed.

## Known limits

- **The plate is not the approved image:** it is a separate, very close generation, a little brighter and more
  saturated, with small differences in detail.
- **Grass motion is image-space:** strands bend from root to tip and move independently, along a direction field
  measured from the plate (`?motion=sheet` for the earlier single-layer motion). There is no blade geometry behind
  the photo, so at the peak of a hard drag some patches soften or briefly double.
- **Clouds:** they stay still (part of the plate).
- **The glass:** a clean rounded rectangle, slightly darker and clearer than the approved panel.
