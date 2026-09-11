# ADR-0002: State, idempotency and storage

Status: accepted (2026-09)

## Decision

- The **run directory is the artifact authority**: `runs/<brand_id>/<run_id>/`, one numbered folder per
  stage, each stage writing `<stage>.json` plus a sidecar `<stage>.meta.json` with the stage version, the
  inputs hash, prompt versions, brand config version, provider ids, timing and cost. Media is written to
  `*.part` and renamed, so a half-written file is never mistaken for a finished one on resume.
- **SQLite** (`data/pipeline.db`, `better-sqlite3`) is an index and ledger, not the source of truth: runs,
  stages, shots, the generation ledger (every paid call) and QC results. It can be rebuilt from `runs/`.
- **Idempotency key** = `sha256(stageVersion, brandConfigVersion, upstream artifact hashes, prompt
  versions, provider config)`. Editing the brand file or a prompt invalidates exactly the downstream
  stages. `rerun --from <stage>` resets that stage and everything after it.
- **Shot-level granularity**: each shot has its own `shotHash` (its storyboard entry, continuity entry,
  routing entry, prompt versions, provider config). A shot is re-produced only when its own hash changes.

## Consequences

- A crash anywhere resumes with `resume <run_id>` and re-pays nothing that already succeeded.
- Everything is inspectable and hand-editable JSON; the database can be deleted and rebuilt.
