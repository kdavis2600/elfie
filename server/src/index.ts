import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdirSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import cors from "cors";
import express from "express";
import mime from "mime-types";
import multer from "multer";
import { createCanvas } from "@napi-rs/canvas";

import { createMockReport } from "../../lib/mock";
import { normalizeTranscriptSegments } from "../../lib/transcript";
import { ConsultationReport, PendingAudio } from "../../types/report";
import { consultationReportSchema } from "./reportSchema";

const app = express();
const AUDIO_UPLOAD_DIR = path.join(os.tmpdir(), "elfie-audio-uploads");
mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });

const audioUpload = multer({ dest: AUDIO_UPLOAD_DIR, limits: { fileSize: 25 * 1024 * 1024 } });
const templateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const PORT = Number(process.env.PORT ?? 8787);
const RAW_BASE_URL =
  process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1";
const QWEN_MODEL = process.env.QWEN_MODEL ?? "qwen3.5-plus";
const QWEN_REPAIR_MODEL = process.env.QWEN_REPAIR_MODEL ?? "qwen-flash";
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const PRIVACY_MODE = parseBoolean(process.env.PRIVACY_MODE, true);
const ASR_CHUNK_CONCURRENCY = clampInteger(parseNullableNumber(process.env.ASR_CHUNK_CONCURRENCY), 1, 3) ?? 3;
const QWEN_REQUEST_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.QWEN_REQUEST_TIMEOUT_MS), 15_000, 240_000) ?? 180_000;
const execFileAsync = promisify(execFile);

app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    configured: Boolean(DASHSCOPE_API_KEY),
    baseUrl: normalizeCompatibleBaseUrl(RAW_BASE_URL),
    model: QWEN_MODEL,
    privacyMode: PRIVACY_MODE,
  });
});

app.post("/api/process-audio", audioUpload.single("file"), async (req, res) => {
  const startedAt = Date.now();
  const file = req.file;
  const sourceType = parseSourceType(req.body?.sourceType);
  const durationSec = parseNullableNumber(req.body?.durationSec);

  if (!file) {
    res.status(400).send("Missing audio file.");
    return;
  }

  try {
    const pendingAudioBase: PendingAudio = {
      uri: file.originalname,
      fileName: file.originalname,
      durationSec,
      mimeType: file.mimetype,
      sourceType,
    };

    if (!DASHSCOPE_API_KEY) {
      const report = finalizeReportForStorage(createMockReport(sourceType), pendingAudioBase, PRIVACY_MODE);
      logRun("mock", startedAt, { reason: "no_api_key" });
      res.json({
        report,
        transcript: report.transcript.fullText,
        detectedLanguage: report.language.detected,
        usedMock: true,
      });
      return;
    }

    const { transcript, actualDurationSec } = await transcribeAudioAsync(file.path);
    const pendingAudio: PendingAudio = {
      ...pendingAudioBase,
      durationSec: actualDurationSec ?? durationSec,
    };
    const redactedTranscript = PRIVACY_MODE ? redactSensitiveText(transcript) : transcript;
    const extractedReport = await extractReportAsync({
      transcript: redactedTranscript,
      audio: pendingAudio,
      privacyMode: PRIVACY_MODE,
    });
    const report = finalizeReportForStorage(extractedReport, pendingAudio, PRIVACY_MODE);

    logRun("success", startedAt, {
      sourceType,
      durationSec,
      transcriptLength: transcript.length,
    });

    res.json({
      report,
      transcript: report.transcript.fullText,
      detectedLanguage: report.language.detected,
      usedMock: false,
    });
  } catch (error) {
    console.error("[process-audio] failed", error);
    logRun("failure", startedAt, {
      sourceType,
      durationSec,
      error: error instanceof Error ? error.message : "unknown",
    });
    const message = error instanceof Error ? error.message : "Processing failed.";
    res.status(resolveServerErrorStatus(error)).send(message);
  } finally {
    if (file?.path) {
      await fs.rm(file.path, { force: true });
    }
  }
});

