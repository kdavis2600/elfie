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
- `PRIVACY_MODE`: privacy mode is on by default; set to `false` on the backend to disable redaction and include the full transcript in PDFs
- `EXPO_PUBLIC_PRIVACY_MODE`: privacy-mode UI copy is on by default; set to `false` in Expo to hide the privacy-mode messaging

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
   - privacy mode is enabled by default, so the backend redacts direct identifiers before Qwen extraction unless explicitly disabled
   - Qwen extraction returns the `ConsultationReport`
   - the app generates and stores the PDF locally
5. Review the note in-app and share or email the PDF.

## Core Consultation Modules

- `server/src/index.ts`: owns `/api/process-audio`, audio chunking, ASR, transcript windowing, evidence extraction, final synthesis, privacy redaction, JSON repair, fallback logic, and final response shaping.
- `server/src/reportSchema.ts`: enforces the final `ConsultationReport` shape with Zod before the backend returns anything to the client.
- `types/report.ts`: shared report contract for app and server.
- `lib/transcript.ts`: normalizes transcript segments, parses speaker-tagged text when needed, and cleans privacy redaction artifacts before display.
- `lib/api.ts`: app-side API client with explicit request timeouts for consultation processing and health checks.
- `app/processing.tsx`: the judge-facing consultation processing screen, including progress UI, error copy, and retry behavior.
- `lib/pdf.ts`: turns the structured consultation report into a shareable PDF, with or without a custom clinic template.

## Consultation FAQ

### 1. How does the consultation pipeline work end to end?

The app uploads audio to `/api/process-audio`. The backend converts the file into ASR-friendly MP3 chunks when needed, calls Qwen ASR to get transcript text, optionally redacts direct identifiers, extracts structured evidence from overlapping transcript windows, synthesizes a full `ConsultationReport`, validates it against the shared schema, and returns the report plus transcript. The app then renders a PDF locally and stores the result in session history.

### 2. How does it reduce hallucinations?

It does not magically eliminate hallucinations, but it does stack several guardrails to reduce them:

- prompts repeatedly instruct the model to never invent diagnoses, names, meds, vitals, allergies, or follow-up dates
- extraction happens first on smaller transcript windows, which keeps the model grounded in a tighter slice of source text
- final synthesis is told to prioritize merged evidence over the raw transcript excerpt
- missing details are supposed to stay `null`, `unknown`, or empty arrays instead of being guessed
- the final payload must pass `consultationReportSchema`, so malformed or structurally inconsistent output is rejected

### 3. Why split the transcript into windows first instead of summarizing once?

Windowed extraction is a reliability play. Long transcripts are broken into overlapping character windows, each window is extracted separately, and the results are merged before the final note is synthesized. That lowers the chance that one long prompt drops an important symptom, medication mention, or plan detail from the middle of the consultation.

### 4. What happens when the model returns bad JSON?

The backend first tries to parse the model output directly. If that fails, it runs a JSON repair step that preserves the same information while fixing formatting. If repair still fails, the request does not silently ship broken data. The code either falls back to a more conservative merged-evidence report or throws an error instead of pretending the malformed payload is trustworthy.

### 5. How is uncertainty surfaced instead of hidden?

The report has explicit uncertainty fields:

- `soap.assessment.diagnoses[].confidence` is limited to `confirmed`, `likely`, `possible`, or `unclear`
- `quality.missingInformation` lists gaps
- `quality.ambiguities` records uncertainty that the model could not resolve cleanly

This is intentional. The pipeline is designed to preserve uncertainty when the transcript is incomplete instead of smoothing everything into false confidence.

### 6. What happens if Qwen fails during extraction or synthesis?

The backend degrades in layers:

- evidence-window extraction can fall back to Claude if configured
- final synthesis can also fall back to Claude if configured
- if synthesis still fails, the backend builds a heuristic report candidate from the already-merged evidence instead of dropping the entire note

That means the system prefers a conservative partial report over a hard failure when enough grounded evidence already exists.

### 7. How are long audio files handled?

The backend probes duration with `ffprobe` and uses `ffmpeg` to re-encode audio into mono 16 kHz MP3. If the upload is larger than about 6.5 MB or longer than about 290 seconds, it is segmented before ASR. This keeps the transcription stage inside the limits the app was tuned for and is one of the main reasons the demo path remains stable on longer consultations.

### 8. What does privacy mode actually do?

Privacy mode is on by default. Before structured extraction, the backend runs redaction rules over the transcript to strip or replace direct identifiers such as names, emails, phone numbers, dates of birth, record numbers, and many address-like strings. After synthesis, the stored report is re-redacted, clinician and patient names are nulled, source filenames are removed, and the PDF omits the full transcript. The UI also calls this out so judges know the omission is intentional.

### 9. Can a doctor edit the generated note without regenerating everything?

Yes. `/api/edit-report` edits the structured note, not the raw transcript. The edit prompt preserves `id`, `createdAt`, `sourceAudio`, `language`, `privacy`, and `transcript`, changes only the fields needed to satisfy the instruction, and runs the edited result back through the same schema validation path. In privacy mode it also prevents reintroducing direct identifiers.

### 10. What are some other non-obvious reliability features?

- Transcript segments are normalized and deduplicated before display, even if the model returns inconsistent speaker chunks.
- Duplicate diagnoses from different transcript windows are merged, keeping the strongest confidence label.
- The client uses explicit long timeouts for consultation and lab processing instead of default fetch behavior.
- The processing screens expose retry paths rather than leaving the user stuck after a backend error.
- If `DASHSCOPE_API_KEY` is missing, the app returns a clearly mocked consultation report so demo UI paths stay testable without pretending live inference occurred.

