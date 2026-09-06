# TA Resident Registry — UI specification (v1)

This document defines every screen, every state, every action visible
to a user. It complements [REQUIREMENT.md](REQUIREMENT.md) — that
answers "what does the system do?"; this answers "what does the user
see and do?".

Status: **Phase 1 (mock mode)** — all pages backed by `localStorage`
via `docs/assets/js/api.js`. Same UX will drive Phase 2 with a real
worker.

---

## 1. Roles at a glance

| Role | Set by | Sees |
|---|---|---|
| `UNKNOWN` | not signed in | landing + sign-in only |
| `RESIDENT` | any successful sign-in | own household record |
| `MANAGER` | email in `managers.json` | directory + verify actions |
| `ADMIN` | hard-coded floor **or** email in `admins.json` | everything + settings |

### 1.1 Hard-coded admin floor
Two emails are **always** ADMIN, even if `admins.json` is empty or the
private repo is unreachable. Cannot be removed via the UI.

- `samanasippa@gmail.com` — parent / mentor developer
- `ta.deskops@gmail.com` — web developer

These live in the **worker source code** (server-authoritative) and are
mirrored in `docs/assets/js/api.js` for mock-mode preview parity.

### 1.2 Public contact email
`theaddressaundh@gmail.com` — the address shown to residents whenever
the site says "write to the Committee at ...". Stored in
`config/site.json → society.contactEmail`, editable via Settings.

---

## 2. Pages

### 2.1 `index.html` — Landing
Purpose: welcome, route to next action.

| State | Shows |
|---|---|
| Signed out | Hero + "Sign in with any email" CTA + "What we collect" |
| Signed in (RESIDENT) | "You're signed in" + [My household details] button |
| Signed in (MANAGER) | above + [Registry Managers dashboard] button |
| Signed in (ADMIN) | above + [Settings] button |

Contact email shown at the bottom of "What we collect": "Questions?
Write to <contactEmail>."

### 2.2 `signin.html` — Email OTP flow
Two-step: email → code. Existing UX preserved.

**Mock hint**: when running in mock mode, the OTP is auto-filled into
the six boxes and shown in a yellow banner. In production the banner
is absent and the code arrives by email.

### 2.3 `my-details.html` — Household form (RESIDENT+)
Sections: Flat identity · Primary resident · Family members ·
Vehicles · Emergency contact.

**Status badge** in the top-right corner:
- `Draft` (grey) — not yet submitted
- `Submitted — pending review` (info)
- `Verified` (green)
- `Needs corrections` (amber) — with the sent-back note visible above
  the form

**Actions row** (sticky bottom of form):
- **Save draft** — writes without status change
- **Submit for review** — validates required fields; sets `status=submitted`

When status is `sent-back`, the review note appears in a warning card
at the top of the page and the resident can edit + resubmit.

### 2.4 `managers.html` — Registry Managers dashboard (MANAGER+)
KPI grid across the top: Records · Drafts · Submitted · Verified ·
Sent back.

Directory table with columns: Tower · Flat · Primary · Mobile ·
Family · Vehicles · Status · Updated.

**Row click** opens a **side-panel** with the full record:
- All identity, primary, family, vehicles, emergency fields
- If `status=submitted`:
  - [Verify] button (green) → `status=verified` + closes panel + refresh table
  - [Send back] button (amber) → opens a note prompt, then `status=sent-back`
- If `status=verified`:
  - Read-only, plus a subtle "Verified on <date> by <email>" line
- If `status=sent-back`:
  - Shows previous note; [Verify] and [Send back] both available

**Export CSV** button in the section header — includes every field.

### 2.5 `settings.html` — Admin editor (ADMIN)
Three sections, all edit-in-place with individual [Save] buttons so
mistakes stay scoped.

1. **Public contact email**
   - One text input, pre-filled from `site.json`.
   - Save button writes to `PUT /config/site` (Phase 2); mock writes
     to `trr_mock_site` localStorage key.

