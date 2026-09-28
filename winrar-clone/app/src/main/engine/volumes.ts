import { basename, dirname, join } from 'node:path';

/**
 * Resolves the first volume of a multi-volume set (FR-EXT-05). 7-Zip only reads the set correctly when it is
 * opened from the first volume; opening part3 directly yields "Headers Error".
 *
 * Supported schemes: name.partN.rar (any zero padding), name.rar + name.r00.., name.7z.001 / name.zip.001 /
 * name.001, and name.zip + name.z01...
 */
export function firstVolumePath(path: string, exists: (p: string) => boolean): string {
  const dir = dirname(path);
  const name = basename(path);

  const part = /^(.*\.part)(\d+)(\.rar)$/i.exec(name);
  if (part) {
    const [, prefix, digits, ext] = part as unknown as [string, string, string, string];
    const candidate = join(dir, `${prefix}${'1'.padStart(digits.length, '0')}${ext}`);
    return exists(candidate) ? candidate : path;
  }

  const oldRar = /^(.*)\.r(\d{2,3})$/i.exec(name);
  if (oldRar) {
    const candidate = join(dir, `${oldRar[1]}.rar`);
    return exists(candidate) ? candidate : path;
  }

  const numbered = /^(.*)\.(\d{3})$/.exec(name);
  if (numbered) {
    const candidate = join(dir, `${numbered[1]}.001`);
    return exists(candidate) ? candidate : path;
  }

  const splitZip = /^(.*)\.z(\d{2})$/i.exec(name);
  if (splitZip) {
    const candidate = join(dir, `${splitZip[1]}.zip`);
    return exists(candidate) ? candidate : path;
  }

  return path;
}
