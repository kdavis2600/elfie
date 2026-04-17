# Ralph Feedback

Current locked architecture:

- Expo app -> Railway backend -> OpenAI transcription -> Alibaba Qwen extraction -> validated JSON -> app PDF/share flow

Locked constraints:

- Qwen is hosted on Alibaba Model Studio, not on Railway
- Railway backend is built in parallel with the app
- preferred transcription path is `gpt-4o-transcribe` or `gpt-4o-transcribe-diarize`
- fallback transcription path is `whisper-1`
- local `ollama` `qwen2.5-coder:32b` may be used for bounded draft coding tasks only

Known external state:

- Railway project exists: `elfie-scribe`
- Railway service exists: `elfie-scribe-api`
- App Store Connect app exists: `Qwen Hackathon (Elfie)` / `com.kizzle.hackathon`
- local `.env` already includes Alibaba access key pair, `DASHSCOPE_API_KEY`, `QWEN_BASE_URL`, and `QWEN_MODEL`

Rules for the run:

- Prefer working vertical slices over broad unfinished scaffolding.
- Keep each checkpoint testable.
- If blocked by infrastructure or credentials, finish all local code that does not require the missing dependency and record the blocker honestly.
- Do not reopen already locked product decisions unless the current path provably fails.
