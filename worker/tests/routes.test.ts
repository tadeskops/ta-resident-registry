import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';
import { __resetMemStore } from '../src/lib/otp';
import { signJwt } from '../src/lib/jwt';

const BASE = 'https://worker.example';
const SECRET = 'test-secret-'.padEnd(48, 'x');

function makeEnv(patch: Partial<any> = {}): any {
  return {
    JWT_SECRET: SECRET,
    GH_TOKEN: 'ghtoken',
    GH_OWNER: 'tadeskops',
    GH_REPO: 'trr_record',
    GH_BRANCH: 'main',
    MAIL_PROVIDER: 'noop',
    MAIL_FROM: 'test@example.com',
    ...patch,
  };
}

async function bodyOf(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

describe('router', () => {
  beforeEach(() => {
    __resetMemStore();
    // Mock GitHub fetches: return 404 for reads (empty roster / no records)
    // and 200 for PUTs.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('api.github.com') && method === 'GET') {
        return new Response('not found', { status: 404 });
      }
      if (url.includes('api.github.com') && method === 'PUT') {
        return new Response(JSON.stringify({ content: { sha: 'fakesha' } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('unmocked', { status: 502 });
    }));
  });

  it('OPTIONS returns 204 with CORS', async () => {
    const res = await worker.fetch(new Request(`${BASE}/whoami`, { method: 'OPTIONS' }), makeEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('unknown route returns 404', async () => {
    const res = await worker.fetch(new Request(`${BASE}/does-not-exist`), makeEnv());
    expect(res.status).toBe(404);
    const j = await bodyOf(res);
    expect(j.ok).toBe(false);
  });

  it('whoami is UNKNOWN when unauthenticated', async () => {
    const res = await worker.fetch(new Request(`${BASE}/whoami`), makeEnv());
    const j = await bodyOf(res);
    expect(j.ok).toBe(true);
    expect(j.data.role).toBe('UNKNOWN');
  });

  it('whoami returns role for a valid JWT', async () => {
    const t = await signJwt({ sub: 'ta.deskops@gmail.com', role: 'ADMIN' }, SECRET);
    const res = await worker.fetch(
      new Request(`${BASE}/whoami`, { headers: { Authorization: `Bearer ${t}` } }),
      makeEnv(),
    );
    const j = await bodyOf(res);
    expect(j.data.email).toBe('ta.deskops@gmail.com');
    expect(j.data.role).toBe('ADMIN');
  });

  it('/config returns defaults even when GitHub 404s', async () => {
    const res = await worker.fetch(new Request(`${BASE}/config`), makeEnv());
    const j = await bodyOf(res);
    expect(j.ok).toBe(true);
    expect(j.data.society.contactEmail).toBe('theaddressaundh@gmail.com');
    expect(j.data.forms.resident.fields.showFamilySection).toBe(true);
  });

  it('/config/admins denies non-admin', async () => {
    const t = await signJwt({ sub: 'anon@x.com', role: 'RESIDENT' }, SECRET);
    const res = await worker.fetch(
      new Request(`${BASE}/config/admins`, { headers: { Authorization: `Bearer ${t}` } }),
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });

  it('/config/admins returns floor for hard-coded admin', async () => {
    const t = await signJwt({ sub: 'ta.deskops@gmail.com', role: 'ADMIN' }, SECRET);
    const res = await worker.fetch(
      new Request(`${BASE}/config/admins`, { headers: { Authorization: `Bearer ${t}` } }),
      makeEnv(),
    );
    const j = await bodyOf(res);
    expect(res.status).toBe(200);
    const emails = j.data.map((a: any) => a.email);
    expect(emails).toContain('ta.deskops@gmail.com');
    expect(emails).toContain('samanasippa@gmail.com');
    expect(j.data.filter((a: any) => a.system).length).toBe(2);
  });

  it('rejects adding a hard-coded admin as a manager', async () => {
    const t = await signJwt({ sub: 'ta.deskops@gmail.com', role: 'ADMIN' }, SECRET);
    const res = await worker.fetch(
      new Request(`${BASE}/config/managers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'samanasippa@gmail.com' }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(409);
    const j = await bodyOf(res);
    expect(j.error).toMatch(/system admin/i);
  });

  it('/auth/otp/request always returns 202', async () => {
    for (const email of ['not-an-email', 'valid@example.com']) {
      const res = await worker.fetch(new Request(`${BASE}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }), makeEnv());
      expect(res.status).toBe(202);
    }
  });

  it('/auth/otp/verify rejects bad code', async () => {
    const res = await worker.fetch(new Request(`${BASE}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.co', code: '000000' }),
    }), makeEnv());
    expect(res.status).toBe(400);
  });
});
