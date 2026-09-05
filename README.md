# @aleyan/iceberg

A reusable interactive 3D iceberg for the web. It renders the iceberg, split
ocean, atmosphere, and depth-aware item labels; your application supplies the
catalogue.

## Install

```sh
bun add @aleyan/iceberg three
```

## Use

Import the stylesheet once, give the host a height, then mount the scene in
browser code:

```ts
import {
  mountIceberg,
  parseItems,
  type IcebergItem,
} from "@aleyan/iceberg";
import "@aleyan/iceberg/styles.css";
import itemsToml from "./items.toml?raw";

const items: IcebergItem[] = parseItems(itemsToml);
const host = document.querySelector<HTMLElement>("#iceberg");

if (host) {
  const iceberg = mountIceberg(host, { items });
  await iceberg.ready;

  // Call iceberg.dispose() when a client-side route removes the host.
}
```

```css
#iceberg {
  width: 100%;
  height: 100svh;
  --aleyan-iceberg-font-family: "Atkinson", sans-serif;
  --aleyan-iceberg-mono-font-family: "IosevkaCustom", monospace;
}
```

The optional font custom properties inherit through every generated control
and are read when the WebGL label atlas is built. Define them on the host to
match the typography of the containing application.

`mountIceberg` does not run during import, so the package is safe to import
from server-rendered projects. Call it only in the browser (for example from an
Astro `<script>` or a client-loaded component).

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

## Options

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

## Assets

The iceberg GLB, ocean HDR, sky texture, and glacial relief texture were created
for the original Python Iceberg project and are distributed under this
repository's MIT license. The texture sources were generated specifically for
the project; the runtime does not include the original meme reference or Blender
working files.