app.post("/api/edit-report", async (req, res) => {
  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
  const parsedReport = consultationReportSchema.safeParse(req.body?.report);

  if (!instruction) {
    res.status(400).send("Missing AI edit instruction.");
    return;
  }

  if (!parsedReport.success) {
    res.status(400).send("Invalid report payload.");
    return;
  }

  if (!DASHSCOPE_API_KEY) {
    res.status(503).send("AI editing is unavailable because the Qwen API key is not configured.");
    return;
  }

  try {
    const report = await editStructuredReportAsync(parsedReport.data, instruction);
    res.json({ report });
  } catch (error) {
    console.error("[edit-report] failed", error);
    const message = error instanceof Error ? error.message : "AI edit failed.";
    res.status(resolveServerErrorStatus(error)).send(message);
  }
});

app.post("/api/template-preview", templateUpload.single("file"), async (req, res) => {
  const file = req.file;

  if (!file) {
    res.status(400).send("Missing template file.");
    return;
  }

  const mimeType = file.mimetype || mime.lookup(file.originalname) || "application/octet-stream";

  if (!String(mimeType).includes("pdf")) {
    res.status(400).send("Template preview is only required for PDF templates.");
    return;
  }

  try {
    const preview = await renderPdfPreviewAsync(file.buffer);
    res.json(preview);
  } catch (error) {
    console.error("[template-preview] failed", error);
    const message = error instanceof Error ? error.message : "Template preview failed.";
    const statusCode = /only single-page pdf templates/i.test(message) ? 400 : 500;
    res.status(statusCode).send(message);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).send("Uploaded file is too large. Keep files under 25 MB.");
      return;
    }

    res.status(400).send(error.message);
    return;
  }

  next(error);
});

app.listen(PORT, () => {
  console.log(`[elfie-scribe-api] listening on http://0.0.0.0:${PORT}`);
});

async function transcribeAudioAsync(inputPath: string) {
  const prepared = await prepareAudioChunksAsync(inputPath);

  try {
    const transcripts = await mapWithConcurrencyLimit(prepared.chunks, ASR_CHUNK_CONCURRENCY, async (chunk) => {
      const chunkBuffer = await fs.readFile(chunk.path);
      const dataUrl = `data:audio/mpeg;base64,${chunkBuffer.toString("base64")}`;
      const response = await qwenChatCompletionAsync({
        model: "qwen3-asr-flash",
        messages: [
          {
            role: "system",
            content: [
              {
                type: "text",
                text: "Transcribe this consultation audio accurately. Preserve the original language and punctuation. Do not summarize.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: dataUrl,
                },
              },
            ],
          },
        ],
        asr_options: {
          enable_itn: false,
        },
      });

      return extractMessageText(response).trim();
    });

    const nonEmptyTranscripts = transcripts.filter(Boolean);

    if (!nonEmptyTranscripts.length) {
      throw new Error("ASR returned an empty transcript.");
    }

    return {
      transcript: nonEmptyTranscripts.join("\n\n"),
      actualDurationSec: prepared.durationSec,
    };
  } finally {
    await fs.rm(prepared.tempDir, { recursive: true, force: true });
  }
}

