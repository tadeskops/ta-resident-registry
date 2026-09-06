# Worker

Cloudflare Worker backend for `tadeskops/ta-resident-registry`.
Persists resident records and roster to the private `tadeskops/trr_record`
repo via the GitHub Contents API, and mints HS256 JWTs for the Email
OTP flow.

## Layout

```
src/
  index.ts                  router + JWT auth middleware
  lib/
    env.ts                  Env + Ctx + Role types
    envelope.ts             {ok,data}/{ok:false,error} helpers
    http.ts                 CORS + json() + readJsonBody()
    roles.ts                HARD_CODED_ADMINS floor + roleFor + isAtLeast
    jwt.ts                  HS256 sign + verify (Web Crypto)
    otp.ts                  Generate/hash/verify 6-digit codes; KV or in-memory
    mail.ts                 MailSender interface + Resend / MailChannels / noop
    github.ts               Contents API get/put + audit.log appender
    site-config.ts          site.json + admins.json + managers.json read/write
    records.ts              Per-flat CRUD + per-tower index
  routes/
    auth.ts                 POST /auth/otp/{request,verify}
    whoami.ts               GET /whoami
    config.ts               GET /config, PUT /config/site,
                            GET/POST /config/admins, DELETE /config/admins/:email,
                            GET/POST /config/managers, DELETE /config/managers/:email
    residents.ts            GET/PUT /residents/me, POST /residents/me/submit,
                            GET /residents, GET /residents/:tower/:flat,
                            POST /residents/:tower/:flat/{verify,send-back}
tests/
  roles.test.ts             hard-coded floor + email validation + role chain
  jwt.test.ts               sign / verify / tamper / expiry
  otp.test.ts               6-digit generator + attempt limit
  routes.test.ts            end-to-end HTTP smoke: 404, CORS, JWT auth, RBAC
```

## Contract highlights

- **Envelope**: `{ ok: true, data }` or `{ ok: false, error: <string> }`.
- **CORS**: `https://tadeskops.github.io` + `http://localhost:8792` allowed.
- **Auth**: Bearer JWT (HS256, `sub=email`, `role`, `exp=+8h`). Server
  never trusts client role hints — every mutating route re-verifies.
- **Hard-coded floor**: `HARD_CODED_ADMINS = ['samanasippa@gmail.com',
  'ta.deskops@gmail.com']` in [src/lib/roles.ts](src/lib/roles.ts).
  Cannot be removed, cannot be added as a manager. Mirror of the
  client-side constant in `docs/assets/js/api.js`.
- **Storage layout in `trr_record`**:
  ```
  config/site.json                    site + form settings
  config/admins.json                  dynamic admins
  config/managers.json                dynamic managers
  config/residents/<T>/<F>.json       one file per flat
  config/residents/<T>.index.json     one directory index per tower
  config/audit.log                    append-only
  ```

## Local dev

```powershell
cd worker
npm install
npx wrangler secret put JWT_SECRET
npx wrangler secret put GH_TOKEN
npx wrangler secret put RESEND_API_KEY
npm run dev
```

Point the frontend at the dev URL by adding **before** `api.js`:

```html
<script>window.__TRR_API__ = 'http://127.0.0.1:8787';</script>
```

## Tests

```powershell
npm install
npm test
```

Vitest runs four suites: `roles`, `jwt`, `otp`, `routes`. The `routes`
suite stubs `fetch` so GitHub is never called during tests.

## Deploy

Prerequisites (once per Cloudflare account):

1. `wrangler login`
2. `wrangler kv:namespace create OTP_KV` → copy the `id` → uncomment
   `[[kv_namespaces]]` in `wrangler.toml` with that id.
3. `wrangler secret put JWT_SECRET` (>= 32 random bytes)
4. `wrangler secret put GH_TOKEN` (fine-grained PAT: repo=`trr_record`,
   contents=Read/write, metadata=Read)
5. `wrangler secret put RESEND_API_KEY` (only if `MAIL_PROVIDER=resend`)

Then:

```powershell
npm run deploy
```

## Env vars

| Name             | Kind         | Purpose                                       |
|------------------|--------------|-----------------------------------------------|
| `JWT_SECRET`     | secret       | HS256 signing key                             |
| `GH_TOKEN`       | secret       | fine-grained PAT for `trr_record`             |
| `RESEND_API_KEY` | secret       | mail sender (only if provider=resend)         |
| `GH_OWNER`       | `[vars]`     | `tadeskops`                                   |
| `GH_REPO`        | `[vars]`     | `trr_record`                                  |
| `GH_BRANCH`     | `[vars]`     | `main`                                        |
| `MAIL_PROVIDER`  | `[vars]`     | `resend` \| `mailchannels` \| `noop`          |
| `MAIL_FROM`      | `[vars]`     | verified sender address                       |
| `OTP_KV`         | KV binding   | 6-digit code store (in-memory fallback if unset) |

## Sender-domain checklist (before Phase 2 goes live)

- [ ] Verify sender domain in Resend (or set up MailChannels SPF+DKIM)
- [ ] SPF DNS record includes `include:_spf.resend.com` (or mailchannels)
- [ ] DKIM CNAME records added
- [ ] Send a test email to a gmail + outlook + yahoo address
- [ ] Flip `FEATURE_TRR_OTP_LIVE=true` in site.json

## Known limits

- Bulk directory read touches every flat file. Fine for < 40 flats;
  above that, the CF Free 50-subrequest cap will truncate the list.
  Mitigation for later: read only `config/residents/*.index.json`
  (one per tower) and lazy-load flat detail on click.
- OTP store: without KV binding the module falls back to an in-memory
  Map. That map resets on every isolate cold-start, so codes may vanish
  between the request and verify steps in production. **Always bind an
  OTP_KV namespace before flipping FEATURE_TRR_OTP_LIVE.**
