import { describe, expect, it, vi } from 'vitest';
import { InProcessEventBus } from '../core/index.js';
import { StockCandidateProcessor } from '../stock-candidate-processor.js';

describe('StockCandidateProcessor', () => {
  it('turns an internal anomaly event into an immediate ticker-scoped run', async () => {
    const execute = vi.fn(async () => ({ status: 'COMPLETED' }));
    const processor = new StockCandidateProcessor(new InProcessEventBus(), {
      execute,
    });
    await processor.processStockCandidate({
      type: 'stock.market_anomaly.detected',
      configId: '11111111-1111-4111-8111-111111111111',
      chatId: 123n,
      tickers: ['mu'],
    });
    expect(execute).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      123n,
      'SCHEDULED',
      { targetKeys: new Set(['MU']) },
    );
    processor.stop();
  });
});
