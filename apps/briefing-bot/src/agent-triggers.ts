import { z } from 'zod';

const brnoSourceSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const brnoResultSchema = z.discriminatedUnion('status', [
  z.object({
    source: z.string(),
    status: z.literal('success'),
    fetched: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({ source: z.string(), status: z.literal('busy') }),
  z.object({
    source: z.string(),
    status: z.literal('failed'),
    error: z.string(),
  }),
]);
const brnoResponseSchema = z.object({
  status: z.enum(['success', 'partial']),
  results: z.array(brnoResultSchema),
});
const muResponseSchema = z.object({
  status: z.enum(['BUSY', 'SUCCESS', 'PARTIAL', 'FAILED']),
  sourceCount: z.number().int().nonnegative(),
  fetchedCount: z.number().int().nonnegative(),
  activityCount: z.number().int().nonnegative(),
  sourceFailures: z.array(
    z.object({ sourceId: z.string(), message: z.string() }),
  ),
  briefingPublished: z.number().int().nonnegative(),
});

const agentAliases = {
  stocks: 'stocks',
  stock: 'stocks',
  medical: 'medical',
  publications: 'medical',
  news: 'news',
  'mu-clubs': 'mu-clubs',
  mu: 'mu-clubs',
  'brno-events': 'brno-events',
  brno: 'brno-events',
} as const;

export type TriggerableAgentId =
  'stocks' | 'medical' | 'news' | 'mu-clubs' | 'brno-events';
export type AgentTriggerOutcome = {
  status: 'QUEUED' | 'BUSY' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  message: string;
};
export type WatcherRunRequester = {
  requestWatcherRun: (
    telegramChatId: bigint,
    watcherId: 'stocks' | 'medical' | 'news',
  ) => Promise<
    | { status: 'QUEUED' }
    | { status: 'BUSY' }
    | { status: 'DISABLED' }
    | { status: 'NOT_CONFIGURED' }
  >;
};
export type AgentTriggerRunner = {
  describe: () => string;
  trigger: (
    telegramChatId: bigint,
    requestedAgent: string,
    source?: string,
  ) => Promise<AgentTriggerOutcome>;
};

type ApiTarget = { baseUrl: string; token: string };
type AgentTriggerOptions = {
  watchers: WatcherRunRequester;
  brnoEvents?: ApiTarget;
  muClubs?: ApiTarget;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

export class AgentTriggerError extends Error {}

const safeError = (value: unknown): string =>
  (typeof value === 'string' ? value : 'Unexpected response')
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, 500);

const telegramMessage = (lines: string[]): string => {
  const message = lines.join('\n');
  return message.length <= 4_000 ? message : `${message.slice(0, 3_999)}…`;
};

const normalizedUrl = (baseUrl: string, path: string): URL =>
  new URL(path, `${baseUrl.replace(/\/+$/u, '')}/`);

export class AgentTriggerService implements AgentTriggerRunner {
  readonly #watchers: WatcherRunRequester;
  readonly #brnoEvents: ApiTarget | undefined;
  readonly #muClubs: ApiTarget | undefined;
  readonly #timeoutMs: number;
  readonly #fetcher: typeof fetch;

  public constructor(options: AgentTriggerOptions) {
    this.#watchers = options.watchers;
    this.#brnoEvents = options.brnoEvents;
    this.#muClubs = options.muClubs;
    this.#timeoutMs = options.timeoutMs ?? 180_000;
    this.#fetcher = options.fetcher ?? fetch;
  }

  public describe(): string {
    return [
      'Available producer triggers:',
      '',
      '• stocks — queue Stocks Bot now',
      '• medical — queue Publications Bot now',
      '• news — queue News Bot now',
      `• mu-clubs — run MU Clubs Monitor now${this.#muClubs ? '' : ' (API not configured)'}`,
      `• brno-events [SOURCE] — run all enabled Brno sources or one source${this.#brnoEvents ? '' : ' (API not configured)'}`,
      '',
      'Usage: /trigger brno-events',
      'Source example: /trigger brno-events goout',
      'Brno sources: meetup, goout, visitbrno, muni, vut, jic, ceitec',
    ].join('\n');
  }

  public async trigger(
    telegramChatId: bigint,
    requestedAgent: string,
    source?: string,
  ): Promise<AgentTriggerOutcome> {
    const normalized = requestedAgent.trim().toLowerCase();
    const agent = agentAliases[normalized as keyof typeof agentAliases];
    if (!agent)
      throw new AgentTriggerError(`Unknown producer: ${requestedAgent}`);
    if (agent === 'brno-events') return this.#triggerBrno(source);
    if (source)
      throw new AgentTriggerError(
        `${agent} does not support a source argument.`,
      );
    if (agent === 'mu-clubs') return this.#triggerMuClubs();
    return this.#triggerWatcher(telegramChatId, agent);
  }

  async #triggerWatcher(
    telegramChatId: bigint,
    agent: 'stocks' | 'medical' | 'news',
  ): Promise<AgentTriggerOutcome> {
    const result = await this.#watchers.requestWatcherRun(
      telegramChatId,
      agent,
    );
    if (result.status === 'QUEUED')
      return {
        status: 'QUEUED',
        message: `✅ ${agent} is queued to run on its next scheduler tick.`,
      };
    if (result.status === 'BUSY')
      return { status: 'BUSY', message: `⏳ ${agent} is already running.` };
    if (result.status === 'DISABLED')
      throw new AgentTriggerError(
        `${agent} is paused. Resume it in its own Telegram bot first.`,
      );
    throw new AgentTriggerError(
      `${agent} is not configured for this Telegram chat.`,
    );
  }

  async #triggerBrno(source?: string): Promise<AgentTriggerOutcome> {
    if (!this.#brnoEvents)
      throw new AgentTriggerError('Brno Events trigger API is not configured.');
    const sourceId = source ? brnoSourceSchema.safeParse(source) : undefined;
    if (sourceId && !sourceId.success)
      throw new AgentTriggerError(
        'Invalid Brno source ID. Use /agents to see the command format.',
      );
    const path = sourceId ? `run/${sourceId.data}` : 'run';
    const response = await this.#post(this.#brnoEvents, path);
    if (!response.ok) throw await this.#httpError('Brno Events', response);
    const parsed = brnoResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new AgentTriggerError('Brno Events returned an invalid response.');
    const lines = parsed.data.results.map((result) => {
      if (result.status === 'busy')
        return `• ${result.source}: already running`;
      if (result.status === 'failed')
        return `• ${result.source}: failed — ${safeError(result.error)}`;
      return `• ${result.source}: fetched ${result.fetched}, created ${result.created}, updated ${result.updated}, duplicates ${result.duplicates}`;
    });
    const hasFailure = parsed.data.results.some(
      ({ status }) => status === 'failed',
    );
    const allBusy =
      parsed.data.results.length > 0 &&
      parsed.data.results.every(({ status }) => status === 'busy');
    return {
      status: hasFailure ? 'PARTIAL' : allBusy ? 'BUSY' : 'SUCCESS',
      message: telegramMessage([
        hasFailure
          ? '⚠️ Brno Events search and evaluation finished with source failures.'
          : allBusy
            ? '⏳ Requested Brno Events sources are already running.'
            : '✅ Brno Events search and evaluation finished.',
        ...lines,
      ]),
    };
  }

  async #triggerMuClubs(): Promise<AgentTriggerOutcome> {
    if (!this.#muClubs)
      throw new AgentTriggerError('MU Clubs trigger API is not configured.');
    const response = await this.#post(this.#muClubs, 'run');
    if (!response.ok && response.status !== 409)
      throw await this.#httpError('MU Clubs', response);
    const parsed = muResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new AgentTriggerError('MU Clubs returned an invalid response.');
    const { status, sourceCount, fetchedCount, activityCount, sourceFailures } =
      parsed.data;
    if (status === 'BUSY')
      return { status: 'BUSY', message: '⏳ MU Clubs is already running.' };
    return {
      status,
      message: telegramMessage([
        status === 'SUCCESS'
          ? '✅ MU Clubs search and evaluation finished.'
          : '⚠️ MU Clubs search and evaluation finished with failures.',
        `Sources ${sourceCount}, fetched ${fetchedCount}, relevant activities ${activityCount}, briefing events ${parsed.data.briefingPublished}.`,
        ...sourceFailures.map(
          ({ sourceId, message }) =>
            `• ${sourceId}: failed — ${safeError(message)}`,
        ),
      ]),
    };
  }

  #post(target: ApiTarget, path: string): Promise<Response> {
    return this.#fetcher(normalizedUrl(target.baseUrl, path), {
      method: 'POST',
      headers: { authorization: `Bearer ${target.token}` },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
  }

  async #httpError(agent: string, response: Response): Promise<Error> {
    const body = (await response.json().catch(() => undefined)) as
      { error?: unknown } | undefined;
    return new AgentTriggerError(
      `${agent} rejected the trigger (${response.status}): ${safeError(body?.error)}`,
    );
  }
}
