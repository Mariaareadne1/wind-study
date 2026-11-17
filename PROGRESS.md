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

## Grass feasibility experiment (`?scene=grass-feasibility`), branch `experiment/soft-grass-feasibility` — 2026-11-16
A focused test of whether real-time 3D grass can reach the approved hero reference (`design/reference/approved-hero-reference.png`). The test uses one hillside (a ridge with a darker valley in front), one fixed camera at 1672×941 and one low sun. It has no clouds, glass, UI, image displacement or particles, and the reference image is never used as a texture.

**Verdict: NO-GO** for reaching the approved reference with real-time blade geometry. Details are under "Decision" below.

### Running it
- `npm run dev`, then go to http://localhost:5428/?scene=grass-feasibility&candidate=b&wind=breeze
- `candidate=a|b`, `wind=calm|breeze|gust` (wind scale 0.08 / 1 / 2.3), `compare` (no loop; frames rendered on request through `window.__grass.render(t)`), `dpr=`
- Stills: `node scripts/grass-shot.mjs <prefix> <a|b> <wind> [t...]`. Recordings and frame timing: `node scripts/grass-film.mjs <outdir> a b`. Both use a headless browser on the Metal GPU.

### Sources inspected and licences
| Source | What it is | Licence | Used how |
|---|---|---|---|
| WindSweptGrass (gist kitchenbeats/7e80e53e…) | three.js WebGL2 multi-LOD grass: a near detail grid, world blade clusters, distant cards, Bézier bend, scrolling-noise wind, governor | MIT, © 2026 J Hanlon / I Dream Of AI | Vendored as `src/feasibility/vendor/WindSweptGrass.js` with its licence; the only patch is a wind-strength uniform (9 marked "FEASIBILITY PATCH" lines). It is also the base of candidate B. |
| Revo Realms `src/entities/Vegetation/Grass.ts` (branch feat/new-world) and the blog | WebGPU/TSL compute grass with per-instance wind state | MIT, Aleksandar Gjoreski | Ideas only: root-to-tip colour, a base shade, flow-aligned blades. Its compute path cannot run on WebGL2, and its damped per-instance wind state was **not** ported. |
| Zephyr (RetherSzu) `grass.vert` / `grass.frag` | GLSL grass shading | MIT | Ideas only: normals blended toward the terrain, soft translucency, tip highlight. |

No code was copied from Revo or Zephyr. The vendored files are excluded from lint because they are third-party.

### Candidates
- **A: WindSweptGrass as published.** The only tuning is its own colour uniforms, set to the reference's olive palette (root `#5E8236`, tip `#BCCB68`, far `#6B8C40`).
- **B: SoftGrass** (`src/feasibility/SoftGrass.js`, marked "SOFT GRASS"). It is the same architecture with these changes:
  - finer 6-segment tapered blades with a pointed tip;
  - terrain sampled for every layer;
  - blade normals blended 66% toward the terrain normal, so the hill's shape reads through the grass;
  - blades oriented along a coherent, noise-warped flow field, longer (×1.4) and thinner (×0.62);
  - a static lean along the flow;
  - a softer root-to-tip ramp, transmission reduced, and a faint warm tip highlight.

Both candidates bend blade geometry in the vertex shader, with the root fixed and displacement growing to the tip. Gust fronts are scrolling noise bands.

### Correction rounds (both used)
1. **Scale and shading.** At first most of the view was beyond the dense detail layer, so the grass looked sparse and bald. The hill was rescaled (×0.8), the camera moved closer, terrain-normal shading added and the palette set.
2. **Focus and light.** The detail field now centres on the viewed slope; sun and exposure were adjusted.

No visual tuning was done after round 2.

### Evidence (`docs/media/feasibility/`)
- Stills: `candidate-a.jpg`, `candidate-b.jpg`, `a-vs-b.jpg`, `reference-a-b.jpg` (reference top left, A top right, B bottom left).
- Recordings (10 s each, scaled to 960 px): `b-calm.mp4`, `b-breeze.mp4` (ambient), `b-gust.mp4`, `a-breeze.mp4`, `a-gust.mp4`.
- Motion analysis:
  - `slitscan-breeze-gust.jpg` shows one image row over 300 frames, breeze above and gust below. Gust shows diagonal bright bands, which are fronts travelling across the field. Breeze is mostly local sway.
  - `b-gust-macro.jpg` shows a 200×120 crop over 1.2 s: strands bend while their bases stay in place.
- Frame difference, mean |Δ| over 0.5 s (0–255):

  | | calm | breeze | gust |
  |---|---|---|---|
  | A | 3.6 | 15.6 | 25.1 |
  | B | 7.1 | 20.6 | 26.6 |

  Motion rises monotonically with the wind mode.

### Performance and stability (this Mac, Chromium on Metal, 1672×941, DPR 1)
- All six recordings (A and B × calm, breeze, gust): median frame time 16.7 ms and p95 ≤ 16.8 ms, which is the 60 Hz vsync cap, so the headroom above it was not measured.
- B breeze had a p99 of 33.3 ms (occasional single dropped frames).
- Scene size: about 2.9 M triangles for A and 5.9 M for B, 37–39 draw calls.
- No console errors and no WebGL warnings.
- Not measured on an integrated GPU or a phone. With 5.9 M triangles B is unlikely to hold 60 fps there without the governor dropping quality.

### Tests (2026-11-16)
- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 65 passing, including the new `tests/unit/hillside.test.ts` (the ridge stands above the valley; the terrain contract holds).
- `npm run build`: succeeds.
- E2E `stability.spec.ts` and `hero.spec.ts`: 17 passing (existing routes unaffected). There is no e2e spec for the feasibility route; its evidence is the capture scripts above.

### Honest weaknesses
- **A** reads as a game grass carpet: short, upright, randomly oriented blades with no sense of flowing grass. It is nowhere near the reference.
- **B** is clearly better than A: long, coherent, wind-combed grass, a legible ridge and valley, and believable gust fronts. Against the reference it still falls short:
  - it reads as fine hair or straw over a darker base, not the reference's thick, soft volume;
  - the reference's luminous, saturated sunlit swells and deep soft shadow pools are missing; B is darker and flatter in value;
  - there is a visible layer seam near the ridge crest (detail layer against the cluster layer);
  - the landscape scale is smaller than the reference's. Pulling back to the reference's scale moves most of the view beyond the dense layer, where coverage breaks down. That was the round 1 failure.
- The reference's look comes mostly from large-scale light: big soft swells, rim-lit crests, smooth shadow gradients. Per-blade geometry adds aliasing-prone fine detail at exactly the scale where the reference is smooth.

### Decision
**NO-GO** on building the hero from real-time grass geometry in pursuit of the approved reference.
- Both correction rounds are spent. B is a competent real-time meadow, but not the reference, and the gap is structural, not a matter of parameters. It comes from three things:
  - coverage and density at the reference's scale;
  - the soft volumetric quality of the light;
  - triangle cost.
- Closing it would need a different technique, for example:
  - a lit volumetric or shell layer for the mass of the grass, with blades only in the foreground;
  - or pre-rendered or baked lighting.

  Either is new research, not tuning.
- **What is usable:** B can serve as a secondary "live grass" study, or as a foreground layer, if a lower fidelity bar is acceptable.
- **Scope:** per the brief, the full website was not started.
