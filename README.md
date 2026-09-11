# AIContentPipeline

Local-first, multi-brand AI short-form video pipeline. Give it a brand and a topic; it produces a
720×1280 MP4 and a cost report. The creative direction, script, storyboard, continuity, asset routing
and editing decisions are all driven by the brand's configuration, so two brands produce very
different films from the same code.

```
brand + topic → brief → research → script → voice → storyboard → continuity → route
              → keyframes (optional human approval) → animate → audio → edit → render → QC → report
```

Everything runs on one laptop: a CLI, the filesystem, SQLite, Remotion and ffmpeg. No queues, no
servers, no cloud storage. Every stage is resumable and every shot is idempotent: if shot 6 fails you
never re-pay for research, the script, the storyboard or shots 1–5.

## Requirements

- Node 22.12+ and pnpm 10
- API keys for the providers you enable (see `.env.example`). Defaults: OpenAI (GPT-5.6 Terra for
  creative work, Luna for mechanical work), fal.ai (FLUX.2 Pro keyframes, MiniMax H3 Max
  image-to-video), Cartesia (Sonic 3.5 narration). ElevenLabs is selectable per brand.
- Nothing else to install: ffmpeg and Remotion's headless browser are downloaded by the packages.

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in OPENAI_API_KEY, FAL_KEY, CARTESIA_API_KEY
pnpm cli brands                 # the two example brands: bachalogy (toy), mindcode (psychology app)

# Try the whole pipeline offline first (placeholder assets, real render, real cost accounting):
pnpm cli run --brand bachalogy --topic "first steps with the Wobble Bot" --mock

# Plan a real video and see the estimate without spending on media:
pnpm cli run --brand mindcode --topic "why habits stick" --dry-run

# Produce it, pausing so you can look at the keyframes before any video is generated:
pnpm cli run --brand mindcode --topic "why habits stick" --approve-keyframes
pnpm cli approve <run_id> --reject "shot_03:too dark, lift the lamp"   # optional
pnpm cli resume <run_id>
```

Set a real voice id first: `brands/<id>/brand.yaml → voice.voice_id` (a Cartesia or ElevenLabs
voice). The example brands ship with a placeholder.

The finished file is `runs/<brand>/<run_id>/final.mp4`, next to `report.md` (what was spent, on
what, and why each creative decision was made), `decisions.jsonl` and every stage's artifact.

## Commands

| Command | What it does |
|---|---|
| `pnpm cli run --brand <id> --topic <text> [--goal <text>]` | Produce a video |
| `  --dry-run` | Plan, estimate and stop before the first paid media generation |
| `  --approve-keyframes` | Pause after keyframes so you can approve or reject them |
| `  --budget <usd>` | Override the absolute hard cap (default from the brand, $2.50) |
| `  --ai-video-seconds <n>` | Override the soft target of generated video seconds (default 15) |
| `  --until <stage>` | Stop after a stage (`brief`, `research`, `script`, `voice`, `storyboard`, `continuity`, `route`, `keyframes`, `animate`, `audio`, `edit`, `render`, `final_qc`, `report`) |
| `  --mock` | Offline mock providers (also `PROVIDER_MODE=mock`) |
| `pnpm cli resume <run_id> [--budget <usd>]` | Continue after a failure, a budget stop or an approval pause |
| `pnpm cli rerun <run_id> --from <stage>` | Re-run from a stage; shots whose inputs did not change are reused |
| `pnpm cli approve <run_id> [--reject shot_03:"note"]` | Approve pending keyframes, reject some with a note |
| `pnpm cli inspect <run_id>` | Stage table, shots, spend |
| `pnpm cli report <run_id>` | Print the cost report |
| `pnpm cli runs` | Recent runs |

Exit codes: 0 done or stopped, 1 failed, 2 done but final QC failed, 3 waiting for approval,
4 budget conflict.

## Budget

The hard cap is absolute (default $2.50 per video). The router spends real generated motion where the
storyboard needs it, inside a soft target of 15 seconds; the brief's motion promise may exceed the
soft target, but never the cap. If the story cannot be told inside the cap, the run stops with
`BUDGET_CONFLICT` and lists cheaper alternatives in `06_route/output.json`; continue with
`resume --budget <usd>` or change the brief. A typical 30–40 s video lands around $1.4–2.0 at regular
prices (about 12–15 s of generated video, 6–9 keyframes, narration and the LLM work).

Prices live in `src/config/pricing.ts` with an `asOf` date; the CLI warns when the table is stale.

## Adding a brand

Copy `brands/mindcode/brand.yaml` to `brands/<id>/brand.yaml`, set `id` to the folder name, and
describe the brand: audience, product and claims, tone, emotions, content pillars, visual world
(palette, fonts, camera language, realism rules, forbidden styles), pacing, voice, music, text and
CTA policies, entities (characters, products, locations with the features that must never change),
edit defaults and budget. Reference images and logos go under `brands/<id>/assets/`. Run
`pnpm cli brands` to validate.

## Layout

- `brands/` brand profiles · `prompts/` versioned agent prompts · `assets/music/` royalty-free tracks
- `src/pipeline/stages/` the 14 stages · `src/agents/` LLM callers · `src/router/` asset router
- `src/providers/` vendor adapters behind capability interfaces · `src/remotion/` composition
- `src/qc/` deterministic checks · `src/cost/` pricing, ledger, report
- `runs/` artifacts (source of truth) · `data/pipeline.db` index and ledger

## Docs

- `docs/architecture.md` — stages and layout
- `docs/adr/` — orchestration (why not LangGraph), state and idempotency, model strategy, conditional editing
- `docs/ROADMAP.md` — what this MVP deliberately leaves for later
- `docs/THIRD_PARTY_NOTICES.md` — adapted MIT code (OpenReels)

## Development

```bash
pnpm test        # unit + offline end-to-end (renders real files with mock providers)
pnpm typecheck
pnpm lint
```

On machines that cannot download Remotion's browser, point `REMOTION_BROWSER_EXECUTABLE` at a
chrome-headless-shell binary (or a full Chrome with `REMOTION_CHROME_MODE=chrome-for-testing`).
