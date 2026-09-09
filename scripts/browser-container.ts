import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Match CI's native Linux ARM64 environment for both browsers. This also
// avoids architecture emulation on Apple Silicon. Baselines remain per project.
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
const names = ['chrome-desktop', 'chrome-mobile', 'firefox-desktop', 'firefox-mobile'];
const projects = names.filter(name => !requested.length || requested.some(pattern => new Bun.Glob(pattern).match(name)));
if (!projects.length) throw new Error(`No browser projects match: ${requested.join(', ')}`);
const platform = 'linux/arm64';
const image = 'iceberg-browser-tests:1.63.0-arm64';
const cache = resolve(root, '.cache', 'browser-arm64');
mkdirSync(cache, { recursive: true });
await run(['docker', 'build', `--platform=${platform}`, '-t', image, '-f', 'tests/browser/Dockerfile', '.']);
await run(['docker', 'run', '--rm', '--init', '--ipc=host', `--platform=${platform}`,
  '-v', `${root}:/work`, '-v', '/work/node_modules', '-v', `${cache}:/root/.cache`, '-e', 'CI=1', '-e', 'ICEBERG_TEST_TIMEOUT=240000',
  '-e', 'ICEBERG_PERF_PROFILE=ci', image,
  'bash', '-c', 'bun install --frozen-lockfile && xvfb-run -a bun x playwright test "$@" --headed', 'browser-tests',
  ...args, ...projects.map(project => `--project=${project}`),
]);
