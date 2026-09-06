import { describe, expect, it } from 'vitest';
import { renderStockList, type StockListEntry } from '../stock-list.js';

const stock = (
  symbol: string,
  overrides: Partial<StockListEntry> = {},
): StockListEntry => ({
  id: symbol,
  symbol,
  companyName: `${symbol} & Company`,
  cik: '123',
  enabled: true,
  monitoringTier: 'WATCH',
  monitoringMode: 'NORMAL',
  priority: 50,
  autoDiscovered: false,
  attentionScore: 0,
  investigateUntil: null,
  watchReason: null,
  watchUntil: null,
  ...overrides,
});

describe('stock list rendering', () => {
  it('renders labeled counts and readable stock fields', () => {
    const text = renderStockList([
      stock('AOUT', {
        monitoringTier: 'INVESTIGATE',
        monitoringMode: 'HIGH_RESOLUTION',
        priority: 98,
        autoDiscovered: true,
        attentionScore: 98,
        investigateUntil: new Date('2026-09-05T21:16:44.725Z'),
        watchReason: 'American Outdoor Brands, Inc.: 10-Q',
        discoverySignals: [
          {
            source: 'ALPHA_VANTAGE_MARKET_MOVERS',
            trigger: 'PRICE_MOVE',
            reason: '+44.66% price move on 4,353,325 shares',
          },
        ],
        watchReasonSource: {
          source: 'SEC',
          url: 'https://www.sec.gov/Archives/example-10q.htm',
        },
      }),
      stock('MU', { enabled: false }),
    ]);

    expect(text).toContain('👀 <b>Currently watched:</b> 1');
    expect(text).toContain(
      '📋 <b>Configured:</b> 2 · <b>Paused:</b> 1 · <b>Auto-discovered:</b> 1',
    );
    expect(text).toContain('✅ <b>AOUT</b> — AOUT &amp; Company');
    expect(text).toContain('🎯 <b>Tier:</b> INVESTIGATE');
    expect(text).toContain('⚙️ <b>Mode:</b> HIGH_RESOLUTION');
    expect(text).toContain('⭐ <b>Priority:</b> 98/100');
    expect(text).toContain(
      '⏳ <b>Investigation until:</b> 2026-09-05 21:16:44 UTC',
    );
    expect(text).toContain(
      '🌐 <b>Discovery source:</b> <a href="https://www.alphavantage.co/">Alpha Vantage Market Movers</a> · Price Move',
    );
    expect(text).toContain(
      '💡 <b>Discovery reason:</b> +44.66% price move on 4,353,325 shares',
    );
    expect(text).toContain(
      '📝 <b>Reason:</b> American Outdoor Brands, Inc.: 10-Q',
    );
    expect(text).toContain(
      '📰 <b>Watch source:</b> <a href="https://www.sec.gov/Archives/example-10q.htm">SEC</a>',
    );
    expect(text).toContain('⏸ <b>MU</b>');
  });

  it('renders a useful empty-state count', () => {
    expect(renderStockList([])).toContain('👀 <b>Currently watched:</b> 0');
    expect(renderStockList([])).toContain('No stocks configured.');
  });
});
