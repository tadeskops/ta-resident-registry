# TA Resident Registry — Product & Technical Requirement

- **Version:** 1.0 (2026-09-06)
- **Owner:** The Address Management Committee
- **Sibling repo (design-reference only):** `ta-society-helpdesk`
- **Public code repo:** `tadeskops/ta-resident-registry` (this repo)
- **Private data repo:** `tadeskops/trr_record` (residents, admins, committee, audit log)

---

## 1. Background & goal

The Management Committee needs a canonical, up-to-date register of
**every household** in the society: primary resident, family members,
contact numbers, vehicles, emergency contact, and tenancy status. The
existing helpdesk system (`ta-society-helpdesk`) collects some of this
implicitly via issue reports and vehicle registrations, but it is
neither complete nor authoritative, and its Google-only sign-in shuts
out residents who use Outlook, Yahoo, iCloud, or work-domain email.

This registry is a **single-purpose portal**: residents log in, fill
their household form, and are done. The committee can browse, verify,
and export.

## 2. Non-goals

- Not a replacement for `ta-society-helpdesk`. No issue reporting, no
  reservations, no treasury, no polls.
- Not a payment gateway. Maintenance charges stay on their existing
  system.
- Not a chat / messaging tool. Reminders are outbound-only email.
- No public-facing pages. Every route (except `signin.html`) is
  gated.

## 3. Users & roles

Simplified role chain — no capability tags in v1:

| Role | Access |
|---|---|
| `ADMIN` | Everything: manage committee list, delete records, export. |
| `COMMITTEE` | Read all resident records, mark verified / send-back, send reminders, export CSV. |
| `RESIDENT` | Read + write **their own** household record only. |
| `UNKNOWN` (signed out) | Nothing except `signin.html`. |

Membership is defined in `config/admins.json` and
`config/committee.json` (list of email addresses). Everyone else who
successfully signs in becomes `RESIDENT`.

## 4. Data captured per household

One record per **flat** (`tower + flatNo` is the primary key). Multiple
sign-ins from the same flat converge onto the same record — first
signer becomes the flat's "custodian" who can invite co-residents.

### 4.1 Flat identity (required)
- Tower (single letter, e.g. `A`)
- Flat number (e.g. `1204`)
- Occupancy: `owner` | `owner-occupied` | `tenant` | `vacant`
- Move-in date (optional; required for tenants)
- Prior address (optional)

### 4.2 Primary resident (required)
- Full name
- Date of birth
- Mobile (+91, 10 digits, E.164 stored)
- Email (the sign-in email; read-only)

### 4.3 Family members (0..N; suggested cap 12)
For each: name, relation, DOB, mobile (optional).

### 4.4 Vehicles (0..N; suggested cap 6)
Type (`2W` / `4W` / `EV-2W` / `EV-4W`), registration number, colour,
parking slot (if allotted).

### 4.5 Emergency contact (required)
Name, relation, mobile, alternate mobile (optional).

### 4.6 Explicitly OUT of scope in v1
The following are **not** collected. Revisit when the committee
decides to expand scope:
- Photo uploads (primary resident or family)
- KYC documents (Aadhaar / PAN / rental agreement)
- Domestic help & drivers
- Pets
- Move-out flow (Q’11 deferred — for v1 committee edits the record
  directly if a resident moves out)

### 4.7 Metadata (system-managed)
- `createdAt`, `updatedAt` — ISO timestamps
- `submittedAt` — when resident marks record complete
- `verifiedAt`, `verifiedBy` — committee sign-off
- `status` — `draft` | `submitted` | `verified` | `sent-back` | `stale`
- `sendBackNote` — free text when status is `sent-back`

## 5. Authentication — Email OTP

The **only** sign-in method is email one-time-code. Why not multi-
provider OAuth? Because residents use every provider on the market
(work-domain email, Zoho, ProtonMail, Yahoo, iCloud). OTP covers all
of them with one flow and one dependency (a transactional mail
sender).

### 5.1 Client flow (see `docs/signin.html`)
1. User types email → `POST /auth/otp/request { email }`.
2. Worker validates format, rate-limits (5/hr/IP, 3/hr/email), stores
   `{ email, codeHash, expiresAt, attempts:0 }` in KV or D1, and
   dispatches a 6-digit code via the mail sender.
3. UI advances to code-entry step. User pastes code →
   `POST /auth/otp/verify { email, code }`.
