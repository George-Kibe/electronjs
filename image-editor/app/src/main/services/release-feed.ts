import type { UpdateChannel } from '@shared/settings';

/**
 * Where updates come from (ADR-0010). This repository releases several products, tagged per component by
 * release-please (`image-editor-v0.2.0`, `winrar-app-v…`), so electron-updater's GitHub provider cannot be
 * used: it takes the repo's newest release, whatever product that is, and skips tags that are not plain
 * semver. Instead we pick this product's newest release from the GitHub API and point electron-updater's
 * generic provider at that release's assets. The manifest there (latest*.yml / beta*.yml) still carries
 * the SHA-512 and the staged-rollout percentage. Keep in sync with `publish` in electron-builder.yml.
 */
export const RELEASE_SOURCE = { owner: 'George-Kibe', repo: 'electronjs', tagPrefix: 'image-editor-v' };

type Version = { major: number; minor: number; patch: number; pre: string[] };

/** Strict semver (`1.2.3`, `1.2.3-beta.1`); build metadata is not used in our tags. */
export function parseVersion(v: string): Version | null {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(v);
  if (!m) return null;
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] ? m[4].split('.') : [] };
}

/** Semver precedence: negative when a < b. */
export function compareVersions(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core) return core;
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length; // a release beats its pre-releases
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (+x !== +y) return +x - +y;
    } else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string }>;
};

export type Feed = {
  /** Base URL of the release's assets: the generic provider reads `<url><channel>*.yml` there. */
  url: string;
  /** The manifest's channel: 'beta' only for a beta pre-release (electron-builder names it beta*.yml). */
  channel: 'latest' | 'beta';
  version: string;
};

/**
 * This product's newest release for the channel: Stable takes full releases only, Beta also takes beta
 * pre-releases. Drafts, other products' tags, invalid versions and releases without an update manifest
 * (still uploading, or not built by electron-builder) are skipped.
 */
export function pickRelease(
  releases: readonly GitHubRelease[],
  channel: UpdateChannel,
  source = RELEASE_SOURCE,
): Feed | null {
  let best: { version: Version; raw: string; feed: Feed } | null = null;
  for (const r of releases) {
    if (r.draft || !r.tag_name.startsWith(source.tagPrefix)) continue;
    const raw = r.tag_name.slice(source.tagPrefix.length);
    const version = parseVersion(raw);
    if (!version) continue;
    const pre = version.pre[0];
    if (version.pre.length && (channel === 'latest' || pre !== 'beta')) continue;
    if (!version.pre.length && r.prerelease) continue; // a full version marked pre-release is not ready
    const manifest = version.pre.length ? 'beta' : 'latest';
    if (!r.assets.some((a) => a.name.startsWith(manifest) && a.name.endsWith('.yml'))) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      raw,
      feed: {
        url: `https://github.com/${source.owner}/${source.repo}/releases/download/${encodeURIComponent(r.tag_name)}/`,
        channel: manifest,
        version: raw,
      },
    };
  }
  return best?.feed ?? null;
}

/** The GitHub API listing (newest 100 releases); the caller supplies the HTTP client. */
export function releasesUrl(source = RELEASE_SOURCE): string {
  return `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=100`;
}

/** Validates the API answer just enough to pick from it (it is untrusted network input). */
export function asReleases(json: unknown): GitHubRelease[] {
  if (!Array.isArray(json)) throw new Error('Unexpected releases listing');
  return json.flatMap((r: unknown) => {
    const o = r as Partial<GitHubRelease> | null;
    if (!o || typeof o.tag_name !== 'string' || !Array.isArray(o.assets)) return [];
    return [
      {
        tag_name: o.tag_name,
        draft: o.draft === true,
        prerelease: o.prerelease === true,
        assets: o.assets.filter(
          (a): a is { name: string } => typeof (a as { name?: unknown })?.name === 'string',
        ),
      },
    ];
  });
}

/** Resolves the feed for a channel with the given JSON client (main passes `net.fetch`). */
export function releaseFeedResolver(
  fetchJson: (url: string) => Promise<unknown>,
  source = RELEASE_SOURCE,
): (channel: UpdateChannel) => Promise<Feed | null> {
  return async (channel) => pickRelease(asReleases(await fetchJson(releasesUrl(source))), channel, source);
}
