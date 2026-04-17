# QA Sweep

Final paranoid sweep for the Elfie Scribe hackathon MVP. Each item was checked and classified as `verified`, `fixed`, or `blocked`.

| # | Status | Check | Evidence / action |
|---|---|---|---|
| 1 | verified | Expo Router is the app entrypoint | `package.json` uses `expo-router/entry`. |
| 2 | fixed | Babel preset resolution works | Added `babel-preset-expo` and removed deprecated `expo-router/babel` plugin. |
| 3 | verified | TypeScript compiles cleanly | `npm run typecheck` passes. |
| 4 | verified | iOS JS bundle compiles | `npx expo export --platform ios` passes. |
| 5 | verified | App name and slug match product | `app.json` uses `Elfie Scribe` / `elfie-scribe`. |
| 6 | verified | iOS bundle identifier matches ASC target | `com.kizzle.hackathon` is configured in `app.json`. |
| 7 | verified | Microphone permission string exists | `NSMicrophoneUsageDescription` is present. |
| 8 | fixed | App Store encryption flag was missing | Added `ITSAppUsesNonExemptEncryption: false`. |
| 9 | verified | Android microphone permissions exist | `android.permission.RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` are configured. |
| 10 | verified | Branded splash/logo path resolves | `assets/branding/elfie-logo.png` is used in `app.json`. |
| 11 | verified | Sample audio is bundled into app assets | `assets/audio/sample-consultation.mp3` exports with the iOS bundle. |
| 12 | verified | Home screen has the required primary actions | `Start recording` and `Use sample consultation` are implemented. |
| 13 | verified | Recent report entry point exists | Home screen opens the last persisted report. |
| 14 | fixed | Recording boot effect could re-run after state change | `app/record.tsx` effect now depends only on the recorder instance. |
| 15 | verified | Keep-awake is enabled during recording | `useKeepAwake()` is used on the recording screen. |
| 16 | verified | Audio metering drives a waveform | `Waveform` is fed by normalized recorder metering. |
| 17 | verified | Stop action creates a pending audio job | Recording stop stores a `PendingAudio` object and routes to processing. |
| 18 | fixed | Processing retry path was weak | Retry now increments a local attempt counter and re-runs the effect. |
| 19 | verified | Processing screen handles missing pending audio safely | It redirects home if there is no audio job. |
| 20 | fixed | Report screen redirected during render | Redirect now happens inside `useEffect`. |
| 21 | verified | PDF generation exists and uses report data | `lib/pdf.ts` renders HTML and writes a file with `expo-print`. |
| 22 | verified | PDF share flow exists | `expo-sharing` is wired on the report screen. |
| 23 | verified | Email attachment flow exists | `expo-mail-composer` is wired on the report screen. |
| 24 | verified | Arabic transcript rendering has RTL handling | Report transcript applies RTL style when language starts with `ar`. |
| 25 | verified | Latest report persists locally | AsyncStorage-backed `saveLatestReportAsync` / `loadLatestReportAsync` are implemented. |
| 26 | verified | PDF files persist outside temporary cache | `persistPdfAsync` copies the generated PDF into the app document directory. |
| 27 | verified | Mock fallback exists when backend key is missing | Server returns `usedMock: true` and a mock report if `DASHSCOPE_API_KEY` is absent. |
| 28 | verified | Backend health route works locally | `curl http://127.0.0.1:8787/health` returned healthy JSON. |
| 29 | verified | Backend health route works on Railway | `curl https://elfie-scribe-api-production.up.railway.app/health` returned healthy JSON. |
| 30 | verified | Local ASR request shape works against Alibaba | Direct `qwen3-asr-flash` short-audio call returned transcript text. |
| 31 | verified | Local extraction request shape works against Alibaba | Direct `qwen3.5-plus` JSON-mode call returned valid JSON content. |
| 32 | fixed | Extraction latency was inflated by thinking mode | Added `enable_thinking: false` to extraction and repair calls. |
| 33 | verified | Long audio no longer depends on unsupported direct upload path | Server chunks long audio with `ffmpeg` and transcribes the chunks. |
| 34 | verified | Long sample works through the local backend | Real sample MP3 produced valid report JSON locally. |
| 35 | verified | Long sample works through deployed Railway backend | Real sample MP3 produced valid report JSON on Railway. |
| 36 | verified | Server validates report structure | `consultationReportSchema` parses the final normalized report. |
| 37 | verified | Server has a JSON repair pass | If parse fails, a repair call runs before final validation. |
| 38 | verified | Railway public domain exists | `https://elfie-scribe-api-production.up.railway.app` is active. |
| 39 | verified | Railway runtime has required environment variables | `DASHSCOPE_API_KEY`, `QWEN_BASE_URL`, and `QWEN_MODEL` are set on the service. |
| 40 | fixed | Railway start command previously pointed at Expo | Package `start` now resolves to the backend path. |
| 41 | fixed | Railway needed a deterministic runtime with ffmpeg | Added `Dockerfile` with Node 22 + `ffmpeg`. |
| 42 | verified | Docker build/deploy succeeds on Railway | Railway deployment completed successfully from the Dockerfile. |
| 43 | verified | App build profiles point at the live backend | `eas.json` pins `EXPO_PUBLIC_API_BASE_URL` to Railway for all build profiles. |
| 44 | verified | EAS project is initialized and linked | `app.json` includes `extra.eas.projectId`. |
| 45 | fixed | EAS warned about missing app version source | Added `cli.appVersionSource: remote` to `eas.json`. |
| 46 | verified | TestFlight preflight now passes config-level checks | The remaining EAS failure is credentials, not app configuration. |
| 47 | blocked | Non-interactive TestFlight build still needs iOS credential validation | EAS reports: "Credentials are not set up. Run this command again in interactive mode." |
| 48 | blocked | Apple Developer login is still required for the next build step | Interactive EAS build prompts for Apple ID credentials. |
| 49 | blocked | Expo build credits are exhausted for the current month | EAS warns that further builds will bill at pay-as-you-go rates. |
| 50 | fixed | `.env` became tracked after EAS initialization | Restored `.env` ignore rule and removed `.env` from git tracking. |

## Result

- Product path status: `verified`
- Hosted backend status: `verified`
- Expo/TestFlight repo config status: `verified`
- Remaining blocker to an actual TestFlight upload: `Apple credential validation in interactive EAS flow`, plus user acceptance of pay-as-you-go Expo build billing.
