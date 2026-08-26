---
name: agent-commit
description: >
  Commit, branch, and open pull requests in Palantir-TH under the project's Commit Protocol.
  Use whenever work is about to be recorded in git: staging changes, writing a commit message,
  choosing a branch name, splitting a large diff, running pre-commit quality gates, drafting a
  PR body, or deciding whether a change is a backbone change needing extra review. Triggers on
  "commit", "commit this", "write the commit message", "create a branch", "open a PR", "raise a
  pull request", "squash", "sign-off", "DCO", "conventional commit", "hotfix", "revert".
  Also load before any git history operation (rebase, force-push, amend) so the stop conditions
  are applied before the command runs, not after.
---

# Agent Commit — Palantir-TH

Authoritative source: `mockup/Protocal Commit.md`. This skill is the operational form of that
document for a coding agent. If the two ever disagree, the protocol document wins and this file
is wrong — say so and fix it.

## 0. Consent Gate

Never commit, push, or open a PR unless the user asked for it in this session. Finishing an
implementation is not permission to record it. When the user does ask, run the whole procedure
below — a partial application of it is worse than none, because it looks compliant.

## 1. Stop Conditions

Stop and ask the user. Do not resolve these on your own judgement:

| Situation | Why it stops |
| --- | --- |
| On `main` and asked to commit | Direct commits to `main` are forbidden; offer to branch first |
| `git push --force`, `--force-with-lease` on a shared branch, rebase of pushed history | History rewrite |
| `--no-verify`, `--no-gpg-sign`, skipping a failing hook | Hooks are a gate, not friction |
| A secret, token, credential, `.env` value, or personal/case data appears in the diff | Incident, not a commit — see §9 |
| Quality gates fail | Report the failure; never commit around it |
| Backbone change (§6) with no migration/rollback plan | Cannot merge as-is |
| Unrelated pre-existing staged changes in the working tree | They belong to someone else's commit |

## 2. Pre-Flight

Run before touching the index:

```bash
git status --porcelain
git branch --show-current
git diff            # unstaged
git diff --cached   # already staged — preserve, do not absorb blindly
```

Read the diff. Scan specifically for: `.env*` contents, connection strings, `mongodb+srv://`,
API keys, bearer tokens, `data/raw/` payloads, real citizen coordinates or identities, debug
dumps, and generated files (`.next/`, `*.tsbuildinfo`, `test-results/`). None of these enter git.

Large generated datasets go to approved storage or a release artifact, never into the repository.

## 3. Branch

Branch from a current `main`:

```text
feat/<issue>-short-name
fix/<issue>-short-name
data/<issue>-source-name
schema/<issue>-short-name
docs/<issue>-short-name
refactor/<issue>-short-name
security/<issue>-short-name
hotfix/<issue>-short-name
```

```bash
git switch -c feat/42-event-search
```

One branch, one issue. If the working tree mixes unrelated issues, split them into separate
branches or separate commits before proceeding.

## 4. Commit Message

Conventional Commits:

```text
<type>(<scope>): <summary>

<body>

<footer>
```

Types: `feat`, `fix`, `data`, `schema`, `security`, `refactor`, `perf`, `test`, `docs`,
`build`, `ci`, `chore`, `revert`.

Scopes used in this repository: `ui`, `report`, `map`, `api`, `db`, `ingestion`, `e2e`,
`auth`, `deps`, `skills`, plus per-source scopes such as `acled`, `ucdp`, `dsw`.

Summary rules: imperative mood, 72 characters or fewer, no trailing period, no ticket number in
the summary line — that belongs in `Refs:`.

Body: why the change exists and what it deliberately does not change. Wrap at ~72 columns.

Footer trailer order:

```text
BREAKING CHANGE: <what breaks and what must happen before deploy>
Migration: <path to the migration script>
Rollback: <the command or steps that undo this>
Refs: #57

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Signed-off-by: Full Name <email@example.com>
```

`Signed-off-by` comes last and is produced by `git commit -s`, never typed by hand — the DCO
sign-off is the author's legal assertion, so it must come from the author's own git identity.

Breaking changes carry `!` after the type/scope **and** the `BREAKING CHANGE:` footer:

```text
schema(raw-records)!: require content hash and fetched timestamp
```

One commit does one thing and reverts cleanly. If the summary needs "and", split the commit.
Dependency bumps stay separate from feature work whenever that is possible.

## 5. Quality Gates

