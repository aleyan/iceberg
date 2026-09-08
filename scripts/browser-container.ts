import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Match the native architectures used in CI. Chrome for Testing uses amd64;
// Firefox uses arm64 so its software WebGL is not run through x86 emulation
// on Apple Silicon. Baselines are separate for each browser project.
const root = resolve(import.meta.dir, '..');
const args: string[] = [];
const requested: string[] = [];
const input = process.argv.slice(2);
for (let index = 0; index < input.length; index++) {
  const arg = input[index];
  if (arg.startsWith('--project=')) requested.push(arg.slice('--project='.length));
  else if (arg === '--project') {
    const project = input[++index];
    if (!project) throw new Error('--project requires a project name');
    requested.push(project);
  } else args.push(arg);
}
async function run(cmd: string[]) {
  const child = Bun.spawn(cmd, { cwd: root, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
  const code = await child.exited;
  if (code) throw new Error(`${cmd[0]} failed with exit code ${code}`);
}
let ran = false;
for (const [arch, names] of [
  ['amd64', ['chrome-desktop', 'chrome-mobile']],
  ['arm64', ['firefox-desktop', 'firefox-mobile']],
] as const) {
  const projects = names.filter(name => !requested.length || requested.some(pattern => new Bun.Glob(pattern).match(name)));
  if (!projects.length) continue;
  ran = true;
  const platform = `linux/${arch}`;
  const image = `iceberg-browser-tests:1.63.0-${arch}`;
  const cache = resolve(root, '.cache', `browser-${arch}`);
  mkdirSync(cache, { recursive: true });
  await run(['docker', 'build', `--platform=${platform}`, '-t', image, '-f', 'tests/browser/Dockerfile', '.']);
  await run(['docker', 'run', '--rm', '--init', '--ipc=host', `--platform=${platform}`,
    '-v', `${root}:/work`, '-v', '/work/node_modules', '-v', `${cache}:/root/.cache`, '-e', 'CI=1', '-e', 'ICEBERG_TEST_TIMEOUT=180000',
    '-e', 'ICEBERG_PERF_PROFILE=ci', image,
    'bash', '-c', 'bun install --frozen-lockfile && xvfb-run -a bun x playwright test "$@" --headed', 'browser-tests',
    ...args, ...projects.map(project => `--project=${project}`),
  ]);
}
if (!ran) throw new Error(`No browser projects match: ${requested.join(', ')}`);
