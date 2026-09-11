# Roadmap

MVP-A (this repository) proves the vertical slice: brand profile → creative director → research →
script → voice → storyboard → continuity → keyframes (optional human approval) → image-to-video →
audio → conditional edit → render → final QC → cost report. It is meant to produce several real videos
before the secondary automation below is built.

## Deliberately deferred

- **Vision QC gates.** Keyframe and clip checks are deterministic (size, aspect, flatness, duration,
  dimensions). A vision judge (prompt adherence, brand fit, artifacts, identity drift) slots in behind
  the same `checks` shape in `src/qc/`; the judge prompt rules are in the plan (cite the location,
  propose a fix, two rounds then pass-with-warnings).
- **Stock footage.** `REUSE`/`STOCK` exist in the routing vocabulary but the router only emits
  `STILL`, `STILL_MOTION` and `GEN_VIDEO`. Pexels/Pixabay adapters and the search → verify →
  reformulate resolver come next.
- **Asset library and reuse.** The `assets` table exists; ingesting approved keyframes/clips after a
  QC pass and searching them by entity/description before generating is not wired.
- **Entity sheets.** Continuity uses the brand's reference images. Generating a front + ¾ sheet once
  for entities that lack references (and reusing it across runs) is the next continuity step.
- **Provider fallback and scoring.** The registry resolves one adapter per capability from config.
  Fallback chains and explainable provider scoring come after real-run data exists.
- **Reference-to-video.** MiniMax H3 Max reference-to-video (subject references) stays behind the
  `VideoProvider` interface until the endpoint is confirmed for this workflow.
- **LLM editor.** The edit decision is deterministic from the brief's intent and the brand's
  policies; the `editor` prompt exists for a model-assisted pass over hold lengths and cut points.
- **Captions beyond the basics.** Word timestamps are requested only when the brand can use captions;
  the caption renderer is a simple chunked style.
- **Music generation.** Only the local library (and a mock bed) are supported.
