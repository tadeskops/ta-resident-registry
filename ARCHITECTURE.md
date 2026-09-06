# TA Resident Registry — Architecture

## Topology

```
                    ┌────────────────────────────┐
   Resident/Committee│  GitHub Pages (docs/)      │
   ─────────────────>│  static HTML + CSS + JS    │
                    │  tadeskops.github.io/...    │
                    └──────────────┬─────────────┘
                                   │ fetch()
                                   ▼
                    ┌────────────────────────────┐
                    │  Cloudflare Worker         │
                    │  (worker/src)              │
                    │  - /auth/otp/*             │
                    │  - /residents/*            │
                    │  - /reports/*              │
                    └──────┬──────────────┬──────┘
                           │              │
              GitHub REST/GraphQL      Mail sender
              (private data repo)     (MailChannels / Resend)
                           │
                           ▼
              ┌────────────────────────┐
              │  private GitHub repo   │
              │  config/residents/…    │
              │  photos/…              │
              │  audit.log             │
              └────────────────────────┘
```

## Why Cloudflare Workers (not a full server)

- Zero-idle cost — free tier covers a 200-flat society easily.
- Same stack as `ta-society-helpdesk` and `ta_vibehive` — one mental
  model, one auth helper library, one CI shape.
- Edge-terminated HTTPS + free custom domain.
- **Known constraint**: 50 outbound `fetch()` subrequests per
  invocation on the Free plan. Every bulk-read route (`GET /residents`,
  `GET /reports/completion`, `GET /reports/export.csv`) MUST use
  GitHub GraphQL batching — one POST with N aliased blob selections
  per query, chunked at ≤ 50 aliases. Never fall into `Promise.all`
  over `readJson` calls; that pattern silently truncates once you
  cross ~45 flats. Documented in the workspace `debugging.md` memory.

## Auth flow (Email OTP → JWT)

```
[Client]                   [Worker]                     [Mail sender]
    │                          │                              │
    │ POST /auth/otp/request   │                              │
    │─── { email } ───────────>│                              │
    │                          │ rate-limit check (KV)        │
    │                          │ code = random 6-digit        │
    │                          │ store { email, sha256(code), │
    │                          │         expiresAt=+10min }   │
    │                          │─ sendOtpEmail(email, code) ─>│
    │<── 202 Accepted ─────────│                              │
    │                          │                              │
    │ POST /auth/otp/verify    │                              │
    │─── { email, code } ─────>│                              │
    │                          │ lookup + compare hash        │
    │                          │ mint JWT (sub=email,         │
    │                          │           role,              │
    │                          │           exp=+8h)           │
    │<── { token } ────────────│                              │
    │                          │                              │
    │ GET /residents/me        │                              │
    │  Authorization: Bearer.. │                              │
    │─────────────────────────>│                              │
```

## Threat model (short)

| Threat | Mitigation |
|---|---|
| Email guessing / enumeration | `/auth/otp/request` returns the **same** `202 Accepted` shape whether the email is known or not. Never confirm existence. |
| OTP brute force | 6 digits × max 5 attempts × 10-min TTL → 1 in 200k per code. Combined with per-email + per-IP rate limits. |
| Replay of intercepted JWT | Short `exp` (8h). Rotate `JWT_SECRET` per quarter. Revocation list in KV for emergency lockouts. |
| Photo upload abuse | MIME whitelist (jpg/png/webp), 2 MB cap, filename sanitisation, stored under `photos/<tower>/<flat>/`. |
| Committee viewing PII of unrelated flats | RBAC enforced server-side per route. Client role hints never trusted. |
| Cloudflare subrequest cap silently truncating directory | GraphQL batched bulk read + explicit `expected === received` assertion in `/residents` handler; fail loudly, don't blank. |
| Repo secrets leaked in commits | `.gitignore` covers `.dev.vars`, `.wrangler/`. GitHub PAT / JWT secret only in `wrangler secret put`, never in `wrangler.toml`. |
| Mojibake corruption on bulk edits | Use the `[System.IO.File]::ReadAllText/WriteAllText` + BOM-less UTF-8 pattern (see debugging memory). Never `Get-Content -Raw` + `Set-Content -Encoding UTF8` round-trips. |

## Environment variables (`wrangler secret put ...`)

| Name | Purpose |
|---|---|
| `JWT_SECRET` | HS256 signing key (≥ 32 random bytes) |
| `GH_TOKEN` | Fine-grained PAT with `contents:rw` on the private data repo only |
| `GH_OWNER` | e.g. `tadeskops` |
| `GH_REPO` | `trr_record` (private, distinct from this public code repo) |
| `GH_BRANCH` | e.g. `main` |
| `MAIL_PROVIDER` | `resend` \| `mailchannels` |
| `RESEND_API_KEY` | Only if `MAIL_PROVIDER=resend` |
| `MAIL_FROM` | e.g. `committee@theaddress.example` |

Non-secret config (towers list, feature flags) lives in
`config/site.json` and is fetched at cold start.
