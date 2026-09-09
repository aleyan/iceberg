import { resolve } from 'node:path';

// Bundle the actual source without HMR or a dev overlay affecting measurements.
const output = await Bun.build({
  entrypoints: [resolve(import.meta.dir, 'fixture/main.ts')],
  target: 'browser',
  sourcemap: 'inline',
});
if (!output.success) throw new AggregateError(output.logs, 'Browser fixture build failed');
const files = new Map(output.outputs.map(file => ['/' + file.path.split('/').at(-1), file]));
Bun.serve({
  hostname: '127.0.0.1', port: 4179,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/health') return new Response('iceberg-browser-tests');
    if (path === '/') return new Response(Bun.file(new URL('fixture/index.html', import.meta.url)));
    if (files.has(path)) return new Response(files.get(path));
    if (/^\/assets\/(models|environment|textures)\/[a-z0-9.-]+$/.test(path)) {
      return new Response(Bun.file(resolve(import.meta.dir, '../..' + path)));
    }
    return new Response('Not found', { status: 404 });
  },
});
