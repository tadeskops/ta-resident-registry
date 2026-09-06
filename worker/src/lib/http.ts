const ALLOWED_ORIGINS = new Set([
  'https://tadeskops.github.io',
  'http://localhost:8792',
  'http://127.0.0.1:8792',
]);

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://tadeskops.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, init: ResponseInit & { origin?: string | null } = {}): Response {
  const { origin, ...restInit } = init;
  return new Response(JSON.stringify(body), {
    status: restInit.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin ?? null),
      ...(restInit.headers as Record<string, string> | undefined),
    },
  });
}

export function noContent(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('expected application/json');
  const text = await req.text();
  if (!text) throw new Error('empty request body');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('invalid JSON');
  }
}
