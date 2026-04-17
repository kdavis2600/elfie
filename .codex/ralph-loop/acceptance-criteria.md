# Ralph Acceptance Criteria

The task is complete only when all of the following are true:

1. The app runs locally in this repo.
2. The sample consultation path works end-to-end.
3. The real-device recording path works end-to-end.
4. Audio is uploaded to the Railway backend.
5. Backend transcription runs through OpenAI.
6. Backend extraction runs through Alibaba-hosted Qwen.
7. The returned `ConsultationReport` is schema-validated before app rendering.
8. The report renders in-app with summary, SOAP, action items, missing or ambiguous info, and transcript.
9. PDF generation works from the same report object.
10. Native share works.
11. Email compose works when available and degrades gracefully when unavailable.
12. A clearly labeled demo fallback exists when remote AI is unavailable.
13. README explains setup, env vars, sample flow, and demo-only limitations.

Checkpoint expectations:

- `CP0`: external keys and sample audio confirmed
- `CP1`: app shell compiles and Railway health endpoint is live
- `CP2`: app uploads sample audio and Railway returns a mocked validated report
- `CP3`: sample mp3 completes the full real AI happy path
- `CP4`: real-device recording completes the full happy path
- `CP5`: demo polish and fallback path are good enough for hackathon use
- `CP6`: TestFlight-ready state is reached
