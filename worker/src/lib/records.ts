/*
 * Per-flat storage in config/residents/<TOWER>/<FLAT>.json.
 * Small files (< 5 KB), cheap round-trips. The `list` operation
 * reads the tower "index" files (config/residents/<TOWER>.index.json)
 * which the writer keeps in sync — one directory-scan fetch per tower
 * keeps us well under the CF Free 50-subrequest cap.
 */
import type { Env } from './env';
import { readJsonFile, writeJsonFile } from './github';

export type RecordStatus = 'draft' | 'submitted' | 'verified' | 'sent-back' | 'stale';

export interface ResidentRecord {
  flat: { tower: string; flatNo: string; occupancy?: string; moveInDate?: string | null; priorAddress?: string | null };
  primary: { name: string; dob?: string; mobile: string; email: string };
  family?: Array<{ name: string; relation?: string; dob?: string; mobile?: string }>;
  vehicles?: Array<{ type?: string; regNo?: string; colour?: string; slot?: string }>;
  emergency?: { name: string; relation?: string; mobile: string; altMobile?: string | null };
  status?: RecordStatus;
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  sendBackAt?: string;
  sendBackBy?: string;
  sendBackNote?: string | null;
}

interface TowerIndex {
  version: number;
  items: Array<{ tower: string; flatNo: string; primaryEmail?: string; primaryName?: string; status?: RecordStatus; updatedAt?: string }>;
}

function recordPath(tower: string, flat: string): string {
  return `config/residents/${tower}/${flat}.json`;
}
function indexPath(tower: string): string {
  return `config/residents/${tower}.index.json`;
}

export async function getRecord(env: Env, tower: string, flat: string): Promise<{ record: ResidentRecord | null; sha: string | null }> {
  const f = await readJsonFile<ResidentRecord>(env, recordPath(tower, flat));
  if (!f) return { record: null, sha: null };
  return { record: f.data, sha: f.sha };
}

export async function putRecord(env: Env, next: ResidentRecord, sha: string | null): Promise<{ sha: string }> {
  const tower = String(next.flat?.tower || '').trim().toUpperCase();
  const flat = String(next.flat?.flatNo || '').trim();
  if (!tower || !flat) throw new Error('flat.tower and flat.flatNo are required');
  const now = new Date().toISOString();
  next.updatedAt = now;
  if (!next.createdAt) next.createdAt = now;
  next.status = next.status || 'draft';
  const wrote = await writeJsonFile(env, recordPath(tower, flat), next, sha, `residents: ${tower}/${flat} status=${next.status}`);
  await upsertIndex(env, tower, next);
  return wrote;
}

export async function findRecordForEmail(env: Env, email: string): Promise<{ record: ResidentRecord | null; sha: string | null }> {
  // Slow path: scan tower indexes. Called only when the caller doesn't
  // already know their flat.
  // We rely on primaryEmail hint in the tower index files.
  const towers = await guessTowers(env);
  for (const t of towers) {
    const idx = await readJsonFile<TowerIndex>(env, indexPath(t));
    if (!idx) continue;
    const hit = idx.data.items.find(it => (it.primaryEmail || '').toLowerCase() === email.toLowerCase());
    if (hit) return getRecord(env, hit.tower, hit.flatNo);
  }
  return { record: null, sha: null };
}

export async function listAllRecords(env: Env): Promise<ResidentRecord[]> {
  const towers = await guessTowers(env);
  const acc: ResidentRecord[] = [];
  for (const t of towers) {
    const idx = await readJsonFile<TowerIndex>(env, indexPath(t));
    if (!idx) continue;
    for (const it of idx.data.items) {
      const rec = await readJsonFile<ResidentRecord>(env, recordPath(it.tower, it.flatNo));
      if (rec) acc.push(rec.data);
    }
  }
  acc.sort((a, b) => {
    const at = a.flat?.tower || '';
    const bt = b.flat?.tower || '';
    if (at !== bt) return at.localeCompare(bt);
    return String(a.flat?.flatNo || '').localeCompare(String(b.flat?.flatNo || ''));
  });
  return acc;
}

async function guessTowers(env: Env): Promise<string[]> {
  // Read site.json for the canonical towers list.
  const site = await readJsonFile<{ towers?: string[] }>(env, 'config/site.json');
  return (site?.data.towers || ['A', 'B', 'C', 'D']).map(t => String(t).toUpperCase());
}

async function upsertIndex(env: Env, tower: string, rec: ResidentRecord): Promise<void> {
  const path = indexPath(tower);
  const cur = await readJsonFile<TowerIndex>(env, path);
  const items = cur ? cur.data.items.filter(it => String(it.flatNo) !== String(rec.flat.flatNo)) : [];
  items.push({
    tower,
    flatNo: rec.flat.flatNo,
    primaryEmail: rec.primary?.email,
    primaryName: rec.primary?.name,
    status: rec.status,
    updatedAt: rec.updatedAt,
  });
  items.sort((a, b) => a.flatNo.localeCompare(b.flatNo));
  await writeJsonFile(env, path, { version: 1, items }, cur?.sha ?? null, `residents: index ${tower}`);
}
