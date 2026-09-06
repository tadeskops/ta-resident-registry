# Deployment (fully automated)

Everything runs in GitHub Actions. You never open a terminal. After the
one-time setup below, every push to `main` under `worker/**`
automatically tests, syncs secrets, and deploys the Cloudflare Worker.
GitHub Pages already auto-deploys the frontend from `main`/`docs`.

## One-time setup (5 minutes)

### 1. Get a Cloudflare API token + account id

1. Cloudflare dashboard → **My Profile** → **API Tokens** → **Create Token**
2. Template: **Edit Cloudflare Workers**
3. Under **Zone Resources** you can leave "All zones" or scope down.
4. Copy the token — you'll paste it below.
5. Cloudflare dashboard → **Workers & Pages** → sidebar → your **Account
   ID** (a hex string). Copy it.

### 2. Create a fine-grained GitHub PAT for the private data repo

1. github.com → **Settings** → **Developer settings** → **Personal
   access tokens** → **Fine-grained tokens** → **Generate new token**
2. Repository access: **Only select repositories** → `tadeskops/trr_record`
3. Permissions → **Contents: Read and write**, **Metadata: Read**
4. Copy the token.

### 3. Generate a JWT signing secret

Use any method that produces ≥ 32 random bytes. Simplest is to open
this URL and copy the "base64" value: <https://www.random.org/bytes/>
(choose 32 bytes, base 64). Or from any browser DevTools console:

```js
btoa(crypto.getRandomValues(new Uint8Array(32)).join(','))
```

### 4. (Optional) Get a Resend API key

Only if you want real emails now. Otherwise skip — `MAIL_PROVIDER=noop`
works for testing without email delivery.

1. Sign up at <https://resend.com/>
2. Add + verify your sender domain (needs DNS access)
3. **API Keys** → create → copy

### 5. Add all secrets to the GitHub repo

github.com → `tadeskops/ta-resident-registry` → **Settings** → **Secrets
and variables** → **Actions** → **New repository secret**. Add each:

| Secret name             | Value                                             |
|-------------------------|---------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`  | from step 1                                       |
| `CLOUDFLARE_ACCOUNT_ID` | from step 1                                       |
| `TRR_GH_TOKEN`          | fine-grained PAT from step 2                      |
| `JWT_SECRET`            | random string from step 3                         |
| `RESEND_API_KEY`        | from step 4 (optional — skip if using noop mail)  |

> `TRR_GH_TOKEN` is prefixed to avoid collision with the built-in
> `GITHUB_TOKEN`.

### 6. Create the KV namespace (one click)

github.com → `tadeskops/ta-resident-registry` → **Actions** tab →
**Setup KV namespace (one-time)** → **Run workflow** → **Run workflow**.

Wait ~30 s. When it finishes, open the run's **Summary** — it prints:

```
[[kv_namespaces]]
binding = "OTP_KV"
id = "abc123def..."
```

Copy those three lines and paste them into
[worker/wrangler.toml](worker/wrangler.toml), replacing the commented-out
block. Commit + push. Nothing else needed — the next commit to `main`
under `worker/**` will pick it up automatically.

## What happens on every push

1. GitHub Actions **Test** workflow runs on every push and PR:
   - Worker typecheck (`tsc --noEmit`)
   - Worker unit tests (`vitest run`)
   - Frontend JS parse checks
   - JSON config validation

2. GitHub Actions **Deploy worker** workflow runs on push to `main` when
   `worker/**` changes:
   - Runs the same tests
   - Syncs `JWT_SECRET`, `GH_TOKEN`, `RESEND_API_KEY` to Cloudflare via
     `wrangler secret put` (idempotent — safe to re-run)
   - `wrangler deploy` → new worker version live

3. **GitHub Pages** auto-deploys `docs/**` from `main` (already
   configured — no workflow file needed).

## Flip the frontend to the live worker

Once the worker is deployed, its URL looks like
`https://ta-resident-registry.<your-subdomain>.workers.dev`. To point
the frontend at it, edit each HTML page (or just [index.html](docs/index.html))
and add **before** the `api.js` script tag:

```html
<script>window.__TRR_API__ = 'https://ta-resident-registry.YOURSUB.workers.dev';</script>
```

Commit + push. Pages redeploys within a minute.

To flip back to mock mode (useful for demos without a Cloudflare
account), delete that line or set `window.__TRR_MOCK__ = true;`.

## Verifying the pipeline works

After you've added all secrets:

1. **Actions** tab → **Test** → **Run workflow** on `main` → confirm green.
2. Make any tiny change under `worker/**` (e.g. bump the version in
   `worker/package.json`) → commit + push → watch the **Deploy worker**
   run go green → open the worker URL in a browser → hit `/whoami` →
   expect `{"ok":true,"data":{"email":null,"role":"UNKNOWN"}}`.

## Rotating a secret

Change the value in **Settings → Secrets** and re-run the **Deploy
worker** workflow (**Actions → Deploy worker → Run workflow**). The
sync steps overwrite the old CF secret.

## Turning off automation temporarily

- Disable a workflow: **Actions** tab → workflow name → **⋯** → **Disable
  workflow**.
- Rollback a deploy: revert the commit + push → next Deploy workflow
  picks up the reverted code.