### 11. What does the app deliberately not claim to do?

It is not a medical device, not a diagnosis engine, and not a guarantee against hallucination. It is a structured clinical documentation MVP designed for demo reliability. The safest way to describe it is: it helps turn consultations into a structured draft note while preserving gaps and uncertainty where the transcript does not support a stronger claim.

## Core Lab Modules

- `server/src/labAnalyzer.ts`: owns `/api/analyze-lab-report`, PDF/image text extraction, OCR versus vision routing, batching, structured row extraction, reasoning enrichment, deduping, and final report shaping.
- `server/src/labReportSchema.ts`: enforces the final `LabAnalysisReport` shape with Zod before the backend returns the result.
- `types/labReport.ts`: shared lab-analysis contract for app and server.
- `app/labs/processing.tsx`: the judge-facing lab processing screen, including progress UI, retry behavior, and navigation back to import.
- `lib/api.ts`: app-side lab upload client with an explicit long timeout for document analysis.
- `lib/pdf.ts`: renders the normalized lab result set into a shareable PDF.

## Lab Analyzer FAQ

### 1. How does the lab analyzer work end to end?

The app uploads a PDF or image to `/api/analyze-lab-report`. The backend extracts visible text from each page, compacts that text into model-friendly batches, asks the model for structured lab rows, normalizes and deduplicates those rows, derives default flags and severity, optionally enriches the report with a conservative reasoning pass, sanitizes identity fields, validates the final shape with Zod, and returns a structured `LabAnalysisReport`. The app then renders and stores a PDF locally.

### 2. How does it decide between plain PDF text, OCR, and vision?

It uses the cheapest grounded path first:

- PDFs first try native text extraction through `pdfjs`
- if a PDF page has too little usable text, that page is rendered to an image and retried with Qwen vision
- image uploads first try local OCR
- if local OCR is weak or unavailable, the image falls back to Qwen vision

This helps preserve text fidelity when the file already contains selectable text, while still handling scanned lab reports.

### 3. How does it reduce hallucinated lab rows?

The prompts explicitly say to never invent tests, values, ranges, units, patient identity, or page numbers. The extraction stage also requires raw source-faithful fields such as `testNameRaw`, `valueRaw`, `referenceRangeRaw`, `pageNumber`, `sourceSnippet`, and `sourceRowText`. If a field is unclear, the prompt tells the model to return `null` instead of guessing. After that, the backend normalizes the payload and validates the final report against `labAnalysisReportSchema`.

### 4. Why batch pages instead of sending the whole document at once?

Large lab documents are split into bounded extraction batches by page count and character count. Before batching, the backend compacts each page down to the most lab-like lines and context lines. That lowers timeout risk, keeps prompts focused on clinically relevant rows, and makes it less likely that one noisy page buries the useful data from another.

### 5. What happens if model extraction fails or returns malformed JSON?

There are multiple fallback layers:

- a batch that fails on Qwen can retry on Claude if configured
- malformed JSON is run through a JSON repair step
- if model-based row extraction still comes back empty, the backend falls back to heuristic row parsing from the extracted text

So the system prefers a conservative partial extraction over pretending the document had no useful rows at all.

### 6. What do `mock`, `qwen_only`, and `hybrid` mean?

The `processing.mode` field tells you how the report was produced:

- `mock`: no live DashScope key was configured, so a demo report was returned
- `qwen_only`: extraction and reasoning stayed within the Qwen path
- `hybrid`: Claude contributed to extraction or reasoning after a Qwen failure or as an available enrichment path

That makes the processing path explicit instead of hiding it behind one generic “success” label.

### 7. How are numeric flags and severity derived?

The backend parses numeric values and reference ranges when it can, then computes flags like `low`, `high`, `normal`, or `out_of_range`. Severity is derived conservatively from how far a value sits from the parsed reference boundary. This means the model is not the sole source of truth for whether a numeric result is abnormal; deterministic normalization logic also contributes.

### 8. How does it avoid duplicate or noisy results?

After normalization, rows are deduplicated using a key built from the test name, panel, raw value, reference range, unit, page number, and source row text. If duplicates are removed, that is recorded in `quality.processingNotes`. The report also preserves `confidence`, `sourceSnippet`, and `sourceRowText` so a reviewer can trace where a row came from instead of trusting a decontextualized summary.

### 9. Does it only look at numeric rows, or can it notice qualitative document warnings too?

It also scans the extracted source text for document-level cues such as “outside the reference range,” high-risk qualitative outcome wording, malignancy-style language, and specimen-quality issues like hemolysis. Those cues can become abnormal findings even when the numeric row data alone is incomplete. The goal is not to diagnose, but to avoid dropping an important warning that was clearly printed in the source document.

### 10. How does the lab analyzer handle privacy and storage?

The final stored report sanitizes patient-identifying text, nulls the patient name, strips or cleans name-bearing snippets, and marks the source document as `persisted: false`. The mobile app does not keep the original uploaded lab file as part of its normal stored state. The report also records that uploaded documents may be retained temporarily in a server-side debug archive, so the storage behavior is at least surfaced rather than hidden.

### 11. What does the lab analyzer deliberately not claim to do?

It is not a diagnosis engine and not a substitute for clinician review. The safer claim is: it extracts structured rows, ranks abnormalities conservatively, and produces a patient-readable summary while keeping uncertainty, missing information, warnings, and provenance visible in the report structure.

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