Match CI (`.github/workflows/ci.yml` runs `npm ci` then `npm run check`):

```bash
npm ci
npm run check     # check:env + gis:validate + typecheck + build
```

For any change to browser behavior — `/report`, map interaction, GPS, forms:

```bash
npx playwright test
```

A bug fix adds a regression test that fails before the fix and passes after it.

If the build breaks on a pre-existing unrelated file: identify the existing failure explicitly,
do not attribute it to this change, run targeted checks on the changed code, and record the
distinction in the commit body and the PR. Never quietly repair unrelated files inside a
feature commit.

### Data pipeline changes

Additionally verify each of these and state the result:

- re-ingesting the same input creates no unintended duplicates
- source ID and `content_hash` stay stable per contract
- raw payloads remain immutable
- `source_url`, `fetched_at`, connector version, and run ID are recorded
- a single record failure does not lose the batch
- retry does not alter already-successful results

## 6. Backbone Changes

Treat as backbone: database schema, indexes, migrations; `source_registry`, `raw_records`,
`ingestion_runs`, `event_candidates`; connectors, scrapers, schedulers, deduplication;
`content_hash`, source identity, provenance; public API, shared types, validation; auth,
authorization, audit log, secrets; dependencies, build, deploy, CI; license, privacy,
retention, security policy.

A backbone commit is incomplete without all three: verification evidence, a migration plan,
and a rollback plan. It needs 2 reviewers, one of them a code owner — say so in the PR, and do
not imply the change is ready to merge on a single approval.

Schema and API sequencing: additive before destructive, and expand → migrate/backfill →
switch readers → contract. Migrations are idempotent and offer a dry run at scale. Never
mutate production data by hand without a script and an audit trail.

## 7. Commit Execution

```bash
git add <explicit paths>          # never `git add -A` over an unreviewed tree
git commit -s                     # -s adds the DCO trailer
```

Multi-line message from PowerShell, using a single-quoted here-string:

```powershell
git commit -s -m @'
feat(report): add draggable incident marker

Citizens can correct the incident point when device GPS is wrong.
Basemap switching leaves coordinates untouched.

Refs: #42

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
'@
```

Then confirm the sign-off trailer is actually present:

```bash
git log -1 --pretty=%B
```

## 8. Pull Request

Never push to `main`. Push the branch and open a PR whose body has every section:

```markdown
## Why
The problem or reason for the change.

## What
What changed, and what deliberately did not.

## Verification
Commands run and their results; screenshots for UI.

## Data and security impact
Sources, license/ToS, PII, secrets, threats — or an explicit "none".

## Migration and rollback
Deploy, migration, and rollback steps — or an explicit "not required".

## Related issue
Closes #<issue>
```

"None" and "not required" are valid answers; a missing section is not. Keep the PR small enough
to review. Call out explicitly, per AGENT.md §28: mobile risk, GPS behavior, HTTPS requirement,
map provider assumptions, satellite licensing, missing E2E coverage, build/test blockers,
privacy risk.

Approval: 1 reviewer normally, 2 plus a code owner for backbone/security/privacy changes. The
author is never the sole approver. Blocking comments get resolved with a reason. CI green, no
conflict with `main`. Significant logic changes after approval need a fresh review.

Merge: **squash and merge**, with a Conventional Commit title referencing the issue/PR, and the
contributor's DCO sign-off on the final commit. Delete the branch after merge. Merge commits
are for release branches or a maintainer-justified case.

## 9. If a Secret Reaches a Commit

Do not push. Do not rewrite history unilaterally. Tell the user immediately, then:

1. treat the secret as compromised — it must be rotated or revoked first
2. notify maintainers privately, never in a public issue or PR
3. remove it from code and history per the incident response plan
4. review logs to assess whether the secret was used
5. record the incident without reproducing the secret's value

The same applies to an unfixed vulnerability: private security reporting only, never a public
issue or PR describing it.

## 10. Emergency Hotfix

Only for an outage, data at risk, or an actively exploited vulnerability, and only when the user
declares the emergency. Then: branch `hotfix/<issue>-short-name`, smallest possible diff,
relevant gates still run, a rollback command or feature flag ready, and a post-incident PR
within 48 hours adding the tests, docs, and review that were skipped. The bans on committing
secrets and on destroying data without a backup never lift.

## 11. Definition of Done

A reviewer must be able to answer, from the PR alone: what changed, why it is safe, how it was
verified, and how to roll it back. Passing the build is not done.
