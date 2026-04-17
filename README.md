# Elfie Scribe

Elfie Scribe is an iOS-first Expo + React Native hackathon app that records or imports a consultation, transcribes it with Alibaba Qwen ASR, extracts a structured clinical note with Qwen, renders the report in-app, generates a PDF, and shares it through the native share sheet or Mail.

## Stack

- Expo + React Native + TypeScript + Expo Router
- `expo-audio` for recording
- `expo-print`, `expo-sharing`, `expo-mail-composer`
- Express backend for audio processing
- Alibaba Cloud Model Studio for Qwen ASR and report extraction
- Railway for backend hosting

## Project Structure

- `app/`: Expo Router screens
- `components/`: reusable UI
- `constants/`: theme tokens
- `lib/`: app-side helpers for API, PDF, session state, storage, and mock data
- `server/src/`: Railway-compatible Express API
- `assets/audio/`: bundled demo consultation
- `assets/branding/`: logo assets

## Environment

Copy `.env.example` to `.env` locally and set:

- `EXPO_PUBLIC_API_BASE_URL`: public Railway backend URL
- `DASHSCOPE_API_KEY`: Alibaba Model Studio key
- `QWEN_BASE_URL`: usually `https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`
- `QWEN_MODEL`: extraction model, currently `qwen3.5-plus`

Notes:

- `ALIBABA_CLOUD_ACCESS_KEY_ID` and `ALIBABA_CLOUD_ACCESS_KEY_SECRET` are optional for future provisioning work and are not required for runtime inference.
- Direct client-side LLM access is intentionally not used here; the app talks to the backend.

## Local Development

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
npm run server
```

Start Expo:

```bash
npm run app
```

Typecheck:

```bash
npm run typecheck
```

Bundle iOS locally:

```bash
npx expo export --platform ios
```

## Demo Flow

1. Start the backend.
2. Launch the Expo app on device or Expo Go.
3. Tap `Use sample consultation` for the safest demo path, or `Start recording` on a physical device.
4. Wait for processing:
   - backend chunks long files if needed
   - Qwen ASR produces transcript text
   - Qwen extraction returns the `ConsultationReport`
   - the app generates and stores the PDF locally
5. Review the note in-app and share or email the PDF.

## Railway

The backend is intended to deploy as a single Railway service.

- `nixpacks.toml` installs Node and `ffmpeg`, which the server uses for chunking long audio into Qwen-ASR-friendly segments.
- Default start command is `npm run server`.

Recommended Railway variables:

- `DASHSCOPE_API_KEY`
- `QWEN_BASE_URL`
- `QWEN_MODEL`

## EAS / TestFlight

This repo includes `eas.json` with:

- `development`: dev client
- `preview`: internal distribution
- `testflight`: App Store / TestFlight build
- `production`: release profile with auto-increment

The iOS bundle identifier is configured as `com.kizzle.hackathon`.

Before a real TestFlight build, ensure:

1. `EXPO_PUBLIC_API_BASE_URL` points to the deployed Railway backend.
2. EAS project configuration is initialized for this repo.
3. App Store Connect app `Qwen Hackathon (Elfie)` is still the intended target.

## Known Limitations

- The backend currently uses chunked synchronous ASR for long audio instead of the asynchronous file-transcription API.
- The product path is optimized for hackathon demo reliability, not HIPAA compliance.
- Speaker diarization is inferred only when the transcript makes roles obvious.
- Mail sharing depends on device availability of Mail composer.

## Demo-Only Fallback

If `DASHSCOPE_API_KEY` is missing on the backend, `/api/process-audio` returns a clearly mocked `ConsultationReport` so the app UI remains demoable without pretending real inference occurred.
