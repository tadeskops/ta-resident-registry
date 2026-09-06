import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../src/lib/jwt';

const SECRET = 'test-secret-'.padEnd(48, 'x');

describe('jwt', () => {
  it('signs + verifies a token', async () => {
    const t = await signJwt({ sub: 'alice@example.com', role: 'ADMIN' }, SECRET);
    const p = await verifyJwt(t, SECRET);
    expect(p).not.toBeNull();
    expect(p!.sub).toBe('alice@example.com');
    expect(p!.role).toBe('ADMIN');
    expect(p!.exp).toBeGreaterThan(p!.iat);
  });

  it('rejects tampered payload', async () => {
    const t = await signJwt({ sub: 'alice@example.com', role: 'RESIDENT' }, SECRET);
    const parts = t.split('.');
    const bad = `${parts[0]}.${parts[1]}X.${parts[2]}`;
    expect(await verifyJwt(bad, SECRET)).toBeNull();
  });

  it('rejects wrong secret', async () => {
    const t = await signJwt({ sub: 'a@b.co', role: 'RESIDENT' }, SECRET);
    expect(await verifyJwt(t, 'other-secret-'.padEnd(48, 'y'))).toBeNull();
  });

  it('rejects expired token', async () => {
    const t = await signJwt({ sub: 'a@b.co', role: 'RESIDENT' }, SECRET, -60);
    expect(await verifyJwt(t, SECRET)).toBeNull();
  });
});
