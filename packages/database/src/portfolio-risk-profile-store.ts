import type { DatabaseClient } from './client.js';
import type { PortfolioRiskTolerance } from './generated/prisma/enums.js';

export type PortfolioRiskProfileView = {
  tolerance: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  maxSinglePositionPercent: number;
  maxSectorPercent: number;
  maxTotalPaperNotionalCzk: number | null;
};

export type PortfolioRiskProfileUpdate = PortfolioRiskProfileView;

const view = (profile: {
  tolerance: PortfolioRiskTolerance;
  maxSinglePositionPercent: number;
  maxSectorPercent: number;
  maxTotalPaperNotionalCzk: number | null;
}): PortfolioRiskProfileView => ({
  tolerance: profile.tolerance,
  maxSinglePositionPercent: profile.maxSinglePositionPercent,
  maxSectorPercent: profile.maxSectorPercent,
  maxTotalPaperNotionalCzk: profile.maxTotalPaperNotionalCzk,
});

export class PortfolioRiskProfileStore {
  public constructor(private readonly db: DatabaseClient) {}

  public async get(chatConfigId: string): Promise<PortfolioRiskProfileView> {
    const profile = await this.db.portfolioRiskProfile.upsert({
      where: { chatConfigId },
      create: { chatConfigId },
      update: {},
    });
    return view(profile);
  }

  public async update(
    chatConfigId: string,
    input: PortfolioRiskProfileUpdate,
  ): Promise<PortfolioRiskProfileView> {
    const profile = await this.db.portfolioRiskProfile.upsert({
      where: { chatConfigId },
      create: { chatConfigId, ...input },
      update: input,
    });
    return view(profile);
  }
}
