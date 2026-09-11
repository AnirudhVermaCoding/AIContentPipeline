# Architecture

Local-first, configuration-driven pipeline: `brand_id + topic/goal → 720×1280 MP4 + cost report`.
Everything runs on one laptop: CLI, filesystem, SQLite, Remotion + ffmpeg. No queues, servers or cloud
storage.

## Stages

```
00 brief        Brand Brain (deterministic brand context) + Creative Director (LLM)   → CreativeBrief
01 research     LLM with web search; depth chosen by the brief (none | light | deep)   → ResearchNotes
02 script       LLM                                                                    → Script (narration lines, or music-only)
03 voice        TTS per narration line, concatenated with gaps → exact line timings   → voice.mp3 + timings
04 storyboard   LLM, cuts to measured narration timing; deterministic slop-risk check → Storyboard (shot count decided by the story)
05 continuity   Continuity Controller: entities, identity blocks, refs, locks          → ContinuityBible
06 route        Asset Router within the seconds target, the motion promise and the cap → RoutingPlan
07 keyframes    sequential: prompt → keyframe → checks → [WAITING_APPROVAL]           → shots/shot_NN/keyframe_vN.png
08 animate      parallel: image-to-video for GEN_VIDEO shots, stills for the rest      → shots/shot_NN/video.mp4
09 audio        music choice, voice envelope, ducking profile                          → AudioPlan
10 edit         Edit Decision: NONE | FINISH_ONLY | LIGHT | ASSEMBLY                   → EDL
11 render       ffmpeg (NONE / FINISH_ONLY) or Remotion (LIGHT / ASSEMBLY)             → final.mp4
12 final_qc     probe, loudness, text policy, motion promise (silent-downgrade check)  → FinalQcReport
13 report       ledger + decisions                                                     → report.json / report.md
```

Voice is synthesized right after the script so the storyboard cuts to real timing. All keyframes are
produced (and optionally approved) before any paid animation.

## Layout

- `brands/<id>/brand.yaml` — BrandProfile (validated; its hash is the brand config version).
- `prompts/*.md` — versioned system prompts.
- `src/brand` — schema, loader, Brand Brain (role-specific context slices).
- `src/schema` — every artifact schema (zod).
- `src/pipeline` — manifest, stage runner, budget guard, events, stages/.
- `src/agents` — thin LLM callers (prompt + schema + validation).
- `src/providers` — vendor adapters behind capability interfaces; `registry.ts` resolves them from config.
- `src/cost` — pricing table, ledger, estimator, report.
- `src/media` — ffmpeg wrappers, probing, loudness, envelope, finish path.
- `src/remotion` — the `BrandVideo` composition driven by EDL props.
- `src/render` — bundle cache and render dispatch.
- `src/qc` — deterministic checks (storyboard risk, keyframe, final); vision judges slot in later.
- `src/cli` — `brands | run | resume | rerun | approve | inspect | report | runs | music`.
- `src/budget` — brand-level wallet, daily and 48-hour limits with transactional holds (studio + CLI).
- `src/studio` — the studio API (Hono), job supervisor/runner, services; `studio/` — the Next.js UI.
- `brands/<id>/products/<pid>/product.yaml` — product catalog with reference photos merged into a run's profile.
- `runs/<brand>/<run_id>/` — artifacts (source of truth); `data/pipeline.db` — index + ledger.

See the ADRs in `docs/adr/` for the orchestration, state, model and editing decisions, and
`docs/ROADMAP.md` for what this MVP defers.
