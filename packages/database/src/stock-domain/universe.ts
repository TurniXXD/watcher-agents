import { z } from 'zod';
import type { EventBus } from './events.js';

export const monitoringTierSchema = z.enum([
  'CORE',
  'WATCH',
  'DISCOVERY',
  'INVESTIGATE',
]);
export type MonitoringTier = z.infer<typeof monitoringTierSchema>;

export const monitoringModeSchema = z.enum([
  'LOW_RESOLUTION',
  'NORMAL',
  'HIGH_RESOLUTION',
  'EVENT_MODE',
]);
export type MonitoringMode = z.infer<typeof monitoringModeSchema>;

export const companyUniverseInputSchema = z.object({
  chatConfigId: z.string().min(1),
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  companyName: z.string().trim().min(1),
  cik: z.string().trim().min(1).nullable().default(null),
  exchange: z.string().trim().min(1).nullable().default(null),
  sector: z.string().trim().min(1).nullable().default(null),
  industry: z.string().trim().min(1).nullable().default(null),
  marketCap: z.number().nonnegative().nullable().default(null),
  currency: z.string().trim().min(3).max(3).nullable().default(null),
  country: z.string().trim().min(2).nullable().default(null),
  investorRelationsUrl: z.url().nullable().default(null),
  enabled: z.boolean().default(true),
  monitoringTier: monitoringTierSchema.default('WATCH'),
  monitoringMode: monitoringModeSchema.default('NORMAL'),
  priority: z.number().int().min(0).max(100).default(50),
  tags: z.array(z.string().trim().min(1)).default([]),
  watchReason: z.string().trim().min(1).nullable().default(null),
  watchUntil: z.date().nullable().default(null),
});

export type CompanyUniverseInput = z.output<typeof companyUniverseInputSchema>;

export type CompanyUniverseRecord = CompanyUniverseInput & {
  id: string;
};

export type CompanyStateUpdate = {
  monitoringTier?: MonitoringTier;
  monitoringMode?: MonitoringMode;
  priority?: number;
  attentionScore?: number;
  enabled?: boolean;
  watchReason?: string | null;
  watchUntil?: Date | null;
  watchStartedAt?: Date | null;
  investigationStartedAt?: Date | null;
  investigateUntil?: Date | null;
  highResolutionUntil?: Date | null;
  nextHighResolutionCheckAt?: Date | null;
};

export interface CompanyUniverseRepository {
  createCompany(input: CompanyUniverseInput): Promise<CompanyUniverseRecord>;
  findCompany(
    chatConfigId: string,
    ticker: string,
  ): Promise<CompanyUniverseRecord | null>;
  updateCompanyState(
    companyId: string,
    update: CompanyStateUpdate,
  ): Promise<CompanyUniverseRecord>;
}

const automatedTierTransitions: Record<MonitoringTier, MonitoringTier[]> = {
  CORE: ['WATCH'],
  WATCH: ['CORE', 'DISCOVERY'],
  DISCOVERY: ['INVESTIGATE'],
  INVESTIGATE: ['WATCH', 'DISCOVERY'],
};

export const assertCompanyTransition = (
  current: MonitoringTier,
  next: MonitoringTier,
  cause: 'MANUAL' | 'AUTOMATED',
): void => {
  if (current === next || cause === 'MANUAL') {
    return;
  }
  if (!automatedTierTransitions[current].includes(next)) {
    throw new Error(`Invalid automated tier transition: ${current} -> ${next}`);
  }
};

export class CompanyUniverseManager {
  public constructor(
    private readonly repository: CompanyUniverseRepository,
    private readonly events: EventBus,
  ) {}

  public async addCompany(
    input: z.input<typeof companyUniverseInputSchema>,
  ): Promise<CompanyUniverseRecord> {
    const company = await this.repository.createCompany(
      companyUniverseInputSchema.parse(input),
    );
    await this.events.publish({
      type: 'company.added',
      aggregateType: 'COMPANY',
      aggregateId: company.id,
      payload: {
        ticker: company.ticker,
        monitoringTier: company.monitoringTier,
        monitoringMode: company.monitoringMode,
      },
    });
    return company;
  }

  public async updateState(
    chatConfigId: string,
    ticker: string,
    update: CompanyStateUpdate,
    cause: 'MANUAL' | 'AUTOMATED' = 'MANUAL',
  ): Promise<CompanyUniverseRecord> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const company = await this.repository.findCompany(
      chatConfigId,
      normalizedTicker,
    );
    if (!company) {
      throw new Error(`${normalizedTicker} is not configured`);
    }
    if (update.monitoringTier) {
      assertCompanyTransition(
        company.monitoringTier,
        update.monitoringTier,
        cause,
      );
    }
    if (update.priority !== undefined) {
      z.number().int().min(0).max(100).parse(update.priority);
    }
    if (update.attentionScore !== undefined) {
      z.number().int().min(0).max(100).parse(update.attentionScore);
    }
    const updated = await this.repository.updateCompanyState(
      company.id,
      update,
    );
    await this.events.publish({
      type: 'company.state_changed',
      aggregateType: 'COMPANY',
      aggregateId: company.id,
      payload: {
        ticker: company.ticker,
        previousTier: company.monitoringTier,
        monitoringTier: updated.monitoringTier,
        previousMode: company.monitoringMode,
        monitoringMode: updated.monitoringMode,
        cause,
      },
    });
    return updated;
  }
}
