# Elfie Scribe Infrastructure Notes

Updated: 2026-04-17

## App Store Connect

Existing ASC app already present:

- Name: `Qwen Hackathon (Elfie)`
- Apple app id: `6762429153`
- Bundle identifier: `com.kizzle.hackathon`
- SKU: `qwen-hackathon-001`
- Primary locale: `en-US`

Current ASC state observed via local API helper:

- No uploaded builds yet
- No beta groups yet

Reusable local ASC helper from neighboring repo:

- Repo: `/Users/kizzle/aicoding/flashcard-app-react`
- Helper script: [`scripts/asc-api.js`](/Users/kizzle/aicoding/flashcard-app-react/scripts/asc-api.js)
- Docs: [`docs/ASC-API.md`](/Users/kizzle/aicoding/flashcard-app-react/docs/ASC-API.md)

Credential names used by that helper:

- `ASC_KEY_ID`
- `ASC_ISSUER_ID`
- `ASC_KEY_PATH` or `ASC_KEY_CONTENT`
- Expo aliases also supported:
  - `EXPO_ASC_KEY_ID`
  - `EXPO_ASC_ISSUER_ID`
  - `EXPO_ASC_API_KEY_PATH` or `EXPO_ASC_API_KEY_CONTENT`

Notes:

- The credential values already exist in the neighboring repo's local `.env` / `.env.local`.
- Do not copy secret values into this repo until we decide the final env strategy.

## Railway

New Railway project created for this repo:

- Project name: `elfie-scribe`
- Project id: `3bb470ca-722d-4481-bdf1-eadec3c3e97e`
- Dashboard: [elfie-scribe](https://railway.com/project/3bb470ca-722d-4481-bdf1-eadec3c3e97e)

New Railway service created:

- Service name: `elfie-scribe-api`
- Service id: `e3603770-5493-4915-80ca-ddfbc4027b3f`
- Current status: `NO DEPLOYMENT`

Local repo link state:

- Current directory is linked to project `elfie-scribe`
- Current directory is linked to service `elfie-scribe-api`

Reusable Railway reference from neighboring repo:

- Example config: [`learn-vietnamese-server/railway.toml`](/Users/kizzle/aicoding/flashcard-app-react/learn-vietnamese-server/railway.toml)
- Example env template: [`learn-vietnamese-server/.env.example`](/Users/kizzle/aicoding/flashcard-app-react/learn-vietnamese-server/.env.example)

Observed environment variable names in the example server:

- `PORT`
- `DISCORD_WEBHOOK_URL`
- `ASC_KEY_ID`
- `ASC_ISSUER_ID`
- `ASC_KEY_PATH`
- optional `ASC_KEY_CONTENT`

## Reuse Guidance

Likely safe reuse:

- ASC API helper approach from `flashcard-app-react`
- Railway CLI auth from the current machine
- Existing ASC app record `com.kizzle.hackathon`
- Alibaba Cloud Model Studio as the intended Qwen hosting path
- Local `ollama` model `qwen2.5-coder:32b` for bounded sidecar coding tasks

Still to decide before wiring code:

- Final Alibaba Model Studio region and API key creation
- Final environment variable contract for this repo
