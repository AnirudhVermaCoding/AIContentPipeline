# ADR-0006: Creative Freedom and Goal Focus are prompt strategy, not sampling

Status: accepted (2026-09)

## Decision

- **Two per-run dials, one shared interpreter.** `creative_freedom` and `goal_focus` (0–1) live on
  `RunOptions`. They are resolved once in `createRun` (request → brand `creative_defaults` →
  0.65 / 0.85) and stored on the manifest with their source, so a later edit of `brand.yaml` never
  changes what a run generates with. `src/creative/controls.ts` is the only place their meaning is
  written down: the semantic ranges (Safe … Wild, Explore … Goal-first), the presets, the
  stage-specific guidance and the list of rules that never loosen.
- **Every agent gets the same block.** `buildCreativeControlContext({ creativeFreedom, goalFocus,
  stage, hardConstraints })` returns interpreted guidance ("Creative Freedom: 0.72 — Bold. Explore
  differentiated, cinematic and surprising ideas …") followed by a `Locked` list built from the
  pinned brand and product (identity, must-preserve, claims, forbidden styles and words, CTA and
  text policy, continuity, output format, budget cap). The Creative Director, screenwriter,
  storyboard artist, image prompter and motion prompter append it to their user message. The image
  block separates `CREATIVE VARIABLES` from `LOCKED IDENTITY VARIABLES` explicitly. Research
  receives nothing: factual standards do not move with creativity.
- **Not temperature.** `LlmGenerateOptions` has no sampling parameters and the dials do not add
  any. Models that expose temperature behave exactly like models that do not; the dials change what
  is asked for, not how the answer is sampled.
- **Candidates in one call.** At creative freedom 0.5–0.8 the director drafts two concept
  candidates, above 0.8 up to three, in a single structured call (`candidates`, `selected_index`
  and the full brief for the winner). The ranking weights are stated in the prompt and driven by
  the dials (goal alignment by goal focus, originality by creative freedom); a deterministic
  re-ranking with the same weights is stored beside the brief in `00_brief/director.json`, with
  earlier records kept under `history/`. The estimate and the ledger reservation grow with the
  candidate count, so the preflight shows the cost before anything is spent.
- **Hashing is conditional.** The dials enter the stage hashes of brief, script, storyboard and
  edit, and the per-shot hash, only when the manifest carries them. Runs created before the dials
  existed keep byte-identical hashes and resume without re-running or re-paying anything.
  Prompt files were not version-bumped for the same reason.
- **Selective invalidation is the existing one.** Changing the dials before a run means creating
  the run with them (Duplicate as new video prefills the form so they can be edited). They cannot
  be changed on an existing run; that would silently cascade through paid assets.
- **Regeneration has its own dial.** `variation_strength` (`small | fresh | different`) is per
  action, not per run: it is stored on the shot record's `overrides`, fed to the prompters as
  guidance, persisted on the attempt (`params.variation_strength`) and consumed with the
  instruction. Concept and storyboard regenerations carry it through `manifest.pending_regeneration`,
  which the stage consumes and clears; it is never hashed because `resetFrom` already forces the
  re-run. A single storyboard shot can be rewritten with its own prompt
  (`prompts/storyboard-shot-rewrite.md`); its locked fields (id, narration lines, role, hero flag,
  entities, conformed duration) are forced back so the continuity merge keeps every other shot's
  hash and only that shot is produced again.
- **Weak where the spec says weak.** The router is unchanged: creative freedom reaches routing only
  through the storyboard's `motion_need`, so a wild setting never buys more generated video by
  itself and the hard cap blocks exactly as before. The deterministic edit stage scales still-motion
  amount inside the brand's bound and trims decorative overlays at high goal focus; it adds no
  transitions, because neither renderer draws them yet.

## Consequences

- Operators reason about "how adventurous" and "how goal-driven"; temperature, top-p and prompt
  engineering stay inside the pipeline.
- Every generated asset inherits the run's dials for provenance; regenerated versions also record
  the variation strength that produced them.
- A default run costs slightly more planning LLM output (two candidates in one call) and shows it.
- Semantic QC still does not exist; the dials never lower any acceptance threshold.
