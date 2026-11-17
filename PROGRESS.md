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
