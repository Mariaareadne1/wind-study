# WIND STUDY — progress

Resume with: `npm install`, `npm run dev` (port 5428), `npm test`, `npm run test:e2e`.

## Status
All milestones M0–M10 complete, plus a second version: Hills (`?scene=hills`). Repo: `Mariaareadne1/wind-study` (private), branch `main`. Live at https://wind-study.vercel.app (CLI deploys, no Git integration). The live site is older than `main`: redeploy to get Tune, border and demo.

## Test results (2026-11-05)
- Unit: 53 passing
- E2E Chromium (real GPU): 49 passing, including 11 visual snapshots
- E2E against the production build: 23 functional tests passing (visual snapshots not run there)
- WebKit and Firefox smoke test: passing

## Known limitations
- Not measured on a real phone or an integrated GPU; touch tested in emulation only.
- WebKit and Firefox have a smoke test only, in Playwright's builds, not Safari itself.
- Browser tests have not completed against the live URL; only an HTTP 200 and security headers were checked there.
- Wind on the far hills fades a little near the field's edge (z below about -26), where the air is damped.
- Motion was judged from frame sequences, motion maps and metrics. A person should judge the feel live.
- Resizing past a 5% aspect change regenerates strands: a brief hitch and a change of fine detail.
- Reference images were never available.
- Sim runs on the main thread (about 3.3 ms per step on an M2 Pro).

## Next steps
Live feel review and a real-phone test. Redeploy with `npx vercel --prod`, then run the tests with E2E_URL set.


## Sunlit rebuild (branch `sunlit`), photorealistic pass — 2026-11-16

Target: `references/meadow_target_reference.png` (the first photograph supplied; gitignored). The earlier render is kept as
`references/meadow_current_result.png`. Compare with `node scripts/vs.mjs artifacts/vs/name [steps] [extra query]`,
which renders `?compare&scene=sunlit` at the reference's exact 842×1582 frame. Add `bare` to see the land without grass.

### Done
- Rider and track hidden until the landscape is right (clouds are back, see below).
- Terrain rebuilt as soft asymmetric waves that sweep diagonally, calm in the foreground (`sunlitHeight`).
- Baked terrain light (`src/scene/terrainLight.ts`): sky occlusion from the horizon in 12 directions, sun self-shadow,
  and the surface normal. Valleys are dark because of their shape.
- Linear-light rendering for this scene: half-float target, ACES tonemap, sRGB output. Grass is lit as a canopy by the
  terrain normal, with fibre texture on top.
- Grass: shorter and denser, combed along the contours of the waves, upright and tufty on the flat, restrained highlights,
  natural albedos (`grass`, `gold`, `moss`).
- Meadow and Hills are unchanged (their snapshots still match).

### Grass pass 2
- Wave fronts are told apart from the slope they ride on (`sunlitClimb`), and carry slightly longer, more swept grass
  with a cool sky sheen and softer edges. Crests and backs stay short and fine.
- Lessons from the bisect. From this low camera, lying blades are foreshortened and upright ones show their full
  length, so lean controls apparent length. Fronts face the camera and fill about half the frame, so a strong front
  effect changes half the picture.
- Fixed: the per-blade "swept" value had been overwritten by an older random value, which softened every blade.

### Clouds
- Three cumulus in the photograph's layout (big upper left, medium right, small lower left), each raymarched once into
  its own half-float image (`src/scene/Clouds.ts`) and drawn as a card that slides with the slow drift. The frame pays
  nothing for the volume. A bake costs about 0.18 s at 2880×1800, so rebakes on resize wait out a drag (180 ms).
- Shape (`src/scene/cloudShape.ts`): a flat-based half-ellipsoid core with up to 64 cauliflower heads on its surface,
  smooth-unioned, eroded by warped billow noise, and cut flat at the condensation level.
- Light: Beer-Lambert toward the light with three scattering octaves, a mild forward/back phase, blue sky from above and
  grey light from the land below. The forms are modelled by a key from the upper right (`cloudKey`). Shadows are cast
  by a higher light (`cloudSun`) so each falls close under its cloud, as in the photograph. The land keeps its own sun.
- Shadows are baked on the CPU through the same field and feed the existing flow texture, so grass and ground darken
  under them.
