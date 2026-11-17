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
2 of 8, composition and terrain, with early grass work.

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

### Remaining visual differences (largest first)
1. Clouds are still a little woolly and boxy next to the target's crisp cauliflower heads and wispy tails.
2. The grass is less voluminous and less curved than the target's locks, and its highlights are weaker.
3. A thin dark line on one crest at the right (a back face seen edge-on).
4. No glass panel or text yet.
