# Labs Analyzer Feasibility Plan

Date: 2026-04-17

Scope of this document: planning only. No app code changes are included in this pass.

## Goal

Add a second top-level workflow to the app so the home screen offers:

- `New Consultation Report`
- `Analyze Lab Report`

The existing consultation flow should stay intact. The labs feature should be added as a parallel path, not as a forced rewrite of the current audio-first product.

## Feasibility Verdict

- This is feasible in the current repo.
- The home screen and routing change is easy.
- The backend pattern is reusable because it already supports file upload, Qwen calls, JSON validation, and PDF-related processing.
- A hybrid Qwen + Claude pipeline is more defensible than a Qwen-only reasoning pipeline for this use case.
- The real complexity is not UI. It is robust lab PDF ingestion and safe normalization of lab values.
- The highest-risk requirement from the challenge slide is accurate handling of long-format PDFs in EN/FR/AR/VN, especially if some inputs are scanned rather than text-native.

## What Already Exists That Helps

- `app/index.tsx` already acts as a simple mode-launching home screen.
- `app/import-audio.tsx` and `app/template.tsx` already use `expo-document-picker`, so the app has a working file-import pattern.
- `server/src/index.ts` already has multipart upload handling with `multer`.
- `server/src/index.ts` already has a reusable Qwen request wrapper, JSON repair flow, and Zod schema validation pattern.
- `server/src/index.ts` already renders PDF pages to images for template preview, so PDF page rasterization is not net new.
- `lib/api.ts`, `lib/session.tsx`, and `lib/storage.ts` already support async processing plus local persistence.
- `lib/pdf.ts` already exports app-generated reports as PDFs.

## Current Constraints In This Repo

- The app is strongly shaped around audio consultation intake, not document intake.
- The main report type is `ConsultationReport` in `types/report.ts`, and it is SOAP-specific.
- The main report UI in `components/ReportDetailScreen.tsx` is consultation-specific.
- The processing flow in `app/processing.tsx` is audio-specific.
- The current backend endpoint is `/api/process-audio`, which expects audio and produces a consultation note.
- The current template preview path only supports single-page PDFs. That is fine for templates, but it is not acceptable for the labs challenge.

## Explicit Decisions To Reduce Ambiguity

- Uploaded lab PDFs or images should not be persisted after processing for now.
- Store uploaded lab files only as temporary processing inputs and delete them after the analysis run completes or fails.
- Persist `sourceText` for auditability, but sanitize patient names before storage.
- Set the lab document upload size limit to `15 MB`, independent of page count.
- Do not set a strict page-count limit for the first demo pass; small demo files are expected, but file-size enforcement must be explicit.
- If Claude is unavailable, unconfigured, or removed from scope, the feature should still ship in a Qwen-only degraded mode rather than hard-failing.

These decisions should be treated as part of the feature contract, not left to implementation-time judgment.

## Recommendation

Do not try to squeeze lab analysis into the existing `ConsultationReport` shape.

That would create the wrong abstraction because the current schema assumes:

- transcript text
- speaker turns
- SOAP sections
- visit reason
- audio metadata

The correct move is to add a separate lab-analysis flow with its own schema, screens, and backend endpoint, while reusing the surrounding app infrastructure.

## Recommended Product Shape

1. Home screen becomes a mode selector.
2. `New Consultation Report` launches the current recording/import-audio path.
3. `Analyze Lab Report` launches a new PDF or image intake path.
4. The lab flow produces a `LabAnalysisReport`, not a consultation note.
5. Lab output gets its own detail screen and exported PDF layout.

## Proposed UX Flow

1. Home screen
   User chooses `New Consultation Report` or `Analyze Lab Report`.
2. Lab intake
   User uploads a PDF or photo, or opens a bundled sample lab report for demo safety.
3. Processing
   Backend extracts text and page context, standardizes rows, flags abnormal results, and generates explanations.
4. Results
   User sees:
   - a concise summary
   - abnormal or urgent findings first
   - a normalized table of all extracted lab values
   - missing or uncertain items
   - plain-language next steps
5. Export
   User shares a generated PDF report from the same analysis object.

## Proposed Technical Approach

### Frontend

- Change `app/index.tsx` so the primary choices are mode-based.
- Add a new labs route group, for example:
  - `app/labs/import.tsx`
  - `app/labs/processing.tsx`
  - `app/labs/report.tsx`
- Reuse the same `expo-document-picker` pattern already used for audio/template import.
- Support PDF first, with optional image/photo import if time allows.
- Add a bundled sample lab PDF for demo and QA.
- Keep consultation history and lab-analysis history separate at first to avoid unnecessary refactors.

### Backend

- Add `POST /api/analyze-lab-report`.
- Accept PDF or image uploads.
- Enforce a `15 MB` upload limit for lab documents.
- For text-native PDFs:
  - extract text page by page
- For scanned PDFs or images:
  - rasterize page images
  - run OCR or a vision-capable extraction fallback
- Convert extracted content into normalized candidate lab rows before final explanation generation.
- Run schema validation on the final JSON result.
- Return both the normalized data and the user-facing explanation payload.