4. Worker validates: not expired (10 min), attempts < 5, matches
   `codeHash`. On success mints a JWT (`sub=email`, `role`, `exp=+8h`)
   signed with `JWT_SECRET` (HS256). Returns `{ token }`.
5. Client stores in `localStorage.trr_token` (see the ta-society-
   helpdesk lesson: **localStorage, not sessionStorage** — sessionStorage
   is tab-scoped and forces re-sign-in from external links).
6. Subsequent API calls send `Authorization: Bearer <token>`.

### 5.2 Mail sender
- **v1 choice: Resend** — 3k emails/mo free, single env var
  (`RESEND_API_KEY`), best deliverability. **Requires a verified
  sender domain** (e.g. `theaddress.example`). Configuration is
  gated behind `FEATURE_TRR_OTP_LIVE=false` until the domain is
  verified and DNS (SPF + DKIM) is in place.
- MailChannels remains a fallback — the route handler is transport-
  agnostic (`sendOtpEmail(to, code)` behind a `MailSender` interface
  in `worker/src/lib/mail.ts`).
- SES is out of scope for v1.

### 5.3 Security notes
- Codes are **hashed** at rest (SHA-256 with a per-code salt). Never
  store the plaintext code.
- Rate-limit by both IP and email (KV counter, 1-hour window).
- Log every request/verify attempt to an append-only `config/audit.log`
  (same pattern as ta-society-helpdesk).
- JWT `exp` is 8 hours; client re-runs the OTP flow after expiry.
- No password reset — there is no password.
- Optional hardening for v2: WebAuthn / passkeys as second factor for
  committee accounts.

## 6. Server routes

All routes JSON in/out, envelope `{ ok:true, data }` or `{ ok:false, error:"..." }`.
`Ctx` handlers pattern lifted from ta-society-helpdesk.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/otp/request` | anon | Send code |
| POST | `/auth/otp/verify` | anon | Exchange code → JWT |
| GET | `/whoami` | any | Return `{ email, role, flat? }` |
| GET | `/config` | any | Public config (towers list, sizes) |
| GET | `/residents/me` | RESIDENT+ | Own household record (or blank scaffold) |
| PUT | `/residents/me` | RESIDENT+ | Upsert own household record |
| POST | `/residents/me/submit` | RESIDENT+ | Mark `status=submitted` |
| POST | `/uploads/photo` | RESIDENT+ | Multipart image upload → stored in photos repo |
| GET | `/residents` | COMMITTEE+ | Paginated directory |
| GET | `/residents/:tower/:flat` | COMMITTEE+ | Read one |
| POST | `/residents/:tower/:flat/verify` | COMMITTEE+ | Mark verified |
| POST | `/residents/:tower/:flat/send-back` | COMMITTEE+ | Set `sent-back` + note |
| POST | `/residents/:tower/:flat/remind` | COMMITTEE+ | Trigger reminder email |
| GET | `/reports/completion` | COMMITTEE+ | Per-tower submitted/verified/pending counts |
| GET | `/reports/export.csv` | ADMIN | CSV of every record |

## 7. Storage

Same GitHub-Contents-API pattern as the sibling repo (JSON files in
a private repo, edited via the worker):

```
config/
  site.json              — towers list, form caps, feature flags
  admins.json            — [{ email, name }]
  committee.json         — [{ email, name }]
  residents/
    A/1204.json          — one flat per file
    B/0507.json
  audit.log              — append-only
  otp/                   — transient (KV preferred; JSON fallback)
photos/
  A/1204/primary.jpg
  A/1204/family-{id}.jpg
