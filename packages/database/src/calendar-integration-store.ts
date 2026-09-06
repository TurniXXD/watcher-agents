import type { DatabaseClient } from './client.js';
import { BriefingConfigurationStore } from './briefing-configuration-store.js';

export type CalendarIntegrationRecord = {
  connected: boolean;
  encryptedRefreshToken?: string;
  calendarIds: string[];
  connectedAt?: Date;
  lastRefreshAt?: Date;
};

export class CalendarIntegrationStore {
  private readonly configuration: BriefingConfigurationStore;

  public constructor(private readonly db: DatabaseClient) {
    this.configuration = new BriefingConfigurationStore(db);
  }

  public async beginAuthorization(
    telegramChatId: bigint,
    oauthStateHash: string,
    expiresAt: Date,
  ): Promise<void> {
    const configuration = await this.configuration.ensure(telegramChatId);
    await this.db.calendarIntegrationState.upsert({
      where: { settingsId: configuration.settings.id },
      create: {
        settingsId: configuration.settings.id,
        oauthStateHash,
        oauthStateExpiresAt: expiresAt,
      },
      update: { oauthStateHash, oauthStateExpiresAt: expiresAt },
    });
  }

  public async completeAuthorization(
    oauthStateHash: string,
    encryptedRefreshToken: string,
    now = new Date(),
  ): Promise<bigint> {
    return this.db.$transaction(async (transaction) => {
      const pending = await transaction.calendarIntegrationState.findUnique({
        where: { oauthStateHash },
        include: { settings: { select: { telegramChatId: true } } },
      });
      if (
        !pending ||
        !pending.oauthStateExpiresAt ||
        pending.oauthStateExpiresAt < now
      ) {
        throw new Error('Calendar OAuth state is invalid or expired');
      }
      await transaction.calendarIntegrationState.update({
        where: { id: pending.id },
        data: {
          encryptedRefreshToken,
          connectedAt: now,
          oauthStateHash: null,
          oauthStateExpiresAt: null,
        },
      });
      await transaction.briefingSettings.update({
        where: { id: pending.settingsId },
        data: { calendarEnabled: true },
      });
      return pending.settings.telegramChatId;
    });
  }

  public async get(
    telegramChatId: bigint,
  ): Promise<CalendarIntegrationRecord | undefined> {
    const integration = await this.db.calendarIntegrationState.findFirst({
      where: { settings: { telegramChatId } },
    });
    if (!integration) return undefined;
    return {
      connected: Boolean(integration.encryptedRefreshToken),
      ...(integration.encryptedRefreshToken
        ? { encryptedRefreshToken: integration.encryptedRefreshToken }
        : {}),
      calendarIds: integration.calendarIds,
      ...(integration.connectedAt
        ? { connectedAt: integration.connectedAt }
        : {}),
      ...(integration.lastRefreshAt
        ? { lastRefreshAt: integration.lastRefreshAt }
        : {}),
    };
  }

  public async markRefreshed(telegramChatId: bigint, at = new Date()) {
    await this.db.calendarIntegrationState.updateMany({
      where: { settings: { telegramChatId } },
      data: { lastRefreshAt: at },
    });
  }

  public async disconnect(telegramChatId: bigint): Promise<void> {
    const configuration = await this.configuration.ensure(telegramChatId);
    await this.db.$transaction([
      this.db.calendarIntegrationState.deleteMany({
        where: { settingsId: configuration.settings.id },
      }),
      this.db.briefingSettings.update({
        where: { id: configuration.settings.id },
        data: { calendarEnabled: false },
      }),
    ]);
  }
}