### Model Allocation

Use a hybrid pipeline with clear ownership.

Qwen should handle the lower-level document work it is likely to do well:

- page-level OCR or extraction support
- raw table and row capture
- candidate test-name parsing
- unit and reference-range extraction
- multilingual normalization into a stable intermediate JSON shape
- JSON repair when extraction output is malformed

Deterministic code should handle the parts that should not depend on model taste:

- numeric parsing
- unit normalization where mappings are known
- reference-range parsing
- `low / normal / high` flagging when value and range are available
- confidence gating and fallback handling when rows are incomplete

Claude should be the primary reasoning model for the higher-stakes interpretation layer:

- severity ranking
- actionability
- cross-row synthesis
- patient-friendly explanation
- concise top summary
- identification of which abnormalities matter most right now

Recommended backend flow:

1. Ingest PDF or image.
2. Extract raw text and page context.
3. Use Qwen to produce normalized candidate lab rows.
4. Use deterministic code to compute flags wherever possible.
5. Send the normalized rows, computed flags, and targeted source snippets to Claude.
6. Claude returns severity, actionability, explanations, and overall summary.
7. Validate the final `LabAnalysisReport` JSON before returning it to the app.

This keeps Qwen materially in the product path while reserving the most judgment-heavy decisions for Claude.

### Degraded Mode

- Primary mode is `hybrid`:
  - Qwen for extraction and normalization
  - deterministic code for parsing and flagging
  - Claude for severity ranking, actionability, and explanation
- Fallback mode is `Qwen-only`:
  - use Qwen for extraction plus a constrained explanation pass
  - keep deterministic abnormal-flag computation in code
  - mark the output as degraded or lower-confidence in `quality`
  - do not fail the entire feature only because Claude is unavailable
- This means missing `ANTHROPIC_API_KEY` should reduce interpretation quality, not block the workflow.

### Data Modeling

Add a new `LabAnalysisReport` type instead of overloading `ConsultationReport`.

Suggested shape:

- `id`
- `createdAt`
- `sourceDocument`
- `language`
- `patient`
- `summary`
- `abnormalFindings`
- `results`
- `nextSteps`
- `quality`
- `sourceText`

Recommended additions so the report is debuggable without retaining the original PDF:

- `processing`
- `provenance`

Suggested `results` row fields:

- `testNameRaw`
- `testNameCanonical`
- `panelName`
- `valueRaw`
- `valueNumeric`
- `unit`
- `referenceRangeRaw`
- `referenceLow`
- `referenceHigh`
- `flag`
- `severity`
- `clinicalMeaning`
- `patientExplanation`
- `recommendedFollowUp`
- `confidence`
- `pageNumber`
- `sourceSnippet`
- `sourceRowText`
- `extractionMethod`

## How To Keep The Output Trustworthy

The challenge scoring dimensions strongly suggest we should not rely on pure free-form LLM output.

Recommended split:

- Qwen extracts and normalizes rows, but it should not be the final authority on severity or actionability.
- Deterministic code decides whether a value is low, normal, high, or out-of-range whenever numeric value plus reference range are both available.
- Claude is the primary model for severity, actionability, and patient-friendly explanation.
- Claude-generated next steps must stay conservative and non-diagnostic.
- Missing ranges, malformed values, or unclear units should be surfaced in `quality` instead of guessed.
- Claude should receive structured rows plus source snippets, not just a free-form prompt over the whole document.

### Recommended Semantics For Flagging And Prioritization

- `flag` should be the deterministic source of truth for numeric abnormality status:
  - `low`
  - `normal`
  - `high`
  - `out_of_range`
  - `unknown`
- `severity` should represent clinical prioritization, not raw numeric position:
  - `none`
  - `mild`
  - `moderate`
  - `high`
  - `critical`
  - `unknown`
- `actionability` should stay report-level and bucket next steps into:
  - `urgent_attention`
  - `discuss_with_clinician_soon`
  - `routine_follow_up_or_monitoring`
- UI sorting should use this order:
  1. urgent or critical items
  2. high-severity abnormal findings
  3. other abnormal findings
  4. normal or unknown items
- If `flag` and `severity` appear to disagree, keep the deterministic `flag` as the factual numeric state and surface any uncertainty in `quality` rather than silently reconciling it.

### Privacy And Retention

- Do not persist the uploaded lab PDF or source image in app storage for now.
- Use temporary local/server files only for in-flight processing, then delete them.
- `sourceText` may be persisted for auditability, but stored text should sanitize patient names before persistence.
- Generated app-side artifacts should come from the normalized `LabAnalysisReport`, not from reusing the original uploaded file.
- Exported PDFs should include the analysis output, not the original uploaded lab document by default.

### Best Recommendation For Provenance

Row-level provenance is worth adding in the first version.

Recommended minimum row provenance fields:

- `pageNumber`
- `sourceRowText`
- `sourceSnippet`
- `extractionMethod`
- `confidence`

Recommended report-level provenance fields:

