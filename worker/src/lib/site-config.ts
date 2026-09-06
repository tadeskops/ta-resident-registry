import type { Env } from './env';
import { readJsonFile, writeJsonFile } from './github';

export interface SiteConfig {
  version: number;
  society: { name?: string; shortName?: string; contactEmail?: string };
  towers?: string[];
  occupancyOptions?: Array<{ value: string; label: string }>;
  relationOptions?: string[];
  vehicleTypes?: Array<{ value: string; label: string }>;
  limits?: { familyMembers?: number; vehicles?: number };
  forms?: {
    resident?: {
      fields?: {
        showMoveInDate?: boolean;
        showPriorAddress?: boolean;
        showAltMobile?: boolean;
        showFamilySection?: boolean;
        showVehiclesSection?: boolean;
      };
      limits?: { familyMembers?: number; vehicles?: number };
    };
  };
  features?: Record<string, boolean>;
  reminders?: { cadenceDays?: number; fromEmail?: string; subject?: string };
}

export const DEFAULT_SITE: SiteConfig = {
  version: 1,
  society: { name: 'The Address', shortName: 'TA', contactEmail: 'theaddressaundh@gmail.com' },
  towers: ['A', 'B', 'C', 'D'],
  forms: {
    resident: {
      fields: {
        showMoveInDate: true,
        showPriorAddress: true,
        showAltMobile: true,
        showFamilySection: true,
        showVehiclesSection: true,
      },
      limits: { familyMembers: 12, vehicles: 6 },
    },
  },
};

const SITE_PATH = 'config/site.json';

export async function readSite(env: Env): Promise<{ site: SiteConfig; sha: string | null }> {
  const file = await readJsonFile<SiteConfig>(env, SITE_PATH);
  if (!file) return { site: { ...DEFAULT_SITE }, sha: null };
  return { site: mergeSite(DEFAULT_SITE, file.data), sha: file.sha };
}

export async function writeSite(env: Env, site: SiteConfig, sha: string | null): Promise<{ sha: string }> {
  return writeJsonFile(env, SITE_PATH, site, sha, `config: update site.json`);
}

function mergeSite(base: SiteConfig, patch: Partial<SiteConfig>): SiteConfig {
  return {
    ...base,
    ...patch,
    society: { ...base.society, ...(patch.society || {}) },
    forms: {
      resident: {
        fields: { ...(base.forms?.resident?.fields || {}), ...(patch.forms?.resident?.fields || {}) },
        limits: { ...(base.forms?.resident?.limits || {}), ...(patch.forms?.resident?.limits || {}) },
      },
    },
    features: { ...(base.features || {}), ...(patch.features || {}) },
    reminders: { ...(base.reminders || {}), ...(patch.reminders || {}) },
  };
}

export function patchSite(current: SiteConfig, patch: Partial<SiteConfig>): SiteConfig {
  return mergeSite(current, patch);
}

interface RosterFile {
  version: number;
  items: Array<{ email: string; name?: string }>;
}

const EMPTY_ROSTER: RosterFile = { version: 1, items: [] };

async function readRoster(env: Env, path: string): Promise<{ file: RosterFile; sha: string | null }> {
  const got = await readJsonFile<RosterFile>(env, path);
  if (!got) return { file: { ...EMPTY_ROSTER }, sha: null };
  return { file: got.data, sha: got.sha };
}

export async function readAdmins(env: Env) { return readRoster(env, 'config/admins.json'); }
export async function readManagers(env: Env) { return readRoster(env, 'config/managers.json'); }

export async function writeAdmins(env: Env, items: RosterFile['items'], sha: string | null) {
  return writeJsonFile(env, 'config/admins.json', { version: 1, items }, sha, 'config: update admins');
}
export async function writeManagers(env: Env, items: RosterFile['items'], sha: string | null) {
  return writeJsonFile(env, 'config/managers.json', { version: 1, items }, sha, 'config: update managers');
}
