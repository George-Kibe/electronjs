/**
 * Downloads the pinned official 7-Zip build for one or more targets, verifies its SHA-256 and extracts
 * only the files we ship into vendor/7zip/<platform>-<arch>/.
 *
 * Usage:
 *   tsx scripts/fetch-7zip.ts --host                 # target = this machine (runs on postinstall)
 *   tsx scripts/fetch-7zip.ts --target win32-arm64   # repeatable
 *   tsx scripts/fetch-7zip.ts --all
 *
 * Set SKIP_7ZIP_FETCH=1 to skip (e.g. offline installs). Downloads use `curl`, which honours HTTPS_PROXY and
 * ships with Windows 10+, macOS and every CI image.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Target = {
  file: string;
  sha256: string;
  kind: 'tar.xz' | '7z-sfx';
  extract: Record<string, string>;
};
type Versions = {
  version: string;
  mirrors: string[];
  targets: Record<string, Target>;
  windowsBootstrap: { file: string; sha256: string };
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(readFileSync(join(root, 'scripts/7zip-versions.json'), 'utf8')) as Versions;
const vendorRoot = join(root, 'vendor/7zip');
const hostKey = `${process.platform}-${process.arch}`;

function log(msg: string): void {
  process.stdout.write(`[fetch-7zip] ${msg}\n`);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function download(file: string, expected: string, dir: string): string {
  const dest = join(dir, file);
  const errors: string[] = [];
  for (const mirror of versions.mirrors) {
    const url = mirror.replace('{version}', versions.version).replace('{file}', file);
    try {
      execFileSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest, url], {
        stdio: 'inherit',
      });
      const actual = sha256(dest);
      if (actual !== expected) throw new Error(`SHA-256 mismatch: expected ${expected}, got ${actual}`);
      return dest;
    } catch (err) {
      errors.push(`${url}: ${(err as Error).message}`);
      rmSync(dest, { force: true });
    }
  }
  throw new Error(`Could not download ${file}:\n  ${errors.join('\n  ')}`);
}

/** Returns a path to a 7-Zip executable that runs on this host (used to unpack Windows .exe packages). */
function hostSevenZip(tmp: string): string {
  if (process.platform === 'win32') {
    const { file, sha256: hash } = versions.windowsBootstrap;
    const msi = download(file, hash, tmp);
    const dir = join(tmp, 'msi');
    execFileSync('msiexec', ['/a', msi, '/qn', `TARGETDIR=${dir}`], { stdio: 'inherit' });
    // The administrative-install folder layout depends on the MSI's directory table, so search for it.
    const found = readdirSync(dir, { recursive: true, encoding: 'utf8' }).find((p) =>
      /(^|[\\/])7z\.exe$/i.test(p),
    );
    if (!found) throw new Error('7z.exe not found in the MSI administrative install');
    return join(dir, found);
  }
  const key = `${process.platform}-${process.arch}`;
  const binary = join(vendorRoot, key, '7zz');
  if (!existsSync(binary)) fetchTarget(key);
  return binary;
}

function fetchTarget(key: string): void {
  const target = versions.targets[key];
  if (!target) throw new Error(`Unknown target "${key}". Known: ${Object.keys(versions.targets).join(', ')}`);
  const outDir = join(vendorRoot, key);
  const stamp = join(outDir, '.version');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${versions.version} ${target.sha256}`) {
    log(`${key}: 7-Zip ${versions.version} already present`);
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), '7zip-'));
  try {
    log(`${key}: downloading ${target.file}`);
    const archive = download(target.file, target.sha256, tmp);
    const unpacked = join(tmp, 'unpacked');
    mkdirSync(unpacked);
    if (target.kind === 'tar.xz') {
      execFileSync('tar', ['-xJf', archive, '-C', unpacked], { stdio: 'inherit' });
    } else {
      const sevenZip = hostSevenZip(tmp);
      execFileSync(
        sevenZip,
        ['x', '-y', '-bso0', '-bsp0', `-o${unpacked}`, '--', archive, ...Object.keys(target.extract)],
        {
          stdio: 'inherit',
        },
      );
    }
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const [from, to] of Object.entries(target.extract)) {
      copyFileSync(join(unpacked, from), join(outDir, to));
      if (!to.endsWith('.txt') && process.platform !== 'win32') chmodSync(join(outDir, to), 0o755);
    }
    writeFileSync(stamp, `${versions.version} ${target.sha256}\n`);
    log(`${key}: installed into ${outDir}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  if (process.env.SKIP_7ZIP_FETCH === '1') {
    log('SKIP_7ZIP_FETCH=1, skipping');
    return;
  }
  const args = process.argv.slice(2);
  const targets = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--host') targets.add(hostKey);
    else if (arg === '--all') Object.keys(versions.targets).forEach((t) => targets.add(t));
    else if (arg === '--target' && args[i + 1]) targets.add(args[++i] as string);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (targets.size === 0) targets.add(hostKey);
  for (const key of targets) fetchTarget(key);
}

main();
