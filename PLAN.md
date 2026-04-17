# Elfie Scribe Hackathon Plan

Source: pasted plan from ChatGPT Pro research on 2026-04-17.

## Active Build Checklist

This section is the active plan. The quoted block below is the original source
plan, preserved for reference. When they conflict, this checklist wins.

## Locked Decisions

- [x] Product is an iOS-first Expo / React Native TypeScript app named `Elfie Scribe`.
- [x] This is a Qwen hackathon build, so Qwen is part of the real product path.
- [x] Main pipeline is `Expo app -> Railway backend -> Alibaba Qwen ASR -> Alibaba Qwen extraction -> validated report JSON -> app PDF/share flow`.
- [x] Qwen is hosted on Alibaba Cloud Model Studio, not on Railway.
- [x] Railway backend is built in parallel with the app, not later.
- [x] Preferred transcription path is backend-side Alibaba `qwen3-asr-flash`.
- [x] Long-file fallback transcription path is backend-side Alibaba `qwen3-asr-flash-filetrans`.
- [x] Existing ASC app to reuse is `Qwen Hackathon (Elfie)` / `com.kizzle.hackathon`.
- [x] Railway project exists: `elfie-scribe` with service `elfie-scribe-api`.
- [x] Local sidecar coding model exists on this laptop: `ollama` `qwen2.5-coder:32b`.
- [x] Sample consultation mp3 is present in the repo root.
- [x] Logo asset is present in the repo root.
- [x] UI should stay visually consistent with the live `elfie.co` brand.

## Brand Implementation Rules

Use the live `https://www.elfie.co/` site as the visual source of truth for
fonts, colors, and overall tone.

### Brand Tokens

- [x] Primary dark text / headings: `#14142b`
- [x] Secondary deep neutral: `#21142b`
- [x] Primary accent pink: `#ff0283`
- [x] Neutral lavender text: `#776e91`
- [x] Soft border / surface neutral: `#dcddeb`
- [x] Soft panel neutral: `#eff0f6`
- [x] Light background neutral: `#f7f7fc`
- [x] White background: `#ffffff`
- [x] Soft button glow / lavender accent: `#8f9aff`

### Typography Rules

- [ ] Prefer the real Elfie brand typography direction:
  - headings: `Averta`-style
  - body / UI support: `Be Vietnam Pro` or `Open Sans`
- [ ] If the exact custom web fonts from `elfie.co` are not appropriate to bundle in the app, choose the closest safe fallback while preserving the same hierarchy and feel.
- [ ] Keep headings confident and compact, not generic mobile-app boilerplate.
- [ ] Keep body copy clean, readable, and medically calm.

### Layout And Surface Rules

- [ ] Use light backgrounds, not dark mode by default.
- [ ] Use dark navy text on pale surfaces.
- [ ] Use the hot pink accent sparingly for important CTAs and highlights.
- [ ] Use soft lavender-gray cards, dividers, and progress surfaces.
- [ ] Use rounded cards and large-radius primary buttons.
- [ ] Use subtle elliptical gradient/glow shapes inspired by the homepage hero, not heavy neon effects.
- [ ] Preserve generous whitespace and a premium, calm clinical tone.
- [ ] Avoid default SaaS blue styling unless required by a platform control.

### Asset Rules

- [ ] Use the local logo asset in the repo root if it fits cleanly in the app shell.
- [ ] Keep branding easy to swap if a better or official app-specific wordmark is provided later.
- [ ] Keep PDF branding visually aligned with the app shell and `elfie.co`.

## Milestone 0: External Prereqs

- [x] Create Alibaba Model Studio `DASHSCOPE_API_KEY` in the Singapore region if available for this account.
  - Stored locally in `.env` and validated against the Singapore Responses endpoint on 2026-04-17.
- [x] Confirm Alibaba Model Studio is activated and can bill against the available credits.
  - Confirmed by a successful live `qwen3.5-plus` API call using the stored `DASHSCOPE_API_KEY`.
- [x] Confirm backend `OPENAI_API_KEY` is available for transcription.
  - No longer required after switching to Alibaba-only ASR.
- [x] Place or identify the sample consultation mp3 that will ship in the demo flow.
  - Present: `elfie-medica-l-scribe-sample-consultation.mp3`
