import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  announceRelease,
  maintenanceAbout,
  renderRecommendations,
} from '../telegram.js';

describe('maintenance Telegram copy', () => {
  it('explains the agent purpose and non-mutating safety boundary', () => {
    expect(maintenanceAbout).toContain('private operational observer');
    expect(maintenanceAbout).toContain('probes live service health');
    expect(maintenanceAbout).toContain('monitors server CPU, RAM, and GPU');
    expect(maintenanceAbout).toContain('never edits configuration');
    expect(maintenanceAbout).toContain('never');
    expect(maintenanceAbout).toContain('deploys code');
    expect(maintenanceAbout).toContain(
      'Approval through the authenticated API records a human decision only.',
    );
  });

  it('renders current recommendation evidence without implying application', () => {
    const rendered = renderRecommendations([
      {
        agentName: 'news-bot',
        title: 'Repair NEWS_RSS',
        confidence: 0.94,
        finding: { description: 'Four of five current requests failed.' },
      },
    ]);

    expect(rendered).toContain('Current maintenance recommendations');
    expect(rendered).toContain('Four of five current requests failed.');
    expect(rendered).toContain('94%');
    expect(rendered).toContain('never applies a change automatically');
  });
});

describe('release announcements', () => {
  it('announces a promoted SHA once per chat and rejects invalid metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watcher-release-test-'));
    const path = join(directory, 'current.txt');
    const sendMessage = vi.fn().mockResolvedValue({});
    const hashes = new Set<string>();
    const claimChangeAnnouncement = vi.fn(
      async (hash: string, chatId: bigint) => {
        const key = `${hash}:${chatId}`;
        if (hashes.has(key)) return false;
        hashes.add(key);
        return true;
      },
    );
    const releaseChangeAnnouncement = vi.fn();
    const bot = { api: { sendMessage } } as unknown as Parameters<
      typeof announceRelease
    >[0];
    const store = {
      claimChangeAnnouncement,
      releaseChangeAnnouncement,
    } as unknown as Parameters<typeof announceRelease>[1];
    const logger = { warn: vi.fn() } as unknown as Parameters<
      typeof announceRelease
    >[4];
    try {
      await writeFile(path, `bad-sha\n• Changed app\n`);
      await announceRelease(bot, store, new Set([123]), path, logger);
      expect(sendMessage).not.toHaveBeenCalled();

      const sha = 'a'.repeat(40);
      await writeFile(path, `${sha}\n• Fixed stocks bot\n`);
      await announceRelease(bot, store, new Set([123]), path, logger);
      await announceRelease(bot, store, new Set([123]), path, logger);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining('Fixed stocks bot'),
        expect.any(Object),
      );
      expect(claimChangeAnnouncement).toHaveBeenCalledWith(
        `release:${sha}`,
        123n,
        'Release aaaaaaaaaaaa',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
