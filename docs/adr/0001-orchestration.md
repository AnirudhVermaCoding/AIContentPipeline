# ADR-0001: Orchestration — typed stage runner, not LangGraph

Status: accepted (2026-09)

## Context

The pipeline is a linear sequence of stages with one fan-out (per-shot production), bounded retry loops
inside stages, a hard budget stop, an optional human approval gate before animation, and per-stage /
per-shot idempotency so a failed shot 6 never re-pays for research, script, storyboard or shots 1–5.

Before choosing, we inspected OpenReels' orchestration. It uses Mastra workflows as a linear `.then()`
chain; every step's schema is `{done: boolean}` and the real state travels through mutable closure
objects. No storage is configured, so suspend/resume is inert. The framework provides sequencing only;
"retry from failed stage" is an open TODO. ViMax, by contrast, uses plain async functions with
`if exists(artifact): load` at every node and gets crash-resume for free.

## Options

| Criterion | Typed stage runner + manifest + SQLite | LangGraph.js + SqliteSaver |
|---|---|---|
| Checkpoint / resume | Per-stage artifact files + input hashes; resume = skip done stages with matching hash | Opaque state blobs in a checkpointer; artifact files still needed |
| Branching | One `switch` in the router stage; QC loops are local loops | Conditional edges (nicer diagram, same logic) |
| Human approval | Stage returns `WAITING_APPROVAL`; CLI `approve` + `resume` | `interrupt()` / `Command(resume)` — good, but one gate only |
| Per-shot idempotency | Native: each shot has its own status, hash and files | Sub-graphs or map-reduce; extra complexity |
| Cost ledger | First-class in the runner | Orthogonal, still ours |
| Dependency cost | ~300 lines of typed code | One more framework, reducer semantics, checkpoint schema versioning |
| Debuggability | Every stage output is a JSON file you can open and edit | State lives in checkpointer rows |

## Decision

A plain typed stage runner. A `Stage<I, O>` declares `id`, `version`, how to gather its inputs from the
run manifest, how to hash them, and `run(inputs, ctx)`. The runner walks the ordered stage list, computes
the inputs hash, skips stages already `done` with a matching hash, executes otherwise, persists outputs
atomically, records timing and cost, and stops on failure, budget exhaustion, budget conflict or a pending
approval.

## Consequences

- Checkpoints, resume, retry loops and the approval gate exist without a framework.
- Revisit LangGraph if we add parallel creative branches judged by a critic, multi-round human review
  across several gates, or a UI that needs streaming graph state. None are in the MVP.
