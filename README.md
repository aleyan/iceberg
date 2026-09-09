# @aleyan/iceberg

A reusable interactive 3D iceberg for the web. It renders the iceberg, split
ocean, atmosphere, and depth-aware item labels; your application supplies the
catalogue.


## Affordances

Click the iceberg or focus it with Tab to navigate without a mouse wheel.
Up/Down moves a line, Page Up/Down (or Shift+Space/Space) moves a page, and
Home/End jumps to the top/bottom. Left/Right rotates within the selected view's
limits. Holding an arrow key uses the keyboard's normal repeat behavior.

After 15 seconds without interaction, rendering slows to about 10 fps. After
20 seconds it stops scheduling animation frames entirely. Interacting with the
viewer, changing views, or resizing resumes full-rate rendering.

## Install

```sh
bun add @aleyan/iceberg three
```

## Use

Import the stylesheet once, give the host a height, then mount the scene in
browser code. This example uses Vite's `?raw` import (also supported by Astro);
with other bundlers, load the TOML as text or pass an `IcebergItem[]` directly.

```ts
import {
  mountIceberg,
  parseItems,
  type IcebergItem,
} from "@aleyan/iceberg";
import "@aleyan/iceberg/styles.css";
import itemsToml from "./items.toml?raw";

const host = document.querySelector<HTMLElement>("#iceberg");

if (host) {
  try {
    const items: IcebergItem[] = parseItems(itemsToml);
    const iceberg = mountIceberg(host, { items, viewSelector: true });
    // Register iceberg.dispose() with your component or route's cleanup hook.
    await iceberg.ready;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error("Unable to initialize the iceberg", error);
      host.textContent = "The iceberg could not be loaded.";
    }
  }
}
```

```css
#iceberg {
  width: 100%;
  height: 100svh;
}
```

The package uses system sans-serif and monospace stacks by default. The
optional font custom properties inherit through every generated control and
are read when the WebGL label atlas is built. Define them on the host only when
the containing application already provides its own fonts.

```css
#iceberg {
  --iceberg-font-family: var(--app-sans-font);
  --iceberg-mono-font-family: var(--app-mono-font);
}
```

`mountIceberg` does not run during import, so the package is safe to import
from server-rendered projects. Call it only in the browser (for example from an
Astro `<script>` or a client-loaded component).

`mountIceberg()` throws synchronously if initialization fails, including when
WebGL is unavailable, and releases resources acquired before the failure.
The returned `ready` promise resolves once the model is loaded, framed, and
populated with labels. Model loading failures reject it and dispose the scene.
Optional environment and texture loading is not part of `ready`.
Calling `dispose()` before readiness rejects `ready` with a `DOMException`
whose name is `AbortError`; this is expected cancellation. Calling it after
readiness leaves the resolved promise unchanged. Disposal is idempotent.

### Vite and Astro

Exclude the package from Vite's development dependency optimizer so asset URLs
remain relative to the package instead of being moved into `.vite/deps`:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { exclude: ["@aleyan/iceberg"] },
});
```

For Astro, put the same option under `vite` in `astro.config.mjs`:

```js
import { defineConfig } from "astro/config";

export default defineConfig({
  vite: {
    optimizeDeps: { exclude: ["@aleyan/iceberg"] },
  },
});
```

Keep this exclusion when installing from npm. A registry installation does not
need filesystem access to a sibling `iceberg` checkout.

The default asset URLs resolve from the installed package. Override any of them
when a host needs to copy or CDN-serve assets:

```ts
mountIceberg(host, {
  items,
  assets: {
    model: "/iceberg/iceberg-web.glb",
  },
});
```

## Item format

`parseItems` reads a TOML document containing one or more `[[items]]`
records:

```toml
schema_version = 1
item_count = 1

