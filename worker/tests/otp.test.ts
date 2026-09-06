import { describe, it, expect, beforeEach } from 'vitest';
import { generateOtpCode, otpStoreFor, __resetMemStore } from '../src/lib/otp';

describe('otp', () => {
  beforeEach(() => __resetMemStore());

  it('generates 6-digit codes', () => {
    for (let i = 0; i < 20; i++) {
      const c = generateOtpCode();
      expect(c).toMatch(/^\d{6}$/);
    }
  });

  it('accepts the correct code once', async () => {
    const store = otpStoreFor();
    await store.put('user@example.com', '123456');
    const first = await store.verify('user@example.com', '123456');
    expect(first.ok).toBe(true);
    const second = await store.verify('user@example.com', '123456');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/No code/i);
  });

  it('rejects wrong code and counts attempts', async () => {
    const store = otpStoreFor();
    await store.put('u@x.com', '111111');
    for (let i = 0; i < 5; i++) {
      const r = await store.verify('u@x.com', '000000');
      expect(r.ok).toBe(false);
    }
    // Should be locked out now.
    const locked = await store.verify('u@x.com', '111111');
    expect(locked.ok).toBe(false);
  });
});