async function extractReportAsync({
  transcript,
  audio,
  privacyMode,
}: {
  transcript: string;
  audio: PendingAudio;
  privacyMode: boolean;
}) {
  const prompt = [
    "Return JSON only.",
    "You are generating a structured clinical consultation report for a hackathon MVP.",
    "Never invent names, diagnoses, medications, doses, allergies, vitals, or follow-up dates.",
    "If details are missing, use empty arrays, null, or 'unknown' and list the gaps in quality.missingInformation.",
    "If uncertain, capture the uncertainty in quality.ambiguities and lower diagnosis confidence.",
    "Report language must be English while preserving the original transcript text.",
    "Include transcript.fullText exactly as the transcript input.",
    "Populate transcript.segments with short speaker turns whenever possible.",
    "Infer likely doctor and patient turns from the consultation context. Use unknown only when the speaker truly cannot be inferred.",
    privacyMode
      ? "Privacy mode is enabled. Direct identifiers may already be replaced with [redacted ...] placeholders. Never restore, infer, or fabricate them."
      : "If names are genuinely present in the transcript, you may include them.",
    privacyMode ? "Set visit.patientName and visit.clinicianName to null." : "Use null for names when they are missing.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        id: "string",
        createdAt: "ISO string",
        sourceAudio: {
          fileName: "string|null",
          durationSec: "number|null",
          sourceType: "recorded|sample|imported",
        },
        language: {
          detected: "language code",
          reportLanguage: "en",
        },
        visit: {
          visitReason: "string",
          clinicianName: "string|null",
          patientName: "string|null",
          visitType: "new|follow_up|urgent|unknown",
        },
        summary: {
          oneLiner: "string",
          bullets: ["string"],
        },
        soap: {
          subjective: {
            chiefComplaint: "string",
            hpi: "string",
            symptoms: ["string"],
            history: ["string"],
            medicationsMentioned: ["string"],
            allergiesMentioned: ["string"],
            patientConcerns: ["string"],
          },
          objective: {
            vitals: ["string"],
            findings: ["string"],
            testsOrResults: ["string"],
            observations: ["string"],
          },
          assessment: {
            summary: "string",
            diagnoses: [{ name: "string", confidence: "confirmed|likely|possible|unclear" }],
            differentials: ["string"],
            redFlags: ["string"],
          },
          plan: {
            medications: ["string"],
            testsOrdered: ["string"],
            referrals: ["string"],
            followUp: ["string"],
            patientInstructions: ["string"],
            clinicianTasks: ["string"],
            lifestyleAdvice: ["string"],
          },
        },
        quality: {
          missingInformation: ["string"],
          ambiguities: ["string"],
        },
        transcript: {
          fullText: "string",
          segments: [{ speaker: "doctor|patient|unknown", startSec: 0, endSec: 1, text: "string" }],
        },
      },
      null,
      2,
    ),
    "",
    `Source metadata: ${JSON.stringify({
      fileName: privacyMode ? null : (audio.fileName ?? null),
      durationSec: audio.durationSec ?? null,
      sourceType: audio.sourceType,
    })}`,
    "",
    `Transcript:\n${transcript}`,
  ].join("\n");

  const completion = await qwenChatCompletionAsync({
    model: QWEN_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a careful clinical documentation assistant. Output only JSON. The word JSON appears here to satisfy structured-output style parsers.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: {
      type: "json_object",
    },
    enable_thinking: false,
  });

  const content = extractMessageText(completion);
  const parsed = await repairAndValidateAsync(content, transcript, audio, privacyMode);

  return parsed;
}

async function repairAndValidateAsync(
  raw: string,
  transcript: string,
  audio: PendingAudio,
  privacyMode: boolean,
) {
  const candidate = await parseOrRepairJsonAsync(raw);
  const normalized = normalizeReport(candidate, transcript, audio, privacyMode);
  return consultationReportSchema.parse(normalized);
}

