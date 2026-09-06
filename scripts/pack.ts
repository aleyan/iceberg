import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const filename = `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
const temporary = mkdtempSync(join(tmpdir(), "iceberg-pack-"));

function run(args: string[]) {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

try {
  run(["install", "--frozen-lockfile"]);
  // Do not rely on lifecycle hooks: Bun 1.3.8 can pack without running prepack.
  run(["run", "check"]);
  rmSync(join(root, "dist"), { recursive: true, force: true });
  run(["run", "build"]);
  const tarball = join(temporary, filename);
  run(["pm", "pack", "--ignore-scripts", "--filename", tarball]);

  const entries = new Set(
    execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n"),
  );
  const required = [
    "package.json", "README.md", "LICENSE", "styles.css",
    manifest.exports["."].import, manifest.exports["."].types,
    ...["dist", "assets"].flatMap(directory =>
      readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => relative(root, join(entry.parentPath, entry.name))),
    ),
  ];
  for (const file of required) {
    const packagedPath = `package/${relative(root, resolve(root, file)).replaceAll("\\", "/")}`;
    if (!entries.has(packagedPath)) throw new Error(`Tarball is missing ${packagedPath}`);
  }
  for (const entry of entries) {
    if (!/^package\/(?:dist\/|assets\/|package\.json$|README\.md$|LICENSE$|styles\.css$)/.test(entry)) {
      throw new Error(`Unexpected tarball entry: ${entry}`);
    }
  }
  const destination = join(root, filename);
  copyFileSync(tarball, destination);
  console.log(`Verified ${entries.size} packaged files: ${destination}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