```

**Sharding by tower** keeps individual files small (<50 KB) and
sidesteps the **Cloudflare Workers Free 50-subrequest cap** (see user
memory `debugging.md`) for bulk reads: the committee directory route
uses GitHub GraphQL batching (like the ta_vibehive fix) to fetch all
flats in one round-trip.

## 8. Config `site.json` shape

> **Placeholder values** in `config/site.json` (towers, flatsPerFloor,
> floors, `MAIL_FROM`, `reminders.fromEmail`) MUST be replaced with real
> values before Phase 2 goes live. The scaffold ships with sample
> values so the form is clickable in preview.

```json
{
  "version": 1,
  "society": { "name": "The Address", "shortName": "TA" },
  "towers": ["A", "B", "C", "D"],
  "flatsPerFloor": { "A": 8, "B": 8, "C": 6, "D": 6 },
  "floors": { "A": [1,2,3,4,5,6,7,8,9,10,11,12], "B": [1,2,3,4,5,6,7,8,9,10,11,12] },
  "limits": {
    "familyMembers": 12,
    "vehicles": 6
  },
  "features": {
    "FEATURE_TRR_PHOTOS": false,
    "FEATURE_TRR_REMINDERS": true,
    "FEATURE_TRR_CSV_EXPORT": true,
    "FEATURE_TRR_OTP_LIVE": false
  },
  "reminders": {
    "cadenceDays": 14,
    "fromEmail": "committee@theaddress.example",
    "subject": "Please complete your resident record"
  }
}
```

## 9. Pages

| Page | Purpose | Roles |
|---|---|---|
| `index.html` | Landing → routes signed-in users to their next action | any |
| `signin.html` | Email OTP flow | anon |
| `my-details.html` | Household form (edit + submit) | RESIDENT+ |
| `committee.html` | Directory + completion dashboard + verify actions | COMMITTEE+ |
| `admin.html` | Committee/admin roster management + CSV export | ADMIN |
| `privacy.html` | PII handling notice | any |

## 10. Phasing

- **Phase 1 (shipped 2026-09-06)**: HTML/CSS/JS prototypes in
  **mock mode** (`localStorage`-backed API stub). No worker deployed
  yet. Committee previews UX and gives feedback. **No real resident
  data captured.**
- **Phase 2**: Worker `/auth/otp/*` routes wired to Resend + JWT.
  `residents/me` GET/PUT wired to GitHub (`trr_record`). Real sign-
  ins go live only after sender-domain DNS is verified.
- **Phase 3**: Committee dashboard live, verify + send-back workflow.
- **Phase 4**: Reminders cron (weekly digest to pending flats).
- **Phase 5 (v2)**: Photo uploads (behind `FEATURE_TRR_PHOTOS`).
- **Phase 6**: Admin roster editor + CSV export at the worker
  (Phase 1 already has client-side CSV export).

## 11. Compliance notes

- **Data controller**: The Address Management Committee (as an
  entity). Contact: the committee email address published on the
  society noticeboard.
- All PII stays in the **private** `trr_record` repo, never in
  `docs/` (the public GH Pages target).
- Commit identity: only the `tadeskops` GitHub account may commit to
  either repo. See `CONTRIBUTING.md`.
- CSV exports are audit-logged with `who` and `when`.
- Records include a "Delete my data" action for residents leaving
  the society (soft-delete: sets `status=stale`, redacts PII fields,
  keeps flat + move-out date for occupancy history).
- Privacy notice on `privacy.html` is linked from every page footer.
- Retention: soft-deleted records purged after 7 years; audit log
  rotated monthly, retained online 2 years.

## 12. Decisions locked for v1 (2026-09-06)

| # | Decision | Answer |
|---|---|---|
| Q1 | Two repos vs one | **Two:** public `ta-resident-registry` + private `trr_record` |
| Q3 | Mail sender + sender domain | **Resend**; sender domain must be verified before Phase 2 goes live. `FEATURE_TRR_OTP_LIVE` gate prevents accidental use until DNS is set. |
| Q4 | KYC documents (Aadhaar/PAN/rental) in v1 | **No** — v2 |
| Q5 | Domestic help / drivers in v1 | **No** — v2 |
| Q6 | Photo uploads in v1 | **No** — v2 |
| Q7 | Vehicle duplicate flagging | Deferred to Phase 3 (nice-to-have chip) |
| Q8 | Verification workflow depth | Two-state (`submitted → verified`) with `sent-back` escape hatch. No two-eyes rule. |
| Q9 | Reminder cadence & channel | Email only, 14-day cadence, unsubscribe token in footer |
| Q10 | Tower/flat layout | Placeholder `A/B/C/D` shipped; must be replaced with real values in `config/site.json` before Phase 2 |
| Q11 | Tenant re-verification | Deferred to v2 |
| Q12 | Data controller | **The Address Management Committee** (entity, not named individual) |
| — | License | MIT (public repo) |
| — | Commit identity | `tadeskops` only, both repos |

### Deferred to v2
- Photo uploads (primary + family)
- KYC document uploads
- Domestic help & driver register
- Pet register
- WhatsApp reminders (email only in v1)
- Tenant annual re-verification
- Resident-initiated move-out flow
- Two-eyes verification for committee sign-off