async function editStructuredReportAsync(report: ConsultationReport, instruction: string) {
  const promptReport = {
    ...report,
    transcript: {
      fullText: "[transcript omitted for AI report editing]",
      segments: [],
    },
  };

  const prompt = [
    "Return JSON only.",
    "You are editing an existing structured clinical consultation report for a doctor.",
    "Apply the doctor's instruction to the structured note itself.",
    "Preserve id, createdAt, sourceAudio, language, privacy, and transcript exactly as provided in the existing report.",
    "Do not rewrite the transcript. The transcript is intentionally omitted from the prompt context.",
    "Change only the fields needed to satisfy the instruction.",
    "Never invent names, diagnoses, medications, allergies, test results, or follow-up dates unless the instruction explicitly asks to add them.",
    report.privacy?.mode === "redacted"
      ? "Privacy mode is enabled. Keep clinicianName, patientName, and sourceAudio.fileName as null, and avoid adding direct identifiers."
      : "Preserve existing identity fields unless the instruction explicitly changes them.",
    "",
    `Doctor instruction:\n${instruction}`,
    "",
    `Existing report:\n${JSON.stringify(promptReport, null, 2)}`,
  ].join("\n");

  const completion = await qwenChatCompletionAsync({
    model: QWEN_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a precise clinical note editor. Output only JSON. Preserve structure and keep unchanged fields intact.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: {
      type: "json_object",
    },
    enable_thinking: false,
  });

  const candidate = await parseOrRepairJsonAsync(extractMessageText(completion));
  const merged = mergeEditedReport(candidate, report);
  const finalReport =
    report.privacy?.mode === "redacted"
      ? finalizeReportForStorage(
          merged,
          {
            uri: report.id,
            fileName: report.sourceAudio.fileName ?? null,
            durationSec: report.sourceAudio.durationSec ?? null,
            mimeType: null,
            sourceType: report.sourceAudio.sourceType,
          },
          true,
        )
      : {
          ...merged,
          privacy: report.privacy ?? {
            mode: "standard",
            transcriptRedacted: false,
            transcriptExcludedFromPdf: false,
          },
        };

  return consultationReportSchema.parse(finalReport);
}

function normalizeReport(input: unknown, transcript: string, audio: PendingAudio, privacyMode: boolean) {
  const report = typeof input === "object" && input ? ({ ...(input as Record<string, unknown>) } as Record<string, unknown>) : {};

  return {
    id: String(report.id ?? `report-${Date.now()}`),
    createdAt: typeof report.createdAt === "string" ? report.createdAt : new Date().toISOString(),
    sourceAudio: {
      fileName: audio.fileName ?? null,
      durationSec: audio.durationSec ?? null,
      sourceType: audio.sourceType,
      ...readObject(report.sourceAudio),
    },
    language: {
      detected: "unknown",
      reportLanguage: "en",
      ...readObject(report.language),
    },
    privacy: {
      mode: privacyMode ? "redacted" : "standard",
      transcriptRedacted: privacyMode,
      transcriptExcludedFromPdf: privacyMode,
      ...readObject(report.privacy),
    },
    visit: {
      visitReason: "",
      clinicianName: null,
      patientName: null,
      visitType: "unknown",
      ...readObject(report.visit),
    },
    summary: {
      oneLiner: "",
      bullets: [],
      ...readObject(report.summary),
    },
    soap: {
      subjective: {
        chiefComplaint: "",
        hpi: "",
        symptoms: [],
        history: [],
        medicationsMentioned: [],
        allergiesMentioned: [],
        patientConcerns: [],
        ...readObject(readObject(report.soap).subjective),
      },
      objective: {
        vitals: [],
        findings: [],
        testsOrResults: [],
        observations: [],
        ...readObject(readObject(report.soap).objective),
      },
      assessment: {
        summary: "",
        diagnoses: [],
        differentials: [],
        redFlags: [],
        ...readObject(readObject(report.soap).assessment),
      },
      plan: {
        medications: [],
        testsOrdered: [],
        referrals: [],
        followUp: [],
        patientInstructions: [],
        clinicianTasks: [],
        lifestyleAdvice: [],
        ...readObject(readObject(report.soap).plan),
      },
    },
    quality: {
      missingInformation: [],
      ambiguities: [],
      ...readObject(report.quality),
    },
    transcript: {
      fullText: transcript,
      ...readObject(report.transcript),
    },
  };
}

