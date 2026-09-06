# Contributing to `ta-resident-registry`

## 1. Only the `tadeskops` GitHub account may commit / push to this repo

This is a personal-data-adjacent project for The Address Management
Committee. The GitHub authorship record is part of our audit trail.

**Rules:**

- Every commit on `main` (and every feature branch) MUST be authored by
  the `tadeskops` account.
- No collaborators are added to this repo. External contributors are
  not accepted at this time.
- No GitHub App, bot, or Action may push to this repo on behalf of any
  other identity.
- Pull requests from forks will be closed without review.

If a commit lands with any other author, the reviewer must revert it
immediately (`git revert <sha>`) and rotate any leaked secret.

## 2. Local git identity — enforce it on your machine

Run this **once per clone** on every workstation where you edit this
repo. It scopes the identity to this repo only, so your other repos are
unaffected:

```powershell
cd c:\CR7\TAMC\IRP_Repo\ta-resident-registry
git config --local user.name "tadeskops"
git config --local user.email "ta.deskops@gmail.com"
```

> `ta.deskops@gmail.com` is the canonical identity for the `tadeskops`
> account, matching the email in the initial commits of both this repo
> and `trr_record`. If you prefer to hide it, replace with
> `tadeskops@users.noreply.github.com` — both are valid tadeskops
> identities on github.com.

Verify:

```powershell
git config --local user.name          # tadeskops
git config --local user.email         # ta.deskops@gmail.com
git log -1 --format='%an <%ae>'       # should match the above after your next commit
```

## 3. Pre-commit hook — reject the wrong identity locally

Save this as `.git/hooks/pre-commit` in your clone (not tracked by git —
it's per-machine). Then `chmod +x` it on macOS/Linux, or on Windows just
leave it as-is (Git for Windows executes it via sh):

```sh
#!/bin/sh
# Reject commits authored by anyone other than tadeskops.
name="$(git config user.name)"
email="$(git config user.email)"
if [ "$name" != "tadeskops" ]; then
  echo "ERROR: git user.name is '$name', must be 'tadeskops' in this repo." >&2
  echo "Fix: git config --local user.name tadeskops" >&2
  exit 1
fi
case "$email" in
  ta.deskops@gmail.com|tadeskops@users.noreply.github.com|*@tadeskops.*)
    ;;
  *)
    echo "ERROR: git user.email is '$email'." >&2
    echo "Fix: git config --local user.email ta.deskops@gmail.com" >&2
    exit 1
    ;;
esac
```

## 4. Push authentication

Push only over HTTPS with the `tadeskops` personal access token (PAT)
or via SSH key registered to the `tadeskops` account. Do NOT push using
a co-author PAT / SSH key from another GitHub identity.

```powershell
git remote -v                          # origin  https://github.com/tadeskops/ta-resident-registry.git
git push origin main
```

If Windows Credential Manager offers a different identity, delete the
stored credential for `https://github.com` and re-authenticate as
`tadeskops`:

```powershell
cmdkey /list:git:https://github.com
cmdkey /delete:git:https://github.com    # then push again to re-prompt
```

Or set the local credential helper to `wincred` (learned from the
sibling `ta-society-helpdesk` repo — see workspace `debugging.md`):

```powershell
git config --local credential.helper ""
git config --local --add credential.helper wincred
```

## 5. What NOT to commit here (privacy contract)

Nothing containing personally identifiable information (PII) is allowed
in this public repo. Enforced three ways:

1. `.gitignore` blocks `config/residents/`, `config/otp/`,
   `config/audit.log`, `photos/`, `.dev.vars`, `worker/.dev.vars`,
   `worker/.wrangler/`.
2. The Worker writes PII only to the private `trr_record` repo via a
   fine-grained PAT scoped to that repo alone.
3. Run this before every push:
   ```powershell
   git diff --cached --name-only | Select-String -Pattern 'residents/|photos/|audit\.log|\.dev\.vars'
   ```
   If it prints anything, abort the push.

Committee and admin email lists likewise stay in `trr_record`. The
`config/committee.json` and `config/admins.json` files in **this** repo
are empty scaffolds and must remain empty.

## 6. Branch strategy

- `main` is the deploy branch (GitHub Pages publishes from `docs/`).
- Feature work: `feat/<short-name>` branches, merged into `main` via a
  PR authored by `tadeskops`.
- No force-push to `main`. Set this in Settings → Branches once you're
  past initial scaffolding.
