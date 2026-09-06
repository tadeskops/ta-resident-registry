/*
 * GitHub Contents API adapter for the private data repo. Keeps only the
 * operations we actually need (get JSON with SHA, put JSON with SHA
 * update-or-create) and gracefully treats missing files as null.
 * Writes are single-flat so we stay well under Cloudflare Workers Free
 * 50-subrequest cap on any given request.
 */
import type { Env } from './env';

interface GhContentsGetOk {
  sha: string;
  content: string;
  encoding: 'base64';
}

function b64EncodeString(s: string): string {
  // Workers has btoa, but it can't handle high-code-point chars directly.
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64DecodeString(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function apiBase(env: Env): string {
  return `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents`;
}

function authHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    'User-Agent': 'ta-resident-registry-worker',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export interface JsonFile<T> {
  path: string;
  data: T;
  sha: string | null;
}

export async function readJsonFile<T>(env: Env, path: string): Promise<JsonFile<T> | null> {
  const res = await fetch(`${apiBase(env)}/${encodeURI(path)}?ref=${env.GH_BRANCH}`, {
    headers: authHeaders(env),
    cf: { cacheTtl: 0 } as RequestInit['cf'],
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as GhContentsGetOk;
  const text = b64DecodeString(body.content);
  let data: T;
  try { data = JSON.parse(text) as T; } catch {
    throw new Error(`GitHub file ${path} was not valid JSON`);
  }
  return { path, data, sha: body.sha };
}

export async function writeJsonFile<T>(
  env: Env,
  path: string,
  data: T,
  sha: string | null,
  message: string,
): Promise<{ sha: string }> {
  const payload = {
    message,
    content: b64EncodeString(JSON.stringify(data, null, 2) + '\n'),
    branch: env.GH_BRANCH,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`${apiBase(env)}/${encodeURI(path)}`, {
    method: 'PUT',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const j = (await res.json()) as { content: { sha: string } };
  return { sha: j.content.sha };
}

/** Append a line to the audit.log file. Creates the file if missing. */
export async function appendAudit(env: Env, line: string): Promise<void> {
  const path = 'config/audit.log';
  const stamp = new Date().toISOString();
  const entry = `${stamp} ${line}\n`;
  // Read raw text (not JSON) via the same Contents API, then re-put.
  const res = await fetch(`${apiBase(env)}/${encodeURI(path)}?ref=${env.GH_BRANCH}`, {
    headers: authHeaders(env),
  });
  let sha: string | null = null;
  let existing = '';
  if (res.ok) {
    const body = (await res.json()) as GhContentsGetOk;
    sha = body.sha;
    existing = b64DecodeString(body.content);
  } else if (res.status !== 404) {
    // Non-fatal — swallow so audit doesn't break the mutating request.
    console.warn(`audit read failed ${res.status}`);
    return;
  }
  const payload = {
    message: `audit: ${line.slice(0, 60)}`,
    content: b64EncodeString(existing + entry),
    branch: env.GH_BRANCH,
    ...(sha ? { sha } : {}),
  };
  const put = await fetch(`${apiBase(env)}/${encodeURI(path)}`, {
    method: 'PUT',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!put.ok) console.warn(`audit write failed ${put.status}`);
}