function finalizeReportForStorage(report: ConsultationReport, audio: PendingAudio, privacyMode: boolean) {
  if (!privacyMode) {
    const segments = normalizeTranscriptSegments(report.transcript.fullText, report.transcript.segments);

    return {
      ...report,
      sourceAudio: {
        ...report.sourceAudio,
        fileName: audio.fileName ?? report.sourceAudio.fileName ?? null,
        durationSec: audio.durationSec ?? report.sourceAudio.durationSec ?? null,
        sourceType: audio.sourceType,
      },
      transcript: {
        fullText: report.transcript.fullText.trim(),
        segments: segments.length ? segments : undefined,
      },
      privacy: {
        mode: "standard",
        transcriptRedacted: false,
        transcriptExcludedFromPdf: false,
      },
    };
  }

  const redactedFullText = redactSensitiveText(report.transcript.fullText);
  const redactedSegments = report.transcript.segments?.map((segment) => ({
    ...segment,
    text: redactSensitiveText(segment.text),
  }));
  const normalizedRedactedSegments = normalizeTranscriptSegments(redactedFullText, redactedSegments);

  return {
    ...report,
    sourceAudio: {
      ...report.sourceAudio,
      fileName: null,
      durationSec: audio.durationSec ?? report.sourceAudio.durationSec ?? null,
      sourceType: audio.sourceType,
    },
    visit: {
      ...report.visit,
      visitReason: redactSensitiveText(report.visit.visitReason),
      clinicianName: null,
      patientName: null,
    },
    summary: {
      oneLiner: redactSensitiveText(report.summary.oneLiner),
      bullets: report.summary.bullets.map(redactSensitiveText),
    },
    soap: {
      subjective: {
        chiefComplaint: redactSensitiveText(report.soap.subjective.chiefComplaint),
        hpi: redactSensitiveText(report.soap.subjective.hpi),
        symptoms: report.soap.subjective.symptoms.map(redactSensitiveText),
        history: report.soap.subjective.history.map(redactSensitiveText),
        medicationsMentioned: report.soap.subjective.medicationsMentioned.map(redactSensitiveText),
        allergiesMentioned: report.soap.subjective.allergiesMentioned.map(redactSensitiveText),
        patientConcerns: report.soap.subjective.patientConcerns.map(redactSensitiveText),
      },
      objective: {
        vitals: report.soap.objective.vitals.map(redactSensitiveText),
        findings: report.soap.objective.findings.map(redactSensitiveText),
        testsOrResults: report.soap.objective.testsOrResults.map(redactSensitiveText),
        observations: report.soap.objective.observations.map(redactSensitiveText),
      },
      assessment: {
        summary: redactSensitiveText(report.soap.assessment.summary),
        diagnoses: report.soap.assessment.diagnoses.map((diagnosis) => ({
          ...diagnosis,
          name: redactSensitiveText(diagnosis.name),
        })),
        differentials: report.soap.assessment.differentials.map(redactSensitiveText),
        redFlags: report.soap.assessment.redFlags.map(redactSensitiveText),
      },
      plan: {
        medications: report.soap.plan.medications.map(redactSensitiveText),
        testsOrdered: report.soap.plan.testsOrdered.map(redactSensitiveText),
        referrals: report.soap.plan.referrals.map(redactSensitiveText),
        followUp: report.soap.plan.followUp.map(redactSensitiveText),
        patientInstructions: report.soap.plan.patientInstructions.map(redactSensitiveText),
        clinicianTasks: report.soap.plan.clinicianTasks.map(redactSensitiveText),
        lifestyleAdvice: report.soap.plan.lifestyleAdvice.map(redactSensitiveText),
      },
    },
    quality: {
      missingInformation: dedupeStrings([
        ...report.quality.missingInformation.map(redactSensitiveText),
        "Direct identifiers were redacted before model extraction.",
      ]),
      ambiguities: dedupeStrings([
        ...report.quality.ambiguities.map(redactSensitiveText),
        "Privacy mode may remove names, dates, contact details, file names, or record identifiers.",
      ]),
    },
    transcript: {
      fullText: redactedFullText,
      segments: normalizedRedactedSegments.length ? normalizedRedactedSegments : undefined,
    },
    privacy: {
      mode: "redacted",
      transcriptRedacted: true,
      transcriptExcludedFromPdf: true,
    },
  };
}

