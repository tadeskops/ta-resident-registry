import type { Ctx } from '../lib/env';
import { bad, ok } from '../lib/envelope';
import { json, readJsonBody } from '../lib/http';
import { isAtLeast } from '../lib/roles';
import { appendAudit } from '../lib/github';
import { findRecordForEmail, getRecord, listAllRecords, putRecord, ResidentRecord } from '../lib/records';

function requireAuth(ctx: Ctx, role: 'RESIDENT' | 'MANAGER' | 'ADMIN'): Response | null {
  if (!ctx.authRole || !isAtLeast(ctx.authRole, role)) {
    return json(bad(`${role.toLowerCase()}+ required`), { status: 403, origin: ctx.url.origin });
  }
  return null;
}

export async function getMyRecord(ctx: Ctx): Promise<Response> {
  const gate = requireAuth(ctx, 'RESIDENT');
  if (gate) return gate;
  const { record } = await findRecordForEmail(ctx.env, ctx.authEmail!);
  return json(ok(record), { origin: ctx.url.origin });
}

export async function putMyRecord(ctx: Ctx): Promise<Response> {
  const gate = requireAuth(ctx, 'RESIDENT');
  if (gate) return gate;
  let body: ResidentRecord;
  try { body = await readJsonBody(ctx.req); } catch (e) { return json(bad((e as Error).message), { status: 400, origin: ctx.url.origin }); }
  if (!body || !body.flat || !body.flat.tower || !body.flat.flatNo) {
    return json(bad('flat.tower and flat.flatNo are required'), { status: 400, origin: ctx.url.origin });
  }
  const tower = String(body.flat.tower).trim().toUpperCase();
  const flatNo = String(body.flat.flatNo).trim();
  const { record: existing, sha } = await getRecord(ctx.env, tower, flatNo);
  // Guard: if the flat already has a different primary email, block (residents
  // can't overwrite each other's records).
  if (existing && existing.primary?.email && existing.primary.email.toLowerCase() !== ctx.authEmail!.toLowerCase()) {
    return json(bad('This flat is claimed by another resident.'), { status: 409, origin: ctx.url.origin });
  }
  const merged: ResidentRecord = {
    ...(existing || {} as ResidentRecord),
    ...body,
    flat: { ...(existing?.flat || {} as ResidentRecord['flat']), ...body.flat, tower, flatNo },
    primary: { ...(existing?.primary || {} as ResidentRecord['primary']), ...body.primary, email: ctx.authEmail! },
  };
  merged.status = merged.status && merged.status !== 'draft' ? merged.status : 'draft';
  await putRecord(ctx.env, merged, sha);
  await appendAudit(ctx.env, `residents.put ${tower}/${flatNo} by=${ctx.authEmail}`);
  return json(ok(merged), { origin: ctx.url.origin });
}

export async function submitMyRecord(ctx: Ctx): Promise<Response> {
  const gate = requireAuth(ctx, 'RESIDENT');
  if (gate) return gate;
  const { record, sha } = await findRecordForEmail(ctx.env, ctx.authEmail!);
  if (!record) return json(bad('Save your details before submitting.'), { status: 404, origin: ctx.url.origin });
  record.status = 'submitted';
  record.submittedAt = new Date().toISOString();
  await putRecord(ctx.env, record, sha);
  await appendAudit(ctx.env, `residents.submit ${record.flat.tower}/${record.flat.flatNo} by=${ctx.authEmail}`);
  return json(ok(record), { origin: ctx.url.origin });
}

export async function listRecords(ctx: Ctx): Promise<Response> {
  const gate = requireAuth(ctx, 'MANAGER');
  if (gate) return gate;
  const items = await listAllRecords(ctx.env);
  return json(ok(items), { origin: ctx.url.origin });
}

export async function getRecordByFlat(ctx: Ctx): Promise<Response> {
  const gate = requireAuth(ctx, 'MANAGER');
  if (gate) return gate;
  const tower = String(ctx.params.tower || '').toUpperCase();
  const flat = String(ctx.params.flat || '');
  const { record } = await getRecord(ctx.env, tower, flat);
  if (!record) return json(bad('not found'), { status: 404, origin: ctx.url.origin });
  return json(ok(record), { origin: ctx.url.origin });
}

export async function verifyRecordRoute(ctx: Ctx): Promise<Response> {
  const gate = requireAuth(ctx, 'MANAGER');
  if (gate) return gate;
  const tower = String(ctx.params.tower || '').toUpperCase();
  const flat = String(ctx.params.flat || '');
  const { record, sha } = await getRecord(ctx.env, tower, flat);
  if (!record) return json(bad('not found'), { status: 404, origin: ctx.url.origin });
  record.status = 'verified';
  record.verifiedAt = new Date().toISOString();
  record.verifiedBy = ctx.authEmail!;
  record.sendBackNote = null;
  await putRecord(ctx.env, record, sha);
  await appendAudit(ctx.env, `residents.verify ${tower}/${flat} by=${ctx.authEmail}`);
  return json(ok(record), { origin: ctx.url.origin });
}

export async function sendBackRecordRoute(ctx: Ctx): Promise<Response> {
  const gate = requireAuth(ctx, 'MANAGER');
  if (gate) return gate;
  let body: { note?: string };
  try { body = await readJsonBody(ctx.req); } catch (e) { return json(bad((e as Error).message), { status: 400, origin: ctx.url.origin }); }
  const note = String(body.note || '').trim();
  if (!note) return json(bad('note is required'), { status: 400, origin: ctx.url.origin });
  const tower = String(ctx.params.tower || '').toUpperCase();
  const flat = String(ctx.params.flat || '');
  const { record, sha } = await getRecord(ctx.env, tower, flat);
  if (!record) return json(bad('not found'), { status: 404, origin: ctx.url.origin });
  record.status = 'sent-back';
  record.sendBackNote = note.slice(0, 500);
  record.sendBackAt = new Date().toISOString();
  record.sendBackBy = ctx.authEmail!;
  await putRecord(ctx.env, record, sha);
  await appendAudit(ctx.env, `residents.send-back ${tower}/${flat} by=${ctx.authEmail}`);
  return json(ok(record), { origin: ctx.url.origin });
}