- [x] Confirm the Expo account / local build path to use for device and TestFlight work.
  - Local `eas whoami` and `expo whoami` resolve to `kdavis2600` on 2026-04-17.

## Milestone 1: Repo And App Shell

- [ ] Initialize Expo app with TypeScript and Expo Router.
- [ ] Establish folder structure for `app/`, `components/`, `lib/`, `types/`, `constants/`, `assets/`.
- [ ] Add required Expo packages:
  - `expo-audio`
  - `expo-keep-awake`
  - `expo-print`
  - `expo-sharing`
  - `expo-mail-composer`
  - `expo-file-system`
  - `expo-splash-screen`
  - `expo-haptics`
- [ ] Build the home screen with brand, primary CTA, sample CTA, and recent-report slot.
- [ ] Build the route skeleton for `home -> record -> processing -> report`.
- [ ] Establish shared theme tokens in code from the Elfie brand palette before polishing screens ad hoc.

## Milestone 2: Railway Backend Skeleton

- [ ] Scaffold a Node/TypeScript backend in this repo for `elfie-scribe-api`.
- [ ] Add a `/health` endpoint.
- [ ] Add an audio upload endpoint for recorded or sample files.
- [ ] Add a transcription service wrapper for Alibaba Qwen ASR.
- [ ] Add a Qwen extraction service wrapper for Alibaba Model Studio.
- [ ] Add JSON schema validation for `ConsultationReport`.
- [ ] Add one retry path for malformed model output.
- [ ] Define structured error responses for network, transcription, extraction, and validation failures.
- [ ] Add lightweight request logging for audio duration, transcript success/failure, extraction success/failure, and estimated usage so spend stays visible.
- [ ] Deploy the backend early to Railway and keep the deploy loop live during app work.

## Milestone 3: Audio Capture And Input Paths

- [ ] Request microphone permission.
- [ ] Implement foreground recording with `expo-audio`.
- [ ] Keep the device awake while recording.
- [ ] Show timer and simple live meter / waveform.
- [ ] Implement stop, cancel, and save-to-upload flow.
- [ ] Implement bundled sample mp3 flow that works in simulator/demo conditions.
- [ ] Optionally add import flow only if it is fast and low-risk.

## Milestone 4: AI Pipeline

- [ ] Upload recorded or sample audio from app to Railway.
- [ ] Transcribe on Railway with Alibaba Qwen ASR.
- [ ] Use `qwen3-asr-flash` for short audio and `qwen3-asr-flash-filetrans` when duration or payload size requires it.
- [ ] Preserve speaker-role inference as a post-ASR extraction responsibility unless ASR returns reliable enough segmentation.
- [ ] Preserve full transcript text and detected language.
- [ ] Send transcript to Qwen on Alibaba Model Studio for `ConsultationReport` extraction.
- [ ] Validate the result against the canonical schema before returning it.
- [ ] Capture missing facts in `quality.missingInformation`.
- [ ] Capture uncertainty in `quality.ambiguities`.
- [ ] Never allow invented clinical facts through the validated response path.
- [ ] Cache the transcript and extracted report for the sample audio so UI iteration does not keep re-burning cloud calls.

## Milestone 5: Report, PDF, And Sharing

- [ ] Render the structured report in-app.
- [ ] Include summary, visit reason, SOAP, action items, missing/ambiguous info, and transcript.
- [ ] Make Arabic transcript display reasonably RTL-friendly if detected.
- [ ] Generate HTML from the same report object.
- [ ] Generate PDF from HTML.
- [ ] Persist PDF locally.
- [ ] Open native share sheet for the PDF.
- [ ] Support email compose with PDF attachment when available.
- [ ] Hide or degrade gracefully when email compose is unavailable.

## Milestone 6: Local Persistence And Demo Fallback

- [ ] Persist the latest report JSON locally.
- [ ] Persist the latest PDF path locally.
- [ ] If fast, store a short recent-reports list.
- [ ] Add a clearly labeled mock report fallback for UI demos when remote AI is unavailable.
- [ ] Ensure the mock path never claims real processing occurred.

## Milestone 7: Polish And Real-Device Readiness