async function qwenChatCompletionAsync(body: Record<string, unknown>) {
  let response: Response;

  try {
    response = await fetch(`${normalizeCompatibleBaseUrl(RAW_BASE_URL)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(QWEN_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Qwen request timed out after ${Math.round(QWEN_REQUEST_TIMEOUT_MS / 1000)} seconds.`);
    }

    throw error;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen request failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function parseOrRepairJsonAsync(raw: string) {
  const parsed = parseJsonLike(raw);
  if (parsed) {
    return parsed;
  }

  const repairCompletion = await qwenChatCompletionAsync({
    model: QWEN_REPAIR_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Fix the user's malformed JSON into valid JSON only. Do not add markdown fences. Preserve the same information and do not invent missing facts.",
      },
      {
        role: "user",
        content: raw,
      },
    ],
    response_format: {
      type: "json_object",
    },
    enable_thinking: false,
  });

  const repaired = parseJsonLike(extractMessageText(repairCompletion));
  if (!repaired) {
    throw new Error("Model output was not valid JSON after repair.");
  }

  return repaired;
}

function extractMessageText(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item?.text === "string") {
          return item.text;
        }
        if (typeof item?.content === "string") {
          return item.content;
        }
        return "";
      })
      .join("");
  }

  return "";
}

function parseJsonLike(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(value.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function readObject(value: unknown) {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : {};
}

function mergeEditedReport(input: unknown, originalReport: ConsultationReport): ConsultationReport {
  const editedReport = readObject(input);
  const editedVisit = readObject(editedReport.visit);
  const editedSummary = readObject(editedReport.summary);
  const editedSoap = readObject(editedReport.soap);
  const editedSubjective = readObject(editedSoap.subjective);
  const editedObjective = readObject(editedSoap.objective);
  const editedAssessment = readObject(editedSoap.assessment);
  const editedPlan = readObject(editedSoap.plan);
  const editedQuality = readObject(editedReport.quality);
  const privacyMode = originalReport.privacy?.mode === "redacted";

  return {
    ...originalReport,
    visit: {
      visitReason: readString(editedVisit.visitReason, originalReport.visit.visitReason),
      clinicianName: privacyMode ? null : readNullableString(editedVisit.clinicianName, originalReport.visit.clinicianName ?? null),
      patientName: privacyMode ? null : readNullableString(editedVisit.patientName, originalReport.visit.patientName ?? null),
      visitType: readVisitType(editedVisit.visitType, originalReport.visit.visitType ?? "unknown"),
    },
    summary: {
      oneLiner: readString(editedSummary.oneLiner, originalReport.summary.oneLiner),
      bullets: readStringArray(editedSummary.bullets, originalReport.summary.bullets),
    },
    soap: {
      subjective: {
        chiefComplaint: readString(editedSubjective.chiefComplaint, originalReport.soap.subjective.chiefComplaint),
        hpi: readString(editedSubjective.hpi, originalReport.soap.subjective.hpi),
        symptoms: readStringArray(editedSubjective.symptoms, originalReport.soap.subjective.symptoms),
        history: readStringArray(editedSubjective.history, originalReport.soap.subjective.history),
        medicationsMentioned: readStringArray(
          editedSubjective.medicationsMentioned,
          originalReport.soap.subjective.medicationsMentioned,
        ),
        allergiesMentioned: readStringArray(editedSubjective.allergiesMentioned, originalReport.soap.subjective.allergiesMentioned),
        patientConcerns: readStringArray(editedSubjective.patientConcerns, originalReport.soap.subjective.patientConcerns),
      },
      objective: {
        vitals: readStringArray(editedObjective.vitals, originalReport.soap.objective.vitals),
        findings: readStringArray(editedObjective.findings, originalReport.soap.objective.findings),
        testsOrResults: readStringArray(editedObjective.testsOrResults, originalReport.soap.objective.testsOrResults),
        observations: readStringArray(editedObjective.observations, originalReport.soap.objective.observations),
      },
      assessment: {
        summary: readString(editedAssessment.summary, originalReport.soap.assessment.summary),
        diagnoses: readDiagnosisArray(editedAssessment.diagnoses, originalReport.soap.assessment.diagnoses),
        differentials: readStringArray(editedAssessment.differentials, originalReport.soap.assessment.differentials),
        redFlags: readStringArray(editedAssessment.redFlags, originalReport.soap.assessment.redFlags),
      },
      plan: {
        medications: readStringArray(editedPlan.medications, originalReport.soap.plan.medications),
        testsOrdered: readStringArray(editedPlan.testsOrdered, originalReport.soap.plan.testsOrdered),
        referrals: readStringArray(editedPlan.referrals, originalReport.soap.plan.referrals),
        followUp: readStringArray(editedPlan.followUp, originalReport.soap.plan.followUp),
        patientInstructions: readStringArray(editedPlan.patientInstructions, originalReport.soap.plan.patientInstructions),
        clinicianTasks: readStringArray(editedPlan.clinicianTasks, originalReport.soap.plan.clinicianTasks),
        lifestyleAdvice: readStringArray(editedPlan.lifestyleAdvice, originalReport.soap.plan.lifestyleAdvice),
      },
    },
    quality: {
      missingInformation: readStringArray(editedQuality.missingInformation, originalReport.quality.missingInformation),
      ambiguities: readStringArray(editedQuality.ambiguities, originalReport.quality.ambiguities),
    },
    transcript: originalReport.transcript,
    sourceAudio: originalReport.sourceAudio,
    language: originalReport.language,
    privacy: originalReport.privacy,
    id: originalReport.id,
    createdAt: originalReport.createdAt,
  };
}

function redactSensitiveText(value: string) {
  return applyRedactionRules(value)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function applyRedactionRules(value: string) {
  const monthPattern =
    "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const nameToken = "[\\p{Lu}][\\p{L}'-]+";
  const fullNamePattern = `${nameToken}(?:\\s+${nameToken}){0,3}`;
  const namePrefixPattern =
    "(?:my name is|name is|patient name is|doctor name is|clinician name is|this is|dr\\.?|mr\\.?|mrs\\.?|ms\\.?|tên tôi là|em tên là|tôi tên là|bác sĩ)";
  const roleNamePattern = "(?:patient|doctor|clinician|physician|bệnh nhân|bác sĩ)";
  const replacements: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted email]"],
    [/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted phone]"],
    [
      new RegExp(
        `\\b(?:DOB|D\\.O\\.B\\.|date of birth|birth date|ngày sinh)\\b\\s*[:#-]?\\s*(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|${monthPattern}\\s+\\d{1,2},?\\s+\\d{4})`,
        "giu",
      ),
      "[redacted birth date]",
    ],
    [/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g, "[redacted date]"],
    [new RegExp(`\\b${monthPattern}\\s+\\d{1,2},?\\s+\\d{4}\\b`, "giu"), "[redacted date]"],
    [
      /\b(?:MRN|medical record number|record number|patient id|patient number|national id|passport|cccd|cmnd)\b\s*[:#-]?\s*[A-Z0-9-]{3,}\b/giu,
      "[redacted identifier]",
    ],
    [
      /\b\d{1,5}\s+[A-Za-z0-9][A-Za-z0-9\s.-]{2,40}\s(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Ward|District)\b/giu,
      "[redacted address]",
    ],
    [
      new RegExp(`\\b(${namePrefixPattern})\\s+(${fullNamePattern})`, "giu"),
      (_match, prefix) => `${prefix} [redacted name]`,
    ],
    [
      new RegExp(`\\b(${roleNamePattern})\\s*[:,-]?\\s*(${fullNamePattern})`, "giu"),
      (_match, prefix) => `${prefix} [redacted name]`,
    ],
  ];

  return replacements.reduce(
    (currentValue, [pattern, replacement]) => currentValue.replace(pattern, replacement as never),
    value,
  );
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown, fallback: string | null) {
  if (typeof value === "string" || value === null) {
    return value;
  }
  return fallback;
}

function readStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readDiagnosisArray(
  value: unknown,
  fallback: ConsultationReport["soap"]["assessment"]["diagnoses"],
) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .map((item) => {
      const diagnosis = readObject(item);
      const name = typeof diagnosis.name === "string" ? diagnosis.name : null;
      const confidence = readDiagnosisConfidence(diagnosis.confidence, null);

      if (!name || !confidence) {
        return null;
      }

      return { name, confidence };
    })
    .filter((item): item is ConsultationReport["soap"]["assessment"]["diagnoses"][number] => Boolean(item));
}

function readDiagnosisConfidence(
  value: unknown,
  fallback: ConsultationReport["soap"]["assessment"]["diagnoses"][number]["confidence"] | null,
) {
  return value === "confirmed" || value === "likely" || value === "possible" || value === "unclear" ? value : fallback;
}

function readVisitType(
  value: unknown,
  fallback: NonNullable<ConsultationReport["visit"]["visitType"]>,
) {
  return value === "new" || value === "follow_up" || value === "urgent" || value === "unknown" ? value : fallback;
}

function parseSourceType(value: unknown): PendingAudio["sourceType"] {
  return value === "recorded" || value === "sample" || value === "imported" ? value : "sample";
}

function parseBoolean(value: unknown, defaultValue = false) {
  if (value == null || value === "") {
    return defaultValue;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value === true ? true : defaultValue;
}

function parseNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCompatibleBaseUrl(raw: string) {
  return raw
    .replace(/\/responses\/?$/, "")
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/api\/v2\/apps\/protocols\/compatible-mode\/v1\/?$/, "/compatible-mode/v1")
    .replace(/\/$/, "");
}

function logRun(status: string, startedAt: number, details: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      scope: "elfie-process-audio",
      status,
      durationMs: Date.now() - startedAt,
      ...details,
    }),
  );
}

