import "dotenv/config";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { ConsultationReport, PendingAudio, TranscriptSegment } from "../../types/report";
import { analyzeLabDocumentAsync, LAB_UPLOAD_LIMIT_BYTES } from "./labAnalyzer";
import { labAnalysisReportSchema } from "./labReportSchema";
import { consultationReportSchema } from "./reportSchema";

const app = express();
const AUDIO_UPLOAD_DIR = path.join(os.tmpdir(), "elfie-audio-uploads");
const LAB_UPLOAD_DIR = path.join(os.tmpdir(), "elfie-lab-uploads");
const LAB_UPLOAD_ARCHIVE_DIR = path.resolve(process.env.LAB_UPLOAD_ARCHIVE_DIR ?? path.join(process.cwd(), "lab-upload-attempts"));
mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });
mkdirSync(LAB_UPLOAD_DIR, { recursive: true });
mkdirSync(LAB_UPLOAD_ARCHIVE_DIR, { recursive: true });

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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? null;
const PRIVACY_MODE = parseBoolean(process.env.PRIVACY_MODE, true);
const ASR_CHUNK_CONCURRENCY = clampInteger(parseNullableNumber(process.env.ASR_CHUNK_CONCURRENCY), 1, 3) ?? 3;
const ASR_SEGMENT_SECONDS = clampInteger(parseNullableNumber(process.env.ASR_SEGMENT_SECONDS), 90, 240) ?? 150;
const QWEN_REQUEST_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.QWEN_REQUEST_TIMEOUT_MS), 15_000, 240_000) ?? 180_000;
const CLAUDE_REQUEST_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.CLAUDE_REQUEST_TIMEOUT_MS), 15_000, 240_000) ?? 180_000;
const QWEN_JSON_REPAIR_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.QWEN_JSON_REPAIR_TIMEOUT_MS), 10_000, 60_000) ?? 30_000;
const CONSULTATION_WINDOW_CONCURRENCY =
  clampInteger(parseNullableNumber(process.env.CONSULTATION_WINDOW_CONCURRENCY), 1, 3) ?? 2;
const CONSULTATION_TRANSCRIPT_WINDOW_MAX_CHARS =
  clampInteger(parseNullableNumber(process.env.CONSULTATION_TRANSCRIPT_WINDOW_MAX_CHARS), 2_500, 12_000) ?? 6_000;
const CONSULTATION_TRANSCRIPT_WINDOW_OVERLAP_CHARS =
  clampInteger(parseNullableNumber(process.env.CONSULTATION_TRANSCRIPT_WINDOW_OVERLAP_CHARS), 0, 1_500) ?? 400;
const CONSULTATION_EXTRACTION_WINDOW_TIMEOUT_MS =
  clampInteger(parseNullableNumber(process.env.CONSULTATION_EXTRACTION_WINDOW_TIMEOUT_MS), 15_000, 120_000) ?? 60_000;
const CONSULTATION_SYNTHESIS_TIMEOUT_MS =
  clampInteger(parseNullableNumber(process.env.CONSULTATION_SYNTHESIS_TIMEOUT_MS), 15_000, 180_000) ?? 90_000;
const execFileAsync = promisify(execFile);

type ConsultationTranscriptWindow = {
  index: number;
  startChar: number;
  endChar: number;
  text: string;
};

type ConsultationEvidenceDiagnosis = ConsultationReport["soap"]["assessment"]["diagnoses"][number];
type ConsultationEvidenceSegment = TranscriptSegment;

