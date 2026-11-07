import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { s3Storage } from '@payloadcms/storage-s3';
import { buildConfig } from 'payload';
import sharp from 'sharp';
import { Articles } from './collections/articles';
import { Events } from './collections/events';
import {
  IngestionClients,
  IngestionRecords,
  IngestionRuns,
} from './collections/ingestion';
import { Media } from './collections/media';
import { News } from './collections/news';
import { PendingUpdates } from './collections/pending-updates';
import { Publications } from './collections/publications';
import { SocialPosts } from './collections/social-posts';
import { Sources } from './collections/sources';
import { Users } from './collections/users';
import { loadEnv, s3Enabled } from './env';
import { Settings } from './globals/settings';
import { credentialEndpoint } from './ingestion/credential-endpoint';
import { ingestEndpoints } from './ingestion/endpoints';
import { legacyBackfillTask } from './jobs/legacy-backfill';
import { contentMcpPlugin } from './mcp/plugin';
import { migrations } from './migrations';
import { docsEndpoints } from './openapi/endpoints';
import { publicEndpoints } from './public-api/endpoints';
import { systemEndpoints } from './system/endpoints';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const serverUrl = env.SERVER_URL.replace(/\/$/u, '');

export default buildConfig({
  serverURL: serverUrl,
  secret: env.PAYLOAD_SECRET,
  telemetry: false,
  // Admin sessions only; the public site uses the public API, never GraphQL.
  graphQL: { disable: true },
  cors: [serverUrl],
  csrf: [...new Set([serverUrl, ...env.CSRF_ORIGINS])],
  admin: {
    user: 'users',
    importMap: { baseDir: dirname },
    meta: {
      titleSuffix: ' · Vantuch Content Hub',
      description: 'Editorial workspace for vantuch.dev content.',
      robots: 'noindex, nofollow',
    },
    components: {
      graphics: {
        Logo: '/components/Brand#Logo',
        Icon: '/components/Brand#Icon',
      },
      beforeDashboard: ['/components/Brand#DashboardIntro'],
    },
    dateFormat: 'd. M. yyyy HH:mm',
    // Built-in avatar: no third-party Gravatar requests with editor email hashes.
    avatar: 'default',
  },
  collections: [
    Events,
    Articles,
    News,
    Publications,
    SocialPosts,
    Media,
    Sources,
    IngestionRuns,
    PendingUpdates,
    IngestionRecords,
    Users,
    IngestionClients,
  ],
  globals: [Settings],
  endpoints: [
    ...systemEndpoints,
    ...publicEndpoints,
    ...docsEndpoints,
    ...ingestEndpoints,
    credentialEndpoint,
  ],
  editor: lexicalEditor(),
  sharp,
  upload: {
    limits: {
      fileSize: Math.ceil(
        Math.max(
          env.MEDIA_MAX_IMAGE_SIZE_MB,
          env.MEDIA_MAX_DOCUMENT_SIZE_MB,
          env.MEDIA_MAX_VIDEO_SIZE_MB,
        ) *
          1024 *
          1024,
      ),
    },
  },
  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URI, max: env.DATABASE_POOL_MAX },
    idType: 'uuid',
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    prodMigrations: migrations,
  }),
  plugins: [
    contentMcpPlugin(env.MCP_ENABLED),
    s3Storage({
      enabled: s3Enabled(env),
      collections: { media: { prefix: env.S3_PREFIX } },
      bucket: env.S3_BUCKET ?? 'unused',
      config: {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
        },
      },
    }),
  ],
  jobs: {
    // Runs scheduled publish/unpublish jobs inside this long-running server.
    autoRun: [{ cron: '* * * * *', limit: 20, queue: 'default' }],
    shouldAutoRun: () => env.PAYLOAD_JOBS_AUTORUN,
    // One-off import of pre-CMS bot content, queued by a data migration.
    tasks: [legacyBackfillTask],
  },
  logger: {
    options: { level: env.LOG_LEVEL, base: { service: 'content-cms' } },
  },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
});
