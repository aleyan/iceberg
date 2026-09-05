import itemsSource from "./items.toml" with { type: "text" };
import { mountIceberg, parseItems } from "../src/index.js";
import "../styles.css";

const host = document.querySelector<HTMLElement>("#iceberg");
if (!host) throw new Error("Demo host is missing.");

const params = new URLSearchParams(location.search);
const requestedStretch = Number(params.get("icebergStretch"));

mountIceberg(host, {
  items: parseItems(itemsSource),
  assets: {
    model: "/assets/models/iceberg-web.glb",
    environment: "/assets/environment/ocean-panorama.hdr",
    sky: "/assets/environment/polar-cirrus.jpg",
    relief: "/assets/textures/glacial-relief.jpg",
  },
  overview: params.has("overview"),
  stillFrame: params.has("still"),
  underwaterStretch: Number.isFinite(requestedStretch) ? requestedStretch : undefined,
});
