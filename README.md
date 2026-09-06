# TA Resident Registry

A dedicated resident-information portal for the Management Committee of
The Address (Tower Apartments). Residents sign in with **any** email
address (Gmail, Outlook, Yahoo, iCloud, custom domain — anything) via a
one-time code, then fill in their household details. The Resident
Registry Managers get a directory, completion tracking, and CSV export.

**Live now:**
- **Frontend:** <https://tadeskops.github.io/ta-resident-registry/>
- **Worker API:** <https://ta-resident-registry.tadeskops.workers.dev>
- **Private data repo:** [`tadeskops/trr_record`](https://github.com/tadeskops/trr_record)

## Architecture — deploy + runtime

```mermaid
flowchart TB
    classDef src fill:#fef3c7,stroke:#a16207,color:#000
    classDef gh fill:#e0e7ff,stroke:#3730a3,color:#000
    classDef cf fill:#fee2e2,stroke:#b91c1c,color:#000
    classDef pri fill:#f3e8ff,stroke:#7c3aed,color:#000
    classDef user fill:#dcfce7,stroke:#166534,color:#000

    DEV["👨‍💻 Developer (tadeskops only)"]:::user

    subgraph SRC["📄 Single sources of truth (committed to public repo)"]
        RC["docs/config/constants.json<br/>👉 admin floor · society · repo names"]:::src
        RE["docs/config/env.json<br/>👉 apiBase = worker URL"]:::src
        RS["docs/config/site.json<br/>👉 towers · form fields · limits"]:::src
        RW["worker/wrangler.toml<br/>👉 KV id · MAIL_PROVIDER"]:::src
    end

    DEV -->|"git push main"| GH[("GitHub<br/>tadeskops/ta-resident-registry<br/>(public)")]:::gh
    SRC --> GH

    subgraph BUILD["⚙️ GitHub Actions — build & deploy"]
        T["Test workflow<br/>tsc + vitest + frontend parse checks<br/>runs on every push/PR"]:::gh
        DP["Deploy worker<br/>1️⃣ verify GH secrets are set<br/>2️⃣ tsc + vitest<br/>3️⃣ wrangler secret put JWT_SECRET / GH_TOKEN / RESEND_API_KEY<br/>4️⃣ wrangler deploy<br/>runs when worker/** changes"]:::gh
        KV["Setup KV<br/>manual dispatch, one-time"]:::gh
    end

    GH -->|"docs/** or root config"| PGS[("🌐 GitHub Pages<br/>tadeskops.github.io/ta-resident-registry")]:::gh
    GH -->|"any push"| T
    GH -->|"worker/** push"| DP

    subgraph SECRETS["🔐 GitHub repository secrets"]
        S1[CLOUDFLARE_API_TOKEN]:::src
        S2[CLOUDFLARE_ACCOUNT_ID]:::src
        S3[JWT_SECRET]:::src
        S4[TRR_GH_TOKEN]:::src
        S5[RESEND_API_KEY 🟡 optional]:::src
    end
    SECRETS -.->|"secrets: context"| DP

    DP -->|"wrangler deploy"| WK[["☁️ Cloudflare Worker<br/>ta-resident-registry.tadeskops.workers.dev"]]:::cf
    KV -->|"creates namespace"| KVN[("Cloudflare KV<br/>OTP_KV")]:::cf
    WK -.->|"binding"| KVN

    subgraph USR["👤 Runtime"]
        BR["Resident / Manager / Admin browser"]:::user
    end

    BR -->|"① HTML + CSS + JS"| PGS
    BR -->|"② /config/constants.json /config/env.json /config/site.json"| PGS
    BR -->|"③ /auth/otp/request → 202 (mockCode in noop mode)"| WK
    BR -->|"④ /auth/otp/verify → JWT"| WK
    BR -->|"⑤ /residents/* /config/* with Bearer JWT"| WK

    WK -->|"GitHub Contents API<br/>with TRR_GH_TOKEN"| TRR[("🔒 GitHub<br/>tadeskops/trr_record<br/>(private)<br/>residents/*.json<br/>admins.json · managers.json<br/>audit.log")]:::pri
    WK -->|"sendOtpEmail(to, code)"| MAIL["📧 Mail sender<br/>Resend / MailChannels / noop"]:::cf
    WK -.->|"hash + verify OTP<br/>10-min TTL"| KVN
```

**How to read this**

- **Yellow boxes** = files committed to the public repo — the single sources of truth
- **Blue boxes** = GitHub (public repo, Actions, Pages)
- **Red boxes** = Cloudflare (Worker + KV namespace + mail sender)
- **Purple box** = private data repo (`trr_record`)
- **Solid arrows** = actual runtime data flow
- **Dashed arrows** = build-time or configuration bindings

**Every push to `main` triggers automation.** You edit files, `git push`, and CI takes over — no local `wrangler`, no local `npm install`, no local secrets. See [DEPLOYMENT.md](DEPLOYMENT.md) for the one-time setup steps.

This repository is deliberately **separate** from
[`ta-society-helpdesk`](../ta-society-helpdesk) so resident KYC / PII
data lives on its own storage, its own repo, its own worker, and its
own access list — without leaking into the helpdesk operational tree.

Resident records themselves live in a **separate private repo**
[`tadeskops/trr_record`](https://github.com/tadeskops/trr_record).
Nothing in this public repo ever contains a resident's name, phone,
email, or DOB.

## Commit policy

**Only the `tadeskops` GitHub account may commit / push to this repo
or to `trr_record`.** See [CONTRIBUTING.md](CONTRIBUTING.md) for the
git-identity setup, the pre-commit hook, and the push-authentication
checklist. Both repos share the same policy.

> Status: **Phase 2 shipped — live** (Sep 2026). Worker deployed to
> Cloudflare, JWT-based auth working end-to-end, resident records
> persist to the private `trr_record` repo. See
> [REQUIREMENT.md §10 phasing](REQUIREMENT.md#10-phasing) for the roadmap.

## Quick preview (Windows PowerShell)

```powershell
cd ta-resident-registry\docs
python -m http.server 8792
# open http://localhost:8792/
```

Sign-in accepts any email; the "OTP" is printed to the browser console
(and pre-filled in the input) in mock mode. See
[REQUIREMENT.md §5](REQUIREMENT.md#5-authentication--email-otp) for the
real-mode contract.

## Layout

| Path | Purpose |
|---|---|
| `docs/` | Static frontend (GitHub Pages target) |
| `docs/assets/css/theme.css` | Shared visual system |
| `docs/assets/js/{auth,api,ui}.js` | Client helpers |
| `worker/` | Cloudflare Worker source (skeleton) |
| `config/` | Runtime JSON config (site, roles, residents) |
| `REQUIREMENT.md` | Product + technical spec |
| `ARCHITECTURE.md` | Deployment topology, storage layout, threat model |

## Reference material used

Design language, mobile patterns, role model, config-loader shape, and
UTF-8 file-write gotchas were all lifted from the sibling repo
[`ta-society-helpdesk`](../ta-society-helpdesk). This project is
**not** a fork — only the design system is reused. Data, auth, and
routes are independent.