- [ ] Add haptics to start/stop and key success states.
- [ ] Refine spacing, cards, typography, and loading states.
- [ ] Make the processing screen feel premium and trustworthy.
- [ ] Audit the final UI against the live `elfie.co` site for typography, color, spacing, and overall tone consistency.
- [ ] Verify the sample flow in simulator.
- [ ] Verify recording flow on a real iPhone.
- [ ] Move from Expo Go to device/TestFlight when recording, file handling, or share flows require it.
- [ ] Reuse the existing local ASC/TestFlight workflow from `flashcard-app-react`.

## Deferred: Native Share-In Audio Intake

- [ ] Do not implement this until the end of the run, after the current Expo Go-friendly MVP is stable.
- [ ] Add an iOS native share extension so `Elfie Scribe` appears in the system share sheet for supported audio files.
- [ ] Target common audio types first:
  - `mp3`
  - `m4a`
  - `wav`
  - `aac`
  - `mp4` audio
- [ ] Shared audio handed off from Files, Voice Memos, Mail, or other apps should land in the same `pendingAudio -> processing` pipeline used by recording and manual import.
- [ ] Preserve the existing in-app `Import audio` flow even after the share extension exists.
- [ ] Treat this as a native iOS / TestFlight feature, not an Expo Go feature.
- [ ] After implementation, verify separately in:
  - local iOS development build
  - TestFlight build
- [ ] Do not block the rest of the app on this feature. If native extension work becomes risky near deadline, keep the in-app `Import audio` flow as the fallback path.

## Milestone 8: Paranoid QA Sweep

- [ ] After implementation is feature-complete, generate a list of 50 concrete mistakes that are plausibly present in the repo.
- [ ] Make the 50 suspected mistakes specific, not generic. Focus on likely real failure modes across:
  - recording
  - upload
  - Qwen ASR
  - extraction
  - schema validation
  - PDF generation
  - sharing
  - persistence
  - multilingual rendering
  - iOS device behavior
  - Railway deployment
  - TestFlight readiness
- [ ] Verify each of the 50 suspected mistakes one by one using code inspection, targeted testing, simulator/device checks, logs, or small repro steps.
- [ ] Record the result of each check as one of:
  - confirmed bug and fixed
  - confirmed bug but blocked
  - not a bug after verification
- [ ] Fix every confirmed bug that is feasible before the run is considered complete.
- [ ] If any confirmed bug remains blocked, capture the exact blocker and impact clearly in the final handoff.
- [ ] Do not stop this pass after finding only a few issues; continue until all 50 suspected mistakes have been evaluated.

## Qwen Work Allocation

### Qwen In Product

- [ ] Use Alibaba-hosted Qwen for transcript cleanup, speaker-role inference when needed, report extraction, summary writing, and ambiguity detection.
- [ ] Use Alibaba-hosted Qwen ASR for transcription so the app has no OpenAI billing dependency.

### Qwen In Development

- [ ] Use local `qwen2.5-coder:32b` for bounded draft tasks only:
  - small utility modules
  - first-pass report HTML template
  - mock report fixtures
  - test drafts
  - copy variants
  - schema-helper boilerplate
- [ ] Keep final integration, review, and acceptance in the main build loop.
- [ ] Do not rely on local Qwen for final architecture or security-sensitive decisions.
- [ ] If local Qwen coding output becomes low-quality, off-target, slow to correct, or more expensive to review than to write directly, immediately stop delegating that slice to Qwen and take the work back into the main implementation loop.
- [ ] Treat Qwen coding help as optional acceleration, not a requirement. The product path must continue even if local Qwen drafting is abandoned.

## Ralph-Inspired Recursive Checkpoints

This repo does not currently expose a first-class `ralph` skill in this
session, but the checkpoint pattern from `OnlyMacs` should be reused here.

Checkpoint rules:

- Each checkpoint should end in a working, testable slice.
- Each checkpoint should capture:
  - what was built
  - what remains blocked
  - how to verify it
- If blocked by external credentials or infrastructure, finish local code first
  and record the exact blocker honestly.

Checkpoint sequence:

- [ ] `CP0` Prereqs clear
  - Alibaba key exists
  - sample audio exists
  - logo asset exists
- [ ] `CP1` Shell compiles
  - Expo routes render
  - Railway health endpoint deployed
- [ ] `CP2` Backend live
  - app can upload sample audio
  - Railway can answer with a mocked validated report
