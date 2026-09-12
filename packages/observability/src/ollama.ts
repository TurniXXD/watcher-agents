export type OllamaRequestPriority = 'high' | 'normal' | 'low';

export type OllamaRequestContext = {
  caller: string;
  model: string;
  operation: 'chat' | 'embedding';
  priority: OllamaRequestPriority;
  timeoutMs: number;
  inputSize?: number;
  signal?: AbortSignal;
};

export type OllamaActiveRequest = {
  id: string;
  caller: string;
  model: string;
  operation: string;
  startedAt: Date;
  leaseExpiresAt: Date;
  timeoutMs: number;
};

export type OllamaQueuedRequest = {
  id: string;
  caller: string;
  model: string;
  operation: string;
  queuedAt: Date;
  priority: OllamaRequestPriority;
};

export type OllamaQueueSnapshot = {
  observedAt: Date;
  active: OllamaActiveRequest[];
  queued: OllamaQueuedRequest[];
};

export interface OllamaRequestCoordinator {
  run<T>(context: OllamaRequestContext, task: () => Promise<T>): Promise<T>;
  snapshot(now?: Date): Promise<OllamaQueueSnapshot>;
}
