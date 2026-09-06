import type { Role } from './env';

export const HARD_CODED_ADMINS: readonly string[] = Object.freeze([
  'samanasippa@gmail.com',
  'ta.deskops@gmail.com',
]);

export function normEmail(e: string | null | undefined): string {
  return String(e || '').trim().toLowerCase();
}

export function isHardCodedAdmin(email: string): boolean {
  return HARD_CODED_ADMINS.includes(normEmail(email));
}

export interface Roster {
  admins: Array<{ email: string; name?: string }>;
  managers: Array<{ email: string; name?: string }>;
}

export function roleFor(email: string, roster: Roster): Role {
  const e = normEmail(email);
  if (!e) return 'UNKNOWN';
  if (isHardCodedAdmin(e)) return 'ADMIN';
  if (roster.admins.some(a => normEmail(a.email) === e)) return 'ADMIN';
  if (roster.managers.some(m => normEmail(m.email) === e)) return 'MANAGER';
  return 'RESIDENT';
}

const CHAIN: Role[] = ['UNKNOWN', 'RESIDENT', 'MANAGER', 'ADMIN'];
export function isAtLeast(have: Role, need: Role): boolean {
  return CHAIN.indexOf(have) >= CHAIN.indexOf(need);
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(email));
}
