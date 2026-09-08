# Browser and visual tests

The fixture bundles the real library source and renders the shipped GLB, water,
sky, textures, and GPU text atlas. Its deterministic 110-item catalogue exercises
all ten depths without depending on aleyan.com or an external server. A bundled
OFL-licensed Atkinson Hyperlegible font keeps text measurements reproducible.

## Run locally

```sh
bun install
bun run test:install
bun run check                   # source/test typechecks, unit tests, demo build
bun run test:unit:coverage       # text summary and coverage/lcov.info
bun run test:browser             # interaction and layout tests in all four profiles
bun run test:performance         # frame budgets, with animated water
bun run test:screenshots         # reviewed Linux snapshots; requires Docker
bun run test:all                 # all of the above (without the coverage repeat)
```

`bun test` is intentionally scoped to `tests/unit` by `bunfig.toml`. Browser
specs use Playwright and cannot accidentally run under Bun's unit test runner.

The four profiles are Chrome for Testing and Firefox at 1280×900 and 390×844.
Chrome for Testing and Firefox are pinned by `@playwright/test` 1.63.0. To check
an installed stable Chrome as well:

```sh
ICEBERG_CHROME_CHANNEL=chrome bun run test:browser --project=chrome-desktop
```

Firefox mobile means a narrow viewport with touch support. Playwright does not
support Firefox's `isMobile` emulation. Chrome mobile additionally tests native
CDP touch swipes across a pinned description and tap-to-close. These are browser
emulations, not tests on physical Android/iOS devices.

## What is checked

- Orbit, Arc, and List: label placement, fixed world heights, list centering and
  equal world spacing, selector position/font/menu layout, and deep-link retention.
- Description placement at desktop, phone, 320 px width, and landscape sizes.
  A selected description must remain visible after resizing.
- Wheel scrolling over an open description, continued descent to the last item,
  and no premature movement of an embedding page.
- Mouse focus and navigation without a wheel: arrows, Page Up/Down, Space,
  Shift+Space, and Home/End, in every view and browser profile.
- No scrollbars on the standalone page or inside the viewer, menu, or description.
  The assertions check overflow styles and scroll dimensions, including overlay
  scrollbars that consume zero width. They also check unintended scroll offsets.
  The embedding-page test deliberately permits that page's own vertical scrollbar.
- Disposal and uncaught browser exceptions.
- Surface and underwater screenshots for every view, plus menu and description
  screenshots in every browser/viewport combination. The canvas is included.

## Screenshot baselines

```sh
bun run test:screenshots:update
# Or update just one profile:
bun run test:screenshots:update --project=firefox-mobile
```

Review the images under `tests/browser/screenshots/linux/` and commit intentional
changes. A normal test run neither creates missing baselines nor accepts changes.
The 0.2% pixel allowance accommodates small rasterization differences while
retaining checks for label, camera, menu, and tooltip regressions.

The screenshot commands build `tests/browser/Dockerfile` and run under Xvfb in
Linux, matching CI: amd64 for Chrome for Testing and arm64 for Firefox. The source is bind-mounted; an anonymous Linux
`node_modules` volume keeps container dependencies out of the host installation.
The Chrome image uses emulation on Apple Silicon; the Firefox image uses
emulation on Intel hosts. This can be slower than native execution. Browser revisions, the
Dockerfile, and the CI image must be updated together.

Screenshot tests freeze the water's time, cap visual-only frame submissions at
5 Hz, wait for assets/fonts and projected labels to settle, then pause the fixture's animation scheduling during image
readback. Underwater captures start from a fresh deep-linked mount so the camera pose
is exact. Pausing avoids wasting software-renderer CPU on identical frames.
Layout and performance tests never cap or pause the renderer; performance tests always animate the water.

## Performance

Each browser/view runs alone with one worker. After warming the scene, the test
sends 90 native wheel events across the names and records the actual renderer's
animation callbacks. It checks that labels moved and rendering continued, then
attaches every sample and a JSON summary to the report.

The local hardware profile requires p95 frame intervals below 34 ms, no frame
above 200 ms, p95 callback work below 16 ms, and fewer than 5% of intervals above
50 ms. CI interaction and performance tests use a 0.25 device scale factor to
bound software-rendering fill cost on runners without a GPU; their desktop and
mobile CSS viewport sizes remain unchanged. Screenshots explicitly use 1, as do
native GPU performance runs. The scale factor is included in performance reports.
The CI software-WebGL profile first measures the scene at rest, then
limits the additional cost of scrolling: p95 intervals must stay below 1.35×
the idle p95 plus 10 ms (with a 100 ms floor and 500 ms ceiling), p95 callback
work gets at most 8 ms extra (12–50 ms bounds), no frame may exceed one second,
and fewer than 15% of frames may exceed 1.25× the idle p95 plus 10 ms (50 ms
floor). Both baseline and scrolling samples are attached to the report. This
checks scroll regressions without pretending a software renderer is a 60 Hz GPU.
Use `ICEBERG_PERF_PROFILE=ci` to reproduce that profile. Architecture emulation
is unsuitable for performance measurements; use the native `test:performance`
command locally. CI runs each browser on its native architecture. Do not run other GPU-intensive work alongside a hardware
performance measurement. A passing synthetic test does not replace a profile on
an affected user's device.

## CI and failures

CI runs units/typechecks/build plus one isolated container job per browser
profile, covering interactions, screenshots, and performance. There are no
automatic retries to hide intermittent failures. Reports, performance JSON,
failure screenshots, and traces are retained as artifacts for 14 days.

```sh
bun run test:report
bun x playwright show-trace path/to/trace.zip
```

Local test artifacts are in `test-results/local/`; container/CI artifacts are in
`test-results/ci/`. The HTML report is in `playwright-report/`. All are ignored by
Git. Tests, browser dependencies, screenshots, and fonts are excluded from the
published npm tarball.

References: [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots),
[mobile emulation options](https://playwright.dev/docs/api/class-testoptions#test-options-is-mobile),
[container setup](https://playwright.dev/docs/docker).
