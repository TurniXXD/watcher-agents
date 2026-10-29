import { describe, expect, it, vi } from 'vitest';
import {
  createJobsBot,
  jobsAbout,
  jobsBotCommands,
  jobsHelp,
  jobsStart,
} from '../bot.js';

const update = (text: string, updateId: number, userId = 123) => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    date: 1_792_368_000,
    chat: { id: userId, type: 'private' as const, first_name: 'Operator' },
    from: { id: userId, is_bot: false, first_name: 'Operator' },
    text,
    entities: [
      {
        offset: 0,
        length: text.includes(' ') ? text.indexOf(' ') : text.length,
        type: 'bot_command' as const,
      },
    ],
  },
});

const createHarness = () => {
  const store = {
    getOverview: vi.fn(),
    listSources: vi.fn(),
    listJobs: vi.fn(),
    setSourceEnabled: vi.fn(),
    updateApplication: vi.fn(),
    getActiveProfile: vi.fn(),
    updateProfile: vi.fn(),
  };
  const runner = { run: vi.fn(), reevaluateExisting: vi.fn() };
  const onRunComplete = vi.fn();
  const bot = createJobsBot({
    token: 'test-token',
    allowedUserIds: new Set([123]),
    store,
    runner,
    onRunComplete,
    reportError: () => undefined,
  } as never);
  bot.botInfo = {
    id: 456,
    is_bot: true,
    first_name: 'Jobs Bot',
    username: 'jobs_test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
  const messages: string[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    if (method !== 'sendMessage') throw new Error(`Unexpected ${method}`);
    if ('text' in payload && typeof payload.text === 'string') {
      messages.push(payload.text);
    }
    return { ok: true, result: { message_id: messages.length } } as never;
  });
  return { bot, messages, onRunComplete, runner, store };
};

