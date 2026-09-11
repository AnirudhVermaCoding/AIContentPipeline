# ADR-0003: Model and provider strategy

Status: accepted (2026-09)

## Principle

Pipeline logic never names a vendor. Every stage talks to a capability interface (`LlmProvider`,
`ImageProvider`, `VideoProvider`, `TtsProvider`) resolved from configuration (global defaults, overridable
per brand). Prices live in one versioned table with an `asOf` date.

## Defaults (regular list prices, promotions excluded)

| Role | Default | Price | Notes |
|---|---|---|---|
| Creative director, research synthesis, script, storyboard | OpenAI `gpt-5.6-terra` | $2 / $12 per M tokens | reasoning effort medium |
| Routing, classification, edit decisions, formatting, future QC judge | OpenAI `gpt-5.6-luna` | $0.20 / $1.20 per M tokens | vision-capable, reasoning effort low |
| Keyframes | fal `fal-ai/flux-2-pro` (+ `/edit` with reference images) | $0.03 per 720×1280 image | draft tier (`fal-ai/flux-2`) available but off |
| Image-to-video | fal `minimax/h3-max/image-to-video`, 768p, 5–10 s clips | $0.08 / s | primary path. Reference-to-video variants stay optional behind the interface until confirmed |
| Text-to-speech | Cartesia `sonic-3.5` via `/tts/bytes` per narration line | ≈ $0.03 per video | SSE with timestamps only when captions are required; ElevenLabs selectable per brand |
| Music | bundled royalty-free tracks | $0 | |
| Render | Remotion + ffmpeg | $0 | |

## Cost model (typical 35 s video)

| Item | Cost |
|---|---|
| LLM calls | $0.25–0.40 |
| Keyframes (7–9 + retries) | $0.30–0.45 |
| AI video (12–15 s) | $0.96–1.20 |
| TTS | $0.03 |
| Total | ≈ $1.55–2.10 |

## Budget rules

- `hard_cap_usd` (default 2.50) is **absolute**. The ai-video-seconds target (default 15 s) is soft: a
  brief's motion promise may exceed it, but never the cap.
- If the creative requirement cannot be satisfied inside the cap, the run stops with `BUDGET_CONFLICT`
  listing cheaper alternatives; continuing requires an explicit budget override on the CLI.
