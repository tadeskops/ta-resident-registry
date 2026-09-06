import type { Ctx } from '../lib/env';
import { bad, ok } from '../lib/envelope';
import { json, readJsonBody } from '../lib/http';
import { isValidEmail, isAtLeast, normEmail, isHardCodedAdmin, HARD_CODED_ADMINS } from '../lib/roles';
import { readAdmins, readManagers, readSite, writeAdmins, writeManagers, writeSite, patchSite } from '../lib/site-config';
import { appendAudit } from '../lib/github';

export async function getConfig(ctx: Ctx): Promise<Response> {
  const { site } = await readSite(ctx.env);
  return json(ok(site), { origin: ctx.url.origin });
}

export async function putSitePatch(ctx: Ctx): Promise<Response> {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, 'ADMIN')) return json(bad('admin only'), { status: 403, origin: ctx.url.origin });
  let patch: Record<string, unknown>;
  try { patch = await readJsonBody(ctx.req); } catch (e) { return json(bad((e as Error).message), { status: 400, origin: ctx.url.origin }); }
  const { site, sha } = await readSite(ctx.env);
  const next = patchSite(site, patch);
  await writeSite(ctx.env, next, sha);
  await appendAudit(ctx.env, `config.site.patch by=${ctx.authEmail}`);
  return json(ok(next), { origin: ctx.url.origin });
}

export async function listAdmins(ctx: Ctx): Promise<Response> {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, 'ADMIN')) return json(bad('admin only'), { status: 403, origin: ctx.url.origin });
  const { file } = await readAdmins(ctx.env);
  const floor = HARD_CODED_ADMINS.map(email => ({ email, name: '', system: true }));
  const dynamic = file.items.filter(i => !HARD_CODED_ADMINS.includes(normEmail(i.email))).map(i => ({ ...i, system: false }));
  return json(ok(floor.concat(dynamic)), { origin: ctx.url.origin });
}

export async function addAdmin(ctx: Ctx): Promise<Response> {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, 'ADMIN')) return json(bad('admin only'), { status: 403, origin: ctx.url.origin });
  let body: { email?: string; name?: string };
  try { body = await readJsonBody(ctx.req); } catch (e) { return json(bad((e as Error).message), { status: 400, origin: ctx.url.origin }); }
  const email = normEmail(body.email);
  if (!isValidEmail(email)) return json(bad('valid email required'), { status: 400, origin: ctx.url.origin });
  if (isHardCodedAdmin(email)) return json(bad('This email is already a system admin.'), { status: 409, origin: ctx.url.origin });
  const { file, sha } = await readAdmins(ctx.env);
  if (file.items.some(i => normEmail(i.email) === email)) return json(bad('This admin already exists.'), { status: 409, origin: ctx.url.origin });
  const items = file.items.concat([{ email, name: (body.name || '').trim() || undefined }]);
  await writeAdmins(ctx.env, items, sha);
  await appendAudit(ctx.env, `config.admins.add ${email} by=${ctx.authEmail}`);
  return json(ok({ added: email }), { origin: ctx.url.origin });
}

export async function removeAdmin(ctx: Ctx): Promise<Response> {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, 'ADMIN')) return json(bad('admin only'), { status: 403, origin: ctx.url.origin });
  const email = normEmail(decodeURIComponent(ctx.params.email || ''));
  if (isHardCodedAdmin(email)) return json(bad('System admins cannot be removed.'), { status: 403, origin: ctx.url.origin });
  const { file, sha } = await readAdmins(ctx.env);
  const items = file.items.filter(i => normEmail(i.email) !== email);
  if (items.length === file.items.length) return json(bad('not found'), { status: 404, origin: ctx.url.origin });
  await writeAdmins(ctx.env, items, sha);
  await appendAudit(ctx.env, `config.admins.remove ${email} by=${ctx.authEmail}`);
  return json(ok({ removed: email }), { origin: ctx.url.origin });
}

export async function listManagers(ctx: Ctx): Promise<Response> {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, 'ADMIN')) return json(bad('admin only'), { status: 403, origin: ctx.url.origin });
  const { file } = await readManagers(ctx.env);
  return json(ok(file.items), { origin: ctx.url.origin });
}

export async function addManager(ctx: Ctx): Promise<Response> {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, 'ADMIN')) return json(bad('admin only'), { status: 403, origin: ctx.url.origin });
  let body: { email?: string; name?: string };
  try { body = await readJsonBody(ctx.req); } catch (e) { return json(bad((e as Error).message), { status: 400, origin: ctx.url.origin }); }
  const email = normEmail(body.email);
  if (!isValidEmail(email)) return json(bad('valid email required'), { status: 400, origin: ctx.url.origin });
  if (isHardCodedAdmin(email)) return json(bad('This email is already a system admin.'), { status: 409, origin: ctx.url.origin });
  const { file, sha } = await readManagers(ctx.env);
  if (file.items.some(i => normEmail(i.email) === email)) return json(bad('This Registry Manager already exists.'), { status: 409, origin: ctx.url.origin });
  const items = file.items.concat([{ email, name: (body.name || '').trim() || undefined }]);
  await writeManagers(ctx.env, items, sha);
  await appendAudit(ctx.env, `config.managers.add ${email} by=${ctx.authEmail}`);
  return json(ok({ added: email }), { origin: ctx.url.origin });
}

export async function removeManager(ctx: Ctx): Promise<Response> {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, 'ADMIN')) return json(bad('admin only'), { status: 403, origin: ctx.url.origin });
  const email = normEmail(decodeURIComponent(ctx.params.email || ''));
  const { file, sha } = await readManagers(ctx.env);
  const items = file.items.filter(i => normEmail(i.email) !== email);
  if (items.length === file.items.length) return json(bad('not found'), { status: 404, origin: ctx.url.origin });
  await writeManagers(ctx.env, items, sha);
  await appendAudit(ctx.env, `config.managers.remove ${email} by=${ctx.authEmail}`);
  return json(ok({ removed: email }), { origin: ctx.url.origin });
}