- extraction mode used per page: text-native, OCR, or vision fallback
- page count processed
- pages with extraction failures
- whether Claude reasoning was used or the result came from `Qwen-only` degraded mode

This is the best tradeoff for the MVP:

- enough evidence to debug bad extraction or judge-facing correctness issues
- enough context to explain why a row was classified a certain way
- no need to retain the original uploaded PDF for later inspection

## Mapping To Challenge Evaluation

### Clinical Correctness

- Preserve raw values exactly as extracted.
- Standardize only when the parser is confident.
- Never invent missing tests, units, or ranges.
- Prefer deterministic flagging over model judgment whenever numeric comparison is possible.

### Severity Accuracy

- Compute severity in code where possible from numeric distance outside reference range.
- Let Claude interpret severity and prioritization after code-based flagging is computed.
- Escalate ambiguous rows to Claude with the original row text or page snippet for context.

### Completeness

- Keep every extracted lab row, even if some rows remain partially unparsed.
- Explicitly list rows or pages that could not be interpreted.

### Actionability

- Group next steps into:
  - urgent attention
  - discuss with clinician soon
  - routine follow-up or monitoring
- Let Claude write the explanation for these buckets, but keep the bucket labels and output schema fixed in code.

### UX Clarity

- Show the top summary first.
- Put abnormal findings ahead of the full table.
- Preserve raw source context somewhere in the result for auditability.

## Biggest Risks

- Multi-page PDF ingestion is required, and the current template-preview path is single-page only.
- Some lab reports will be scans, not text-native PDFs.
- EN/FR/AR/VN support increases OCR, tokenization, and normalization risk.
- Lab reference ranges may vary by sex, age, lab, or instrument.
- Claude can still overstate urgency if the prompt and schema are too loose.
- A two-model pipeline adds latency, cost, and one more integration surface.
- Poor extraction on even one critical row would hurt both correctness and UX scores.

## What To Avoid

- Do not rename internal `ConsultationReport` concepts into generic names before proving the lab flow.
- Do not reuse the consultation report UI for lab results.
- Do not make Claude or Qwen alone decide normal versus abnormal when numeric comparison is available.
- Do not send the entire raw PDF blindly into the reasoning layer if structured rows and snippets are enough.
- Do not build the labs flow on top of the single-page template-preview assumption.

## Recommended Build Order

1. Home screen mode split
   Add `New Consultation Report` and `Analyze Lab Report`.
2. Lab import flow
   Add PDF upload plus bundled sample lab report.
3. Lab schema
   Add `LabAnalysisReport` type and backend Zod schema.
4. PDF ingestion
   Support multi-page extraction and scanned-page fallback.
5. Qwen extraction layer
   Produce normalized candidate lab rows from the ingested document.
6. Deterministic flagging layer
   Parse tests, units, reference ranges, and abnormal flags in code where possible.
7. Claude reasoning layer
   Generate severity, actionability, patient-friendly interpretations, and overall prioritization.
8. Results UI
   Build a lab-specific detail screen.
9. Export
   Add lab-specific PDF generation.
10. QA
   Test with representative EN/FR/AR/VN files and at least one scanned PDF.

## Required Config If We Build It

- `DASHSCOPE_API_KEY` for Qwen extraction work
- `ANTHROPIC_API_KEY` for Claude reasoning
- `CLAUDE_MODEL` for the chosen Claude model id

Optional:

- a feature flag to switch between `Qwen-only`, `Claude-only`, and `hybrid` for comparison during QA
- a processing-mode field in the response so the UI can disclose when the run used degraded mode

## Likely File Touchpoints If We Build It

- `app/index.tsx`
- `app/labs/import.tsx`
- `app/labs/processing.tsx`
- `app/labs/report.tsx`
- `components/LabReportDetailScreen.tsx`
- `lib/api.ts`
- `lib/session.tsx`
- `lib/storage.ts`
- `lib/pdf.ts`
- `types/labReport.ts`
- `server/src/index.ts`
- `server/src/labReportSchema.ts`
- optional Anthropic client wrapper under `server/src/anthropic.ts`
- optional new backend helpers under `server/src/labs/`

## Go Or No-Go Recommendation

- Go, if we treat this as a second workflow and not a rewrite of the consultation feature.
- Go, if we first validate one key technical assumption:
  the chosen extraction stack can reliably read a realistic multi-page lab PDF, including at least one difficult multilingual example.
- Go, if hackathon rules allow Claude in the reasoning path while keeping Qwen materially involved in extraction.
- No-go, if we expect to get hackathon-quality lab extraction by only renaming the home screen and reusing the current consultation schema.

## Fastest Sensible MVP

If we decide to build this, the fastest sensible MVP is:

- dual-mode home screen
- sample lab PDF plus uploaded PDF
- Qwen extraction to normalized lab rows
- deterministic code-based abnormal flagging
- Claude reasoning for severity, actionability, and insights
- abnormal-first results screen
- generated PDF export

That is a realistic extension of this repo. The hard part is the document-understanding layer, not the app shell.
