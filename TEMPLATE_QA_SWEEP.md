# Template Import Plan And QA Sweep

Date: 2026-04-17

## Implementation Plan

1. Add a single `Import template` pill on the home screen below `Open sample consultation`.
2. Route that pill to a dedicated template setup screen with three sources:
   - `Take photo`
   - `Choose photo`
   - `Import PDF`
3. Persist imported template assets locally so the same background can be reused for later PDFs.
4. For PDF imports, generate a first-page PNG preview on the backend and send it back to the app.
5. Let the clinician name the template and review four suggested fill regions:
   - visit summary
   - history and findings
   - assessment
   - plan and follow-up
6. Use the saved template as page 1 of the generated PDF, preserving the original form and overlaying filled text into the chosen regions.
7. Keep the existing standard consultation note as the second page so the app still produces a readable canonical report.
8. Make every handoff degrade safely:
   - bad saved template data should not crash hydration
   - unreadable template assets should fall back to the standard PDF
   - non-PDF files should be rejected cleanly
   - the main consultation flow should still work with no template configured

## 20-Point Resilience Sweep

| # | Risk / Breakdown Point | Verification | Result |
| --- | --- | --- | --- |
| 1 | Home screen entry point missing or misplaced | Verified in simulator accessibility tree: `Import template` appears below `Open sample consultation`. | Verified |
| 2 | Home pill fails to navigate to the template flow | Tapped `Import template` in simulator and confirmed the `/template` screen rendered. | Verified |
| 3 | Empty-state template screen is confusing or incomplete | Verified in simulator screenshot/snapshot: title, subtitle, `Take photo`, `Choose photo`, `Import PDF`, and `Back` all render. | Verified |
| 4 | iOS permission prompts missing for camera/photo import | `npx expo config --type public` shows `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`. | Verified |
| 5 | Template route breaks Expo bundle | `npm run typecheck` passes and `npx expo export --platform ios` passes after adding `app/template.tsx`. | Verified |
| 6 | Local backend missing PDF preview endpoint | `curl -F file=@tmp-template-test.pdf http://127.0.0.1:8787/api/template-preview` returned `200`. | Verified |
| 7 | Deployed Railway backend missing PDF preview endpoint | `curl -F file=@tmp-template-test.pdf https://elfie-scribe-api-production.up.railway.app/api/template-preview` returned `200`. | Verified |
| 8 | Preview payload shape incomplete or inconsistent | Parsed local and live JSON; both include `previewBase64`, `mimeType`, `width`, and `height`. | Verified |
| 9 | Non-PDF uploads fail unclearly | Local invalid upload returned `400` with `Template preview is only required for PDF templates.` | Verified |
| 10 | Live backend handles invalid uploads differently than local | Live invalid upload also returned `400` with the same message. | Verified |
| 11 | Saved template JSON corruption could break app hydration | Added guarded parsing in `loadTemplateAsync()` / `loadLatestReportAsync()` and removal of corrupted values. | Fixed |
| 12 | Older or malformed template objects could load with invalid geometry | Added `normalizeTemplate()` and verified with `npx tsx` smoke test that bad dimensions fall back to safe defaults. | Fixed and verified |
| 13 | Region coordinates can drift outside the form | `clampRegion()` now constrains x/y/width/height; verified with `npx tsx` smoke test that out-of-range values normalize inside bounds. | Verified |
| 14 | File persistence can fail when source and target are the same path | Added copy-to-self guards in `persistPdfAsync()` and `persistTemplateAssetAsync()`. | Fixed |
| 15 | Saved template asset missing later would break PDF generation | Wrapped template render in a guarded fallback so unreadable templates now degrade to the standard report PDF. | Fixed |
| 16 | Processing screen could still route home after a successful run | Reproduced during simulator sweep, traced to `processing.tsx`, and fixed the `pendingAudio` / redirect race. | Fixed |
| 17 | Template changes might break the no-key demo fallback | Restarted local server with `DASHSCOPE_API_KEY=''`; `POST /api/process-audio` returned `200` with `usedMock: true`. | Verified |
| 18 | Template work might accidentally break the baseline no-template processing path | The processing path still compiles and the backend still returns a valid report payload for sample audio in mock mode. | Verified |
| 19 | Scanned PDFs may exceed the previous upload limit | Raised `multer` file limit from `10 MB` to `25 MB` and redeployed Railway. | Fixed and deployed |
| 20 | Live deployment could lag behind workspace changes | Redeployed Railway after the hardening changes; deployment `86344825-6582-4cef-84d1-f2322b13ac21` reached `SUCCESS`. | Verified |

## Notes

- The current template workflow is intentionally a background-preserving overlay system, not full OCR-to-vector reconstruction.
- The first release path is:
  - photo or PDF import
  - manual region placement once
  - reuse the saved form as the first PDF page for future notes
- This gives a hospital-specific output that feels exact without betting reliability on perfect OCR layout inference.
- During the simulator sweep, a backend `502` surfaced as raw JSON text in the processing UI. `lib/api.ts` now normalizes structured backend errors into clinician-readable copy before they reach the screen.
