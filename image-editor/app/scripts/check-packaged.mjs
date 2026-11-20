// Release check (docs/08 §2): every packaged app bundles sharp's native binaries for its own platform and
// architecture, outside the asar. A build that misses them opens no images, so the release must stop here.
// Usage: node scripts/check-packaged.mjs [dist]
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const resourcesOf = (dir) =>
  dir.startsWith('mac')
    ? join(dist, dir, 'ImageEditor.app', 'Contents', 'Resources')
    : join(dist, dir, 'resources');

/** `win-arm64-unpacked` → win32/arm64, `mac` → darwin/x64, `linux-unpacked` → linux/x64 … */
function targetOf(dir) {
  const platform = dir.startsWith('win') ? 'win32' : dir.startsWith('mac') ? 'darwin' : 'linux';
  const arch = /arm64/.test(dir) ? 'arm64' : 'x64';
  return { platform, arch };
}

const builds = readdirSync(dist).filter((d) => /^(win|linux)(-arm64)?-unpacked$|^mac(-arm64)?$/.test(d));
if (!builds.length) throw new Error(`No packaged app in ${dist}`);
let failed = false;
for (const dir of builds) {
  const { platform, arch } = targetOf(dir);
  const img = join(resourcesOf(dir), 'app.asar.unpacked', 'node_modules', '@img');
  const found = existsSync(img) ? readdirSync(img) : [];
  const want = `sharp-${platform}-${arch}`;
  const ok = found.includes(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${dir}: ${found.join(', ') || '(no @img packages)'}`);
  if (!ok) {
    console.error(`  ${dir} lacks @img/${want}: this build could not decode images.`);
    failed = true;
  }
}
if (failed) process.exit(1);
