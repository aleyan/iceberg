import index from "./index.html";

Bun.serve({
  routes: {
    "/": index,
    "/assets/models/iceberg-web.glb": new Response(
      Bun.file(new URL("../assets/models/iceberg-web.glb", import.meta.url)),
      { headers: { "content-type": "model/gltf-binary" } },
    ),
    "/assets/environment/ocean-panorama.hdr": new Response(
      Bun.file(new URL("../assets/environment/ocean-panorama.hdr", import.meta.url)),
      { headers: { "content-type": "image/vnd.radiance" } },
    ),
    "/assets/environment/polar-cirrus.jpg": new Response(
      Bun.file(new URL("../assets/environment/polar-cirrus.jpg", import.meta.url)),
      { headers: { "content-type": "image/jpeg" } },
    ),
    "/assets/textures/glacial-relief.jpg": new Response(
      Bun.file(new URL("../assets/textures/glacial-relief.jpg", import.meta.url)),
      { headers: { "content-type": "image/jpeg" } },
    ),
  },
  development: true,
});
