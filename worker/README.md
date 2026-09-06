# Worker (skeleton — Phase 2)

Cloudflare Worker for the Resident Registry. Only the route wiring is
present today; every handler returns `501 not implemented`. Phase 2
fills in:

- `/auth/otp/request` — rate-limit + persist code (KV) + call
  `sendOtpEmail(to, code)`.
- `/auth/otp/verify` — hash compare + mint JWT (HS256, `exp=+8h`).
- `/residents/me` GET/PUT — read/write the caller's flat JSON in the
  private data repo via GitHub Contents API.
- `/residents` (COMMITTEE+) — GitHub **GraphQL batched read** (see
  workspace `debugging.md` — the 50-subrequest cap silently truncates
  bulk reads).

## Local dev

```powershell
cd worker
npm install
npx wrangler secret put JWT_SECRET
npx wrangler secret put GH_TOKEN
npx wrangler secret put RESEND_API_KEY
npm run dev
```

Then point the frontend at the dev URL:

```html
<!-- Just before api.js in any page: -->
<script>window.__TRR_API__ = 'http://127.0.0.1:8787';</script>
```

## Deploy

```powershell
npm run deploy
```

Wrangler will publish under the CF account tied to your `wrangler login`
session. Route/domain wiring is out of scope for this skeleton — see the
`ta-society-helpdesk` worker for the pattern.