- [ ] `CP3` Sample happy path complete
  - sample mp3 goes through real Qwen ASR + Qwen extraction + report screen + PDF
- [ ] `CP3A` Ralph recursion on audio-to-JSON quality
  - inspect transcript quality
  - inspect schema validation failures or brittle fields
  - revise prompts / repair logic / chunking if needed
  - repeat until sample audio produces stable usable JSON without invented facts
- [ ] `CP4` Real-device recording happy path complete
  - record on iPhone
  - stop
  - receive real report
  - share PDF
- [ ] `CP5` Demo polish complete
  - fallback path works
  - visual polish is good enough for hackathon demo
  - README is accurate
- [ ] `CP6` Paranoid QA complete
  - all 50 suspected mistakes were explicitly checked
  - confirmed bugs were fixed or honestly documented as blocked
- [ ] `CP7` TestFlight-ready state
  - local device checks complete
  - build path validated
  - next push blockers are only release credentials or metadata

## Unattended Run Rules

- [ ] Do not stop for minor ambiguity. Make the fastest reasonable decision and keep going.
- [ ] Do not sit idle on a single failure path for too long. If one approach is not moving, pivot to the next-best path and keep the main objective advancing.
- [ ] If blocked by a cloud or credential issue, continue all local work that does not require that dependency.
- [ ] Prefer finishing a working vertical slice over broad partial scaffolding.
- [ ] Keep the repo in a runnable state at checkpoint boundaries whenever feasible.

### Course-Correction Matrix

- [ ] If Alibaba Qwen ASR quality is poor:
  - normalize audio before upload if needed
  - try the alternate ASR mode (`qwen3-asr-flash` vs `qwen3-asr-flash-filetrans`)
  - tighten post-processing and extraction prompts
  - chunk long audio or long transcript sections if that improves stability
- [ ] If Qwen extraction quality is poor:
  - strengthen schema validation
  - add one repair pass for malformed JSON
  - simplify the prompt and reduce optional fields before re-expanding
  - split transcript-to-report into smaller phases if needed
- [ ] If Railway deployment is flaky:
  - keep local backend development moving
  - validate locally first
  - return to deploy once the local path is stable
- [ ] If Expo Go becomes limiting:
  - move to device/dev build sooner
  - do not keep forcing Expo Go after it stops being the fastest path
- [ ] If TestFlight setup becomes the only blocker:
  - finish all repo work up to genuine build-ready state
  - document the exact remaining release blocker

### Time And Effort Rules

- [ ] If a subproblem consumes too much time without producing a working slice, downgrade scope and preserve the happy path.
- [ ] If a fancy feature endangers the end-to-end demo, cut it.
- [ ] If a polish task conflicts with reliability, choose reliability.
- [ ] If a vendor path fails repeatedly, preserve interfaces so the provider can be swapped without tearing up app code.

### Budget Guardrails

- [ ] Track estimated cloud usage during backend testing.
- [ ] Cache the sample-audio transcript and extracted report after a successful run.
- [ ] Reuse cached sample outputs for UI iteration whenever real cloud calls are not necessary.
- [ ] Treat `$20` estimated spend as a warning threshold to become more conservative.
- [ ] Treat `$40` estimated spend as a hard caution threshold requiring minimal-repeat testing behavior.
- [ ] Do not approach the full `$80` credit limit unless the only remaining work is final validation.

### Progress Recording

- [ ] Update Ralph repo state at meaningful checkpoints so progress is resumable.
- [ ] Record what changed, what is verified, and what remains blocked after each major slice.
- [ ] Keep final handoff focused on real remaining blockers, not on work already complete.

## Acceptance Criteria

- [ ] App runs locally.
- [ ] Sample consultation path works end-to-end.
- [ ] Real-device recording path works end-to-end.
- [ ] Backend transcription runs through Alibaba-hosted Qwen ASR.
- [ ] Backend extraction runs through Alibaba-hosted Qwen.
- [ ] `ConsultationReport` is schema-validated before app rendering.
- [ ] Report renders in-app.
- [ ] PDF generates successfully.
- [ ] Native share works.
- [ ] Email compose works when available.
- [ ] README explains setup, env, sample flow, and demo-only limitations.
- [ ] A final 50-item likely-mistake QA sweep has been completed and any confirmed bugs have been fixed or documented.

