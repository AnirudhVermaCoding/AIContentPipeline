# AIContentPipeline

Local-first, multi-brand AI short-form video pipeline. Give it a brand and a topic; it produces a
720×1280 MP4 and a cost report, with the creative direction, storyboard, continuity, routing and editing
decisions all driven by the brand's configuration.

```
brand_id + topic → brief → research → script → voice → storyboard → continuity → route
                 → keyframes (optional approval) → animate → audio → edit → render → QC → report
```

## Requirements

- Node 22.12+ and pnpm 10
- API keys for the providers you enable (see `.env.example`); nothing else to install — ffmpeg and a
  headless browser are downloaded by the packages

## Quick start

```bash
pnpm install
cp .env.example .env        # fill in OPENAI_API_KEY, FAL_KEY, CARTESIA_API_KEY
pnpm cli brands             # list configured brands
pnpm cli run --brand bachalogy --topic "first steps with the Wobble Bot" --dry-run   # plan + estimate only
pnpm cli run --brand bachalogy --topic "first steps with the Wobble Bot"             # full run
pnpm cli inspect <run_id>   # stage table, cost so far
pnpm cli resume <run_id>    # continue after a failure or an approval pause
```

Try it offline first: `PROVIDER_MODE=mock pnpm cli run --brand mindcode --topic "why habits stick"`
produces placeholder assets and a real render.

## Docs

- `docs/architecture.md` — stages, layout
- `docs/adr/` — orchestration, state/idempotency, model strategy, conditional editing
- `docs/THIRD_PARTY_NOTICES.md` — adapted MIT code (OpenReels)
