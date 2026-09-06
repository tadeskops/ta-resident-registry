# Runtime data (real deployment)

In the real deployment these JSON files live in a **separate private
GitHub repo** (`tadeskops/trr_record`), not in this public code
repository. See [ARCHITECTURE.md](../ARCHITECTURE.md).

The files kept here are:

- `site.json` — public, non-sensitive form config (towers list, form
  caps, feature flags). Safe to publish; the worker exposes it at
  `GET /config`.
- `managers.json` / `admins.json` — **empty scaffolds** committed
  here so the file layout is self-documenting. In production these are
  overridden by the private data repo copies.

Never commit `residents/*.json` to this public repo. Enforced by
`.gitignore`.
