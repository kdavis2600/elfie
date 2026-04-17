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
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { createMockReport } from "../../lib/mock";
import { cleanPrivacyRedactionText, normalizeTranscriptSegments } from "../../lib/transcript";
import { PendingLabDocument } from "../../types/labReport";
import { ConsultationReport, PendingAudio } from "../../types/report";
import { analyzeLabDocumentAsync, LAB_UPLOAD_LIMIT_BYTES } from "./labAnalyzer";
import { labAnalysisReportSchema } from "./labReportSchema";
import { consultationReportSchema } from "./reportSchema";

const app = express();
const AUDIO_UPLOAD_DIR = path.join(os.tmpdir(), "elfie-audio-uploads");
const LAB_UPLOAD_DIR = path.join(os.tmpdir(), "elfie-lab-uploads");
mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });
mkdirSync(LAB_UPLOAD_DIR, { recursive: true });

const audioUpload = multer({ dest: AUDIO_UPLOAD_DIR, limits: { fileSize: 25 * 1024 * 1024 } });
const labUpload = multer({ dest: LAB_UPLOAD_DIR, limits: { fileSize: LAB_UPLOAD_LIMIT_BYTES } });
const templateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const SUPPORTED_LAB_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const PORT = Number(process.env.PORT ?? 8787);
const RAW_BASE_URL =
  process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1";
const QWEN_MODEL = process.env.QWEN_MODEL ?? "qwen3.5-plus";
const QWEN_REPAIR_MODEL = process.env.QWEN_REPAIR_MODEL ?? "qwen-flash";
const QWEN_TEMPLATE_VISION_MODEL = process.env.QWEN_TEMPLATE_VISION_MODEL ?? "qwen-vl-max-latest";
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

