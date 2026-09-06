import type { Ctx } from '../lib/env';
import { ok } from '../lib/envelope';
import { json } from '../lib/http';

export async function whoami(ctx: Ctx): Promise<Response> {
  if (!ctx.authEmail) return json(ok({ email: null, role: 'UNKNOWN' }), { origin: ctx.url.origin });
  return json(ok({ email: ctx.authEmail, role: ctx.authRole }), { origin: ctx.url.origin });
}