describe('jobs bot informational commands', () => {
  it('serves exact authorized start, help, and about copy without side effects', async () => {
    const harness = createHarness();

    await harness.bot.handleUpdate(update('/start', 1));
    await harness.bot.handleUpdate(update('/help', 2));
    await harness.bot.handleUpdate(update('/about', 3));

    expect(harness.messages).toEqual([jobsStart, jobsHelp, jobsAbout]);
    expect(harness.runner.run).not.toHaveBeenCalled();
    expect(harness.onRunComplete).not.toHaveBeenCalled();
    for (const method of Object.values(harness.store)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('rejects an unauthorized informational command before domain access', async () => {
    const harness = createHarness();

    await harness.bot.handleUpdate(update('/about', 4, 999));

    expect(harness.messages).toEqual(['Unauthorized.']);
    expect(harness.runner.run).not.toHaveBeenCalled();
    for (const method of Object.values(harness.store)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('keeps the command registry, handlers, help text, and Telegram limits aligned', () => {
    expect(jobsBotCommands).toContainEqual(
      expect.objectContaining({ command: 'start' }),
    );
    expect(jobsBotCommands).toContainEqual(
      expect.objectContaining({ command: 'help' }),
    );
    expect(jobsBotCommands).toContainEqual(
      expect.objectContaining({ command: 'about' }),
    );
    for (const command of jobsBotCommands) {
      expect(jobsHelp).toContain(`/${command.command}`);
      expect(command.command.length).toBeLessThanOrEqual(32);
      expect(command.description.length).toBeLessThanOrEqual(256);
    }
    expect(jobsStart.length).toBeLessThanOrEqual(4_096);
    expect(jobsHelp.length).toBeLessThanOrEqual(4_096);
    expect(jobsAbout.length).toBeLessThanOrEqual(4_096);
  });

  it('validates mutating command syntax before calling the store', async () => {
    const harness = createHarness();

    await harness.bot.handleUpdate(update('/jobs_source remote-ok maybe', 5));
    await harness.bot.handleUpdate(update('/jobs_mark job-id UNKNOWN', 6));
    await harness.bot.handleUpdate(update('/jobs_note job-id', 7));

    expect(harness.messages).toEqual([
      'Usage: /jobs_source SOURCE_ID on|off',
      'Usage: /jobs_mark JOB_ID STATUS — see /help for statuses.',
      'Usage: /jobs_note JOB_ID NOTE',
    ]);
    expect(harness.store.setSourceEnabled).not.toHaveBeenCalled();
    expect(harness.store.updateApplication).not.toHaveBeenCalled();
  });

  it('omits confirmed closed vacancies from the latest matches', async () => {
    const harness = createHarness();
    harness.store.listJobs.mockResolvedValue([
      {
        id: 'closed-job',
        title: 'Closed Developer',
        company: 'Example',
        originalUrl: 'https://example.com/closed',
        canonicalApplicationUrl: null,
        availabilityStatus: 'CLOSED_CONFIRMED',
        evaluations: [{ score: 90, eligibility: 'ELIGIBLE' }],
      },
      {
        id: 'open-job',
        title: 'Open Developer',
        company: 'Example',
        originalUrl: 'https://example.com/open',
        canonicalApplicationUrl: null,
        availabilityStatus: 'OPEN_CONFIRMED',
        evaluations: [{ score: 85, eligibility: 'ELIGIBLE' }],
      },
    ] as never);

    await harness.bot.handleUpdate(update('/jobs_latest', 8));

    expect(harness.messages.join('\n')).toContain('Open Developer');
    expect(harness.messages.join('\n')).not.toContain('Closed Developer');
  });

  it('shows the stored reason and check time for a degraded source', async () => {
    const harness = createHarness();
    harness.store.listSources.mockResolvedValue([
      {
        id: 'jobs-cz',
        enabled: true,
        healthStatus: 'DEGRADED',
        lastError: 'HTTP 403 from jobs.cz',
        lastCheckedAt: new Date('2026-10-28T10:00:00Z'),
        lastSuccessfulAt: new Date('2026-10-27T10:00:00Z'),
      },
    ] as never);
    await harness.bot.handleUpdate(update('/jobs_sources', 9));
    expect(harness.messages.join('\n')).toContain(
      'Last error: HTTP 403 from jobs.cz',
    );
    expect(harness.messages.join('\n')).toContain(
      'Checked: 2026-10-28T10:00:00.000Z',
    );
    expect(harness.messages.join('\n')).toContain(
      'Last success: 2026-10-27T10:00:00.000Z',
    );
  });

  it('does not let an unauthorized user edit filters', async () => {
    const harness = createHarness();
    await harness.bot.handleUpdate(
      update('/jobs_filter country block add Czechia', 10, 999),
    );
    expect(harness.messages).toEqual(['Unauthorized.']);
    expect(harness.store.getActiveProfile).not.toHaveBeenCalled();
    expect(harness.store.updateProfile).not.toHaveBeenCalled();
  });

  it('persists the additive sales category and re-evaluates stored jobs', async () => {
    const harness = createHarness();
    harness.store.getActiveProfile.mockResolvedValue({
      row: { id: 'profile-1' },
      profile: {
        name: 'Candidate',
        professionalTitle: 'Full-Stack Developer',
        yearsExperience: 5,
        evaluationMode: 'TECHNICAL',
        searchCategories: { salesBusinessDevelopment: false },
        educationLevel: 'Secondary technical school',
        languages: { Czech: 'native', English: 'B2' },
        preferredRoles: ['Full-Stack Developer'],
        avoidedRoles: [],
        requiredTechnologies: ['TypeScript'],
        excludedTechnologies: [],
        adjacentRoles: [],
        preferredContractTypes: ['employment'],
        preferredLocations: {
          countries: ['Czechia'],
          regions: [],
          cities: ['Brno'],
          remote: true,
          hybrid: false,
          onsite: true,
        },
        skills: [{ name: 'TypeScript', proficiency: 'ADVANCED' }],
        experience: [],
        weights: {
          technology: 30,
          experience: 20,
          role: 15,
          location: 15,
          language: 10,
          career: 5,
          conditions: 5,
        },
        thresholds: { excellent: 85, strong: 70, possible: 55, notify: 70 },
      },
    });
    harness.runner.reevaluateExisting.mockResolvedValue({
      scanned: 4,
      evaluated: 4,
    });

    await harness.bot.handleUpdate(update('/jobs_category sales on', 11));

    expect(harness.store.updateProfile).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({
        searchCategories: { salesBusinessDevelopment: true },
        professionalTitle: 'Full-Stack Developer',
      }),
    );
    expect(harness.runner.reevaluateExisting).toHaveBeenCalledOnce();
    expect(harness.messages).toEqual([
      '✅ Search category saved. Re-evaluating stored jobs…',
      'Re-evaluated 4 of 4 stored jobs.',
    ]);
  });

  it('does not let an unauthorized user edit search categories', async () => {
    const harness = createHarness();
    await harness.bot.handleUpdate(update('/jobs_category sales off', 12, 999));
    expect(harness.messages).toEqual(['Unauthorized.']);
    expect(harness.store.getActiveProfile).not.toHaveBeenCalled();
    expect(harness.store.updateProfile).not.toHaveBeenCalled();
  });
});