app.post("/api/analyze-lab-report", labUpload.single("file"), async (req, res) => {
  const startedAt = Date.now();
  const file = req.file;
  const sourceType = parseLabSourceType(req.body?.sourceType);
  const sizeBytes = parseNullableNumber(req.body?.sizeBytes) ?? file?.size ?? null;

  if (!file) {
    res.status(400).send("Missing lab document file.");
    return;
  }

  const mimeType = file.mimetype || mime.lookup(file.originalname) || "application/octet-stream";

  if (!isSupportedLabDocumentMimeType(String(mimeType))) {
    res.status(400).send("Lab analysis supports PDF, JPG, PNG, WEBP, and HEIC/HEIF uploads only.");
    return;
  }

  try {
    const pendingDocument: PendingLabDocument = {
      uri: file.originalname,
      fileName: file.originalname,
      mimeType: String(mimeType),
      sizeBytes,
      sourceType,
    };

    const report = labAnalysisReportSchema.parse(await analyzeLabDocumentAsync(file.path, pendingDocument));

    logRun(report.processing.usedMock ? "mock" : "success", startedAt, {
      scope: "elfie-analyze-labs",
      sourceType,
      processingMode: report.processing.mode,
      resultCount: report.results.length,
      pageCount: report.sourceDocument.pageCount ?? null,
    });

    res.json({
      report,
      usedMock: report.processing.usedMock,
      processingMode: report.processing.mode,
    });
  } catch (error) {
    console.error("[analyze-lab-report] failed", error);
    logRun("failure", startedAt, {
      scope: "elfie-analyze-labs",
      sourceType,
      error: error instanceof Error ? error.message : "unknown",
    });
    const message = error instanceof Error ? error.message : "Lab analysis failed.";
    res.status(resolveServerErrorStatus(error)).send(message);
  } finally {
    if (file?.path) {
      await fs.rm(file.path, { force: true });
    }
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

app.post("/api/template-sanity-check", async (req, res) => {
  const previewBase64 = typeof req.body?.previewBase64 === "string" ? req.body.previewBase64.trim() : "";
  const previewMimeType = typeof req.body?.previewMimeType === "string" ? req.body.previewMimeType.trim() : "image/png";
  const pageWidth = parseNullableNumber(req.body?.pageWidth);
  const pageHeight = parseNullableNumber(req.body?.pageHeight);
  const regions = Array.isArray(req.body?.regions) ? req.body.regions : [];

  if (!previewBase64 || !pageWidth || !pageHeight || !regions.length) {
    res.status(400).send("Missing template sanity-check payload.");
    return;
  }

  if (!DASHSCOPE_API_KEY) {
    res.status(503).send("AI spot-check is unavailable because the Qwen API key is not configured.");
    return;
  }

  try {
    const overlayBuffer = await renderTemplateSpotCheckImageAsync({
      previewBase64,
      previewMimeType,
      pageWidth,
      pageHeight,
      regions,
    });
    const aiPayload = await analyzeTemplateSpotCheckAsync(overlayBuffer, previewMimeType, regions);
    res.json(mergeTemplateSpotCheckResult(aiPayload, regions));
  } catch (error) {
    console.error("[template-sanity-check] failed", error);
    const message = error instanceof Error ? error.message : "Template sanity check failed.";
    res.status(resolveServerErrorStatus(error)).send(message);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res
        .status(400)
        .send("Uploaded file is too large. Keep audio/template files under 25 MB and lab documents under 15 MB.");
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
      ? "Privacy mode is enabled. Direct identifiers may already be removed or replaced with generic role labels or placeholders. Never restore, infer, or fabricate them."
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
  return cleanPrivacyRedactionText(applyRedactionRules(value));
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
      (_match, prefix) => replaceNamedPrefix(prefix),
    ],
    [
      new RegExp(`\\b(${roleNamePattern})\\s*[:,-]?\\s*(${fullNamePattern})`, "giu"),
      (_match, prefix) => String(prefix).trim(),
    ],
  ];

  return replacements.reduce(
    (currentValue, [pattern, replacement]) => currentValue.replace(pattern, replacement as never),
    value,
  );
}

function replaceNamedPrefix(prefix: string) {
  const normalized = prefix.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();

  if (
    normalized === "my name is" ||
    normalized === "name is" ||
    normalized === "this is" ||
    normalized === "tên tôi là" ||
    normalized === "em tên là" ||
    normalized === "tôi tên là"
  ) {
    return "";
  }

  if (normalized === "mr" || normalized === "mrs" || normalized === "ms" || normalized === "patient name is") {
    return preserveReplacementCase(prefix, "patient");
  }

  if (normalized === "doctor name is" || normalized === "clinician name is") {
    return preserveReplacementCase(prefix, "doctor");
  }

  return String(prefix).trim();
}

function preserveReplacementCase(sample: string, replacement: string) {
  if (!sample) {
    return replacement;
  }

  if (sample === sample.toUpperCase()) {
    return replacement.toUpperCase();
  }

  if (/^\p{Lu}/u.test(sample)) {
    return `${replacement[0]?.toUpperCase() ?? ""}${replacement.slice(1)}`;
  }

  return replacement;
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

function parseLabSourceType(value: unknown): PendingLabDocument["sourceType"] {
  return value === "sample" || value === "pdf" || value === "image" ? value : "pdf";
}

function isSupportedLabDocumentMimeType(mimeType: string) {
  return mimeType.includes("pdf") || SUPPORTED_LAB_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
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
  if (value == null || value === "") {
    return null;
  }

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

type TemplateSpotCheckRegionInput = {
  id: string;
  label: string;
  contentKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  backgroundOpacity: number;
  overflowRisk: "low" | "medium" | "high";
};

async function renderTemplateSpotCheckImageAsync(input: {
  previewBase64: string;
  previewMimeType: string;
  pageWidth: number;
  pageHeight: number;
  regions: unknown[];
}) {
  const width = clampInteger(Math.round(input.pageWidth), 320, 2200) ?? 816;
  const height = clampInteger(Math.round(input.pageHeight), 320, 3000) ?? 1056;
  const previewBuffer = Buffer.from(input.previewBase64, "base64");
  const previewImage = await loadImage(previewBuffer);
  const regions = input.regions
    .map(normalizeTemplateSpotCheckRegion)
    .filter((region): region is TemplateSpotCheckRegionInput => Boolean(region));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  context.drawImage(previewImage, 0, 0, width, height);

  for (const region of regions) {
    const left = Math.round(region.x * width);
    const top = Math.round(region.y * height);
    const regionWidth = Math.round(region.width * width);
    const regionHeight = Math.round(region.height * height);
    const paddingX = 10;
    const paddingY = 8;
    const riskColor =
      region.overflowRisk === "high"
        ? "rgba(191, 38, 0, 0.7)"
        : region.overflowRisk === "medium"
          ? "rgba(153, 102, 0, 0.65)"
          : "rgba(20, 20, 43, 0.16)";

    context.save();
    context.beginPath();
    context.rect(left, top, regionWidth, regionHeight);
    context.clip();
    context.fillStyle = `rgba(255, 255, 255, ${Math.min(1, Math.max(0.2, region.backgroundOpacity))})`;
    context.fillRect(left, top, regionWidth, regionHeight);
    context.strokeStyle = riskColor;
    context.lineWidth = region.overflowRisk === "high" ? 2 : 1;
    context.strokeRect(left, top, regionWidth, regionHeight);

    let cursorY = top + paddingY + 10;

    if (region.title) {
      context.font = "700 9px sans-serif";
      context.fillStyle = "#776e91";
      context.fillText(region.title.toUpperCase(), left + paddingX, cursorY);
      cursorY += 14;
    }

    context.font = `600 ${Math.max(8, Math.round(region.fontSize))}px sans-serif`;
    context.fillStyle = "#14142b";

    region.lines.slice(0, 8).forEach((line, index) => {
      if (index > 0) {
        context.font = `${Math.max(8, Math.round(region.fontSize))}px sans-serif`;
        context.fillStyle = "#4e4b66";
      }

      context.fillText(line, left + paddingX, cursorY);
      cursorY += Math.max(12, region.lineHeight);
    });

    context.restore();
  }

  return canvas.encode("png");
}

async function analyzeTemplateSpotCheckAsync(
  overlayBuffer: Buffer,
  _previewMimeType: string,
  regions: unknown[],
) {
  const normalizedRegions = regions
    .map(normalizeTemplateSpotCheckRegion)
    .filter((region): region is TemplateSpotCheckRegionInput => Boolean(region));
  const prompt = [
    "Return JSON only.",
    "You are reviewing a clinical form overlay for layout QA only.",
    "Do not comment on medical correctness. Focus only on presentation issues such as clipped text, text outside boxes, unreadably dense fields, or labels that make the form look messy.",
    "If the form looks acceptable, say so briefly.",
    "Required JSON shape:",
    JSON.stringify(
      {
        overallRisk: "low|medium|high",
        summary: "string",
        suggestions: ["string"],
        regionFindings: [{ regionId: "string", overflowRisk: "low|medium|high", note: "string" }],
      },
      null,
      2,
    ),
    "",
    `Region metadata:\n${JSON.stringify(
      normalizedRegions.map((region) => ({
        regionId: region.id,
        label: region.label,
        contentKey: region.contentKey,
        heuristicRisk: region.overflowRisk,
      })),
      null,
      2,
    )}`,
  ].join("\n");

  const response = await qwenChatCompletionAsync({
    model: QWEN_TEMPLATE_VISION_MODEL,
    messages: [
      {
        role: "system",
        content: "You are a meticulous document layout reviewer. Output JSON only.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${overlayBuffer.toString("base64")}`,
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_object",
    },
    enable_thinking: false,
  });

  const parsed = parseJsonLike(extractMessageText(response));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Template spot-check did not return valid JSON.");
  }

  return parsed as Record<string, unknown>;
}

function mergeTemplateSpotCheckResult(aiPayload: Record<string, unknown>, rawRegions: unknown[]) {
  const normalizedRegions = rawRegions
    .map(normalizeTemplateSpotCheckRegion)
    .filter((region): region is TemplateSpotCheckRegionInput => Boolean(region));
  const aiRegionFindings = new Map(
    (Array.isArray(aiPayload.regionFindings) ? aiPayload.regionFindings : [])
      .map((value) => normalizeAiRegionFinding(value))
      .filter((finding): finding is NonNullable<ReturnType<typeof normalizeAiRegionFinding>> => Boolean(finding))
      .map((finding) => [finding.regionId, finding]),
  );

  const regionFindings: Array<{
    regionId: string;
    contentKey: string;
    overflowRisk: "low" | "medium" | "high";
    note: string;
  }> = normalizedRegions.map((region) => {
    const aiFinding = aiRegionFindings.get(region.id);
    return {
      regionId: region.id,
      contentKey: region.contentKey,
      overflowRisk: maxTemplateRisk(region.overflowRisk, aiFinding?.overflowRisk ?? "low"),
      note:
        aiFinding?.note ??
        (region.overflowRisk === "high"
          ? "This field is likely too tight for the mapped content."
          : region.overflowRisk === "medium"
            ? "This field looks usable but dense."
            : "This field appears visually stable."),
    };
  });

  const overallRisk = regionFindings.reduce<"low" | "medium" | "high">(
    (current, finding) => maxTemplateRisk(current, finding.overflowRisk),
    normalizeTemplateRisk(aiPayload.overallRisk, "low"),
  );
  const suggestions = dedupeStrings(
    [
      ...readStringArray(aiPayload.suggestions, []),
      ...normalizedRegions
        .filter((region) => region.overflowRisk !== "low")
        .map((region) =>
          region.overflowRisk === "high"
            ? `${region.label} should be taller or mapped to a shorter content block.`
            : `${region.label} would read better with a bit more room.`,
        ),
    ].slice(0, 6),
  );

  return {
    checkedAt: new Date().toISOString(),
    checker: "ai",
    overallRisk,
    summary:
      (typeof aiPayload.summary === "string" && aiPayload.summary.trim()) || buildTemplateSpotCheckSummary(overallRisk),
    suggestions,
    regionFindings,
  };
}

function normalizeTemplateSpotCheckRegion(value: unknown): TemplateSpotCheckRegionInput | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const region = value as Record<string, unknown>;
  const id = typeof region.id === "string" ? region.id : "";
  if (!id) {
    return null;
  }

  return {
    id,
    label: typeof region.label === "string" ? region.label : id,
    contentKey: typeof region.contentKey === "string" ? region.contentKey : "visit_summary",
    x: clampTemplateCoordinate(region.x, 0),
    y: clampTemplateCoordinate(region.y, 0),
    width: clampTemplateCoordinate(region.width, 0.2),
    height: clampTemplateCoordinate(region.height, 0.12),
    title: typeof region.title === "string" ? region.title : "",
    lines: Array.isArray(region.lines) ? region.lines.filter((line): line is string => typeof line === "string").slice(0, 10) : [],
    fontSize: typeof region.fontSize === "number" && Number.isFinite(region.fontSize) ? region.fontSize : 11,
    lineHeight: typeof region.lineHeight === "number" && Number.isFinite(region.lineHeight) ? region.lineHeight : 14,
    backgroundOpacity:
      typeof region.backgroundOpacity === "number" && Number.isFinite(region.backgroundOpacity)
        ? region.backgroundOpacity
        : 0.82,
    overflowRisk: normalizeTemplateRisk(region.overflowRisk, "low"),
  };
}

function normalizeAiRegionFinding(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const finding = value as Record<string, unknown>;
  const regionId = typeof finding.regionId === "string" ? finding.regionId : "";
  if (!regionId) {
    return null;
  }

  return {
    regionId,
    overflowRisk: normalizeTemplateRisk(finding.overflowRisk, "low"),
    note: typeof finding.note === "string" && finding.note.trim() ? finding.note.trim() : null,
  };
}

function normalizeTemplateRisk(value: unknown, fallback: "low" | "medium" | "high") {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function maxTemplateRisk(left: "low" | "medium" | "high", right: "low" | "medium" | "high") {
  if (left === "high" || right === "high") {
    return "high";
  }
  if (left === "medium" || right === "medium") {
    return "medium";
  }
  return "low";
}

function buildTemplateSpotCheckSummary(overallRisk: "low" | "medium" | "high") {
  switch (overallRisk) {
    case "high":
      return "At least one overlay field still looks too tight or visually awkward.";
    case "medium":
      return "The form looks mostly usable, but a couple of fields are visually dense.";
    default:
      return "The form overlay looks stable and readable.";
  }
}

function clampTemplateCoordinate(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
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
