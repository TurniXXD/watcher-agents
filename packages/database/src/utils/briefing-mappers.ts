import type {
  BriefingConfidence,
  BriefingEventStatus as CoreBriefingEventStatus,
  WatcherBotId,
} from '@watcher/core';
import type {
  BriefingConfidence as DatabaseBriefingConfidence,
  BriefingEventStatus,
  BriefingWatcherHealthStatus,
} from '../generated/prisma/enums.js';
import {
  BriefingWatcherBot,
  BriefingVoice,
} from '../generated/prisma/enums.js';

export type BriefingVoiceId = 'amy' | 'hfc_female' | 'hfc_male';
export type BriefingWatcherHealthStatusId =
  'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export const toDatabaseWatcher = (
  watcherBot: WatcherBotId,
): BriefingWatcherBot =>
  ({
    stocks: BriefingWatcherBot.STOCKS,
    medical: BriefingWatcherBot.MEDICAL,
    news: BriefingWatcherBot.NEWS,
    'mu-clubs': BriefingWatcherBot.MU_CLUBS,
  })[watcherBot];

export const fromDatabaseWatcher = (
  watcherBot: BriefingWatcherBot,
): WatcherBotId =>
  ({
    [BriefingWatcherBot.STOCKS]: 'stocks',
    [BriefingWatcherBot.MEDICAL]: 'medical',
    [BriefingWatcherBot.NEWS]: 'news',
    [BriefingWatcherBot.MU_CLUBS]: 'mu-clubs',
  })[watcherBot] as WatcherBotId;

export const fromDatabaseConfidence = (
  confidence: DatabaseBriefingConfidence,
): BriefingConfidence => confidence;

export const fromDatabaseEventStatus = (
  status: BriefingEventStatus,
): CoreBriefingEventStatus => status;

export const toDatabaseVoice = (voice: BriefingVoiceId): BriefingVoice =>
  ({
    amy: BriefingVoice.AMY,
    hfc_female: BriefingVoice.HFC_FEMALE,
    hfc_male: BriefingVoice.HFC_MALE,
  })[voice];

export const fromDatabaseVoice = (voice: BriefingVoice): BriefingVoiceId =>
  ({
    [BriefingVoice.AMY]: 'amy',
    [BriefingVoice.HFC_FEMALE]: 'hfc_female',
    [BriefingVoice.HFC_MALE]: 'hfc_male',
  })[voice] as BriefingVoiceId;

export const fromDatabaseBriefingWatcherHealth = (
  status: BriefingWatcherHealthStatus,
): BriefingWatcherHealthStatusId => status;
