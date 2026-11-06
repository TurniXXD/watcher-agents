import { sql } from '@payloadcms/db-postgres';
import type { Endpoint } from 'payload';
import { jsonResponse } from '../lib/http';
import { isShuttingDown } from './lifecycle';

/** Liveness: the process serves requests. Readiness: the database answers and we are not draining. */
export const systemEndpoints: Endpoint[] = [
  {
    path: '/health',
    method: 'get',
    handler: () => jsonResponse({ status: 'ok' }),
  },
  {
    path: '/ready',
    method: 'get',
    handler: async (req) => {
      if (isShuttingDown())
        return jsonResponse({ status: 'shutting_down' }, { status: 503 });
      try {
        const db = req.payload.db as unknown as {
          drizzle: { execute: (query: unknown) => Promise<unknown> };
        };
        await db.drizzle.execute(sql`select 1`);
        return jsonResponse({ status: 'ready' });
      } catch (error) {
        req.payload.logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          'Readiness check failed',
        );
        return jsonResponse({ status: 'unavailable' }, { status: 503 });
      }
    },
  },
];