- Shadow bake is about 0.5 s on the main thread at startup (228×156 texels). The clouds are rebaked after a lost
  graphics context is restored.
- Tests: 63 unit (3 new for cloud shape and shadows), 51 e2e (the Sunlit test now checks three clouds render white).
- 60 fps held at 2880×1800 with clouds on (16.7 ms median, vsync-limited, load about 14).
- Comparison: `docs/media/sunlit-rebuild/30-clouds-vs.jpg`, `30-cloud-close-vs.jpg`.
- Refinement pass: the core is now a dome that narrows toward its crown (`TAPER`), with heads riding its surface and
  a few big crown heads piled off-centre, so the outline rises to a crown instead of sagging between lobes. The clouds
  are wider and lower, closer to the photograph's proportions. Fine noise is halved and the body is denser, so the
  interior reads as billows rather than smoke. They are modelled from nearly overhead (`cloudKey`).
- The cloud box now allows for the smooth union swelling past its parts, so nothing can be clipped flat.
- A cloud overhead also hides part of the sky, so grass and ground under a shadow lose some ambient light too. The big
  cloud's shadow now reads even on the dark wave front.
- Comparison: `docs/media/sunlit-rebuild/31-clouds-vs.jpg`, `31-cloud-close-vs.jpg`.
- Still open: the target's rims are softer and more feathered than ours.

### Visual issues still open
- Up close our blades are crisper and more brushed than the target's soft, slightly blurred grass.
- Frame cost is about 16.5 ms median at 2880×1800 (450k strands, measured at load about 8). Density is now 1.1
  (396k strands); its timing was taken at load 38 and isn't meaningful.

### Next, in order
1. Rider: small, realistically proportioned.
2. Cursor breeze: a soft local wind that follows the pointer.
3. Optional: a final grass pass (softer blades up close).

## Portfolio hero (`?scene=portfolio`), branch `sunlit` — started 2026-11-16

