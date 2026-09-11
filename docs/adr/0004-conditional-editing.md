# ADR-0004: Editing is a decision, not a default

Status: accepted (2026-09)

## Decision

The Edit Decision stage chooses one of four modes from the creative brief, the brand's policies and the
assets actually produced:

- `NONE` — a single generated clip is the deliverable; only conform to 720×1280 and mux audio.
- `FINISH_ONLY` — trim/concat, audio mix, loudness normalisation; no text.
- `LIGHT` — plus one branded hook text and/or an end card or logo.
- `ASSEMBLY` — a multi-shot edit with holds and, only if the brand's text policy allows and the brief
  asked for it, captions.

Transitions default to hard cuts. Dissolves and any effect require explicit brand allowance and a creative
reason recorded in the EDL. Nothing adds subtitles, transitions or effects automatically.

`NONE` and `FINISH_ONLY` render with ffmpeg only; `LIGHT` and `ASSEMBLY` render with Remotion.
