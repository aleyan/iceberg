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
Linux ARM64 for both browsers, matching the `ubuntu-24.04-arm` CI runners.
The source is bind-mounted; an anonymous Linux
`node_modules` volume keeps container dependencies out of the host installation.
Both browsers run natively on Apple Silicon; Intel hosts use ARM64 emulation,
which can be slower than native execution. Browser revisions, the
Dockerfile, and the CI image must be updated together. Linux Chrome uses ANGLE's
OpenGL backend with Mesa software rendering; native local runs retain Chrome's
normal backend.

Layout and screenshot tests use Playwright's controlled clock. They advance
camera easing and the loading-indicator fade directly, then stop time between
commands. Screenshots still render the real scene at full resolution. Existing
Chrome desktop Orbit/List baselines include a hover preview; those tests now
select that hover state explicitly instead of relying on Xvfb's initial pointer.

A worker retains one loaded scene per viewport/device-scale configuration.
Before every case, `openIceberg` resets the embedding layout, page scroll,
selection, focus, view, and orientation through public APIs/events. It waits for
the renderer's resize observer before rebuilding placements, including width
changes caused by classic scrollbars. Disposal is tested last to avoid an
unnecessary reload; a later case can still reload a disposed scene. Cases remain individually runnable, with
separate traces and assertions. Reusing assets avoids repeating model decoding,
shader initialization, and glyph atlas setup for each keyboard or menu check.

The frame-rate regression compares dense and sparse animation callbacks through
the production render loop. Camera easing uses actual elapsed time; the separate
inertia integration retains its bounded step. Performance tests use fresh
contexts with real time and animated water.

## Performance

Each browser/view runs alone with one worker and real timers. An idle window
collects at least 20 frame samples so its p95 is not estimated from a handful
of startup frames. A native wheel probe records the driver's
acknowledgement latency, then an in-page stream dispatches bubbling, cancelable
wheel events at the element under the pointer. The stream sends the same total
900px of wheel input through the real viewer handlers while the full scene renders.
This keeps protocol round trips out of the hot loop; native keyboard, wheel,
scroll chaining, and touch behavior are exercised by the layout suite.

The scrolling window lasts at least two seconds and collects more than 30 frames.
Slow software renderers get a longer window based on their measured idle frame
interval. Reports include real elapsed time, event count, native acknowledgement
latency, and every frame sample. A stalled renderer fails within 20 seconds.
The fixture parks rendering after initial setup and after the measurement, so
setup and reporting do not run a background render loop. It resumes
the real RAF loop for both sampling windows and the native probe. No fake time
or renderer mocks are used for performance measurements.

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

CI runs units/typechecks/build plus two isolated container jobs per browser
profile: interactions/screenshots and performance. Each complete test command
has a 60-second deadline, and each performance run has its own runner. There are no
automatic retries to hide intermittent failures. Reports, performance JSON,
failure screenshots, and traces are retained as artifacts for 14 days.
Traces retain DOM snapshots, console, and network events; continuous trace
screenshots are disabled because GPU readbacks distort performance measurements.
Real-time camera-settling waits allow 20 seconds in CI and five seconds locally;
layout/visual tests advance their controlled clock instead. The test deadlines
are separate from the measured frame budgets above.

Every normal run writes `timings.json` alongside the test results. It includes
wall-clock duration for the complete command, each case, and each browser API
call, so time spent in loading, input, rendering, or clock advancement can be
inspected without inferring it from the test name. CI uploads this with its other
artifacts. Use the complete `layout.spec.ts screenshots.spec.ts` command when
checking the one-minute browser-suite target; timing one case or increasing the
worker count does not establish the full-suite improvement.

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