async function prepareAudioChunksAsync(inputPath: string) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "elfie-audio-"));
  const outputPattern = path.join(tempDir, "chunk-%03d.mp3");
  const fileInfo = await fs.stat(inputPath);

  const durationSec = await probeDurationAsync(inputPath);
  const needsChunking = fileInfo.size > 6_500_000 || (durationSec ?? 0) > 290;

  if (needsChunking) {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      "240",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-codec:a",
      "libmp3lame",
      outputPattern,
    ]);
  } else {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-codec:a",
      "libmp3lame",
      path.join(tempDir, "chunk-000.mp3"),
    ]);
  }

  const files = (await fs.readdir(tempDir))
    .filter((fileName) => fileName.startsWith("chunk-") && fileName.endsWith(".mp3"))
    .sort();
  const chunks = files.map((fileName) => ({
    path: path.join(tempDir, fileName),
  }));

  if (!chunks.length) {
    throw new Error("Failed to prepare audio chunks for ASR.");
  }

  return { chunks, durationSec, tempDir };
}

async function probeDurationAsync(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  const parsed = Number(stdout.trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

async function renderPdfPreviewAsync(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  if (pdf.numPages !== 1) {
    throw new Error("Only single-page PDF templates are supported right now. Export the first page as its own PDF or image.");
  }
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  await page.render({
    canvasContext: context as never,
    canvas: canvas as never,
    viewport,
  }).promise;

  const previewBuffer = await canvas.encode("png");

  return {
    previewBase64: previewBuffer.toString("base64"),
    mimeType: "image/png",
    width: Math.ceil(viewport.width),
    height: Math.ceil(viewport.height),
  };
}

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function clampInteger(value: number | null, min: number, max: number) {
  if (value == null) {
    return null;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|timed? out/i.test(error.message));
}

function resolveServerErrorStatus(error: unknown) {
  return isAbortError(error) || (error instanceof Error && /timed? out/i.test(error.message)) ? 504 : 500;
}
