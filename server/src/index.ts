import "dotenv/config";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import cors from "cors";
import express from "express";
import mime from "mime-types";
import multer from "multer";

import { createMockReport } from "../../lib/mock";
import { PendingAudio } from "../../types/report";
import { consultationReportSchema } from "./reportSchema";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PORT = Number(process.env.PORT ?? 8787);
const RAW_BASE_URL =
  process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1";
const QWEN_MODEL = process.env.QWEN_MODEL ?? "qwen3.5-plus";
const QWEN_REPAIR_MODEL = process.env.QWEN_REPAIR_MODEL ?? "qwen-flash";
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const execFileAsync = promisify(execFile);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    configured: Boolean(DASHSCOPE_API_KEY),
    baseUrl: normalizeCompatibleBaseUrl(RAW_BASE_URL),
    model: QWEN_MODEL,
  });
});

app.post("/api/process-audio", upload.single("file"), async (req, res) => {
  const startedAt = Date.now();
  const file = req.file;
  const sourceType = parseSourceType(req.body.sourceType);
  const durationSec = parseNullableNumber(req.body.durationSec);

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
      const report = createMockReport(sourceType);
      logRun("mock", startedAt, { reason: "no_api_key" });
      res.json({
        report,
        transcript: report.transcript.fullText,
        detectedLanguage: report.language.detected,
        usedMock: true,
      });
      return;
    }

    const { transcript, actualDurationSec } = await transcribeAudioAsync(
      file.buffer,
      file.mimetype || mime.lookup(file.originalname) || "audio/mpeg",
    );
    const pendingAudio: PendingAudio = {
      ...pendingAudioBase,
      durationSec: actualDurationSec ?? durationSec,
    };
    const report = await extractReportAsync({
      transcript,
      audio: pendingAudio,
    });

    logRun("success", startedAt, {
      sourceType,
      durationSec,
      transcriptLength: transcript.length,
    });

    res.json({
      report,
      transcript,
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
    res.status(500).send(error instanceof Error ? error.message : "Processing failed.");
  }
});

app.listen(PORT, () => {
  console.log(`[elfie-scribe-api] listening on http://0.0.0.0:${PORT}`);
});

async function transcribeAudioAsync(buffer: Buffer, mimeType: string) {
  const prepared = await prepareAudioChunksAsync(buffer, mimeType);

  try {
    const transcripts = await Promise.all(
      prepared.chunks.map(async (chunk) => {
        const dataUrl = `data:audio/mpeg;base64,${chunk.buffer.toString("base64")}`;
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
      }),
    );

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
}: {
  transcript: string;
  audio: PendingAudio;
}) {
  const prompt = [
    "Return JSON only.",
    "You are generating a structured clinical consultation report for a hackathon MVP.",
    "Never invent names, diagnoses, medications, doses, allergies, vitals, or follow-up dates.",
    "If details are missing, use empty arrays, null, or 'unknown' and list the gaps in quality.missingInformation.",
    "If uncertain, capture the uncertainty in quality.ambiguities and lower diagnosis confidence.",
    "Report language must be English while preserving the original transcript text.",
    "Include transcript.fullText exactly as the transcript input.",
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
      fileName: audio.fileName ?? null,
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
  const parsed = await repairAndValidateAsync(content, transcript, audio);

  return parsed;
}

async function repairAndValidateAsync(
  raw: string,
  transcript: string,
  audio: PendingAudio,
) {
  const firstParse = parseJsonLike(raw);
  if (firstParse) {
    const normalized = normalizeReport(firstParse, transcript, audio);
    return consultationReportSchema.parse(normalized);
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

  const repairedText = extractMessageText(repairCompletion);
  const repaired = parseJsonLike(repairedText);

  if (!repaired) {
    throw new Error("Model output was not valid JSON after repair.");
  }

  const normalized = normalizeReport(repaired, transcript, audio);
  return consultationReportSchema.parse(normalized);
}

function normalizeReport(input: unknown, transcript: string, audio: PendingAudio) {
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

async function qwenChatCompletionAsync(body: Record<string, unknown>) {
  const response = await fetch(`${normalizeCompatibleBaseUrl(RAW_BASE_URL)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen request failed (${response.status}): ${text}`);
  }

  return response.json();
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

function parseSourceType(value: unknown): PendingAudio["sourceType"] {
  return value === "recorded" || value === "sample" || value === "imported" ? value : "sample";
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

async function prepareAudioChunksAsync(buffer: Buffer, mimeType: string) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "elfie-audio-"));
  const inputExtension = normalizeExtension(mime.extension(mimeType) || "bin");
  const inputPath = path.join(tempDir, `input.${inputExtension}`);
  const outputPattern = path.join(tempDir, "chunk-%03d.mp3");

  await fs.writeFile(inputPath, buffer);

  const durationSec = await probeDurationAsync(inputPath);
  const needsChunking = buffer.length > 6_500_000 || (durationSec ?? 0) > 290;

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
  const chunks = await Promise.all(
    files.map(async (fileName) => ({
      path: path.join(tempDir, fileName),
      buffer: await fs.readFile(path.join(tempDir, fileName)),
    })),
  );

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

function normalizeExtension(value: string) {
  return value.replace(/^\./, "") || "bin";
}
