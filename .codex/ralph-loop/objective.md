# Ralph Objective

Build the Elfie Scribe hackathon MVP in this repo.

Deliver an iOS-first Expo / React Native TypeScript app and a Railway backend
that together support:

- recording a doctor-patient consultation on device
- processing a bundled sample consultation mp3
- sending audio to the Railway backend
- transcribing audio with OpenAI
- extracting a `ConsultationReport` with Alibaba-hosted Qwen
- validating the structured report before returning it to the app
- rendering the report in-app
- generating a polished PDF
- sharing the PDF through the native share sheet and email when available

Keep the build optimized for:

- end-to-end happy path reliability
- hackathon demo polish
- low implementation risk
- Qwen being part of the real product path

Do not spend time on:

- auth
- HIPAA hardening
- admin dashboards
- long-term sync
- backend experiments outside the locked architecture unless the current path fails
