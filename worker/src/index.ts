/**
 * TA Resident Registry — Cloudflare Worker entry point.
 * See REQUIREMENT.md §6 for the route contract and ARCHITECTURE.md for
 * env vars, threat model, and deployment notes.
 */
import type { Ctx, Env } from './lib/env';
import { bad } from './lib/envelope';
import { json, noContent } from './lib/http';
import { verifyJwt } from './lib/jwt';

import { otpRequest, otpVerify } from './routes/auth';
import { whoami } from './routes/whoami';
import {
  getConfig, putSitePatch,
  listAdmins, addAdmin, removeAdmin,
  listManagers, addManager, removeManager,
} from './routes/config';
import {
  getMyRecord, putMyRecord, submitMyRecord,
  listRecords, getRecordByFlat, verifyRecordRoute, sendBackRecordRoute,
} from './routes/residents';

type Handler = (ctx: Ctx) => Promise<Response>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler; }

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:[a-zA-Z_]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$',
  );
  return { method, pattern, keys, handler };
}

const ROUTES: Route[] = [
  route('POST',   '/auth/otp/request',                 otpRequest),
  route('POST',   '/auth/otp/verify',                  otpVerify),
  route('GET',    '/whoami',                           whoami),
  route('GET',    '/config',                           getConfig),
  route('PUT',    '/config/site',                      putSitePatch),
  route('GET',    '/config/admins',                    listAdmins),
  route('POST',   '/config/admins',                    addAdmin),
  route('DELETE', '/config/admins/:email',             removeAdmin),
  route('GET',    '/config/managers',                  listManagers),
  route('POST',   '/config/managers',                  addManager),
  route('DELETE', '/config/managers/:email',           removeManager),
  route('GET',    '/residents/me',                     getMyRecord),
  route('PUT',    '/residents/me',                     putMyRecord),
  route('POST',   '/residents/me/submit',              submitMyRecord),
  route('GET',    '/residents',                        listRecords),
  route('GET',    '/residents/:tower/:flat',           getRecordByFlat),
  route('POST',   '/residents/:tower/:flat/verify',    verifyRecordRoute),
  route('POST',   '/residents/:tower/:flat/send-back', sendBackRecordRoute),
];

async function decodeAuth(req: Request, env: Env): Promise<{ email: string; role: 'RESIDENT' | 'MANAGER' | 'ADMIN' } | null> {
  const h = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  const token = h.slice(7).trim();
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  return { email: payload.sub, role: payload.role as 'RESIDENT' | 'MANAGER' | 'ADMIN' };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return noContent(origin);
    const url = new URL(req.url);
    for (const r of ROUTES) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const auth = await decodeAuth(req, env);
      const ctx: Ctx = {
        req, env, url, params,
        authEmail: auth?.email,
        authRole: auth?.role || 'UNKNOWN',
      };
      try {
        return await r.handler(ctx);
      } catch (err) {
        console.error('handler error', err);
        return json(bad((err as Error).message || 'internal error'), { status: 500, origin });
      }
    }
    return json(bad('not found'), { status: 404, origin });
  },
};

export type { Env };
