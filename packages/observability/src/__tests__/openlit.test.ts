import { describe, expect, it, vi } from 'vitest';
import {
  createOpenLitInitializer,
  initializeOpenLitFromEnvironment,
  traceAiOperation,
  type AiSpan,
  type AiTracer,
} from '../openlit.js';

describe('OpenLIT observability', () => {
  it('does nothing while disabled and initializes once with content capture disabled', () => {
    const init = vi.fn();
    const environment: Record<string, string | undefined> = {};
    const initialize = createOpenLitInitializer({ init }, environment);

    expect(
      initialize({
        enabled: false,
        applicationName: 'stocks-bot',
        environment: 'production',
      }),
    ).toBe(false);
    expect(
      initialize({
        enabled: true,
        applicationName: 'stocks-bot',
        environment: 'production',
        otlpEndpoint: 'http://otel-collector:4318',
        samplingRatio: 0.25,
      }),
    ).toBe(true);
    expect(
      initialize({
        enabled: true,
        applicationName: 'stocks-bot',
        environment: 'production',
        otlpEndpoint: 'http://different:4318',
      }),
    ).toBe(false);

    expect(init).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith({
      applicationName: 'stocks-bot',
      environment: 'production',
      otlpEndpoint: 'http://otel-collector:4318',
      captureMessageContent: false,
      disabledInstrumentors: ['ollama'],
      disableBatch: false,
      collectGpuStats: false,
      maxContentLength: 0,
    });
    expect(environment).toMatchObject({
      OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
      OTEL_TRACES_SAMPLER_ARG: '0.25',
    });
  });

  it('validates environment configuration and never enables console export implicitly', () => {
    const initialize = vi.fn(() => true);
    expect(
      initializeOpenLitFromEnvironment(
        'news-bot',
        {
          OPENLIT_ENABLED: 'false',
          OTEL_EXPORTER_OTLP_ENDPOINT: '',
          OTEL_EXPORTER_OTLP_HEADERS: '',
        },
        initialize,
      ),
    ).toBe(false);
    expect(initialize).not.toHaveBeenCalled();

    expect(() =>
      initializeOpenLitFromEnvironment(
        'news-bot',
        { OPENLIT_ENABLED: 'true' },
        initialize,
      ),
    ).toThrow('OTEL_EXPORTER_OTLP_ENDPOINT');

    expect(
      initializeOpenLitFromEnvironment(
        'news-bot',
        {
          OPENLIT_ENABLED: 'true',
          OPENLIT_ENVIRONMENT: 'production',
          OPENLIT_SAMPLING_RATIO: '0.1',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://openlit:4318',
          OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer opaque',
        },
        initialize,
      ),
    ).toBe(true);
    expect(initialize).toHaveBeenCalledWith({
      enabled: true,
      applicationName: 'news-bot',
      environment: 'production',
      samplingRatio: 0.1,
      otlpEndpoint: 'http://openlit:4318',
      otlpHeaders: { authorization: 'Bearer opaque' },
    });
  });

  it('records content-free model, correlation, latency, token, and success attributes', async () => {
    const attributes: Record<string, unknown> = {};
    const end = vi.fn();
    const span: AiSpan = {
      setAttributes: (values) => Object.assign(attributes, values),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end,
    };
    const tracer: AiTracer = {
      startActiveSpan: async (_name, callback) => callback(span),
    };

    const result = await traceAiOperation(
      {
        provider: 'ollama',
        model: 'qwen3',
        operation: 'chat',
        caller: 'briefing-bot',
        correlationId: 'run-123',
      },
      async () => ({
        prompt_eval_count: 12,
        eval_count: 7,
        secret: 'raw output',
      }),
      (value) => ({
        inputTokens: value.prompt_eval_count,
        outputTokens: value.eval_count,
      }),
      tracer,
    );

    expect(result.secret).toBe('raw output');
    expect(attributes).toMatchObject({
      'gen_ai.system': 'ollama',
      'gen_ai.request.model': 'qwen3',
      'gen_ai.operation.name': 'chat',
      'watcher.caller': 'briefing-bot',
      'watcher.correlation_id': 'run-123',
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 7,
    });
    expect(Object.values(attributes)).not.toContain('raw output');
    expect(end).toHaveBeenCalledOnce();
  });

  it('marks failed AI calls and rethrows without recording prompt or output content', async () => {
    const attributes: Record<string, unknown> = {};
    const recordException = vi.fn<(error: Error) => unknown>();
    const setStatus = vi.fn();
    const span: AiSpan = {
      setAttributes: (values) => Object.assign(attributes, values),
      setStatus,
      recordException,
      end: vi.fn(),
    };
    const tracer: AiTracer = {
      startActiveSpan: async (_name, callback) => callback(span),
    };
    const failure = new Error('provider echoed private prompt and raw output');

    await expect(
      traceAiOperation(
        {
          provider: 'ollama',
          model: 'qwen3',
          operation: 'embedding',
          caller: 'news-bot',
        },
        async () => Promise.reject(failure),
        undefined,
        tracer,
      ),
    ).rejects.toThrow('provider echoed private prompt and raw output');
    const recorded = recordException.mock.calls[0]?.[0];
    expect(recorded).toEqual(new Error('AI provider operation failed'));
    expect(recorded?.message).not.toContain('private prompt');
    expect(setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'AI provider operation failed',
    });
    expect(attributes).not.toHaveProperty('prompt');
    expect(attributes).not.toHaveProperty('output');
  });
});
