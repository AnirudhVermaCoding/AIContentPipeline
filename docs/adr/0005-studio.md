# ADR-0005: The studio sits beside the pipeline, not inside it

Status: accepted (2026-09)

## Decision

- **Two processes, one root.** `pnpm studio` starts the API server (`src/studio/server.ts`, Hono on
  127.0.0.1:4747, run with tsx like the CLI) and the Next.js app (`studio/`, a pnpm workspace
  package). Both resolve `runs/`, `data/`, `brands/` and `.env` from `AICP_ROOT` (the repo root).
  The Next app never imports runtime pipeline code — only `import type` from
  `src/studio/api-types.ts` — so Remotion's bundler, better-sqlite3, sharp and `import.meta.url`
  paths stay on the runtime they were written for.
- **One process per job.** Every start/resume/rerun is `node --import tsx src/studio/job.ts <id>`,
  spawned detached and tracked in the `jobs` table (pid, heartbeat, current stage/shot,
  pause/cancel flags). A studio restart re-attaches live jobs; a dead process is reconciled: its
  hold is released and any call that was in flight is kept at its estimate and flagged
  `unknown_killed`, never zeroed.
- **Cooperative pause/cancel.** `RunContext.control.checkpoint()` runs between stages, between
  shots and before every paid call. It throws `RunInterruptedError`; the runner puts the stage
  back to `pending` (work already paid for is on disk) and marks the run `stopped` with a
  `stop_reason`. A provider call already in flight is never interrupted; the UI says so.
- **Budget rules live in SQLite, not in memory.** `src/budget/ledger.ts` holds the brand wallet,
  daily (calendar day in the brand's timezone) and rolling 48-hour limits. A job is admitted in
  one `BEGIN IMMEDIATE` transaction that holds its maximum exposure (`hard_cap − spent`); the hold
  shrinks as spend commits and is released when the job stops. Per-call reservations stay in the
  existing `BudgetGuard`. Every paid call books a `spend` row (also when the vendor charged a
  failed call) in the same transaction that completes its ledger row.
- **Provenance is pinned.** `createRun` freezes the effective brand profile (plus the selected
  product) into `brand.snapshot.json`; studio resumes read the snapshot (`brand_source:
  snapshot`), the CLI keeps reading the live file unless `--pin-brand` is given. The brand version
  hash now covers the whole profile (nested fields included) and is computed before asset paths
  are absolutised.
- **Versions are never overwritten.** Shot version numbers count from the files on disk and every
  archived record, so a hash reset (storyboard edit, provider change) cannot clobber
  `keyframe_v1.png`; superseded records go to `shots/<id>/history/`.
- **Continuity preserves what did not change.** On re-run the continuity stage restores the
  previous locks, style bible and per-shot entries for storyboard shots whose entry hash is
  unchanged, so a one-shot edit re-produces one shot.

## Consequences

- Money never moves through the studio: the wallet is an accounting limit that decides whether
  the orchestration may spend. Costs are USD-canonical with the FX rate stored per row.
- Every figure the UI shows carries its source: PROVIDER_REPORTED, CALCULATED_FROM_USAGE or
  ESTIMATED. Today's adapters compute from exact usage (tokens, megapixels, seconds, characters);
  no vendor returns a billed amount in its response.
- Semantic QC (product accuracy, brand fit, realism…) is not implemented; the UI shows those as
  unavailable rather than inventing scores.
