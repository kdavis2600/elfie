## Inspiration
TBD -- submitting for the Elfie track, will fill this in as we get closer to the end.

## What it does
Elfie Scribe turns a raw clinic conversation into a clinician-ready consultation note with a privacy-aware AI pipeline. The mobile app records or imports a visit, streams the audio to a backend that normalizes it with `ffmpeg`, transcribes it with Qwen ASR, and then converts the transcript into a structured SOAP-style `ConsultationReport` JSON object using `qwen3.5-plus` rather than generating unstructured prose. The output is rendered in-app as a reviewable report with explicit missing-information and ambiguity fields, persisted locally, exported as a PDF, and shareable through native mobile flows. We also built a template system so a clinic can import a PDF or photographed paper form and map the structured output into its preferred documentation layout, which makes the system feel closer to a deployable workflow than a generic note-taking demo.

## How we built it

## Use of AI (Qwen Model)
How effectively and meaningfully is Qwen used in your solution?

Qwen is the core inference layer in the product, not an optional enhancement. The runtime pipeline is split into two model stages:

1. `audio -> transcript`
2. `transcript -> structured clinical report`

The Expo app records the consultation and uploads the file to a Railway backend. That backend normalizes audio with `ffmpeg` / `ffprobe`, converts it to mono `16 kHz` chunks, and sends those chunks to Alibaba Qwen ASR (`qwen3-asr-flash`). Once the transcript is assembled, the backend sends the transcript plus source metadata into `qwen3.5-plus`, which is prompted to produce a clinician-oriented `ConsultationReport` JSON object rather than free-form prose.

From a systems perspective, Qwen sits behind a typed orchestration layer instead of being called directly from the phone. That gives us deterministic pre-processing, keeps credentials off-device, and lets us validate model output before it reaches the UI. After extraction, the backend parses the response, normalizes missing fields into a canonical shape, and validates the final object with Zod. If the first extraction response is malformed, a secondary Qwen repair pass converts it into valid JSON without inventing new facts.

In practice, Qwen is responsible for:

- multilingual speech recognition on uploaded consultation audio
- transcript preservation in the source language
- structured SOAP-style note extraction
- uncertainty surfacing through explicit missing-information and ambiguity fields
- recovery when structured output needs repair

We also prepared a local `ollama` `qwen2.5-coder:32b` sidecar for bounded development tasks such as rapid prompt iteration and isolated scaffolding, while keeping final integration and validation in the main codebase. The result is that Qwen is used both in the product runtime and the engineering workflow, but most importantly it is the engine that converts raw consultation audio into a structured clinical report pipeline the app can render, persist, export to PDF, and share.

## Challenges we ran into
The hardest engineering problem was not “calling an LLM,” but making the pipeline reliable enough for clinical documentation. Consultation audio is long, noisy, multilingual, and often poorly structured, so we had to build deterministic preprocessing around the models: chunking audio into ASR-friendly segments, preserving transcript fidelity across chunks, normalizing speaker turns, and handling latency without breaking the mobile UX. On the extraction side, we found that free-form model output was unacceptable for downstream rendering and PDF generation, so we wrapped Qwen in a typed orchestration layer with JSON-only prompting, schema validation, canonical field normalization, and a repair pass for malformed outputs. The privacy constraint made this harder: once identifiers are redacted before extraction, the model cannot rely on those anchors for context, so prompts and validation had to be designed to preserve clinical meaning while explicitly forbidding the system from restoring, guessing, or fabricating patient identity.

## Accomplishments that we're proud of

## What we learned
Our biggest learning is that “AI for healthcare” becomes much more credible when the model is only one component inside a minimization-first system. Instead of sending the entire raw encounter directly from a phone to a frontier model and trusting the response, we keep credentials off-device, do deterministic preprocessing server-side, redact direct identifiers before structured extraction by default, validate the output against a schema, and exclude the full transcript from shareable PDFs in privacy mode. That architecture does not magically make a hackathon MVP production-compliant, but it materially reduces unnecessary exposure while preserving most of the clinical utility. More broadly, we learned that the right design pattern for sensitive domains is constrained generation plus explicit uncertainty: use AI to transform unstructured signal into structured drafts, but pair it with typed contracts, provenance-preserving transcript handling, and visible “missing information / ambiguity” fields so the human clinician remains the final authority.

## What's next for Elfie