type ConsultationExtractionEvidence = {
  language?: {
    detected?: string | null;
  };
  visit?: {
    visitReason?: string | null;
    clinicianName?: string | null;
    patientName?: string | null;
    visitType?: ConsultationReport["visit"]["visitType"] | null;
  };
  summary?: {
    oneLiner?: string | null;
    bullets?: string[];
  };
  soap?: {
    subjective?: {
      chiefComplaint?: string | null;
      hpi?: string | null;
      symptoms?: string[];
      history?: string[];
      medicationsMentioned?: string[];
      allergiesMentioned?: string[];
      patientConcerns?: string[];
    };
    objective?: {
      vitals?: string[];
      findings?: string[];
      testsOrResults?: string[];
      observations?: string[];
    };
    assessment?: {
      summary?: string | null;
      diagnoses?: ConsultationEvidenceDiagnosis[];
      differentials?: string[];
      redFlags?: string[];
    };
    plan?: {
      medications?: string[];
      testsOrdered?: string[];
      referrals?: string[];
      followUp?: string[];
      patientInstructions?: string[];
      clinicianTasks?: string[];
      lifestyleAdvice?: string[];
    };
  };
  quality?: {
    missingInformation?: string[];
    ambiguities?: string[];
    notes?: string[];
  };
  transcript?: {
    segments?: ConsultationEvidenceSegment[];
  };
};

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
  const requestId = req.header("x-railway-request-id")?.trim() || randomUUID();
  const sourceType = parseSourceType(req.body?.sourceType);
  const durationSec = parseNullableNumber(req.body?.durationSec);

  if (!file) {
    res.status(400).send("Missing audio file.");
    return;
  }

  try {
    const mimeType = String(file.mimetype || mime.lookup(file.originalname) || "application/octet-stream");
    const sizeBytes = file.size ?? null;
    logRun("received", startedAt, {
      requestId,
      sourceType,
      durationSec,
      mimeType,
      sizeBytes,
    });
    const pendingAudioBase: PendingAudio = {
      uri: file.originalname,
      fileName: file.originalname,
      durationSec,
      mimeType,
      sourceType,
    };

    if (!DASHSCOPE_API_KEY) {
      const report = finalizeReportForStorage(createMockReport(sourceType), pendingAudioBase, PRIVACY_MODE);
      logRun("mock", startedAt, {
        requestId,
        sourceType,
        mimeType,
        sizeBytes,
        reason: "no_api_key",
      });
      res.json({
        report,
        transcript: report.transcript.fullText,
        detectedLanguage: report.language.detected,
        usedMock: true,
      });
      return;
    }

    let transcriptPayload: {
      transcript: string;
      actualDurationSec: number | null;
    };
    try {
      transcriptPayload = await transcribeAudioAsync(file.path);
    } catch (error) {
      throw new Error(`Transcription stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const { transcript, actualDurationSec } = transcriptPayload;
    logRun("transcribed", startedAt, {
      requestId,
      sourceType,
      mimeType,
      sizeBytes,
      actualDurationSec,
      transcriptLength: transcript.length,
    });
    const pendingAudio: PendingAudio = {
      ...pendingAudioBase,
      durationSec: actualDurationSec ?? durationSec,
    };
    const redactedTranscript = PRIVACY_MODE ? redactSensitiveText(transcript) : transcript;
    logRun("extracting_report", startedAt, {
      requestId,
      sourceType,
      mimeType,
      sizeBytes,
      transcriptLength: redactedTranscript.length,
      privacyMode: PRIVACY_MODE,
    });
    let extractedReport: ConsultationReport;
    try {
      extractedReport = await extractReportAsync({
        transcript: redactedTranscript,
        audio: pendingAudio,
        privacyMode: PRIVACY_MODE,
      });
    } catch (error) {
      throw new Error(`Consultation extraction stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    const report = finalizeReportForStorage(extractedReport, pendingAudio, PRIVACY_MODE);

    logRun("success", startedAt, {
      requestId,
      sourceType,
      durationSec,
      mimeType,
      sizeBytes,
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
      requestId,
      sourceType,
      durationSec,
      mimeType: String(file.mimetype || mime.lookup(file.originalname) || "application/octet-stream"),
      sizeBytes: file.size ?? null,
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
  const requestId = req.header("x-railway-request-id")?.trim() || randomUUID();
  const sourceType = parseLabSourceType(req.body?.sourceType);
  const sizeBytes = parseNullableNumber(req.body?.sizeBytes) ?? file?.size ?? null;
  let archivedAttempt:
    | {
        attemptId: string;
        filePath: string;
        metadataPath: string;
      }
    | null = null;

  if (!file) {
    res.status(400).send("Missing lab document file.");
    return;
  }

  const mimeType = file.mimetype || mime.lookup(file.originalname) || "application/octet-stream";
  logRun("received", startedAt, {
    scope: "elfie-analyze-labs",
    requestId,
    sourceType,
    mimeType: String(mimeType),
    sizeBytes,
  });

  archivedAttempt = await archiveLabAttemptInputAsync({
    file,
    mimeType: String(mimeType),
    sourceType,
    sizeBytes,
    requestId,
  });

  if (!isSupportedLabDocumentMimeType(String(mimeType))) {
    logRun("rejected", startedAt, {
      scope: "elfie-analyze-labs",
      requestId,
      attemptId: archivedAttempt?.attemptId ?? null,
      sourceType,
      mimeType: String(mimeType),
      sizeBytes,
      error: "Unsupported lab document MIME type.",
    });
    await finalizeArchivedLabAttemptAsync(archivedAttempt, {
      status: "rejected",
      error: "Unsupported lab document MIME type.",
      httpStatus: 400,
    });
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

    logRun("archived", startedAt, {
      scope: "elfie-analyze-labs",
      requestId,
      attemptId: archivedAttempt?.attemptId ?? null,
      sourceType,
      mimeType: String(mimeType),
      sizeBytes,
    });
    logRun("analyzing", startedAt, {
      scope: "elfie-analyze-labs",
      requestId,
      attemptId: archivedAttempt?.attemptId ?? null,
      sourceType,
      mimeType: String(mimeType),
      sizeBytes,
    });

    let analyzedReport: Awaited<ReturnType<typeof analyzeLabDocumentAsync>>;
    try {
      analyzedReport = await analyzeLabDocumentAsync(file.path, pendingDocument);
    } catch (error) {
      throw new Error(`Lab analysis stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const report = labAnalysisReportSchema.parse(analyzedReport);

    logRun(report.processing.usedMock ? "mock" : "success", startedAt, {
      scope: "elfie-analyze-labs",
      requestId,
      attemptId: archivedAttempt?.attemptId ?? null,
      sourceType,
      mimeType: String(mimeType),
      sizeBytes,
      processingMode: report.processing.mode,
      resultCount: report.results.length,
      pageCount: report.sourceDocument.pageCount ?? null,
    });

    await finalizeArchivedLabAttemptAsync(archivedAttempt, {
      status: report.processing.usedMock ? "mock" : "success",
      mimeType: String(mimeType),
      sourceType,
      sizeBytes,
      processingMode: report.processing.mode,
      resultCount: report.results.length,
      pageCount: report.sourceDocument.pageCount ?? null,
      degradedMode: report.quality.degradedMode,
      warnings: report.quality.warnings,
      processingNotes: report.quality.processingNotes,
      httpStatus: 200,
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
      requestId,
      attemptId: archivedAttempt?.attemptId ?? null,
      sourceType,
      mimeType: String(mimeType),
      sizeBytes,
      error: error instanceof Error ? error.message : "unknown",
    });
    await finalizeArchivedLabAttemptAsync(archivedAttempt, {
      status: "failure",
      mimeType: String(mimeType),
      sourceType,
      sizeBytes,
      error: error instanceof Error ? error.message : "unknown",
      httpStatus: resolveServerErrorStatus(error),
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

async function archiveLabAttemptInputAsync(input: {
  file: Express.Multer.File;
  mimeType: string;
  sourceType: PendingLabDocument["sourceType"];
  sizeBytes: number | null;
  requestId: string;
}) {
  const attemptId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${input.requestId}`;
  const extension = resolveArchiveExtension(input.file.originalname, input.mimeType);
  const safeBaseName = `${attemptId}${extension ? `.${extension}` : ""}`;
  const filePath = path.join(LAB_UPLOAD_ARCHIVE_DIR, safeBaseName);
  const metadataPath = path.join(LAB_UPLOAD_ARCHIVE_DIR, `${attemptId}.json`);

  try {
    await fs.copyFile(input.file.path, filePath);
    await fs.writeFile(
      metadataPath,
      JSON.stringify(
        {
          attemptId,
          requestId: input.requestId,
          receivedAt: new Date().toISOString(),
          originalFileName: input.file.originalname,
          archivedFileName: safeBaseName,
          mimeType: input.mimeType,
          sourceType: input.sourceType,
          sizeBytes: input.sizeBytes,
          status: "received",
        },
        null,
        2,
      ),
      "utf8",
    );

    return { attemptId, filePath, metadataPath };
  } catch (error) {
    console.error("[archive-lab-attempt] failed", error);
    return null;
  }
}

async function finalizeArchivedLabAttemptAsync(
  archivedAttempt: { attemptId: string; filePath: string; metadataPath: string } | null,
  patch: Record<string, unknown>,
) {
  if (!archivedAttempt) {
    return;
  }

  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await fs.readFile(archivedAttempt.metadataPath, "utf8")) as Record<string, unknown>;
    } catch {
      existing = {
        attemptId: archivedAttempt.attemptId,
      };
    }

    await fs.writeFile(
      archivedAttempt.metadataPath,
      JSON.stringify(
        {
          ...existing,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (error) {
    console.error("[archive-lab-attempt] finalize failed", error);
  }
}

function resolveArchiveExtension(fileName: string, mimeType: string) {
  const fromName = path.extname(fileName).replace(/^\./, "").trim().toLowerCase();
  if (fromName) {
    return fromName;
  }

  const fromMime = mime.extension(mimeType);
  return typeof fromMime === "string" ? fromMime.toLowerCase() : "";
}

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
  const windows = buildConsultationTranscriptWindows(transcript);
  const evidenceParts = await mapWithConcurrencyLimit(
    windows,
    Math.min(CONSULTATION_WINDOW_CONCURRENCY, windows.length),
    async (window) => extractConsultationEvidenceWindowAsync(window, windows.length, audio, privacyMode),
  );
  const mergedEvidence = mergeConsultationEvidence(evidenceParts);
  const prompt = buildConsultationSynthesisPrompt(transcript, audio, privacyMode, mergedEvidence, windows.length);

  try {
    const completion = await qwenChatCompletionAsync(
      {
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
      },
      CONSULTATION_SYNTHESIS_TIMEOUT_MS,
    );

    return repairAndValidateAsync(extractMessageText(completion), transcript, audio, privacyMode, mergedEvidence);
  } catch (qwenError) {
    console.warn("[process-audio] qwen consultation synthesis failed, trying fallback", {
      error: qwenError instanceof Error ? qwenError.message : "unknown",
      transcriptLength: transcript.length,
      windows: windows.length,
    });

    if (ANTHROPIC_API_KEY && CLAUDE_MODEL) {
      try {
        const content = await claudeTextCompletionAsync({
          systemPrompt:
            "You are a careful clinical documentation assistant. Return valid JSON only. Never invent facts or identifiers.",
          userPrompt: prompt,
          maxTokens: 3200,
          timeoutMs: CONSULTATION_SYNTHESIS_TIMEOUT_MS,
        });
        return repairAndValidateAsync(content, transcript, audio, privacyMode, mergedEvidence);
      } catch (claudeError) {
        console.warn("[process-audio] claude consultation synthesis fallback failed", {
          error: claudeError instanceof Error ? claudeError.message : "unknown",
          transcriptLength: transcript.length,
          windows: windows.length,
        });
      }
    }

    const heuristicCandidate = buildHeuristicConsultationReportCandidate(
      mergedEvidence,
      qwenError instanceof Error ? qwenError.message : "Consultation synthesis failed.",
    );
    const normalized = mergeReportWithEvidence(normalizeReport(heuristicCandidate, transcript, audio, privacyMode), mergedEvidence);
    return consultationReportSchema.parse(normalized);
  }
}

async function repairAndValidateAsync(
  raw: string,
  transcript: string,
  audio: PendingAudio,
  privacyMode: boolean,
  mergedEvidence?: ConsultationExtractionEvidence,
) {
  const candidate = await parseOrRepairJsonAsync(raw, {
    preferClaude: true,
    repairTimeoutMs: QWEN_JSON_REPAIR_TIMEOUT_MS,
  });
  const normalized = mergeReportWithEvidence(normalizeReport(candidate, transcript, audio, privacyMode), mergedEvidence);
  return consultationReportSchema.parse(normalized);
}

async function extractConsultationEvidenceWindowAsync(
  window: ConsultationTranscriptWindow,
  totalWindows: number,
  audio: PendingAudio,
  privacyMode: boolean,
) {
  const prompt = buildConsultationEvidencePrompt(window, totalWindows, audio, privacyMode);

  try {
    const completion = await qwenChatCompletionAsync(
      {
        model: QWEN_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You extract structured consultation evidence from transcript windows. Output valid JSON only and never invent missing facts.",
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
      },
      CONSULTATION_EXTRACTION_WINDOW_TIMEOUT_MS,
    );

    const parsed = parseJsonLike(extractMessageText(completion));
    if (!parsed) {
      throw new Error("Qwen consultation evidence extraction returned invalid JSON.");
    }

    return normalizeConsultationEvidence(parsed);
  } catch (qwenError) {
    if (ANTHROPIC_API_KEY && CLAUDE_MODEL) {
      try {
        const content = await claudeTextCompletionAsync({
          systemPrompt:
            "You extract structured consultation evidence from transcript windows. Return valid JSON only and never invent facts.",
          userPrompt: prompt,
          maxTokens: 2400,
          timeoutMs: CONSULTATION_EXTRACTION_WINDOW_TIMEOUT_MS,
        });
        const parsed = parseJsonLike(content);
        if (!parsed) {
          throw new Error("Claude consultation evidence extraction returned invalid JSON.");
        }

        const evidence = normalizeConsultationEvidence(parsed);
        return {
          ...evidence,
          quality: {
            ...evidence.quality,
            notes: dedupeStrings([
              ...(evidence.quality?.notes ?? []),
              `Claude evidence fallback was used for transcript window ${window.index + 1}.`,
            ]),
          },
        };
      } catch (claudeError) {
        return buildFallbackConsultationEvidence(window, qwenError, claudeError);
      }
    }

    return buildFallbackConsultationEvidence(window, qwenError);
  }
}

function buildConsultationEvidencePrompt(
  window: ConsultationTranscriptWindow,
  totalWindows: number,
  audio: PendingAudio,
  privacyMode: boolean,
) {
  return [
    "Return JSON only.",
    "You are extracting structured evidence from one window of a clinical consultation transcript.",
    "Never invent names, diagnoses, medications, doses, allergies, vitals, or follow-up dates.",
    "Capture only facts that are grounded in this transcript window.",
    "If a detail is missing or uncertain, use null or an empty array and record it in quality.missingInformation or quality.ambiguities.",
    "Use English for normalized fields while preserving source meaning.",
    "Keep transcript.segments short and limited to the most informative speaker turns from this window.",
    privacyMode
      ? "Privacy mode is enabled. Direct identifiers may already be redacted. Never restore or infer them."
      : "Use names only when clearly present in this transcript window.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        language: {
          detected: "language code|null",
        },
        visit: {
          visitReason: "string|null",
          clinicianName: "string|null",
          patientName: "string|null",
          visitType: "new|follow_up|urgent|unknown|null",
        },
        summary: {
          oneLiner: "string|null",
          bullets: ["string"],
        },
        soap: {
          subjective: {
            chiefComplaint: "string|null",
            hpi: "string|null",
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
            summary: "string|null",
            diagnoses: [{ name: "string", confidence: "confirmed|likely|possible|unclear|null" }],
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
          notes: ["string"],
        },
        transcript: {
          segments: [{ speaker: "doctor|patient|unknown", text: "string", startSec: 0, endSec: 1 }],
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
      windowIndex: window.index + 1,
      totalWindows,
      startChar: window.startChar,
      endChar: window.endChar,
    })}`,
    "",
    `Transcript window:\n${window.text}`,
  ].join("\n");
}

function buildConsultationSynthesisPrompt(
  transcript: string,
  audio: PendingAudio,
  privacyMode: boolean,
  evidence: ConsultationExtractionEvidence,
  windowCount: number,
) {
  return [
    "Return JSON only.",
    "You are generating a structured clinical consultation report for a hackathon MVP.",
    "Never invent names, diagnoses, medications, doses, allergies, vitals, or follow-up dates.",
    "If details are missing, use empty arrays, null, or 'unknown' and list the gaps in quality.missingInformation.",
    "If uncertain, capture the uncertainty in quality.ambiguities and lower diagnosis confidence.",
    "Report language must be English while preserving the original transcript meaning.",
    "Populate transcript.segments with concise, useful speaker turns when possible.",
    "The system will restore transcript.fullText separately, so leave transcript.fullText as an empty string.",
    "Prioritize grounded synthesis from the merged evidence. Use the transcript excerpt only as supporting context.",
    privacyMode
      ? "Privacy mode is enabled. Direct identifiers may already be removed or replaced with placeholders. Never restore, infer, or fabricate them."
      : "If names are genuinely present in the evidence, you may include them.",
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
          fullText: "",
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
      transcriptLength: transcript.length,
      extractionWindows: windowCount,
    })}`,
    "",
    `Merged evidence:\n${JSON.stringify(evidence, null, 2)}`,
    "",
    `Transcript excerpt:\n${buildConsultationTranscriptExcerpt(transcript)}`,
  ].join("\n");
}

function normalizeConsultationEvidence(input: unknown): ConsultationExtractionEvidence {
  const root = readObject(input);
  const visit = readObject(root.visit);
  const summary = readObject(root.summary);
  const soap = readObject(root.soap);
  const subjective = readObject(soap.subjective);
  const objective = readObject(soap.objective);
  const assessment = readObject(soap.assessment);
  const plan = readObject(soap.plan);
  const quality = readObject(root.quality);

  return {
    language: {
      detected: readNullableString(readObject(root.language).detected, null),
    },
    visit: {
      visitReason: readNullableString(visit.visitReason, null),
      clinicianName: readNullableString(visit.clinicianName, null),
      patientName: readNullableString(visit.patientName, null),
      visitType: normalizeConsultationVisitType(visit.visitType, null),
    },
    summary: {
      oneLiner: readNullableString(summary.oneLiner, null),
      bullets: readStringArray(summary.bullets, []),
    },
    soap: {
      subjective: {
        chiefComplaint: readNullableString(subjective.chiefComplaint, null),
        hpi: readNullableString(subjective.hpi, null),
        symptoms: readStringArray(subjective.symptoms, []),
        history: readStringArray(subjective.history, []),
        medicationsMentioned: readStringArray(subjective.medicationsMentioned, []),
        allergiesMentioned: readStringArray(subjective.allergiesMentioned, []),
        patientConcerns: readStringArray(subjective.patientConcerns, []),
      },
      objective: {
        vitals: readStringArray(objective.vitals, []),
        findings: readStringArray(objective.findings, []),
        testsOrResults: readStringArray(objective.testsOrResults, []),
        observations: readStringArray(objective.observations, []),
      },
      assessment: {
        summary: readNullableString(assessment.summary, null),
        diagnoses: normalizeConsultationDiagnosisArray(assessment.diagnoses),
        differentials: readStringArray(assessment.differentials, []),
        redFlags: readStringArray(assessment.redFlags, []),
      },
      plan: {
        medications: readStringArray(plan.medications, []),
        testsOrdered: readStringArray(plan.testsOrdered, []),
        referrals: readStringArray(plan.referrals, []),
        followUp: readStringArray(plan.followUp, []),
        patientInstructions: readStringArray(plan.patientInstructions, []),
        clinicianTasks: readStringArray(plan.clinicianTasks, []),
        lifestyleAdvice: readStringArray(plan.lifestyleAdvice, []),
      },
    },
    quality: {
      missingInformation: readStringArray(quality.missingInformation, []),
      ambiguities: readStringArray(quality.ambiguities, []),
      notes: readStringArray(quality.notes, []),
    },
    transcript: {
      segments: normalizeConsultationSegments(readObject(root.transcript).segments),
    },
  };
}

function buildFallbackConsultationEvidence(
  window: ConsultationTranscriptWindow,
  qwenError: unknown,
  claudeError?: unknown,
): ConsultationExtractionEvidence {
  const notes = [
    `Qwen consultation evidence extraction failed for transcript window ${window.index + 1}: ${
      qwenError instanceof Error ? qwenError.message : "unknown error"
    }`,
  ];

  if (claudeError) {
    notes.push(
      `Claude consultation evidence fallback failed for transcript window ${window.index + 1}: ${
        claudeError instanceof Error ? claudeError.message : "unknown error"
      }`,
    );
  }

  return {
    quality: {
      missingInformation: [`Transcript window ${window.index + 1} required degraded extraction handling.`],
      ambiguities: [],
      notes,
    },
    transcript: {
      segments: buildFallbackTranscriptSegments(window.text, 4),
    },
  };
}

function mergeConsultationEvidence(evidenceParts: ConsultationExtractionEvidence[]) {
  const merged: ConsultationExtractionEvidence = {
    language: { detected: "unknown" },
    visit: {
      visitReason: null,
      clinicianName: null,
      patientName: null,
      visitType: null,
    },
    summary: {
      oneLiner: null,
      bullets: [],
    },
    soap: {
      subjective: {
        chiefComplaint: null,
        hpi: null,
        symptoms: [],
        history: [],
        medicationsMentioned: [],
        allergiesMentioned: [],
        patientConcerns: [],
      },
      objective: {
        vitals: [],
        findings: [],
        testsOrResults: [],
        observations: [],
      },
      assessment: {
        summary: null,
        diagnoses: [],
        differentials: [],
        redFlags: [],
      },
      plan: {
        medications: [],
        testsOrdered: [],
        referrals: [],
        followUp: [],
        patientInstructions: [],
        clinicianTasks: [],
        lifestyleAdvice: [],
      },
    },
    quality: {
      missingInformation: [],
      ambiguities: [],
      notes: [],
    },
    transcript: {
      segments: [],
    },
  };

  for (const evidence of evidenceParts) {
    merged.language!.detected =
      merged.language!.detected && merged.language!.detected !== "unknown"
        ? merged.language!.detected
        : evidence.language?.detected ?? merged.language!.detected;

    merged.visit!.visitReason = preferLongerString(merged.visit!.visitReason, evidence.visit?.visitReason ?? null);
    merged.visit!.clinicianName = preferLongerString(merged.visit!.clinicianName, evidence.visit?.clinicianName ?? null);
    merged.visit!.patientName = preferLongerString(merged.visit!.patientName, evidence.visit?.patientName ?? null);
    merged.visit!.visitType = normalizeConsultationVisitType(evidence.visit?.visitType, merged.visit!.visitType ?? null);

    merged.summary!.oneLiner = preferLongerString(merged.summary!.oneLiner, evidence.summary?.oneLiner ?? null);
    merged.summary!.bullets = dedupeStrings([...(merged.summary!.bullets ?? []), ...(evidence.summary?.bullets ?? [])]);

    merged.soap!.subjective!.chiefComplaint = preferLongerString(
      merged.soap!.subjective!.chiefComplaint,
      evidence.soap?.subjective?.chiefComplaint ?? null,
    );
    merged.soap!.subjective!.hpi = preferLongerString(merged.soap!.subjective!.hpi, evidence.soap?.subjective?.hpi ?? null);
    merged.soap!.subjective!.symptoms = dedupeStrings([
      ...(merged.soap!.subjective!.symptoms ?? []),
      ...(evidence.soap?.subjective?.symptoms ?? []),
    ]);
    merged.soap!.subjective!.history = dedupeStrings([
      ...(merged.soap!.subjective!.history ?? []),
      ...(evidence.soap?.subjective?.history ?? []),
    ]);
    merged.soap!.subjective!.medicationsMentioned = dedupeStrings([
      ...(merged.soap!.subjective!.medicationsMentioned ?? []),
      ...(evidence.soap?.subjective?.medicationsMentioned ?? []),
    ]);
    merged.soap!.subjective!.allergiesMentioned = dedupeStrings([
      ...(merged.soap!.subjective!.allergiesMentioned ?? []),
      ...(evidence.soap?.subjective?.allergiesMentioned ?? []),
    ]);
    merged.soap!.subjective!.patientConcerns = dedupeStrings([
      ...(merged.soap!.subjective!.patientConcerns ?? []),
      ...(evidence.soap?.subjective?.patientConcerns ?? []),
    ]);

    merged.soap!.objective!.vitals = dedupeStrings([...(merged.soap!.objective!.vitals ?? []), ...(evidence.soap?.objective?.vitals ?? [])]);
    merged.soap!.objective!.findings = dedupeStrings([
      ...(merged.soap!.objective!.findings ?? []),
      ...(evidence.soap?.objective?.findings ?? []),
    ]);
    merged.soap!.objective!.testsOrResults = dedupeStrings([
      ...(merged.soap!.objective!.testsOrResults ?? []),
      ...(evidence.soap?.objective?.testsOrResults ?? []),
    ]);
    merged.soap!.objective!.observations = dedupeStrings([
      ...(merged.soap!.objective!.observations ?? []),
      ...(evidence.soap?.objective?.observations ?? []),
    ]);

    merged.soap!.assessment!.summary = preferLongerString(
      merged.soap!.assessment!.summary,
      evidence.soap?.assessment?.summary ?? null,
    );
    merged.soap!.assessment!.diagnoses = mergeDiagnosisLists(
      merged.soap!.assessment!.diagnoses ?? [],
      evidence.soap?.assessment?.diagnoses ?? [],
    );
    merged.soap!.assessment!.differentials = dedupeStrings([
      ...(merged.soap!.assessment!.differentials ?? []),
      ...(evidence.soap?.assessment?.differentials ?? []),
    ]);
    merged.soap!.assessment!.redFlags = dedupeStrings([
      ...(merged.soap!.assessment!.redFlags ?? []),
      ...(evidence.soap?.assessment?.redFlags ?? []),
    ]);

    merged.soap!.plan!.medications = dedupeStrings([...(merged.soap!.plan!.medications ?? []), ...(evidence.soap?.plan?.medications ?? [])]);
    merged.soap!.plan!.testsOrdered = dedupeStrings([
      ...(merged.soap!.plan!.testsOrdered ?? []),
      ...(evidence.soap?.plan?.testsOrdered ?? []),
    ]);
    merged.soap!.plan!.referrals = dedupeStrings([...(merged.soap!.plan!.referrals ?? []), ...(evidence.soap?.plan?.referrals ?? [])]);
    merged.soap!.plan!.followUp = dedupeStrings([...(merged.soap!.plan!.followUp ?? []), ...(evidence.soap?.plan?.followUp ?? [])]);
    merged.soap!.plan!.patientInstructions = dedupeStrings([
      ...(merged.soap!.plan!.patientInstructions ?? []),
      ...(evidence.soap?.plan?.patientInstructions ?? []),
    ]);
    merged.soap!.plan!.clinicianTasks = dedupeStrings([
      ...(merged.soap!.plan!.clinicianTasks ?? []),
      ...(evidence.soap?.plan?.clinicianTasks ?? []),
    ]);
    merged.soap!.plan!.lifestyleAdvice = dedupeStrings([
      ...(merged.soap!.plan!.lifestyleAdvice ?? []),
      ...(evidence.soap?.plan?.lifestyleAdvice ?? []),
    ]);

    merged.quality!.missingInformation = dedupeStrings([
      ...(merged.quality!.missingInformation ?? []),
      ...(evidence.quality?.missingInformation ?? []),
    ]);
    merged.quality!.ambiguities = dedupeStrings([...(merged.quality!.ambiguities ?? []), ...(evidence.quality?.ambiguities ?? [])]);
    merged.quality!.notes = dedupeStrings([...(merged.quality!.notes ?? []), ...(evidence.quality?.notes ?? [])]);
    merged.transcript!.segments = mergeTranscriptSegments(
      merged.transcript!.segments ?? [],
      evidence.transcript?.segments ?? [],
    );
  }

  return merged;
}

function buildHeuristicConsultationReportCandidate(evidence: ConsultationExtractionEvidence, synthesisError: string) {
  const summaryBullets = evidence.summary?.bullets?.length ? evidence.summary.bullets : buildHeuristicSummaryBullets(evidence);
  const summaryLine =
    evidence.summary?.oneLiner ??
    summaryBullets[0] ??
    evidence.soap?.subjective?.chiefComplaint ??
    evidence.visit?.visitReason ??
    "Consultation note generated from partial extraction.";

  return {
    language: {
      detected: evidence.language?.detected ?? "unknown",
      reportLanguage: "en",
    },
    visit: {
      visitReason: evidence.visit?.visitReason ?? evidence.soap?.subjective?.chiefComplaint ?? "",
      clinicianName: evidence.visit?.clinicianName ?? null,
      patientName: evidence.visit?.patientName ?? null,
      visitType: normalizeConsultationVisitType(evidence.visit?.visitType, "unknown") ?? "unknown",
    },
    summary: {
      oneLiner: summaryLine,
      bullets: summaryBullets,
    },
    soap: {
      subjective: {
        chiefComplaint: evidence.soap?.subjective?.chiefComplaint ?? evidence.visit?.visitReason ?? "",
        hpi: evidence.soap?.subjective?.hpi ?? "",
        symptoms: evidence.soap?.subjective?.symptoms ?? [],
        history: evidence.soap?.subjective?.history ?? [],
        medicationsMentioned: evidence.soap?.subjective?.medicationsMentioned ?? [],
        allergiesMentioned: evidence.soap?.subjective?.allergiesMentioned ?? [],
        patientConcerns: evidence.soap?.subjective?.patientConcerns ?? [],
      },
      objective: {
        vitals: evidence.soap?.objective?.vitals ?? [],
        findings: evidence.soap?.objective?.findings ?? [],
        testsOrResults: evidence.soap?.objective?.testsOrResults ?? [],
        observations: evidence.soap?.objective?.observations ?? [],
      },
      assessment: {
        summary: evidence.soap?.assessment?.summary ?? "",
        diagnoses: evidence.soap?.assessment?.diagnoses ?? [],
        differentials: evidence.soap?.assessment?.differentials ?? [],
        redFlags: evidence.soap?.assessment?.redFlags ?? [],
      },
      plan: {
        medications: evidence.soap?.plan?.medications ?? [],
        testsOrdered: evidence.soap?.plan?.testsOrdered ?? [],
        referrals: evidence.soap?.plan?.referrals ?? [],
        followUp: evidence.soap?.plan?.followUp ?? [],
        patientInstructions: evidence.soap?.plan?.patientInstructions ?? [],
        clinicianTasks: evidence.soap?.plan?.clinicianTasks ?? [],
        lifestyleAdvice: evidence.soap?.plan?.lifestyleAdvice ?? [],
      },
    },
    quality: {
      missingInformation: dedupeStrings([
        ...(evidence.quality?.missingInformation ?? []),
        "Full AI consultation synthesis was unavailable, so the report used a merged-evidence fallback.",
      ]),
      ambiguities: dedupeStrings([...(evidence.quality?.ambiguities ?? []), synthesisError]),
    },
    transcript: {
      fullText: "",
      segments: evidence.transcript?.segments?.length ? evidence.transcript.segments : [],
    },
  };
}

function mergeReportWithEvidence(report: ConsultationReport, evidence?: ConsultationExtractionEvidence): ConsultationReport {
  if (!evidence) {
    return report;
  }

  const mergedSegments = mergeTranscriptSegments(report.transcript.segments ?? [], evidence.transcript?.segments ?? []);
  const summaryBullets = dedupeStrings([...report.summary.bullets, ...(evidence.summary?.bullets ?? [])]);

  return {
    ...report,
    language: {
      detected:
        report.language.detected && report.language.detected !== "unknown"
          ? report.language.detected
          : evidence.language?.detected ?? "unknown",
      reportLanguage: "en",
    },
    visit: {
      visitReason:
        report.visit.visitReason ||
        evidence.visit?.visitReason ||
        evidence.soap?.subjective?.chiefComplaint ||
        report.visit.visitReason,
      clinicianName: report.visit.clinicianName ?? evidence.visit?.clinicianName ?? null,
      patientName: report.visit.patientName ?? evidence.visit?.patientName ?? null,
      visitType: normalizeConsultationVisitType(report.visit.visitType, evidence.visit?.visitType ?? "unknown") ?? "unknown",
    },
    summary: {
      oneLiner:
        report.summary.oneLiner ||
        evidence.summary?.oneLiner ||
        summaryBullets[0] ||
        evidence.visit?.visitReason ||
        report.summary.oneLiner,
      bullets: summaryBullets,
    },
    soap: {
      subjective: {
        chiefComplaint:
          report.soap.subjective.chiefComplaint || evidence.soap?.subjective?.chiefComplaint || report.soap.subjective.chiefComplaint,
        hpi: report.soap.subjective.hpi || evidence.soap?.subjective?.hpi || report.soap.subjective.hpi,
        symptoms: dedupeStrings([...report.soap.subjective.symptoms, ...(evidence.soap?.subjective?.symptoms ?? [])]),
        history: dedupeStrings([...report.soap.subjective.history, ...(evidence.soap?.subjective?.history ?? [])]),
        medicationsMentioned: dedupeStrings([
          ...report.soap.subjective.medicationsMentioned,
          ...(evidence.soap?.subjective?.medicationsMentioned ?? []),
        ]),
        allergiesMentioned: dedupeStrings([
          ...report.soap.subjective.allergiesMentioned,
          ...(evidence.soap?.subjective?.allergiesMentioned ?? []),
        ]),
        patientConcerns: dedupeStrings([
          ...report.soap.subjective.patientConcerns,
          ...(evidence.soap?.subjective?.patientConcerns ?? []),
        ]),
      },
      objective: {
        vitals: dedupeStrings([...report.soap.objective.vitals, ...(evidence.soap?.objective?.vitals ?? [])]),
        findings: dedupeStrings([...report.soap.objective.findings, ...(evidence.soap?.objective?.findings ?? [])]),
        testsOrResults: dedupeStrings([
          ...report.soap.objective.testsOrResults,
          ...(evidence.soap?.objective?.testsOrResults ?? []),
        ]),
        observations: dedupeStrings([...report.soap.objective.observations, ...(evidence.soap?.objective?.observations ?? [])]),
      },
      assessment: {
        summary: report.soap.assessment.summary || evidence.soap?.assessment?.summary || report.soap.assessment.summary,
        diagnoses: mergeDiagnosisLists(report.soap.assessment.diagnoses, evidence.soap?.assessment?.diagnoses ?? []),
        differentials: dedupeStrings([
          ...report.soap.assessment.differentials,
          ...(evidence.soap?.assessment?.differentials ?? []),
        ]),
        redFlags: dedupeStrings([...report.soap.assessment.redFlags, ...(evidence.soap?.assessment?.redFlags ?? [])]),
      },
      plan: {
        medications: dedupeStrings([...report.soap.plan.medications, ...(evidence.soap?.plan?.medications ?? [])]),
        testsOrdered: dedupeStrings([...report.soap.plan.testsOrdered, ...(evidence.soap?.plan?.testsOrdered ?? [])]),
        referrals: dedupeStrings([...report.soap.plan.referrals, ...(evidence.soap?.plan?.referrals ?? [])]),
        followUp: dedupeStrings([...report.soap.plan.followUp, ...(evidence.soap?.plan?.followUp ?? [])]),
        patientInstructions: dedupeStrings([
          ...report.soap.plan.patientInstructions,
          ...(evidence.soap?.plan?.patientInstructions ?? []),
        ]),
        clinicianTasks: dedupeStrings([...report.soap.plan.clinicianTasks, ...(evidence.soap?.plan?.clinicianTasks ?? [])]),
        lifestyleAdvice: dedupeStrings([...report.soap.plan.lifestyleAdvice, ...(evidence.soap?.plan?.lifestyleAdvice ?? [])]),
      },
    },
    quality: {
      missingInformation: dedupeStrings([...report.quality.missingInformation, ...(evidence.quality?.missingInformation ?? [])]),
      ambiguities: dedupeStrings([...report.quality.ambiguities, ...(evidence.quality?.ambiguities ?? [])]),
    },
    transcript: {
      fullText: report.transcript.fullText,
      segments: mergedSegments.length ? mergedSegments : report.transcript.segments,
    },
  };
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

function normalizeReport(input: unknown, transcript: string, audio: PendingAudio, privacyMode: boolean): ConsultationReport {
  const report = typeof input === "object" && input ? ({ ...(input as Record<string, unknown>) } as Record<string, unknown>) : {};
  const sourceAudio = readObject(report.sourceAudio);
  const language = readObject(report.language);
  const privacy = readObject(report.privacy);
  const transcriptObject = readObject(report.transcript);
  const visit = readObject(report.visit);

  return {
    id: String(report.id ?? `report-${Date.now()}`),
    createdAt: typeof report.createdAt === "string" ? report.createdAt : new Date().toISOString(),
    sourceAudio: {
      ...sourceAudio,
      fileName: audio.fileName ?? null,
      durationSec: audio.durationSec ?? null,
      sourceType: audio.sourceType,
    },
    language: {
      ...language,
      detected: typeof language.detected === "string" ? language.detected : "unknown",
      reportLanguage: "en",
    },
    privacy: {
      ...privacy,
      mode: privacyMode ? "redacted" : "standard",
      transcriptRedacted: privacyMode,
      transcriptExcludedFromPdf: privacyMode,
    },
    visit: {
      ...visit,
      visitReason: typeof visit.visitReason === "string" ? visit.visitReason : "",
      clinicianName:
        typeof visit.clinicianName === "string" || visit.clinicianName === null ? visit.clinicianName : null,
      patientName: typeof visit.patientName === "string" || visit.patientName === null ? visit.patientName : null,
      visitType: readVisitType(visit.visitType, "unknown"),
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
      segments: Array.isArray(transcriptObject.segments) ? transcriptObject.segments : undefined,
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

async function qwenChatCompletionAsync(body: Record<string, unknown>, timeoutMs = QWEN_REQUEST_TIMEOUT_MS) {
  let response: Response;

  try {
    response = await fetch(`${normalizeCompatibleBaseUrl(RAW_BASE_URL)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Qwen request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen request failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function parseOrRepairJsonAsync(
  raw: string,
  options?: {
    preferClaude?: boolean;
    repairTimeoutMs?: number;
  },
) {
  const parsed = parseJsonLike(raw);
  if (parsed) {
    return parsed;
  }

  const repairTimeoutMs = options?.repairTimeoutMs ?? QWEN_JSON_REPAIR_TIMEOUT_MS;
  const repairOrder = options?.preferClaude ? ["claude", "qwen"] : ["qwen", "claude"];

  for (const strategy of repairOrder) {
    try {
      if (strategy === "claude" && ANTHROPIC_API_KEY && CLAUDE_MODEL) {
        const repairedText = await claudeTextCompletionAsync({
          systemPrompt:
            "Fix the user's malformed JSON into valid JSON only. Do not add markdown fences. Preserve the same information and do not invent missing facts.",
          userPrompt: raw,
          maxTokens: 2400,
          timeoutMs: repairTimeoutMs,
        });
        const repaired = parseJsonLike(repairedText);
        if (repaired) {
          return repaired;
        }
      }

      if (strategy === "qwen") {
        const repairCompletion = await qwenChatCompletionAsync(
          {
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
          },
          repairTimeoutMs,
        );

        const repaired = parseJsonLike(extractMessageText(repairCompletion));
        if (repaired) {
          return repaired;
        }
      }
    } catch {
      continue;
    }
  }

  throw new Error("Model output was not valid JSON after repair.");
}

async function claudeTextCompletionAsync({
  systemPrompt,
  userPrompt,
  maxTokens,
  timeoutMs = CLAUDE_REQUEST_TIMEOUT_MS,
}: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs?: number;
}) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Claude request failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  return Array.isArray(payload.content)
    ? payload.content
        .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
        .join("")
    : "";
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

function normalizeConsultationVisitType(
  value: unknown,
  fallback: ConsultationReport["visit"]["visitType"] | null,
): ConsultationReport["visit"]["visitType"] | null {
  return value === "new" || value === "follow_up" || value === "urgent" || value === "unknown" ? value : fallback;
}

function normalizeConsultationDiagnosisArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as ConsultationReport["soap"]["assessment"]["diagnoses"];
  }

  const diagnoses: ConsultationReport["soap"]["assessment"]["diagnoses"] = [];

  for (const item of value) {
    const diagnosis = readObject(item);
    const name = readNullableString(diagnosis.name, null)?.trim() || null;
    const confidence = readDiagnosisConfidence(diagnosis.confidence, null);
    if (!name || !confidence) {
      continue;
    }

    diagnoses.push({
      name,
      confidence,
    });
  }

  return diagnoses;
}

function normalizeConsultationSegments(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as NonNullable<ConsultationReport["transcript"]["segments"]>;
  }

  const segments: NonNullable<ConsultationReport["transcript"]["segments"]> = [];

  for (const item of value) {
    const segment = readObject(item);
    const text = readNullableString(segment.text, null)?.trim() || null;
    if (!text) {
      continue;
    }

    const normalizedSegment: TranscriptSegment = {
      speaker: normalizeTranscriptSpeaker(segment.speaker),
      text,
    };

    if (typeof segment.startSec === "number" && Number.isFinite(segment.startSec)) {
      normalizedSegment.startSec = segment.startSec;
    }

    if (typeof segment.endSec === "number" && Number.isFinite(segment.endSec)) {
      normalizedSegment.endSec = segment.endSec;
    }

    segments.push(normalizedSegment);
  }

  return segments;
}

function normalizeTranscriptSpeaker(value: unknown): "doctor" | "patient" | "unknown" {
  return value === "doctor" || value === "patient" || value === "unknown" ? value : "unknown";
}

function mergeDiagnosisLists(
  left: ConsultationReport["soap"]["assessment"]["diagnoses"],
  right: ConsultationReport["soap"]["assessment"]["diagnoses"],
) {
  const merged = new Map<string, ConsultationReport["soap"]["assessment"]["diagnoses"][number]>();

  for (const diagnosis of [...left, ...right]) {
    const key = diagnosis.name.trim().toLowerCase();
    const existing = merged.get(key);
    if (!existing || diagnosisConfidenceRank(diagnosis.confidence) > diagnosisConfidenceRank(existing.confidence)) {
      merged.set(key, diagnosis);
    }
  }

  return Array.from(merged.values());
}

function diagnosisConfidenceRank(value: ConsultationReport["soap"]["assessment"]["diagnoses"][number]["confidence"]) {
  switch (value) {
    case "confirmed":
      return 4;
    case "likely":
      return 3;
    case "possible":
      return 2;
    default:
      return 1;
  }
}

function mergeTranscriptSegments(
  left: NonNullable<ConsultationReport["transcript"]["segments"]>,
  right: ConsultationEvidenceSegment[],
) {
  const merged = new Map<string, NonNullable<ConsultationReport["transcript"]["segments"]>[number]>();

  for (const segment of [...left, ...normalizeConsultationSegments(right)]) {
    const text = segment.text.trim();
    if (!text) {
      continue;
    }

    const key = `${segment.speaker}:${text.toLowerCase()}`;
    if (!merged.has(key)) {
      merged.set(key, segment);
    }
  }

  return Array.from(merged.values()).slice(0, 24);
}

function preferLongerString(current: string | null | undefined, candidate: string | null | undefined) {
  const normalizedCurrent = typeof current === "string" ? current.trim() : "";
  const normalizedCandidate = typeof candidate === "string" ? candidate.trim() : "";

  if (!normalizedCandidate) {
    return normalizedCurrent || null;
  }

  if (!normalizedCurrent || normalizedCandidate.length > normalizedCurrent.length + 8) {
    return normalizedCandidate;
  }

  return normalizedCurrent;
}

function buildConsultationTranscriptWindows(transcript: string) {
  const normalized = transcript.trim();
  if (!normalized) {
    return [{ index: 0, startChar: 0, endChar: 0, text: "" }] satisfies ConsultationTranscriptWindow[];
  }

  const windows: ConsultationTranscriptWindow[] = [];
  let startChar = 0;

  while (startChar < normalized.length) {
    let endChar = Math.min(normalized.length, startChar + CONSULTATION_TRANSCRIPT_WINDOW_MAX_CHARS);
    if (endChar < normalized.length) {
      const boundary = findTranscriptBoundary(normalized, startChar, endChar);
      if (boundary > startChar + Math.floor(CONSULTATION_TRANSCRIPT_WINDOW_MAX_CHARS * 0.6)) {
        endChar = boundary;
      }
    }

    const text = normalized.slice(startChar, endChar).trim();
    if (text) {
      windows.push({
        index: windows.length,
        startChar,
        endChar,
        text,
      });
    }

    if (endChar >= normalized.length) {
      break;
    }

    startChar = Math.max(endChar - CONSULTATION_TRANSCRIPT_WINDOW_OVERLAP_CHARS, startChar + 1);
  }

  return windows.length
    ? windows
    : [{ index: 0, startChar: 0, endChar: normalized.length, text: normalized }];
}

function findTranscriptBoundary(text: string, startChar: number, endChar: number) {
  const window = text.slice(startChar, endChar);
  const candidateOffsets = [
    window.lastIndexOf("\n\n"),
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
    window.lastIndexOf("\n"),
    window.lastIndexOf(" "),
  ].filter((offset) => offset > 0);

  if (!candidateOffsets.length) {
    return endChar;
  }

  return startChar + Math.max(...candidateOffsets) + 1;
}

function buildConsultationTranscriptExcerpt(transcript: string) {
  const normalized = transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  if (normalized.length <= 4_000) {
    return normalized;
  }

  const head = normalized.slice(0, 1_800).trim();
  const middleStart = Math.max(0, Math.floor(normalized.length / 2) - 500);
  const middle = normalized.slice(middleStart, middleStart + 1_000).trim();
  const tail = normalized.slice(-1_200).trim();

  return [head, "[... transcript condensed for synthesis ...]", middle, "[...]", tail].join("\n\n");
}

function buildFallbackTranscriptSegments(text: string, maxSegments: number) {
  return text
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxSegments)
    .map((line) => ({
      speaker: "unknown" as const,
      text: line.length > 320 ? `${line.slice(0, 317).trim()}...` : line,
    }));
}

function buildHeuristicSummaryBullets(evidence: ConsultationExtractionEvidence) {
  const bullets = [
    evidence.visit?.visitReason ? `Visit reason: ${evidence.visit.visitReason}` : null,
    evidence.soap?.subjective?.chiefComplaint ? `Chief complaint: ${evidence.soap.subjective.chiefComplaint}` : null,
    ...(evidence.soap?.subjective?.symptoms ?? []).slice(0, 3).map((item) => `Symptom: ${item}`),
    ...(evidence.soap?.objective?.findings ?? []).slice(0, 2).map((item) => `Finding: ${item}`),
    ...(evidence.soap?.objective?.testsOrResults ?? []).slice(0, 2).map((item) => `Test/result: ${item}`),
    ...(evidence.soap?.plan?.followUp ?? []).slice(0, 2).map((item) => `Follow-up: ${item}`),
  ].filter((item): item is string => Boolean(item));

  return dedupeStrings(bullets).slice(0, 6);
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
      String(ASR_SEGMENT_SECONDS),
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