## Non-Goals

- [ ] No auth
- [ ] No HIPAA hardening
- [ ] No admin dashboard
- [ ] No long-term sync
- [ ] No time spent comparing multiple backend stacks unless the current path fails

> "You are my hackathon cofounder, product designer, and staff mobile engineer.
>
> Build this project end-to-end in this repo.
>
> PROJECT GOAL
> Create an iOS-first Expo / React Native TypeScript app called "Elfie Scribe" that:
> 1. records a doctor-patient consultation on phone
> 2. or processes a supplied sample mp3
> 3. transcribes the conversation
> 4. extracts a structured clinical consultation report
> 5. generates a polished PDF
> 6. lets the user share it via native share sheet or email
> 7. shows the report in-app
>
> The feeling should be magical:
> doctor taps record, leaves the phone on the desk, taps stop, and gets a polished clinical note.
>
> This is a 14-hour hackathon MVP.
> Optimize for:
> - end-to-end happy path
> - polished demo UX
> - low implementation risk
> - clean code
> Not for:
> - HIPAA/compliance hardening
> - auth
> - billing
> - backend admin
> - cloud sync
>
> EVALUATION LENS
> Optimize toward these judging dimensions:
> - clinical correctness
> - multilingual handling (EN / FR / AR / VI)
> - completeness
> - actionability
> - UX clarity
>
> IMPORTANT CONSTRAINTS
> - Use Expo + React Native + TypeScript
> - Use Expo Router
> - Use current official Expo packages
> - Use expo-audio for recording
> - Do not use deprecated expo-av
> - Prefer foreground recording + keep-awake for MVP reliability
> - Direct OpenAI API calls from the app are acceptable for this prototype
> - Do not use the official OpenAI JS SDK inside the React Native client
> - Use plain fetch + REST + FormData for OpenAI requests
> - Use EXPO_PUBLIC_OPENAI_API_KEY for this demo build and clearly mark it as demo-only in README
> - Do not stop and ask me lots of high-level questions; make reasonable decisions and keep going
> - iOS first, Android-compatible where easy
> - If something is uncertain, choose the fastest reliable option and move forward
>
> TECH STACK
> Use:
> - Expo
> - React Native
> - TypeScript
> - Expo Router
> - expo-audio
> - expo-keep-awake
> - expo-print
> - expo-sharing
> - expo-mail-composer
> - expo-file-system
> - expo-splash-screen
> - expo-haptics
>
> Optional only if fast:
> - expo-document-picker for importing mp3
> - a bundled sample mp3 asset for demo mode
>
> DO NOT OVERBUILD
> Avoid spending time on:
> - auth
> - user accounts
> - backend dashboards
> - analytics
> - feature flags
> - pixel-perfect Android parity if it slows the iOS demo
> - complex design systems
> - over-abstracted state management
>
> DESIGN DIRECTION
> Visual style:
> - premium
> - calm
> - clinical
> - minimal
> - polished
> - lots of whitespace
> - rounded cards
> - subtle animation
> - soft gradients only if tasteful
>
> Use a palette inspired by the attached challenge slide:
> - dark navy
> - muted lavender
> - soft gray / off-white
> - clean black / charcoal text
>
> Branding:
> - app name: Elfie Scribe
> - subtitle idea: "From consultation to note in one tap."
> - if a real Elfie logo asset exists, use it
> - otherwise create a clean placeholder wordmark that can be swapped later
>
> CORE USER FLOW
> Flow:
> Home -> Record or Use Sample -> Processing -> Report -> Share / Email -> New recording
>
> SCREENS TO BUILD
>
> 1) Native splash + Home screen
> - branded splash behavior / launch screen
> - home screen with Elfie branding
> - short value prop
> - primary CTA: "Start recording"
> - secondary CTA: "Use sample consultation"
> - if there is a last report, show a simple recent card or "Open last report"
> - keep this screen beautiful and simple
>
> 2) Recording screen
> - request microphone permission
> - show large timer
> - show live waveform / audio meter based on metering values
> - subtle haptics on start / stop
> - keep screen awake while recording
> - big primary stop button
> - secondary cancel button
> - make it feel trustworthy and magical
>
> 3) Processing screen
> - full-screen progress state
> - steps such as:
>   - Preparing audio
>   - Uploading
>   - Transcribing
>   - Structuring note
>   - Generating PDF
> - show friendly microcopy
> - show recoverable error states with retry
>
> 4) Report screen
> Render a polished in-app consultation report from structured JSON.
> Sections:
> - one-line summary
> - visit reason
> - SOAP
> - action items
> - missing / ambiguous info
> - transcript
>
> Buttons:
> - Share PDF
> - Email PDF
> - New recording
>
> MULTILINGUAL HANDLING
> - Support input audio that may be EN / FR / AR / VI
> - Detect and store the source language
> - Default report output language to English for MVP
> - Preserve the original transcript text
> - If Arabic is detected, make transcript rendering reasonably RTL-friendly in-app
> - If a language badge is easy, show it on the report screen
>
> CLINICAL REPORT FORMAT
> Use SOAP as the base because it is familiar and scannable, but improve it for demo usefulness with:
> - summary
> - action items
> - missing info
> - transcript
>
> Canonical data model name:
> ConsultationReport
>
> Use this TypeScript shape as the target shape:
>
> type ConsultationReport = {
>   id: string;
>   createdAt: string;
>   sourceAudio: {
>     fileName?: string | null;
>     durationSec?: number | null;
>     sourceType: "recorded" | "sample" | "imported";
>   };
>   language: {
>     detected: string;
>     reportLanguage: string;
>   };
>   visit: {
>     visitReason: string;
>     clinicianName?: string | null;
>     patientName?: string | null;
>     visitType?: "new" | "follow_up" | "urgent" | "unknown";
>   };
>   summary: {
>     oneLiner: string;
>     bullets: string[];
>   };
>   soap: {
>     subjective: {
>       chiefComplaint: string;
>       hpi: string;
>       symptoms: string[];
>       history: string[];
>       medicationsMentioned: string[];
>       allergiesMentioned: string[];
>       patientConcerns: string[];
>     };
>     objective: {
>       vitals: string[];
>       findings: string[];
>       testsOrResults: string[];
>       observations: string[];
>     };
>     assessment: {
>       summary: string;
>       diagnoses: Array<{
>         name: string;
>         confidence: "confirmed" | "likely" | "possible" | "unclear";
>       }>;
>       differentials: string[];
>       redFlags: string[];
>     };
>     plan: {
>       medications: string[];
>       testsOrdered: string[];
>       referrals: string[];
>       followUp: string[];
>       patientInstructions: string[];
>       clinicianTasks: string[];
>       lifestyleAdvice: string[];
>     };
>   };
>   quality: {
>     missingInformation: string[];
>     ambiguities: string[];
>   };
>   transcript: {
>     fullText: string;
>     segments?: Array<{
>       speaker: "doctor" | "patient" | "unknown";
>       startSec?: number;
>       endSec?: number;
>       text: string;
>     }>;
>   };
> };
>
> AI PIPELINE
>
> STEP 1: TRANSCRIPTION
> - Take audio from recording or sample mp3
> - Upload audio to OpenAI transcription endpoint using plain fetch + FormData
> - Preserve full transcript text
> - Prefer a diarized transcription path if it is quick and stable
> - If diarization is not worth the complexity, use normal transcription and continue
> - If speaker labels are unavailable, allow the extraction step to infer doctor/patient when possible, otherwise mark as unknown
> - Store detected language if available
>
> STEP 2: STRUCTURED EXTRACTION
> - Send transcript to a model that supports strict structured JSON schema output
> - Enforce a schema matching ConsultationReport
> - The model must not hallucinate facts
> - If information is missing, use empty arrays / nullish fields and record it in quality.missingInformation
> - If information is uncertain, capture it in quality.ambiguities and lower diagnosis confidence
> - Keep wording concise, clinician-facing, and useful
>
> STEP 3: REPORT + PDF
> - Render a polished native report screen from the ConsultationReport object
> - Also render an HTML template from the same data
> - Generate a PDF from the HTML
> - Persist the PDF and the JSON locally
> - Let the user share or email the PDF
>
> EXTRACTION RULES
> These rules matter a lot:
> - never invent patient names, clinician names, vitals, allergies, medications, diagnoses, doses, or follow-up dates
> - if a diagnosis is only discussed as a possibility, do not mark it confirmed
> - use concise doctor-friendly phrasing
> - summary.oneLiner should be short and sharp
> - summary.bullets should focus on the highest-value points
> - prefer empty arrays to filler text like "none mentioned"
> - preserve transcript wording as much as practical
> - surface gaps explicitly in missingInformation
> - surface uncertainty explicitly in ambiguities
>
> MODEL / CONFIG APPROACH
> Keep model choices in constants so I can change them easily.
> Suggested strategy:
> - transcription model: prefer a fast current transcription model; use diarized transcription only if it is easy and reliable
> - structured extraction model: use a current model that supports json_schema / structured outputs
> - keep all API configuration centralized in one file
>
> FILE / MODULE STRUCTURE
> Use a clean structure similar to:
>
> - app/
> - components/
> - lib/
> - hooks/
> - types/
> - constants/
> - utils/
> - assets/
>
> Suggested modules:
> - lib/recording.ts
> - lib/openai.ts
> - lib/reportSchema.ts
> - lib/reportExtractor.ts
> - lib/pdf.ts
> - lib/storage.ts
> - components/Waveform.tsx
> - components/ReportSection.tsx
> - components/ProgressStep.tsx
>
> IMPLEMENTATION DETAILS
>
> Recording:
> - request microphone permission
> - configure audio mode properly for foreground recording
> - use metering to drive a simple waveform / level visualization
> - use keep-awake while recording
> - keep the implementation robust, not fancy
>
> Sample audio:
> - support the supplied sample mp3
> - if fastest, use a bundled asset
> - optionally also support import via document picker
> - make this flow work well in simulator / demo conditions
>
> Storage:
> - persist the latest report locally
> - persist the generated PDF locally
> - if easy, keep a small recent reports list
> - do not rely only on temporary paths
>
> PDF:
> - generate from HTML
> - polished typography
> - clean margins
> - branded header
> - one-line summary near top
> - SOAP sections clearly separated
> - action items section
> - missing / ambiguous info section
> - transcript appendix at end if readable; if too long, include excerpts or transcript summary
>
> Sharing:
> - Share PDF button should open native share sheet
> - On iOS this should make AirDrop available via the share sheet when available
> - Email PDF button should use mail composer with attachment
> - If mail composer is unavailable, hide or disable the email action gracefully
> - Sharing should still work even if email is unavailable
>
> ERROR HANDLING
> - readable error screen / state
> - retry button
> - friendly failure copy
> - handle missing API key gracefully
> - handle network failure gracefully
> - handle transcription / extraction failure gracefully
>
> DEMO RELIABILITY
> Very important:
> - create a happy-path demo mode using the provided sample mp3
> - if OPENAI key is not configured, provide a clearly labeled developer/demo fallback that loads a local mock ConsultationReport so the UI can still be demoed
> - this fallback should not pretend it processed real audio; label it clearly
>
> POLISH
> Add tasteful polish:
> - subtle haptics on key actions
> - refined spacing
> - clean cards
> - smooth transitions if easy
> - progress states that feel premium
> But do not waste time on over-animated UI
>
> README
> Write a concise README that includes:
> - what the app does
> - exact setup steps
> - env var names
> - how to run it
> - how to test with sample audio
> - known limitations
> - clearly mark that direct client-side OpenAI usage is demo-only
>
> NICE-TO-HAVES ONLY IF FAST
> - report title editing before share
> - recent reports list
> - transcript collapse/expand
> - language badge
> - completion success animation
>
> DEFINITION OF DONE
> Done means:
> - app runs locally
> - I can record audio on a device
> - I can also process the supplied sample mp3
> - stop recording triggers transcription, extraction, report generation, and PDF generation
> - I can view the report in-app
> - I can share the PDF
> - I can email the PDF when mail composer is available
> - the app looks polished enough for a hackathon demo
> - README exists and is accurate
>
> WORK ORDER
> Please do this in order:
> 1. Inspect the repo contents and any supplied sample audio / assets
> 2. Scaffold whatever is missing
> 3. Implement the end-to-end happy path
> 4. Polish the UI
> 5. Add local persistence
> 6. Write the README
> 7. Leave only small TODO comments for future improvements
>
> Start building now."
