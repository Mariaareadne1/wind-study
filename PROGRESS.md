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
- Clouds, rider and track hidden until the grass is right.
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

### Visual issues still open
- Up close our blades are crisper and more brushed than the target's soft, slightly blurred grass.
- Frame cost is about 16.5 ms median at 2880×1800 (450k strands, measured at load about 8). Density is now 1.1
  (396k strands); its timing was taken at load 38 and isn't meaningful.

### Next, in order
1. Final grass pass (length variation on wave crests, tuft clumping).
2. Clouds: photographic cumulus (irregular silhouettes, soft volume, grey-blue undersides).
3. Rider: small, realistically proportioned.
4. Cursor breeze: a soft local wind that follows the pointer.
