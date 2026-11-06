import type { Endpoint, PayloadRequest } from 'payload';
import { roleOf } from '../access/roles';
import { loadEnv } from '../env';
import { errorResponse, htmlResponse, jsonResponse } from '../lib/http';
import { buildIngestOpenApi, buildPublicOpenApi } from './build';

export const SWAGGER_UI_VERSION = '5.32.0';
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

const swaggerHtml = (title: string, initPath: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="stylesheet" href="${CDN}/swagger-ui.css" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${CDN}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
<script src="${initPath}"></script>
</body>
</html>`;

const initScript = (specPath: string) =>
  `window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specPath)}, dom_id: '#swagger-ui', deepLinking: true, tryItOutEnabled: true });\n`;

const CSP = [
  "default-src 'none'",
  `script-src 'self' https://cdn.jsdelivr.net`,
  `style-src https://cdn.jsdelivr.net 'unsafe-inline'`,
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const script = (body: string) =>
  new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** Private ingestion docs require a signed-in CMS user (and sit behind Cloudflare Access). */
const requireStaff = (req: PayloadRequest): Response | null =>
  roleOf(req.user)
    ? null
    : errorResponse(
        401,
        'unauthorized',
        'Sign in to the CMS admin to view the ingestion API documentation',
      );

export const docsEndpoints: Endpoint[] = [
  {
    path: '/public/openapi.json',
    method: 'get',
    handler: () => {
      const response = jsonResponse(buildPublicOpenApi(loadEnv().SERVER_URL), {
        cacheSeconds: 3600,
      });
      response.headers.set('Access-Control-Allow-Origin', '*');
      return response;
    },
  },
  {
    path: '/public/docs',
    method: 'get',
    handler: () =>
      htmlResponse(
        swaggerHtml('Vantuch Content API', '/api/public/docs/init.js'),
        CSP,
      ),
  },
  {
    path: '/public/docs/init.js',
    method: 'get',
    handler: () => script(initScript('/api/public/openapi.json')),
  },
  {
    path: '/ingest/openapi.json',
    method: 'get',
    handler: (req) =>
      requireStaff(req) ??
      jsonResponse(buildIngestOpenApi(loadEnv().SERVER_URL)),
  },
  {
    path: '/ingest/docs',
    method: 'get',
    handler: (req) => {
      const denied = requireStaff(req);
      if (denied) return denied;
      const response = htmlResponse(
        swaggerHtml(
          'Vantuch Content API – Ingestion',
          '/api/ingest/docs/init.js',
        ),
        CSP,
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    },
  },
  {
    path: '/ingest/docs/init.js',
    method: 'get',
    handler: () => script(initScript('/api/ingest/openapi.json')),
  },
];
