import type { Endpoint } from 'payload';
import { z } from 'zod';
import { hasRole } from '../access/roles';
import { ingestibleCollections } from '../collections/ingestion';
import { errorResponse, jsonResponse, zodDetails } from '../lib/http';
import { generateCredential } from './credentials';

export const createCredentialSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    botId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/u),
    scopes: z.array(z.enum(ingestibleCollections)).min(1),
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

/**
 * Admin-only credential creation used by the Bot Credentials admin form. The
 * token is returned exactly once; only its SHA-256 hash is stored.
 */
export const credentialEndpoint: Endpoint = {
  path: '/ingest/credentials',
  method: 'post',
  handler: async (req) => {
    if (!hasRole(req.user, 'admin'))
      return errorResponse(403, 'forbidden', 'Administrators only');
    let body: unknown;
    try {
      body = await req.json?.();
    } catch {
      return errorResponse(400, 'bad_request', 'Malformed JSON');
    }
    const parsed = createCredentialSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        400,
        'validation_failed',
        'Invalid credential request',
        { details: zodDetails(parsed.error.issues) },
      );
    }
    const credential = generateCredential();
    await req.payload.create({
      collection: 'ingestion-clients',
      data: {
        name: parsed.data.name,
        botId: parsed.data.botId,
        keyId: credential.keyId,
        secretHash: credential.secretHash,
        scopes: parsed.data.scopes,
        active: true,
        ...(parsed.data.expiresInDays
          ? {
              expiresAt: new Date(
                Date.now() + parsed.data.expiresInDays * 86_400_000,
              ).toISOString(),
            }
          : {}),
      },
      overrideAccess: true,
    });
    req.payload.logger.info(
      {
        audit: 'credential-created',
        keyId: credential.keyId,
        botId: parsed.data.botId,
        scopes: parsed.data.scopes,
        by: req.user?.id,
      },
      'Bot credential created',
    );
    return jsonResponse(
      {
        keyId: credential.keyId,
        botId: parsed.data.botId,
        token: credential.token,
      },
      { status: 201 },
    );
  },
};