Target: `design/reference/portfolio_hero_target.png` (1914 × 1048 as supplied; the brief said 1672 × 941, same ~16:9
shape). Compare with `scripts/hero.sh name [extra query]`: renders `?compare&scene=portfolio` at 1914 × 1048, DPR 1
(a real desktop hero's CSS size, so the grass budget matches), and stacks it under the target
(`artifacts/vs/name-st.jpg`). `node scripts/regions.mjs render.png` prints mean colour per region against the target.
Add `bare` to see the land alone.

### Current milestone
8 of 8: polish and delivery. Milestones 1–7 are done; the remaining visual gaps are listed below.

### Visual breakdown of the target
- **Landscape:** no sky. Grass-covered swells fill the frame, with crests rising gently to the right in long S-curves.
  The upper left is dark folded hills. A dark trough runs under the big cloud, rising right. A lit crest crosses the
  middle. A second dark trough sits under the lower clouds. The foreground is a broad, warm, lighter slope (bottom
  right), with a few tiny white flowers at the bottom left.
- **Grass:** long, silky strands (100–200 px at 1914 wide, 2–3 px thick) gathered into flowing locks, with visible
  gaps of shade between them and light catching the tips. The direction follows the swells. Colour is olive: means
  around (85,105,60) to (118,134,55) sRGB, with green only 15–25% over red and real blue. Never lime.
- **Clouds:** three, low over the land. A large one in the upper middle (x 38–72%, y 9–32%). A broad, luminous one in
  the middle right (x 60–96%, y 34–62%). A small one lower middle (x 42–56%, y 58–70%). Soft feathered rims and
  bright tops. Shadows fall below and a little left of each.
- **Panel:** thick, smoky, green-tinted glass at x ≈ 6–35%, y ≈ 24–71%, corner radius about 50 px. It has a thin
  bright rim, visible refraction at the edges, and sharp cream text.
- **Camera:** fixed, raised about 35°, looking down onto the swells. The land feels large.

### Rendering strategy: approach A (the existing 3D scene, improved)
- A first render of the Sunlit engine in the wide frame already reached the right family: diagonal swells, deep
  troughs, a lit foreground. It has real 3D wind, cloud shadows that agree with the clouds, and no image to distort.
- Approach B (a hybrid over a painted plate) would need a clean, panel-free plate of the target. I can't produce a
  faithful one, and faking it (cloning or blurring over the panel) is ruled out. So it stays a fallback only.

### Done so far
- `src/scene/portfolio.ts`: bigger, fewer swells than Sunlit, with crests rising right and long S-bends; a fixed
  raised camera (35° on desktop, steeper for tall windows).
- `PORTFOLIO` profile in `src/scene/profiles.ts`, reusing the Sunlit engine.
- Combed grass (`long.combed`): every blade lies over along the land (`makeFlow(..., combed)`), gathered into locks
  that vary in lift, length and tone (`tufts.ts`, drawn only when combed, so other scenes are unchanged).
- The ground under thick grass is shaded (`canopy`), so the gaps between locks read as depth.
- Olive grade (saturation 0.76, warmer sun, exposure 1.1).
- Meadow, Hills and Sunlit unchanged: 63 unit tests pass, and the 20 snapshot and scene browser tests pass.

### Reference audit (all MIT)
- **glass-studies (own, MIT):** the final shader already refracts a texture of what is drawn beneath it
  (`src/glass/shaders.ts`): rounded-rect SDF, squircle bevel profile, refraction at IOR 1.52, dispersion, Fresnel rim
  and specular. Port it to sample the compositor's target. Do not use `.research/glass-gl` (AGPL).
- **zephyr (MIT, rether):** translucency, sheen and tip glint block; Voronoi dome clumping.
- **threejs-field-grass (MIT, Kissinger):** its wake field with ease-in and smootherstep recovery (about 0.9 s). It has
  no cursor wake of its own; the pointer has to be projected onto the ground.
- **liquid-glass-react (MIT):** its README says the shader was reverse-engineered from Apple's. Reuse the ideas
  (lens curve, mip blur) without copying its code.
- **liquidGL (MIT):** uses a DOM rasteriser for the backdrop. Not needed, since our backdrop is already a GPU texture.
- **volumetric-clouds (MIT):** weaker lighting than ours. Only its flat-bottom/tall-top idea is relevant.

### Clouds (milestone 4, first pass)
- Three clouds placed by projecting the target's screen positions onto the land (1914 × 1048). Sizes and positions
  are now within a few percent of the target.
- New per-scene cloud style (`CloudStyle`: gain, ambient, edge, fray, billows) and per-cloud `taper` and `core`.
  Sunlit's defaults are unchanged.
- Billow noise is sized to each cloud (`billows` per width), not in world units. In world units the wide portfolio
  clouds read as fur.
- The light on these clouds sat far past the tonemapper's white, so they were flat white. A gain of 0.42 lets the heads
  model. They are lit from the upper left (`cloudKey`), as in the target.

### Glass panel (milestone 5)
- `src/engine/glass.ts`: drawn inside the compositor's final pass, so it refracts the live landscape texture directly,
  with no extra copy of the frame and no read-back. Ported from glass-studies (MIT, own code): squircle bevel, IOR 1.52,
  dispersion toward the rim, a frosted body (24-tap rotated spiral), a milky rim band, Fresnel rim light, top streak,
  hairline, a pointer-following glint and a soft contact shadow.
- `src/hero/`: `PortfolioHero` (the renderer's lifecycle, glass placement, loading and fallback), `IntroPanel` (HTML
  text and navigation), `content.ts` (text and links as data, with `safeHref`), `HeroPage` (the standalone page).
- Type: Newsreader at display optical size for the title (Instrument Serif was tried and read too condensed next to the
  reference), Inter Tight for the rest. Both are OFL, bundled locally. Sizes are container units of the panel.
- Links: Work, Playground and About go to `#work`, `#playground` and `#about` on the standalone page. The arrow opens the
  full Wind Study. All are overridable from the address (`?work=…`) or by passing `content`.

### Interaction (milestone 6)
- `src/interaction/HoverBreeze.ts`: an ordinary mouse move over the land drives a soft gust through the existing
  pipeline. It is 0.45 of a drawn gust, has no ink, ends after 140 ms of stillness, and is capped in length. Drag
  is unchanged.
- The panel sits over the canvas, so moving over it or clicking its links makes no wind (tested).
- On touch, the canvas has `touch-action: pan-y`: vertical swipes scroll the page; sideways drags make wind.
- Reduced motion: no hover breeze and no cloud drift; drags still work.
- Measured against an identical control run (`scripts/hover-check.mjs`): hover changes the swept band about twice the
  background difference and drag about twice hover. Both settle on their own.

### Responsive, loading, performance (milestone 7)
- Desktop keeps the reference's width of view at any 16:10 to 21:9 shape. Tall windows aim between the clouds,
  look further up the hill, and put the panel low and wide.
- Loading: a still captured from the renderer (`public/hero/still-wide.webp`, `still-tall.webp`) shows at once, with
  a frosted CSS stand-in for the glass. The live scene fades in when ready (about 2.6 s here). Without WebGL, or
  while a lost context recovers, the still and frosted panel stay (tested).
- Frame time on this Mac (vsync, live hero, load about 6): 1440 × 900 at 2× steady 60 fps idle and dragging;
  1920 × 1080 at 2× 60 fps median with some 33 ms frames; phone 390 × 844 steady 60 fps.
  `node scripts/hero-perf.mjs W H DPR`.

### Tests
- 63 unit, 60 browser (9 new for the hero: text and links, glass alignment, refraction, hover vs panel, drag, keyboard
  order, no-WebGL fallback, reduced motion, context loss and restore, phone layout). Meadow, Hills and Sunlit snapshots
  are unchanged. Production build passes.

### Grass pass (milestone 3, second round)
- The target's grass runs right and a little downhill, across the crests. Contour-following made our strands stand
  up into steep diagonal strokes. Combed grass now lies flatter (lean about 1.4) and follows a prevailing breeze
  toward the viewer's right, with contour-following at a third.
- The locks vary more in tone, with deeper troughs and brighter crests. The swells are taller (5.4), so the troughs read
  through the longer grass.
- Mean regional luminance gap to the target went from 21.6 to 10.7 (`scripts/regions.mjs`).

### Cloud pass (milestone 4, second round)
- The woolly, streaked look came from the noise warp stretching the billows, and from the union blending the heads
  into one mass. Both are now per-scene (`warp`, `blend`). The portfolio uses a light warp (0.25) and a sharp union
  (18), so each head stays a distinct rounded billow with a grey crease. Sunlit keeps its defaults (0.8, 10).

### Delivery (milestone 8)
- Final images: `docs/media/portfolio/final-desktop.jpg`, `final-phone.jpg`, `final-vs-target.jpg`; recording
  `docs/media/portfolio/hero-interaction.mp4` (hover, then drag; `node scripts/hero-film.mjs out.mp4`).
- Integration notes: `docs/PORTFOLIO_HERO.md`.
- Preview deployment: https://wind-study-hbyi693ii-mariashowalter1819-4477s-projects.vercel.app/?scene=portfolio
  (behind Vercel sign-in; the same production build passes the 9 hero tests locally with `E2E_PROD=1`).
  Production (wind-study.vercel.app) is unchanged.

### Remaining visual differences (largest first)
1. Clouds: the target's tails are wispier and its undersides flatter and greyer; the middle-right cloud's right end is
   still a little boxy.
2. The target's glass has a slightly organic, liquid edge with bright blobs; ours is a clean rounded rectangle.
3. The small white wildflowers at the lower left are not there.

## Hybrid image-directed hero (`?scene=portfolio-hybrid`), branch `portfolio-hybrid` — started 2026-11-16

Brief: `/Users/mariashowalter/Downloads/Wind_Hybrid_Claude_Prompt.md`. Stop rebuilding a synthetic landscape: show
the approved picture and animate only its fine grass detail. The procedural hero (`?scene=portfolio`) stays on
`sunlit` and here, untouched.

### Assets
- `design/reference/approved-hero-reference.png` (1672 × 941): the approved design, with panel and text baked in.
  Reference only; never shown.
- `design/reference/clean-landscape.png` (1672 × 941): a separately generated landscape with no panel. It is very close
  to the approved image but **not pixel-identical**: a little brighter and more saturated, with small differences in
  the grass.
- `public/hybrid/clean-landscape.webp`: the plate as shipped, WebP quality 95, 545 KB, 47.4 dB PSNR against the PNG.
- `public/hybrid/grass-mask.png`: authored by `scripts/hybrid-mask.mjs`, with a debug view in
  `artifacts/hybrid-mask-debug.png`. It combines a colour key for bright, unsaturated pixels (clouds, flowers),
  hand-placed feathered ellipses over each cloud and its rim, then dilation and a soft feather. About 80% of the
  picture may move.
- The prototype's `grass-detail.png` is not used: the detail is computed on the GPU from the plate's own mip levels,
  so there is no second, lossy image.

### Prototype audit
- Its mask was a global green threshold, which the brief calls temporary.
- An always-on sine wave shifted the detail everywhere, with no bevel or proper refraction in its glass.
- It had its own CPU spring field. Kept from it: the idea of warping only the high-pass detail.

### Architecture (`src/hybrid/`)
- `plate.ts`: one full-screen pass with a cover fit around a focal point. Output is
  `plate + mask × [highpass(p − shift) − highpass(p)]`, with `highpass = plate − mip level 2`. At zero wind it is
  the plate. The shift fades out within a few pixels of the picture's edges.
- `HybridApp.ts`: Wind Study's own `WindSim` (fixed 60 Hz, two-spring grass response, gusts, ambient breeze) mapped
  onto the plate, with the plate spanning the field's width. `WindTextures` uploads the bend. Drag makes a full gust;
  `HoverBreeze` makes the soft one. The same `Compositor` draws the glass over the result.
- `HybridHero.tsx`, `HybridPage.tsx`, `hybrid.css`: the shared `IntroPanel` and `useGlassPanel`. The still and the
  no-WebGL fallback are the same plate, placed by CSS `background-position` at the same focal point (identical to
  `coverFit`).
- Shared changes: the compositor gained `setGlassLook` (frost, milk, tint, haze) and `setVignette`. The portfolio
  hero's look is unchanged (its defaults reproduce the earlier constants). `useGlassPanel` now serves both heroes.

### Milestone 2: image-faithful still — done
- At 1672 × 941, with zero wind and outside the panel, the render matches the plate to WebP precision: median 2, 99th
  percentile 9, max 47 (scattered compression artifacts), 41.3 dB (`node scripts/plate-diff.mjs render.png`).
- Composition against the approved image: `docs/media/hybrid/m2-still-vs-approved.jpg`.
- Visible differences: the plate is a little brighter and more saturated than the approved image, and our glass is
  darker and clearer than the reference's lighter, frosted panel.

### Milestone 3: one-patch wind proof (the gate)
- Patch: 300 × 200 plate px around (1150, 780), bright foreground grass away from the clouds and the glass.
  `node scripts/hybrid-patch.mjs prefix drag|hover` steps the sim by hand and saves crops before, during, and 0.6,
  1.6 and 3.1 s after, plus a 4× difference map.
- Drag: mean change 8.55 inside the patch, 0 over the clouds, 0.03 over the far hills. Hover: 5.17 / 0 / 0.03.
  Grass bend rises from the ambient 0.051 to a peak of 0.12 about half a second after the stroke (the gust's air
  arriving), and is back to 0.067 by 3 s. No gusts are left.
- Evidence: `docs/media/hybrid/m3-patch-strip.png` (before → settled, native pixels), `m3-patch-diff.png`,
  `m3-patch-zoom.mp4` (2× zoom, real time, hover then drag), `m3-hero-interaction.mp4` (full frame).
- Bug found and fixed on the way: the warp sat in a per-pixel branch, and an implicit-derivative `texture()` inside
  it picked wrong mip levels where pixels disagreed. That drew thin dashed rings along the mask's soft edges
  (plainly visible on a phone) and noise on the top rows. Now every sample uses an explicit level, with no branch.
  The render at rest then matches zero wind exactly.
- **Honest read:** it passes the gate's measurable tests. Movement is local, it settles, it never tears, and clouds
  and ridges stay still. Visually the fine detail slides and shimmers coherently along the stroke; it reads as wind
  passing over grass, not as a rubbery warp. But it is still a sheet of detail moving, not individual blades bending
  from a root. The zoomed clip is the thing to judge it by.

### Milestone 4: whole scene and glass
- The validated technique runs across the whole plate through the authored mask. There is no separate direction
  field: the plate's own detail already carries the grass's rest direction, and the wind's direction comes from the
  pointer and the ambient breeze.
- Glass: the compositor's refraction (shared with the procedural hero), tuned lighter for the approved panel (frost
  14 px, milky rim 0.32, tint 0.6, haze 0.13): `docs/media/hybrid/m4-panel-vs-approved.jpg`.

