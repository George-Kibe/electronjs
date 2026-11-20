import { describe, expect, it } from 'vitest';
import {
  asReleases,
  compareVersions,
  parseVersion,
  pickRelease,
  releaseFeedResolver,
  releasesUrl,
  type GitHubRelease,
} from './release-feed';

const rel = (tag: string, over: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: tag,
  draft: false,
  prerelease: /v\d+\.\d+\.\d+-/.test(tag), // GitHub's flag follows the version's pre-release part
  assets: [{ name: /-beta/.test(tag) ? 'beta.yml' : 'latest.yml' }, { name: 'ImageEditor-Setup.exe' }],
  ...over,
});

const url = (tag: string) => `https://github.com/George-Kibe/electronjs/releases/download/${tag}/`;

describe('semver', () => {
  it('orders versions and pre-releases by precedence', () => {
    const order = [
      '0.9.9',
      '1.0.0-alpha',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0',
      '1.0.1',
      '1.10.0',
    ];
    const parsed = order.map((v) => parseVersion(v)!);
    for (let i = 1; i < parsed.length; i++)
      expect(compareVersions(parsed[i - 1]!, parsed[i]!)).toBeLessThan(0);
    expect(compareVersions(parseVersion('2.0.0')!, parseVersion('2.0.0')!)).toBe(0);
  });

  it('rejects non-semver', () => {
    for (const v of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-', '1.0.0+build', 'latest'])
      expect(parseVersion(v)).toBeNull();
  });
});

describe('pickRelease (ADR-0010)', () => {
  // Newest first, as the API lists them; other products release in the same repo.
  const releases = [
    rel('winrar-app-v3.0.0'),
    rel('image-editor-v0.3.0-beta.1'),
    rel('whatsapp-desktop-v9.0.0'),
    rel('image-editor-v0.2.1'),
    rel('image-editor-v0.10.0', { draft: true }),
    rel('image-editor-v0.2.0'),
  ];

  it('Stable: the newest full image-editor release', () => {
    expect(pickRelease(releases, 'latest')).toEqual({
      url: url('image-editor-v0.2.1'),
      channel: 'latest',
      version: '0.2.1',
    });
  });

  it('Beta: a newer beta pre-release, else the newest release', () => {
    expect(pickRelease(releases, 'beta')).toEqual({
      url: url('image-editor-v0.3.0-beta.1'),
      channel: 'beta',
      version: '0.3.0-beta.1',
    });
    expect(pickRelease([...releases, rel('image-editor-v0.3.0')], 'beta')).toMatchObject({
      version: '0.3.0',
      channel: 'latest',
    });
  });

  it('picks by version, not by listing order', () => {
    expect(pickRelease([rel('image-editor-v0.9.0'), rel('image-editor-v0.10.0')], 'latest')?.version).toBe(
      '0.10.0',
    );
  });

  it('skips releases that cannot be installed yet or are not betas', () => {
    expect(pickRelease([rel('image-editor-v0.4.0', { assets: [] })], 'latest')).toBeNull(); // still uploading
    expect(pickRelease([rel('image-editor-v0.4.0', { prerelease: true })], 'latest')).toBeNull();
    expect(
      pickRelease([rel('image-editor-v0.4.0-alpha.1', { assets: [{ name: 'alpha.yml' }] })], 'beta'),
    ).toBeNull();
    expect(pickRelease([rel('image-editor-vnext')], 'latest')).toBeNull();
    expect(pickRelease([], 'latest')).toBeNull();
  });

  it('accepts the per-platform manifests', () => {
    for (const name of ['latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml'])
      expect(pickRelease([rel('image-editor-v1.0.0', { assets: [{ name }] })], 'latest')).not.toBeNull();
  });
});

describe('asReleases', () => {
  it('keeps well-formed entries from untrusted JSON', () => {
    expect(
      asReleases([
        {
          tag_name: 'image-editor-v1.0.0',
          draft: false,
          prerelease: false,
          assets: [{ name: 'latest.yml' }, { x: 1 }],
        },
        { tag_name: 5 },
        null,
        { tag_name: 't', assets: 'no' },
      ]),
    ).toEqual([
      { tag_name: 'image-editor-v1.0.0', draft: false, prerelease: false, assets: [{ name: 'latest.yml' }] },
    ]);
    expect(() => asReleases({ message: 'API rate limit exceeded' })).toThrow();
  });

  it('lists the 100 newest releases of the repo', () => {
    expect(releasesUrl()).toBe('https://api.github.com/repos/George-Kibe/electronjs/releases?per_page=100');
  });
});

describe('releaseFeedResolver', () => {
  it('fetches the listing and picks for the channel', async () => {
    const seen: string[] = [];
    const resolve = releaseFeedResolver(async (u) => {
      seen.push(u);
      return [rel('image-editor-v1.2.0'), rel('image-editor-v1.3.0-beta.1')];
    });
    expect((await resolve('latest'))?.version).toBe('1.2.0');
    expect((await resolve('beta'))?.version).toBe('1.3.0-beta.1');
    expect(seen).toEqual([releasesUrl(), releasesUrl()]);
  });

  it('fails on an unexpected answer (the update check reports an error)', async () => {
    await expect(releaseFeedResolver(async () => ({ message: 'Not Found' }))('latest')).rejects.toThrow();
  });
});
