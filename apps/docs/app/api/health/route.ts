export const dynamic = 'force-dynamic';

export const GET = (): Response =>
  Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
