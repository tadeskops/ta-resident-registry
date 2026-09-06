import type { Ctx } from '../lib/env';
import { bad, ok } from '../lib/envelope';
import { json, readJsonBody } from '../lib/http';
import { isValidEmail, normEmail, roleFor } from '../lib/roles';
import { readAdmins, readManagers } from '../lib/site-config';
import { generateOtpCode, otpStoreFor } from '../lib/otp';
import { mailSenderFor } from '../lib/mail';
import { signJwt } from '../lib/jwt';
import { appendAudit } from '../lib/github';

export async function otpRequest(ctx: Ctx): Promise<Response> {
  let body: { email?: string };
  try { body = await readJsonBody(ctx.req); } catch (e) { return json(bad((e as Error).message), { status: 400, origin: ctx.url.origin }); }
  const email = normEmail(body.email);
  // Always return 202 to avoid email-existence enumeration (§ARCHITECTURE.md threat table).
  if (!isValidEmail(email)) {
    return json(ok({ sent: true }), { status: 202, origin: ctx.url.origin });
  }
  let mockCode: string | undefined;
  try {
    const code = generateOtpCode();
    const store = otpStoreFor(ctx.env.OTP_KV);
    await store.put(email, code);
    const mail = mailSenderFor(ctx.env);
    await mail.sendOtpEmail(email, code);
    // In noop mail mode (no real email delivery), echo the code back so the
    // sign-in flow is completable without email infrastructure — matches the
    // frontend mock-mode UX. Removed automatically when MAIL_PROVIDER is
    // switched to a real sender (resend / mailchannels).
    if ((ctx.env.MAIL_PROVIDER || 'noop') === 'noop') mockCode = code;
    ctx.env.OTP_KV && (await appendAudit(ctx.env, `auth.otp.request ${email}`));
  } catch (e) {
    console.error('otpRequest failed', e);
    // Still return 202 so we don't leak infra state.
  }
  return json(ok(mockCode ? { sent: true, mockCode } : { sent: true }), { status: 202, origin: ctx.url.origin });
}

export async function otpVerify(ctx: Ctx): Promise<Response> {
  let body: { email?: string; code?: string };
  try { body = await readJsonBody(ctx.req); } catch (e) { return json(bad((e as Error).message), { status: 400, origin: ctx.url.origin }); }
  const email = normEmail(body.email);
  const code = String(body.code || '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return json(bad('Enter your email and the 6-digit code.'), { status: 400, origin: ctx.url.origin });
  }
  const store = otpStoreFor(ctx.env.OTP_KV);
  const result = await store.verify(email, code);
  if (!result.ok) return json(bad(result.error), { status: 400, origin: ctx.url.origin });

  // Compute role from roster (falls back to RESIDENT if roster files don't exist yet).
  let admins: Awaited<ReturnType<typeof readAdmins>>['file'] | { items: [] } = { items: [] as any };
  let managers: Awaited<ReturnType<typeof readManagers>>['file'] | { items: [] } = { items: [] as any };
  try { admins = (await readAdmins(ctx.env)).file; } catch (e) { console.warn('readAdmins failed', e); }
  try { managers = (await readManagers(ctx.env)).file; } catch (e) { console.warn('readManagers failed', e); }
  const role = roleFor(email, { admins: admins.items, managers: managers.items });

  const token = await signJwt({ sub: email, role }, ctx.env.JWT_SECRET);
  ctx.env.OTP_KV && (await appendAudit(ctx.env, `auth.otp.verify ${email} role=${role}`));
  return json(ok({ token, role }), { origin: ctx.url.origin });
}
