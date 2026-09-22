import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import {
  CachedFuelPriceProvider,
  EuCzechDieselPriceProvider,
  JsonFeedTransportRequestProvider,
} from '../providers.js';

describe('transport providers', () => {
  it('parses the official workbook shape and English CNB date header', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('prices');
    sheet.addRow(['in EUR', 'Automotive gas oil Diesel']);
    sheet.addRow(['Czechia', 1_500]);
    const workbookBytes = await workbook.xlsx.writeBuffer();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(workbookBytes))
      .mockResolvedValueOnce(
        new Response(
          '21 Sep 2026 #182\nCountry|Currency|Amount|Code|Rate\nEMU|euro|1|EUR|24.350\n',
        ),
      );
    const provider = new EuCzechDieselPriceProvider(
      fetcher,
      'https://example.com/fuel.xlsx',
      'https://example.com/rates.txt',
    );
    await expect(
      provider.getCurrentPrice({ country: 'CZ' }),
    ).resolves.toMatchObject({
      pricePerLiter: 36.53,
      updatedAt: new Date('2026-09-21T12:00:00Z'),
      stale: false,
    });
  });

  it('uses the latest cached fuel price and marks it stale when live refresh fails', async () => {
    const cached = {
      fuel: 'diesel' as const,
      pricePerLiter: 34.9,
      currency: 'CZK' as const,
      source: 'official',
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      stale: false,
    };
    const provider = new CachedFuelPriceProvider(
      { getCurrentPrice: vi.fn().mockRejectedValue(new Error('offline')) },
      { get: vi.fn().mockResolvedValue(cached), put: vi.fn() },
      0,
    );
    await expect(provider.getCurrentPrice({ country: 'CZ' })).resolves.toEqual({
      ...cached,
      stale: true,
    });
  });

  it('validates normalized JSON feed data and preserves unknown values as absent', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requests: [
            {
              externalId: '1',
              source: 'feed',
              cargo: { description: 'box' },
              currency: 'CZK',
              publishedAt: '2026-09-22T10:00:00Z',
              raw: { title: 'box' },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new JsonFeedTransportRequestProvider(
      'https://example.com/feed',
      undefined,
      fetcher,
    );
    const [result] = await provider.fetchRequests();
    expect(result?.cargo.weightKg).toBeUndefined();
    expect(result?.publishedAt).toBeInstanceOf(Date);
  });
});