### Milestone 5: polish
- Phone: the crop centres a little right (focus 0.66), keeping the big cloud and much of the second over the grass,
  with the panel low and wide.
- Frame time on this Mac: 1672 × 941 at 2× steady 60 fps idle and dragging; phone 390 × 844 steady 60 fps. Ready in
  about 0.8 s, against 2.6 s for the procedural hero.
- Tests: `tests/e2e/hybrid.spec.ts`, 7 tests:
  - the plate at rest, compared with the WebP decoded by the same browser;
  - a drag is local, never touches clouds or far hills, and settles;
  - hover versus panel;
  - panel geometry and glass alignment;
  - the no-WebGL fallback;
  - reduced motion;
  - the phone crop and `touch-action`.
- Full run: 63 unit, 67 browser, plus the 16 hero and hybrid tests on the production build.

### Remaining visible differences from the approved image
1. The plate is a separate generation: a little brighter and more saturated, with small differences in grass and
   cloud detail. It is not an inpainting of the approved image.
2. The glass body is a touch darker and clearer than the approved panel's lighter, milkier look, and its edge is a
   clean rounded rectangle without the reference's slight liquid wobble.
3. Grass motion is detail-only: convincing as a breeze, not as individual blades bending.
4. Clouds are part of the plate and stay still, as the brief asked.

