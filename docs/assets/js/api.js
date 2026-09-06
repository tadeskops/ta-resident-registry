/* =========================================================================
   TA Resident Registry — API client
   Runs in two modes:
   - MOCK MODE (default when opened as file:// or when window.__TRR_MOCK__
     is truthy) — data is kept in localStorage. Perfect for previewing
     the UX without a running worker.
   - LIVE MODE — set window.__TRR_API__ = 'https://your-worker.example'
     before this script loads and it will proxy to a real Cloudflare
     Worker (see REQUIREMENT.md §6 for the route contract).
   ========================================================================= */
(function () {
  const LIVE_BASE = (typeof window !== 'undefined' && window.__TRR_API__) || '';
  const MOCK = !LIVE_BASE || window.__TRR_MOCK__ === true;

  const TOKEN_KEY = 'trr_token';
  const EMAIL_KEY = 'trr_email';
  const MOCK_OTP_KEY = 'trr_mock_otp';
  const MOCK_RECORDS_KEY = 'trr_mock_records';
  const MOCK_ADMINS_KEY = 'trr_mock_admins';
  const MOCK_MANAGERS_KEY = 'trr_mock_managers';
  const MOCK_SITE_KEY = 'trr_mock_site';

  // Server-authoritative in worker/src/lib/roles.ts; mirrored here for mock parity.
  const HARD_CODED_ADMINS = Object.freeze([
    'samanasippa@gmail.com',
    'ta.deskops@gmail.com',
  ]);

  const DEFAULT_CONTACT_EMAIL = 'theaddressaundh@gmail.com';

  const DEFAULT_FORMS = Object.freeze({
    resident: Object.freeze({
      fields: Object.freeze({
        showMoveInDate: true,
        showPriorAddress: true,
        showAltMobile: true,
        showFamilySection: true,
        showVehiclesSection: true,
      }),
      limits: Object.freeze({ familyMembers: 12, vehicles: 6 }),
    }),
  });

  function readJsonKey(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch (_e) { return fallback; }
  }
  function writeJsonKey(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function readRecords() { return readJsonKey(MOCK_RECORDS_KEY, {}); }
  function writeRecords(map) { writeJsonKey(MOCK_RECORDS_KEY, map); }

  function readDynamicAdmins() { return readJsonKey(MOCK_ADMINS_KEY, []); }
  function writeDynamicAdmins(list) { writeJsonKey(MOCK_ADMINS_KEY, list); }
  function readDynamicManagers() { return readJsonKey(MOCK_MANAGERS_KEY, []); }
  function writeDynamicManagers(list) { writeJsonKey(MOCK_MANAGERS_KEY, list); }

  function readSiteOverride() { return readJsonKey(MOCK_SITE_KEY, {}); }
  function writeSiteOverride(patch) {
    const cur = readSiteOverride();
    writeJsonKey(MOCK_SITE_KEY, Object.assign({}, cur, patch));
  }

  function normEmail(e) { return String(e || '').trim().toLowerCase(); }
  function isValidEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(e)); }

  function roleFor(email) {
    const e = normEmail(email);
    if (!e) return 'UNKNOWN';
    if (HARD_CODED_ADMINS.includes(e)) return 'ADMIN';
    if (readDynamicAdmins().some(a => normEmail(a.email) === e)) return 'ADMIN';
    if (readDynamicManagers().some(m => normEmail(m.email) === e)) return 'MANAGER';
    return 'RESIDENT';
  }

  async function liveFetch(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(LIVE_BASE.replace(/\/$/, '') + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let payload = null;
    try { payload = await res.json(); } catch (_e) { /* non-JSON */ }
    if (!res.ok || (payload && payload.ok === false)) {
      const err = (payload && payload.error) || res.statusText || 'Request failed';
      throw new Error(err);
    }
    return payload && payload.data !== undefined ? payload.data : payload;
  }

  async function mockOtpRequest(email) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const record = { email: String(email || '').trim().toLowerCase(), code, expiresAt: Date.now() + 10 * 60 * 1000 };
    localStorage.setItem(MOCK_OTP_KEY, JSON.stringify(record));
    console.info('[TRR mock] OTP for', record.email, '=', code);
    return { sent: true, mockCode: code };
  }

  async function mockOtpVerify(email, code) {
    let record = null;
    try { record = JSON.parse(localStorage.getItem(MOCK_OTP_KEY) || 'null'); } catch (_e) {}
    const e = String(email || '').trim().toLowerCase();
    if (!record || record.email !== e) throw new Error('No code was sent to this email.');
    if (Date.now() > record.expiresAt) throw new Error('Code expired. Request a new one.');
    if (String(code || '').trim() !== record.code) throw new Error('Incorrect code. Try again.');
    const token = 'mock.' + btoa(JSON.stringify({ sub: e, role: roleFor(e), exp: Date.now() + 8 * 3600 * 1000 })).replace(/=+$/, '');
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EMAIL_KEY, e);
    localStorage.removeItem(MOCK_OTP_KEY);
    return { token };
  }

  function requireEmail() {
    const e = localStorage.getItem(EMAIL_KEY);
    if (!e) throw new Error('Not signed in.');
    return e;
  }

  async function mockGetMyRecord() {
    const email = requireEmail();
    const all = readRecords();
    const found = Object.values(all).find(r => (r.primary || {}).email === email);
    return found || null;
  }

  async function mockPutMyRecord(rec) {
    const email = requireEmail();
    const all = readRecords();
    const key = `${rec.flat && rec.flat.tower || ''}-${rec.flat && rec.flat.flatNo || ''}`;
    if (!key || key === '-') throw new Error('Tower and flat number are required.');
    const existing = all[key] || {};
    const now = new Date().toISOString();
    const next = Object.assign({}, existing, rec, {
      primary: Object.assign({}, existing.primary, rec.primary, { email }),
      updatedAt: now,
      createdAt: existing.createdAt || now,
      status: existing.status && existing.status !== 'draft' ? existing.status : 'draft',
    });
    all[key] = next;
    writeRecords(all);
    return next;
  }

  async function mockSubmitMyRecord() {
    const email = requireEmail();
    const all = readRecords();
    const key = Object.keys(all).find(k => (all[k].primary || {}).email === email);
    if (!key) throw new Error('Save your details before submitting.');
    all[key].status = 'submitted';
    all[key].submittedAt = new Date().toISOString();
    writeRecords(all);
    return all[key];
  }

  async function mockListRecords() {
    const all = readRecords();
    return Object.values(all).sort((a, b) => {
      const at = (a.flat && a.flat.tower) || '';
      const bt = (b.flat && b.flat.tower) || '';
      if (at !== bt) return at.localeCompare(bt);
      return String((a.flat && a.flat.flatNo) || '').localeCompare(String((b.flat && b.flat.flatNo) || ''));
    });
  }

  function findKey(tower, flat) {
    return `${String(tower || '')}-${String(flat || '')}`;
  }
  async function mockGetRecord(tower, flat) {
    const all = readRecords();
    return all[findKey(tower, flat)] || null;
  }
  async function mockVerifyRecord(tower, flat) {
    const email = requireEmail();
    const all = readRecords();
    const key = findKey(tower, flat);
    if (!all[key]) throw new Error('Record not found.');
    all[key].status = 'verified';
    all[key].verifiedAt = new Date().toISOString();
    all[key].verifiedBy = email;
    all[key].sendBackNote = null;
    writeRecords(all);
    return all[key];
  }
  async function mockSendBackRecord(tower, flat, note) {
    const email = requireEmail();
    const all = readRecords();
    const key = findKey(tower, flat);
    if (!all[key]) throw new Error('Record not found.');
    if (!note || !String(note).trim()) throw new Error('Send-back note is required.');
    all[key].status = 'sent-back';
    all[key].sendBackNote = String(note).trim();
    all[key].sendBackAt = new Date().toISOString();
    all[key].sendBackBy = email;
    writeRecords(all);
    return all[key];
  }

  async function mockGetSite() {
    const base = (typeof window !== 'undefined' && window.__TRR_SITE_BASE__) || {};
    let disk = null;
    try {
      const res = await fetch('./config/site.json', { cache: 'no-cache' });
      if (res.ok) disk = await res.json();
    } catch (_e) { /* not fatal */ }
    const override = readSiteOverride();
    const merged = Object.assign({}, base, disk || {}, override);
    merged.society = Object.assign({}, (base.society || {}), (disk && disk.society) || {}, override.society || {});
    if (!merged.society.contactEmail) merged.society.contactEmail = DEFAULT_CONTACT_EMAIL;
    // Deep-ish merge forms.resident
    const dr = (disk && disk.forms && disk.forms.resident) || {};
    const or = (override.forms && override.forms.resident) || {};
    merged.forms = Object.assign({}, merged.forms || {}, {
      resident: {
        fields: Object.assign({}, DEFAULT_FORMS.resident.fields, dr.fields || {}, or.fields || {}),
        limits: Object.assign({}, DEFAULT_FORMS.resident.limits, dr.limits || {}, or.limits || {}),
      },
    });
    return merged;
  }
  async function mockPutSitePatch(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid site patch.');
    const cur = readSiteOverride();
    const merged = Object.assign({}, cur);
    if (patch.society) merged.society = Object.assign({}, cur.society || {}, patch.society);
    if (patch.forms) {
      merged.forms = Object.assign({}, cur.forms || {});
      if (patch.forms.resident) {
        const curR = (cur.forms && cur.forms.resident) || {};
        merged.forms.resident = {
          fields: Object.assign({}, curR.fields || {}, patch.forms.resident.fields || {}),
          limits: Object.assign({}, curR.limits || {}, patch.forms.resident.limits || {}),
        };
      }
    }
    writeSiteOverride(merged);
    return mockGetSite();
  }

  function buildAdminList() {
    const floor = HARD_CODED_ADMINS.map(email => ({ email, name: '', system: true }));
    const dynamic = readDynamicAdmins().map(a => ({ email: normEmail(a.email), name: a.name || '', system: false }));
    const seen = new Set(floor.map(a => a.email));
    const uniqueDynamic = dynamic.filter(a => !seen.has(a.email));
    return floor.concat(uniqueDynamic);
  }

  async function mockListAdmins() { return buildAdminList(); }
  async function mockAddAdmin(email, name) {
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const e = normEmail(email);
    if (HARD_CODED_ADMINS.includes(e)) throw new Error('This email is already a system admin.');
    const list = readDynamicAdmins();
    if (list.some(a => normEmail(a.email) === e)) throw new Error('This admin already exists.');
    list.push({ email: e, name: name || '' });
    writeDynamicAdmins(list);
    return buildAdminList();
  }
  async function mockRemoveAdmin(email) {
    const e = normEmail(email);
    if (HARD_CODED_ADMINS.includes(e)) throw new Error('System admins cannot be removed.');
    const list = readDynamicAdmins().filter(a => normEmail(a.email) !== e);
    writeDynamicAdmins(list);
    return buildAdminList();
  }

  async function mockListManagers() {
    return readDynamicManagers().map(m => ({ email: normEmail(m.email), name: m.name || '' }));
  }
  async function mockAddManager(email, name) {
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    const e = normEmail(email);
    if (HARD_CODED_ADMINS.includes(e)) throw new Error('This email is already a system admin.');
    const list = readDynamicManagers();
    if (list.some(m => normEmail(m.email) === e)) throw new Error('This Registry Manager already exists.');
    list.push({ email: e, name: name || '' });
    writeDynamicManagers(list);
    return mockListManagers();
  }
  async function mockRemoveManager(email) {
    const e = normEmail(email);
    const list = readDynamicManagers().filter(m => normEmail(m.email) !== e);
    writeDynamicManagers(list);
    return mockListManagers();
  }

  const API = {
    isMock: MOCK,
    isSignedIn: () => !!localStorage.getItem(TOKEN_KEY),
    currentEmail: () => localStorage.getItem(EMAIL_KEY) || '',
    currentRole: () => {
      const t = localStorage.getItem(TOKEN_KEY);
      if (!t) return 'UNKNOWN';
      try {
        const body = t.startsWith('mock.') ? t.slice(5) : t.split('.')[1];
        const decoded = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
        return decoded.role || 'RESIDENT';
      } catch (_e) { return 'RESIDENT'; }
    },
    signOut: () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
    },
    otpRequest: (email) => MOCK ? mockOtpRequest(email) : liveFetch('/auth/otp/request', { method: 'POST', body: { email } }),
    otpVerify: (email, code) => MOCK ? mockOtpVerify(email, code) : liveFetch('/auth/otp/verify', { method: 'POST', body: { email, code } }),
    whoami: async () => {
      if (MOCK) {
        const email = localStorage.getItem(EMAIL_KEY);
        if (!email) return null;
        return { email, role: roleFor(email) };
      }
      return liveFetch('/whoami');
    },
    getSite: () => MOCK ? mockGetSite() : liveFetch('/config'),
    putSitePatch: (patch) => MOCK ? mockPutSitePatch(patch) : liveFetch('/config/site', { method: 'PUT', body: patch }),
    getMyRecord: () => MOCK ? mockGetMyRecord() : liveFetch('/residents/me'),
    putMyRecord: (rec) => MOCK ? mockPutMyRecord(rec) : liveFetch('/residents/me', { method: 'PUT', body: rec }),
    submitMyRecord: () => MOCK ? mockSubmitMyRecord() : liveFetch('/residents/me/submit', { method: 'POST' }),
    listRecords: () => MOCK ? mockListRecords() : liveFetch('/residents'),
    getRecord: (tower, flat) => MOCK ? mockGetRecord(tower, flat) : liveFetch(`/residents/${encodeURIComponent(tower)}/${encodeURIComponent(flat)}`),
    verifyRecord: (tower, flat) => MOCK ? mockVerifyRecord(tower, flat) : liveFetch(`/residents/${encodeURIComponent(tower)}/${encodeURIComponent(flat)}/verify`, { method: 'POST' }),
    sendBackRecord: (tower, flat, note) => MOCK ? mockSendBackRecord(tower, flat, note) : liveFetch(`/residents/${encodeURIComponent(tower)}/${encodeURIComponent(flat)}/send-back`, { method: 'POST', body: { note } }),
    listAdmins: () => MOCK ? mockListAdmins() : liveFetch('/config/admins'),
    addAdmin: (email, name) => MOCK ? mockAddAdmin(email, name) : liveFetch('/config/admins', { method: 'POST', body: { email, name } }),
    removeAdmin: (email) => MOCK ? mockRemoveAdmin(email) : liveFetch('/config/admins/' + encodeURIComponent(email), { method: 'DELETE' }),
    listManagers: () => MOCK ? mockListManagers() : liveFetch('/config/managers'),
    addManager: (email, name) => MOCK ? mockAddManager(email, name) : liveFetch('/config/managers', { method: 'POST', body: { email, name } }),
    removeManager: (email) => MOCK ? mockRemoveManager(email) : liveFetch('/config/managers/' + encodeURIComponent(email), { method: 'DELETE' }),
    hardCodedAdmins: () => HARD_CODED_ADMINS.slice(),
  };

  window.TRR = window.TRR || {};
  window.TRR.API = API;
})();
