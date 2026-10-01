import { createServer } from 'node:http';

export const osintHealthResponse = (
  method: string | undefined,
  url: string | undefined,
  ready: boolean,
) => {
  if (method !== 'GET' || url !== '/healthz') {
    return { statusCode: 404, body: null } as const;
  }
  return {
    statusCode: ready ? 200 : 503,
    body: { status: ready ? 'ready' : 'starting' },
  } as const;
};

export const createOsintHealthServer = (isReady: () => boolean) =>
  createServer((request, response) => {
    const result = osintHealthResponse(request.method, request.url, isReady());
    if (!result.body) {
      response.writeHead(result.statusCode).end();
      return;
    }
    response
      .writeHead(result.statusCode, { 'content-type': 'application/json' })
      .end(JSON.stringify(result.body));
  });
