# WIND STUDY — progress

Resume with: `npm install`, `npm run dev` (port 5428), `npm test`, `npm run test:e2e`.

## Status
All milestones M0–M10 complete. Repo: `Mariaareadne1/wind-study` (private), branch `main`. Live at https://wind-study.vercel.app (CLI deploys, no Git integration). The live site is older than `main`: redeploy to get Tune, border and demo.

## Test results (2026-11-05)
- Unit: 44 passing
- E2E Chromium (real GPU): 40 passing, including 9 visual snapshots
- E2E against the production build: 23 functional tests passing (visual snapshots not run there)
- WebKit and Firefox smoke test: passing

## Known limitations
- Not measured on a real phone or an integrated GPU; touch tested in emulation only.
- WebKit and Firefox have a smoke test only, in Playwright's builds, not Safari itself.
- Browser tests have not completed against the live URL; only an HTTP 200 and security headers were checked there.
- Motion was judged from frame sequences, motion maps and metrics. A person should judge the feel live.
- Resizing past a 5% aspect change regenerates strands: a brief hitch and a change of fine detail.
- Reference images were never available.
- Sim runs on the main thread (about 3.3 ms per step on an M2 Pro).

## Next steps
Live feel review and a real-phone test. Redeploy with `npx vercel --prod`, then run the tests with E2E_URL set.