### Blade-level motion (follow-up, 2026-11-16)
Goal: strands that move individually and bend from root to tip, instead of the detail sliding as one sheet.
- **Direction field:** `scripts/hybrid-flow.mjs` computes it from a structure tensor of the plate's luminance. The
  strand runs at right angles to the dominant gradient; the field stores the doubled angle and its coherence.
  Shipped as `public/hybrid/grass-flow.webp` (418 × 235, lossless, 186 KB). Debug view: `?debug=3`, and
  `artifacts/hybrid-flow-debug.png` with line glyphs.
- **Blade warp (`bladeShift` in `src/hybrid/plate.ts`):** in each strand's own frame, noise that changes every
  ~8 px across but slowly along the strand gives each one its own phase and strength (0.75–1.25). A smooth wave
  along the strand (110 px) stands in for root to tip, so tips travel and roots hold (reach 0.45–1). Blades sway
  across themselves more than they slide along themselves. The stiff spring flutters the tips. Total shift is capped
  at 6 plate px.
- **Bug found on the way:** the first version took strand coordinates from absolute plate pixels, so pixel-level
  wobble in the measured angle was magnified about 1700× into phase noise, and the grass turned to speckle. Each
  40 px tile now uses its own constant direction, and the four nearest tiles are blended.
- **Tuning by eye:** a 46 px root-to-tip wave curled strands into S-shapes; 110 px gives one bend per strand.
- **A/B:** `?motion=sheet` keeps the earlier motion. Evidence:
  - `docs/media/hybrid/blade-vs-sheet-crops.png`: before | sheet | blade, native pixels ×4, at the peak of a drag;
  - `blade-vs-sheet-zoom.mp4`: the same gestures, side by side, real time;
  - `blade-hero-interaction.mp4`.
- **Unchanged:** at rest the render still matches the plate (median 2, max 47); the drag still never moves clouds
  (0) or far hills (0.03); 60 fps on desktop and phone.
- **Tests:** a new browser test checks that blade and sheet agree at rest but differ in the strand-scale texture of
  the change. 63 unit and 68 browser pass, plus 8 hybrid on the production build.
- **Honest read:** strands now bend and move independently: clearly more grass-like than the sheet, and still with
  no tearing. At the peak of a hard drag, some patches soften or briefly double, because a warp can only move what
  the photo already shows; there is no geometry behind a blade. Hover and the ambient breeze stay well below that
  point.
