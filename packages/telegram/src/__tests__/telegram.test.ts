import { describe, expect, it } from 'vitest';
import { isAuthorized, parseAllowedUserIds } from '../authorization.js';
import { parsePublicationQueriesCsv } from '../input.js';
import {
  formatRunDuration,
  renderPublicationDigest,
  renderPublicationSourceList,
  renderRunProgress,
  renderStockDigest,
  renderStockSourceList,
  splitTelegramMessage,
} from '../messages.js';

describe('Telegram utilities', () => {
  it('authorizes only configured user IDs', () => {
    const ids = parseAllowedUserIds('123, 456');
    expect(isAuthorized(ids, 123)).toBe(true);
    expect(isAuthorized(ids, 999)).toBe(false);
    expect(isAuthorized(ids, undefined)).toBe(false);
  });

  it('rejects invalid allowlist values', () => {
    expect(() => parseAllowedUserIds('123,nope')).toThrow(
      'Invalid Telegram user ID',
    );
  });

  it('parses publication queries from CSV content', () => {
    expect(
      parsePublicationQueriesCsv(
        'query,notes\nmycorrhizal fungi,soil\n"plant, microbe",quoted\nMYCORRHIZAL FUNGI,duplicate',
      ),
    ).toEqual(['mycorrhizal fungi', 'plant, microbe']);
  });

  it('splits messages without exceeding Telegram limits', () => {
    const parts = splitTelegramMessage(
      `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`,
      80,
    );
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.length <= 80)).toBe(true);
  });

  it('formats run durations for Telegram output', () => {
    expect(formatRunDuration(499)).toBe('0s');
    expect(formatRunDuration(61_000)).toBe('1m 1s');
    expect(formatRunDuration(3_661_000)).toBe('1h 1m 1s');
  });

  it('renders manual run progress with a fixed width bar', () => {
    expect(
      renderRunProgress({
        percent: 60,
        step: 'Analyzing fundamentals',
      }),
    ).toBe(
      '⏳ Processing request...\n[██████░░░░] 60%\nCurrent step: Analyzing fundamentals',
    );
  });

  it('renders source lists with provider links', () => {
    expect(renderStockSourceList()).toContain(
      '<a href="https://www.sec.gov/edgar/searchedgar/companysearch">SEC EDGAR</a>',
    );
    expect(renderStockSourceList()).toContain(
      '<a href="https://finviz.com/insidertrading.ashx">FINVIZ Insider Trading</a>',
    );
    expect(renderPublicationSourceList()).toContain(
      '<a href="https://pubmed.ncbi.nlm.nih.gov/">PubMed</a>',
    );
    expect(renderPublicationSourceList()).toContain(
      '<a href="https://clinicaltrials.gov/">ClinicalTrials.gov</a>',
    );
  });

  it('renders stock digest entries with isolated URLs', () => {
    const text = renderStockDigest({
      durationMs: 366_000,
      fetchedCount: 2,
      newItemCount: 2,
      analyzedCount: 2,
      failedAnalysisCount: 0,
      sourceFailures: [],
      analyses: [
        {
          item: {
            id: 'SEC:1',
            source: 'SEC',
            externalId: '1',
            title: 'Micron filing',
            url: 'https://www.sec.gov/Archives/edgar/data/1/a.htm',
            content: 'content',
            metadata: { target: 'MU' },
          },
          outcome: {
            status: 'SUCCESS',
            result: {
              title: 'Leadership update',
              summary: 'Executive role changes were announced.',
              importance: 8,
              sentiment: 'neutral',
              eventType: '8-K',
              positives: [],
              negatives: [],
              risks: [],
              catalysts: [],
              confidence: 0.8,
            },
          },
        },
        {
          item: {
            id: 'SEC:2',
            source: 'SEC',
            externalId: '2',
            title: 'Micron ownership filing',
            url: 'https://www.sec.gov/Archives/edgar/data/1/b.xml',
            content: 'content',
            metadata: { target: 'MU' },
          },
          outcome: {
            status: 'SUCCESS',
            result: {
              title: 'Ownership filing',
              summary: 'A routine ownership filing was submitted.',
              importance: 3,
              sentiment: 'neutral',
              eventType: 'Form 4',
              positives: [],
              negatives: [],
              risks: [],
              catalysts: [],
              confidence: 0.8,
            },
          },
        },
      ],
    });

    expect(text).toContain('<b>1. MU</b>');
    expect(text).toContain('⚪ <b>Sentiment:</b> neutral');
    expect(text).toContain('⏱ <b>Run time:</b> 6m 6s');
    expect(text).toContain(
      '<a href="https://www.sec.gov/Archives/edgar/data/1/a.htm">SEC</a>\n\n──────────\n\n<b>2. MU</b>',
    );
  });

  it('renders publication digests as escaped, structured Telegram HTML', () => {
    const text = renderPublicationDigest({
      durationMs: 900_000,
      fetchedCount: 1,
      newItemCount: 1,
      analyzedCount: 1,
      failedAnalysisCount: 0,
      sourceFailures: [],
      analyses: [
        {
          item: {
            id: 'PUBMED:1',
            source: 'PUBMED',
            externalId: '1',
            title: 'Source title',
            url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
            content: 'content',
            metadata: { target: 'fungi & soil' },
          },
          outcome: {
            status: 'SUCCESS',
            result: {
              title: 'Plant < microbe interactions',
              summary: 'A concise & useful summary.',
              importance: 8,
              relevance: 9,
              keyFindings: ['One finding', 'Second finding'],
              methods: ['Review'],
              limitations: ['Limited field evidence'],
              whyInteresting: 'It informs agricultural practice.',
              confidence: 0.9,
            },
          },
        },
      ],
    });

    expect(text).toContain('🧬 <b>PUBLICATIONS WATCHER</b>');
    expect(text).toContain('⏱ <b>Run time:</b> 15m 0s');
    expect(text).toContain('<b>1. Plant &lt; microbe interactions</b>');
    expect(text).toContain('🎯 <b>Topic:</b> fungi &amp; soil');
    expect(text).toContain('🔑 <b>Key findings</b>\n• One finding');
    expect(text).toContain(
      '<a href="https://pubmed.ncbi.nlm.nih.gov/1/">PUBMED</a>',
    );
  });
});
