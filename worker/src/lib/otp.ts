/*
 * 6-digit OTP: generate, hash, store in KV (10-min TTL), verify.
 * Falls back to in-memory Map when OTP_KV isn't bound (dev only — resets
 * on every isolate restart).
 */

const MEM = new Map<string, { hash: string; expiresAt: number; attempts: number }>();
const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function hashCode(email: string, code: string): Promise<string> {
  return sha256Hex(`${email.toLowerCase()}|${code}`);
}

function key(email: string): string { return `otp:${email.toLowerCase()}`; }

export interface OtpStore {
  put(email: string, code: string): Promise<void>;
  verify(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export function otpStoreFor(kv?: KVNamespace): OtpStore {
  return {
    async put(email: string, code: string): Promise<void> {
      const hash = await hashCode(email, code);
      const entry = { hash, expiresAt: Date.now() + TTL_MS, attempts: 0 };
      if (kv) {
        await kv.put(key(email), JSON.stringify(entry), { expirationTtl: TTL_MS / 1000 });
      } else {
        MEM.set(key(email), entry);
      }
    },
    async verify(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const k = key(email);
      let entry: { hash: string; expiresAt: number; attempts: number } | null = null;
      if (kv) {
        const raw = await kv.get(k);
        entry = raw ? (JSON.parse(raw) as typeof entry) : null;
      } else {
        entry = MEM.get(k) || null;
      }
      if (!entry) return { ok: false, error: 'No code was sent to this email.' };
      if (Date.now() > entry.expiresAt) {
        if (kv) await kv.delete(k); else MEM.delete(k);
        return { ok: false, error: 'Code expired. Request a new one.' };
      }
      if (entry.attempts >= MAX_ATTEMPTS) {
        if (kv) await kv.delete(k); else MEM.delete(k);
        return { ok: false, error: 'Too many attempts. Request a new code.' };
      }
      const gotHash = await hashCode(email, code);
      if (gotHash !== entry.hash) {
        entry.attempts += 1;
        if (kv) {
          await kv.put(k, JSON.stringify(entry), { expirationTtl: Math.max(1, Math.floor((entry.expiresAt - Date.now()) / 1000)) });
        } else {
          MEM.set(k, entry);
        }
        return { ok: false, error: 'Incorrect code. Try again.' };
      }
      if (kv) await kv.delete(k); else MEM.delete(k);
      return { ok: true };
    },
  };
}

// Test hook only.
export function __resetMemStore(): void { MEM.clear(); }
