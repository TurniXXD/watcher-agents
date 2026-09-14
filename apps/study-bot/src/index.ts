import { checkOllamaReady, createLogger, ReadinessServer } from '@watcher/core';
import {
  createDatabaseClient,
  PostgresOllamaCoordinator,
  ResourceLeaseStore,
  StudyStore,
} from '@watcher/database';
import { parseAllowedUserIds } from '@watcher/telegram';
import { createStudyBot, createStudyTransport } from './bot.js';
import { env } from './config/env.js';
import { PdfJsExtractor } from './ingestion/pdf-extractor.js';
import { OllamaStudyLlm } from './llm/study-llm.js';
import { S3StudyStorage } from './storage/s3-storage.js';
import { StudyService } from './study-service.js';
import { PiperStudyTtsProvider } from './tts/piper-tts.js';

const logger = createLogger('study-bot', env.LOG_LEVEL);
const database = createDatabaseClient(env.DATABASE_URL);
const coordinator = new PostgresOllamaCoordinator(database, logger);
const store = new StudyStore(database);
const storage = new S3StudyStorage({
  endpoint: env.STUDY_S3_ENDPOINT,
  region: env.STUDY_S3_REGION,
  accessKeyId: env.STUDY_S3_ACCESS_KEY_ID,
  secretAccessKey: env.STUDY_S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.STUDY_S3_FORCE_PATH_STYLE,
});
const llm = new OllamaStudyLlm({
  url: env.OLLAMA_URL,
  model: env.OLLAMA_MODEL,
  timeoutMs: env.STUDY_OLLAMA_TIMEOUT_MS,
  numCtx: env.STUDY_OLLAMA_NUM_CTX,
  numPredict: env.STUDY_OLLAMA_NUM_PREDICT,
  coordinator,
  logger,
});
const tts = new PiperStudyTtsProvider({
  dataDirectory: env.PIPER_DATA_DIR,
  voice: env.STUDY_TTS_VOICE,
});
let service: StudyService;
const bot = createStudyBot({
  token: env.STUDY_TELEGRAM_TOKEN,
  allowedIds: parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
  store,
  storage,
  documentsBucket: env.STUDY_S3_DOCUMENTS_BUCKET,
  maxPdfBytes: env.STUDY_MAX_PDF_SIZE_MB * 1_000_000,
  service: () => service,
  download: async (fileId) => {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path)
      throw new Error('Telegram did not return a file path.');
    const response = await fetch(
      `https://api.telegram.org/file/bot${env.STUDY_TELEGRAM_TOKEN}/${file.file_path}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok)
      throw new Error(
        `Telegram file download returned HTTP ${response.status}`,
      );
    return new Uint8Array(await response.arrayBuffer());
  },
  reportError: (error) =>
    logger.error({ err: error }, 'Study Telegram update failed'),
});
service = new StudyService({
  store,
  storage,
  extractor: new PdfJsExtractor(),
  llm,
  tts,
  lease: new ResourceLeaseStore(database),
  transport: createStudyTransport(bot),
  documentsBucket: env.STUDY_S3_DOCUMENTS_BUCKET,
  mediaBucket: env.STUDY_S3_MEDIA_BUCKET,
  maxPages: env.STUDY_MAX_DOCUMENT_PAGES,
  logger,
});
const interruptedJobs = await store.recoverInterruptedJobs();
for (const jobId of interruptedJobs) {
  void service
    .process(jobId)
    .catch((error: unknown) =>
      logger.error(
        { err: error, jobId },
        'Could not resume interrupted study job',
      ),
    );
}
const readiness = new ReadinessServer(async () => {
  await database.$queryRaw`SELECT 1`;
  await checkOllamaReady(env.OLLAMA_URL);
}, logger);
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Shutting down');
  readiness.markApplicationStopping();
  await bot.stop();
  await readiness.stop();
  await database.$disconnect();
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
await readiness.start();
await bot.start({
  onStart: () => {
    readiness.markApplicationReady();
    logger.info('Study bot started');
  },
});