[[items]]
slug = "mutable-default-arguments"
name = "Mutable default arguments"
short_description = "Default values are evaluated once, when the function is defined."
url = "https://docs.python.org/3/faq/programming.html"
obscurity_bucket = 1
obscurity_rating = 2.2
cursedness_rating = 6.7
```

Slugs must be unique kebab-case strings. Buckets are integers from 1 (above the
waterline) to 10 (the abyss); ratings are numbers from 0 to 10. Names and
descriptions support inline code surrounded by backticks, but not arbitrary
HTML.

By default, selecting an item writes `?item=<slug>` and browser Back/Forward
restores it. Set `syncUrl: false` to keep the containing page URL untouched.

## Views

The default `orbit` view keeps the original full rotation and labels around the
whole iceberg. `arc` limits rotation to 30 degrees total (15 degrees either side)
and compresses the original irregular label arrangement onto the front arc.
Items remain reachable by descending, without needing to turn to the back.
`list` places names at equal intervals down the center, with horizontal rotation
locked. Labels stay at fixed world positions and move with the iceberg in every
view; Arc retains the original depths, and List spaces names across the same
depth range. List uses the center column's width to reduce wrapping. All three
views share camera scrolling, label rendering, occlusion, and detail popups.
Wheel and touch navigation continue over open descriptions. Hover previews stay
closed while navigating; explicitly selected descriptions remain pinned.

Enable the top-right dropdown with `viewSelector: true`. It shows the current
choice (Orbit, Arc, or List) and opens a vertical menu. Its font size matches the
item names. The selector
is opt-in, so existing embeddings keep their current appearance. Selected items
and their URL links survive view changes.

```ts
import { icebergViews, mountIceberg, type IcebergView } from "@aleyan/iceberg";

const iceberg = mountIceberg(host, {
  items,
  view: "arc",
  viewSelector: true,
  onViewChange: (view: IcebergView) => console.log(view),
});
// For custom controls, omit viewSelector and use the controller:
iceberg.setView("list");
console.log(iceberg.view, iceberg.availableViews, icebergViews);
// availableViews and icebergViews are the immutable ["orbit", "arc", "list"].
```

`setView()` also works before `ready` resolves. Unknown modes throw `TypeError`;
valid changes after disposal do nothing. The default interaction hint and canvas
accessibility instructions update with the mode. Custom hints remain host-owned.

## Options

- `view`: initial `orbit`, `arc`, or `list` layout; defaults to `orbit`.
- `viewSelector`: displays the built-in mode selector; defaults to `false`.
- `onViewChange`: callback after a mode change, for custom controls or host state.

- `aboveWaterLabelStretch`: expands the above-water label span; defaults to 1.
- `assets`: overrides for the model, HDR environment, sky, or relief texture.
- `hint`: custom interaction hint, or `false` to hide it.
- `initialItem`: selected item when URL synchronization is disabled.
- `overview`: frames the complete iceberg instead of the scrolling view.
- `stillFrame`: freezes water motion for screenshots or visual tests.
- `syncUrl`: enables item deep links; defaults to `true`.
- `underwaterStretch`: stretches the submerged model from 1 to 4; defaults to 2.
- `waterLevel`: changes the world-space waterline; defaults to -0.72.

## Develop

```sh
bun install
bun run dev
bun run check
bun run build
```

The package publishes only `dist/`, `assets/`, `styles.css`, and its
documentation/license. The small synthetic catalogue under `demo/items.toml`
is for local development and tests and is deliberately not part of the npm
package. The real Python catalogue remains in the consuming site.

## Tests

`bun run check` runs source and test typechecks, the unit suite, and the demo
bundle check. `bun run test:unit:coverage` writes an LCOV report.

For the real-browser suite, run `bun run test:install`, then
`bun run test:browser` and `bun run test:performance`. Chrome and Firefox each
run desktop and mobile viewport profiles. `bun run test:screenshots` compares
reviewed screenshots inside a pinned Linux container and requires Docker.
CI runs every suite and retains failure artifacts and performance measurements.

See [the testing guide](tests/browser/README.md) for coverage, performance budgets,
baseline updates, mobile-emulation limits, and troubleshooting.

## Prepare a release

1) Update the version in package.json
2) Run `bun run pack:release`
3) Publish a release from github releases. This causes publish.yaml workflow to publish to npm.


## Assets

The iceberg GLB, ocean HDR, sky texture, and glacial relief texture were created
for the original Python Iceberg project and are distributed under this
repository's MIT license. The texture sources were generated specifically for
the project; the runtime does not include the original meme reference or Blender
working files.
