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
  const MOCK_ADMINS = new Set(['admin@example.com']);
  const MOCK_MANAGERS = new Set(['manager@example.com', 'chair@example.com']);

  function readRecords() {
    try { return JSON.parse(localStorage.getItem(MOCK_RECORDS_KEY) || '{}'); }
    catch (_e) { return {}; }
  }
  function writeRecords(map) {
    localStorage.setItem(MOCK_RECORDS_KEY, JSON.stringify(map));
  }
  function roleFor(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return 'UNKNOWN';
    if (MOCK_ADMINS.has(e)) return 'ADMIN';
    if (MOCK_MANAGERS.has(e)) return 'MANAGER';
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
    getMyRecord: () => MOCK ? mockGetMyRecord() : liveFetch('/residents/me'),
    putMyRecord: (rec) => MOCK ? mockPutMyRecord(rec) : liveFetch('/residents/me', { method: 'PUT', body: rec }),
    submitMyRecord: () => MOCK ? mockSubmitMyRecord() : liveFetch('/residents/me/submit', { method: 'POST' }),
    listRecords: () => MOCK ? mockListRecords() : liveFetch('/residents'),
  };

  window.TRR = window.TRR || {};
  window.TRR.API = API;
})();
