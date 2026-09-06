/*
 * HS256 JWT sign + verify using Web Crypto (available in Workers).
 * Token shape:  header.payload.signature  (base64url-encoded)
 * Payload:      { sub: <email>, role: <Role>, iat, exp }
 */
import type { Role } from './env';

function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s: string): ArrayBuffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const buf = new ArrayBuffer(b.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return buf;
}
function utf8(s: string): ArrayBuffer {
  const arr = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return buf;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export interface JwtPayload {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, ttlSeconds = 8 * 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64urlEncode(utf8(JSON.stringify(header)));
  const p = b64urlEncode(utf8(JSON.stringify(full)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, utf8(`${h}.${p}`));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const key = await importKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(s), utf8(`${h}.${p}`));
  if (!ok) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as JwtPayload;
  } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now - 30) return null;
  return payload;
}
