import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { Openlit, type OpenlitOptions } from 'openlit';
import { z } from 'zod';

const configSchema = z
  .object({
    enabled: z.boolean(),
    applicationName: z.string().trim().min(1),
    environment: z.string().trim().min(1),
    otlpEndpoint: z.url().optional(),
    otlpHeaders: z.record(z.string(), z.string()).optional(),
    samplingRatio: z.number().min(0).max(1).default(1),
  })
  .superRefine((value, context) => {
    if (value.enabled && !value.otlpEndpoint) {
      context.addIssue({
        code: 'custom',
        path: ['otlpEndpoint'],
        message:
          'An OTLP endpoint is required when OpenLIT is enabled so telemetry is never written to stdout',
      });
    }
  });

export type OpenLitConfiguration = z.input<typeof configSchema>;

type OpenLitSdk = { init(options?: OpenlitOptions): void };
type Environment = Record<string, string | undefined>;

export const createOpenLitInitializer = (
  sdk: OpenLitSdk = Openlit,
  processEnvironment: Environment = process.env,
) => {
  let initialized = false;
  return (configuration: OpenLitConfiguration): boolean => {
    const config = configSchema.parse(configuration);
    if (!config.enabled || initialized) return false;
    const otlpEndpoint = config.otlpEndpoint;
    if (!otlpEndpoint) {
      throw new Error('OpenLIT OTLP endpoint is required when enabled');
    }
    processEnvironment['OTEL_TRACES_SAMPLER'] ??= 'parentbased_traceidratio';
    processEnvironment['OTEL_TRACES_SAMPLER_ARG'] ??= String(
      config.samplingRatio,
    );
    sdk.init({
      applicationName: config.applicationName,
      environment: config.environment,
      otlpEndpoint,
      ...(config.otlpHeaders ? { otlpHeaders: config.otlpHeaders } : {}),
      captureMessageContent: false,
      disabledInstrumentors: ['ollama'],
      disableBatch: false,
      collectGpuStats: false,
      maxContentLength: 0,
    });
    initialized = true;
    return true;
  };
};

export const initializeOpenLit = createOpenLitInitializer();

const openLitEnvironmentSchema = z
  .object({
    OPENLIT_ENABLED: z.stringbool().default(false),
    OPENLIT_ENVIRONMENT: z.string().trim().min(1).default('production'),
    OPENLIT_SAMPLING_RATIO: z.coerce.number().min(0).max(1).default(0.1),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url().optional(),
    ),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.OPENLIT_ENABLED && !value.OTEL_EXPORTER_OTLP_ENDPOINT) {
      context.addIssue({
        code: 'custom',
        path: ['OTEL_EXPORTER_OTLP_ENDPOINT'],
        message:
          'OTEL_EXPORTER_OTLP_ENDPOINT is required when OpenLIT is enabled',
      });
    }
  });

const parseHeaders = (value: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('=');
        if (separator <= 0) {
          throw new Error(
            'OTEL_EXPORTER_OTLP_HEADERS entries must use name=value',
          );
        }
        return [
          entry.slice(0, separator).trim(),
          entry.slice(separator + 1).trim(),
        ];
      }),
  );

export const initializeOpenLitFromEnvironment = (
  applicationName: string,
  environment: Record<string, string | undefined> = process.env,
  initialize: (
    configuration: OpenLitConfiguration,
  ) => boolean = initializeOpenLit,
): boolean => {
  const parsed = openLitEnvironmentSchema.parse(environment);
  if (!parsed.OPENLIT_ENABLED) return false;
  const headers = parseHeaders(parsed.OTEL_EXPORTER_OTLP_HEADERS);
  return initialize({
    enabled: true,
    applicationName,
    environment: parsed.OPENLIT_ENVIRONMENT,
    samplingRatio: parsed.OPENLIT_SAMPLING_RATIO,
    otlpEndpoint: parsed.OTEL_EXPORTER_OTLP_ENDPOINT,
    ...(Object.keys(headers).length ? { otlpHeaders: headers } : {}),
  });
};

export type AiSpan = {
  setAttributes(attributes: Record<string, unknown>): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  recordException(error: Error): unknown;
  end(): unknown;
};

export type AiTracer = {
  startActiveSpan<T>(
    name: string,
    callback: (span: AiSpan) => Promise<T>,
  ): Promise<T>;
};

const spanAdapter = (span: Span): AiSpan => ({
  setAttributes: (attributes) => span.setAttributes(attributes as Attributes),
  setStatus: (status) => span.setStatus(status),
  recordException: (error) => span.recordException(error),
  end: () => span.end(),
});

const defaultTracer: AiTracer = {
  startActiveSpan: (name, callback) =>
    trace
      .getTracer('@watcher/observability')
      .startActiveSpan(name, (span) => callback(spanAdapter(span))),
};

export type AiOperationContext = {
  provider: string;
  model: string;
  operation: string;
  caller: string;
  correlationId?: string;
  jobId?: string;
};

export type AiUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reliableCostUsd?: number;
};

export const traceAiOperation = async <T>(
  context: AiOperationContext,
  task: () => Promise<T>,
  usage: ((result: T) => AiUsage) | undefined,
  tracer: AiTracer = defaultTracer,
): Promise<T> =>
  tracer.startActiveSpan(`gen_ai.${context.operation}`, async (span) => {
    const startedAt = performance.now();
    span.setAttributes({
      'gen_ai.system': context.provider,
      'gen_ai.request.model': context.model,
      'gen_ai.operation.name': context.operation,
      'watcher.caller': context.caller,
      ...(context.correlationId
        ? { 'watcher.correlation_id': context.correlationId }
        : {}),
      ...(context.jobId ? { 'watcher.job_id': context.jobId } : {}),
    });
    try {
      const result = await task();
      const observed = usage?.(result);
      span.setAttributes({
        'gen_ai.client.operation.duration_ms': Math.round(
          performance.now() - startedAt,
        ),
        ...(observed?.inputTokens === undefined
          ? {}
          : { 'gen_ai.usage.input_tokens': observed.inputTokens }),
        ...(observed?.outputTokens === undefined
          ? {}
          : { 'gen_ai.usage.output_tokens': observed.outputTokens }),
        ...(observed?.reliableCostUsd === undefined
          ? {}
          : { 'gen_ai.usage.cost_usd': observed.reliableCostUsd }),
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const sanitizedFailure = new Error('AI provider operation failed');
      span.recordException(sanitizedFailure);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'AI provider operation failed',
      });
      throw error;
    } finally {
      span.end();
    }
  });
