import { describe, expect, it, vi } from 'vitest';
import { StudyService } from '../study-service.js';

describe('StudyService', () => {
  it('fails a scanned document clearly instead of sending unsupported material to the LLM', async () => {
    const transition = vi.fn().mockResolvedValue(undefined);
    const transport = {
      stage: vi.fn(),
      lectureReady: vi.fn(),
      text: vi.fn(),
      quiz: vi.fn(),
      anki: vi.fn(),
    };
    const store = {
      getJob: vi.fn().mockResolvedValue({
        id: 'job',
        status: 'RECEIVED',
        documentId: 'doc',
        chatId: 123n,
        document: { sourceObjectKey: 'study-bot/documents/doc.pdf' },
      }),
      transition,
      savePages: vi.fn(),
    };
    const llm = { generate: vi.fn() };
    const service = new StudyService({
      store: store as never,
      storage: {
        get: vi.fn().mockResolvedValue(new Uint8Array([1])),
        put: vi.fn(),
      },
      extractor: {
        extract: vi
          .fn()
          .mockResolvedValue([{ pageNumber: 1, text: 'scanned' }]),
      },
      llm,
      tts: { synthesize: vi.fn() },
      lease: { withExclusiveLease: vi.fn() } as never,
      transport,
      documentsBucket: 'documents',
      mediaBucket: 'media',
      maxPages: 10,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });

    await service.process('job');

    expect(llm.generate).not.toHaveBeenCalled();
    expect(transition).toHaveBeenLastCalledWith(
      'job',
      'FAILED',
      expect.stringContaining('OCR is required'),
    );
    expect(transport.text).toHaveBeenCalledWith(
      123n,
      expect.stringContaining('OCR is required'),
    );
  });
});
