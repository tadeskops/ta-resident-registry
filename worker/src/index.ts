/**
 * TA Resident Registry — Cloudflare Worker (skeleton).
 *
 * ⚠️  This file is a route-contract skeleton. Handlers are placeholders
 * that return { ok:false, error:'not implemented' } — wire them up in
 * Phase 2 (see ../REQUIREMENT.md §6 for the full contract and
 * ../ARCHITECTURE.md for env vars and threat model).
 *
 * Key constraints we're deliberately inheriting from ta-society-helpdesk:
 *   - Envelope is { ok:true, data } or { ok:false, error:'string' }.
 *     `error` is a plain string, not { message }.
 *   - FeatureDisabled = 503 (not 404).
 *   - Bulk directory reads MUST use GitHub GraphQL batching to stay under
 *     Cloudflare Workers Free 50-subrequest cap.
 *   - JWT stored in localStorage on the client (not sessionStorage).
 */

interface Env {
  JWT_SECRET: string;
  GH_TOKEN: string;
  GH_OWNER: string;
  GH_REPO: string;
  GH_BRANCH: string;
  MAIL_PROVIDER: 'resend' | 'mailchannels';
  RESEND_API_KEY?: string;
  MAIL_FROM: string;
}

type Ok<T> = { ok: true; data: T };
type Bad = { ok: false; error: string };
const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
const bad = (error: string): Bad => ({ ok: false, error });

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://tadeskops.github.io',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...(init.headers || {}) },
  });
}

// -----------------------------------------------------------------------
// Very small router.  Real code should extract to worker/src/router.ts.
// -----------------------------------------------------------------------
type Handler = (req: Request, env: Env, params: Record<string, string>) => Promise<Response>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; }

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:[a-zA-Z_]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$'
  );
  return { method, pattern, keys, handler };
}

const ROUTES: Route[] = [
  route('POST', '/auth/otp/request', notImplemented('auth.otp.request')),
  route('POST', '/auth/otp/verify', notImplemented('auth.otp.verify')),
  route('GET', '/whoami', notImplemented('whoami')),
  route('GET', '/config', notImplemented('config')),

  route('GET', '/residents/me', notImplemented('residents.me.get')),
  route('PUT', '/residents/me', notImplemented('residents.me.put')),
  route('POST', '/residents/me/submit', notImplemented('residents.me.submit')),

  route('POST', '/uploads/photo', notImplemented('uploads.photo')),

  route('GET', '/residents', notImplemented('residents.list')),
  route('GET', '/residents/:tower/:flat', notImplemented('residents.get')),
  route('POST', '/residents/:tower/:flat/verify', notImplemented('residents.verify')),
  route('POST', '/residents/:tower/:flat/send-back', notImplemented('residents.sendback')),
  route('POST', '/residents/:tower/:flat/remind', notImplemented('residents.remind')),

  route('GET', '/reports/completion', notImplemented('reports.completion')),
  route('GET', '/reports/export.csv', notImplemented('reports.export')),
];

function notImplemented(action: string): Handler {
  return async () => json(bad(`not implemented: ${action}`), { status: 501 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(req.url);
    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        return await r.handler(req, env, params);
      } catch (err) {
        return json(bad((err as Error).message || 'internal error'), { status: 500 });
      }
    }
    return json(bad('not found'), { status: 404 });
  },
};