2. **Administrators**
   - Two hard-coded rows first, with a 🔒 padlock and text "System —
     non-removable". No Remove button.
   - Dynamic rows below (from `admins.json`), each with a Remove
     button.
   - "Add administrator" input + Add button at the bottom.

3. **Registry Managers**
   - No floor. All rows are dynamic (from `managers.json`).
   - Each with a Remove button.
   - "Add Registry Manager" input + Add button at the bottom.

### 2.6 `privacy.html` — Privacy notice
- Data controller: The Address Management Committee
- Contact email shown: fetched from `site.json` (defaults to
  `theaddressaundh@gmail.com` if config not loaded)
- Otherwise unchanged from Phase 1.

---

## 3. State machine — Resident record

```
         ┌────────────────────────────────────┐
         │                                    │
     ┌──►│               DRAFT                │
     │   │   (resident editing, unsaved       │
     │   │    changes visible in form)        │
     │   └──────────────┬─────────────────────┘
     │                  │  [Save]  → same state
     │                  │  [Submit]
     │                  ▼
     │   ┌────────────────────────────────────┐
     │   │           SUBMITTED                 │
     │   │  (resident can still edit + submit  │
     │   │   again; manager reviews)          │
     │   └────┬────────────────────┬──────────┘
     │        │  [Verify]         │  [Send back <note>]
     │        ▼                    ▼
     │   ┌─────────┐        ┌──────────────┐
     │   │ VERIFIED│        │  SENT-BACK   │
     │   │(locked, │        │(note visible │
     │   │read     │        │to resident)  │
     │   │only for │        └──────┬───────┘
     │   │resident)│               │ resident edits + submits
     │   └─────────┘               │
     │        ▲                    │
     │        └────────────────────┘
     │                                     back to SUBMITTED
     │                                          │
     └──────────────────────────────────────────┘
```

Move-out (Phase 2+): sets `status=stale`, redacts PII fields, keeps
occupancy history.

---

## 4. Validation rules

Client-side, minimal. Server-side re-validates in Phase 2.

| Field | Rule |
|---|---|
| Tower | Required. Must be in `site.json → towers` |
| Flat number | Required. Digits only, 3–5 chars |
| Occupancy | Required. Value from `site.json → occupancyOptions` |
| Primary name | Required, ≤ 80 chars |
| Primary DOB | Required, before today |
| Primary mobile | Required, 10 digits (India) |
| Emergency name/relation/mobile | All required |
| Family member: name | Required if row exists |
| Vehicle: type + regNo | Both required if row exists |
| Family count | ≤ `site.json → limits.familyMembers` (default 12) |
| Vehicle count | ≤ `site.json → limits.vehicles` (default 6) |
| Email (any input) | RFC-ish: `^[^@\s]+@[^@\s]+\.[^@\s]+$` |
| Add admin/manager email | must pass the above regex |

---

## 5. Interaction principles

- **One primary action per screen.** No modal-in-modal. No wizard.
- **Toasts, not banners.** Info messages surface at the bottom-center
  for 3.2 s and auto-dismiss.
- **Optimistic UI** for saves. Show the result immediately; revert
  and toast on failure.
- **Keyboard-first sign-in.** Enter submits the email step; auto-
  advance between OTP boxes; `/` focuses the search anywhere (Phase 2).
- **Every destructive action confirms** — sign-out, remove admin,
  remove manager, delete my data.

---

## 6. Screens NOT in v1

Explicitly deferred to keep scope tight:

- Photo upload UI (primary + family)
- KYC document upload
- Domestic help / driver register
- Two-eyes verification (dual sign-off)
- Reminder cron scheduler UI (worker cron does this without UI in v1)
- Audit-log viewer

Each has a placeholder feature-flag in `site.json` and returns
`503 not implemented` from the worker until turned on.
