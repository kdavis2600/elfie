import "dotenv/config";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createCanvas } from "@napi-rs/canvas";

import { createMockLabReport } from "../../lib/mockLab";
import {
  LabActionabilityBucket,
  LabAbnormalFinding,
  LabAnalysisReport,
  LabDocumentSourceType,
  LabExtractionMethod,
  LabFlag,
  LabProcessingMode,
  LabResultRow,
  LabSeverity,
  PendingLabDocument,
} from "../../types/labReport";
import { labAnalysisReportSchema } from "./labReportSchema";

export const LAB_UPLOAD_LIMIT_BYTES = 15 * 1024 * 1024;

const RAW_BASE_URL =
  process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1";
const QWEN_MODEL = process.env.QWEN_MODEL ?? "qwen3.5-plus";
const QWEN_LAB_REASONING_MODEL = process.env.QWEN_LAB_REASONING_MODEL ?? QWEN_MODEL;
const QWEN_LAB_VISION_MODEL = process.env.QWEN_LAB_VISION_MODEL ?? "qwen-vl-max-latest";
const QWEN_REPAIR_MODEL = process.env.QWEN_REPAIR_MODEL ?? "qwen-flash";
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? null;
const QWEN_REQUEST_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.QWEN_REQUEST_TIMEOUT_MS), 15_000, 240_000) ?? 180_000;
const CLAUDE_REQUEST_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.CLAUDE_REQUEST_TIMEOUT_MS), 15_000, 240_000) ?? 180_000;
const QWEN_JSON_REPAIR_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.QWEN_JSON_REPAIR_TIMEOUT_MS), 10_000, 60_000) ?? 30_000;
const QWEN_LAB_VISION_TIMEOUT_MS = clampInteger(parseNullableNumber(process.env.QWEN_LAB_VISION_TIMEOUT_MS), 15_000, 120_000) ?? 60_000;
const QWEN_LAB_EXTRACTION_TIMEOUT_MS =
  clampInteger(parseNullableNumber(process.env.QWEN_LAB_EXTRACTION_TIMEOUT_MS), 15_000, 120_000) ?? 75_000;
const QWEN_LAB_REASONING_TIMEOUT_MS =
  clampInteger(parseNullableNumber(process.env.QWEN_LAB_REASONING_TIMEOUT_MS), 15_000, 150_000) ?? 90_000;
const LAB_EXTRACTION_BATCH_MAX_CHARS =
  clampInteger(parseNullableNumber(process.env.LAB_EXTRACTION_BATCH_MAX_CHARS), 3_000, 24_000) ?? 9_000;
const LAB_EXTRACTION_BATCH_MAX_PAGES =
  clampInteger(parseNullableNumber(process.env.LAB_EXTRACTION_BATCH_MAX_PAGES), 1, 4) ?? 2;
const LAB_EXTRACTION_BATCH_CONCURRENCY =
  clampInteger(parseNullableNumber(process.env.LAB_EXTRACTION_BATCH_CONCURRENCY), 1, 3) ?? 2;
const LAB_EXTRACTION_PAGE_MAX_CHARS =
  clampInteger(parseNullableNumber(process.env.LAB_EXTRACTION_PAGE_MAX_CHARS), 1_500, 8_000) ?? 4_500;
const LAB_EXTRACTION_PAGE_MAX_LINES =
  clampInteger(parseNullableNumber(process.env.LAB_EXTRACTION_PAGE_MAX_LINES), 25, 200) ?? 90;
const execFileAsync = promisify(execFile);

type ExtractedLabPage = {
  pageNumber: number;
  text: string;
  extractionMethod: LabExtractionMethod;
};

type PreparedLabExtractionPage = ExtractedLabPage & {
  compactText: string;
};

type ExtractedLabDocument = {
  pageCount: number;
  pages: ExtractedLabPage[];
  sourceText: string;
  pagesWithExtractionFailures: number[];
};

type LocalOcrResult = {
  text: string;
  averageConfidence: number | null;
  wordCount: number;
};

type LabExtractionBatch = {
  pages: PreparedLabExtractionPage[];
  charCount: number;
};

type LabBatchExtractionOutcome = {
  candidate: LabExtractionCandidate | null;
  warnings: string[];
  processingNotes: string[];
  usedClaude: boolean;
};

type LabExtractionResult = {
  candidate: LabExtractionCandidate;
  warnings: string[];
  processingNotes: string[];
  extractionModel: string | null;
};

type LabExtractionCandidate = {
  language?: {
    detected?: string | null;
  };
  patient?: {
    name?: string | null;
    sex?: string | null;
    ageText?: string | null;
    patientLabel?: string | null;
  };
  quality?: {
    missingInformation?: string[];
    ambiguities?: string[];
  };
  results?: Array<{
    testNameRaw?: string | null;
    testNameCanonical?: string | null;
    panelName?: string | null;
    valueRaw?: string | null;
    unit?: string | null;
    referenceRangeRaw?: string | null;
    flagHint?: string | null;
    pageNumber?: number | null;
    sourceSnippet?: string | null;
    sourceRowText?: string | null;
    extractionMethod?: string | null;
    confidence?: number | null;
  }>;
};

type LabReasoningPayload = {
  summary?: {
    headline?: string | null;
    bullets?: string[];
    overallRisk?: string | null;
  };
  abnormalFindings?: Array<{
    id?: string | null;
    title?: string | null;
    severity?: string | null;
    explanation?: string | null;
    relatedResultIds?: string[];
    actionability?: string | null;
  }>;
  nextSteps?: {
    urgentAttention?: string[];
    discussWithClinicianSoon?: string[];
    routineFollowUpOrMonitoring?: string[];
  };
  resultInsights?: Array<{
    resultId?: string | null;
    severity?: string | null;
    clinicalMeaning?: string | null;
    patientExplanation?: string | null;
    recommendedFollowUp?: string | null;
  }>;
  quality?: {
    missingInformation?: string[];
    ambiguities?: string[];
    warnings?: string[];
    processingNotes?: string[];
  };
};

export async function analyzeLabDocumentAsync(inputPath: string, pendingDocument: PendingLabDocument): Promise<LabAnalysisReport> {
  if (!DASHSCOPE_API_KEY) {
    return finalizeLabReportForStorage(createMockLabReport(pendingDocument.sourceType), pendingDocument);
  }

  let extractedDocument: ExtractedLabDocument;
  try {
    extractedDocument = await extractLabDocumentAsync(inputPath, pendingDocument.mimeType ?? null);
  } catch (error) {
    throw new Error(`Document extraction stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  let extraction: LabExtractionResult;
  try {
    extraction = await extractLabCandidateAsync(extractedDocument, pendingDocument);
  } catch (error) {
    throw new Error(`Structured extraction stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  let normalizedReport: LabAnalysisReport;
  try {
    normalizedReport = buildNormalizedLabReport(extraction, extractedDocument, pendingDocument);
  } catch (error) {
    throw new Error(`Normalization stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  if (shouldRetryImageExtractionWithVision(pendingDocument, extractedDocument, normalizedReport)) {
    try {
      extractedDocument = await extractLabDocumentAsync(inputPath, pendingDocument.mimeType ?? null, {
        forceImageVision: true,
      });
      extraction = await extractLabCandidateAsync(extractedDocument, pendingDocument);
    } catch (error) {
      throw new Error(`Vision retry stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const retriedReport = buildNormalizedLabReport(extraction, extractedDocument, pendingDocument);
    normalizedReport = {
      ...retriedReport,
      quality: {
        ...retriedReport.quality,
        processingNotes: dedupeStrings([
          ...retriedReport.quality.processingNotes,
          "Initial local OCR extraction was insufficient, so the image was retried with Qwen vision extraction.",
        ]),
      },
    };
  }

  let enrichedReport: LabAnalysisReport;
  try {
    enrichedReport = await enrichLabReportAsync(normalizedReport);
  } catch (error) {
    throw new Error(`Reasoning stage failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return finalizeLabReportForStorage(enrichedReport, pendingDocument);
}

async function extractLabDocumentAsync(
  inputPath: string,
  mimeType: string | null,
  options?: { forceImageVision?: boolean },
): Promise<ExtractedLabDocument> {
  const resolvedMimeType = String(mimeType ?? "").toLowerCase();

  if (resolvedMimeType.includes("pdf")) {
    return extractLabPdfAsync(inputPath);
  }

  if (resolvedMimeType.includes("image")) {
    const extraction = await extractTextFromImageAsync(inputPath, mimeType ?? "image/jpeg", options?.forceImageVision ?? false);

    return {
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          text: extraction.text,
          extractionMethod: extraction.extractionMethod,
        },
      ],
      sourceText: extraction.text,
      pagesWithExtractionFailures: extraction.text.trim() ? [] : [1],
    };
  }

  throw new Error("Lab analysis supports PDF and image uploads only.");
}

async function extractTextFromImageAsync(inputPath: string, mimeType: string, forceVision = false) {
  const preparedImage = await prepareImageForExtractionAsync(inputPath);
  try {
    let fallbackOcrText = "";

    try {
      const ocrResult = await extractTextWithLocalOcrAsync(preparedImage.normalizedPath);
      fallbackOcrText = ocrResult.text;
      if (!forceVision && shouldUseLocalOcr(ocrResult)) {
        return {
          text: ocrResult.text,
          extractionMethod: "ocr" as const,
        };
      }
    } catch {
      // Fall through to Qwen vision when local OCR is unavailable or fails.
    }
    try {
      const dataUrl = await createVisionImageDataUrlAsync(inputPath, mimeType);
      const text = await extractVisibleTextFromImageAsync(dataUrl, "lab image");

      return {
        text,
        extractionMethod: "vision" as const,
      };
    } catch {
      return {
        text: fallbackOcrText,
        extractionMethod: fallbackOcrText.trim() ? ("ocr" as const) : ("unknown" as const),
      };
    }
  } finally {
    await fs.rm(preparedImage.tempDir, { recursive: true, force: true });
  }
}

async function extractLabPdfAsync(inputPath: string): Promise<ExtractedLabDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fileBuffer = await fs.readFile(inputPath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages: ExtractedLabPage[] = [];
  const pagesWithExtractionFailures: number[] = [];

  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    let extractedText = "";

    try {
      const textContent = await page.getTextContent();
      extractedText = rebuildPdfText(textContent.items ?? []);
    } catch {
      extractedText = "";
    }

    if (extractedText.trim().length >= 24) {
      pages.push({
        pageNumber: index,
        text: extractedText,
        extractionMethod: "text",
      });
      continue;
    }

    let visionText = "";

    try {
      const dataUrl = await renderPdfPageDataUrlAsync(page);
      visionText = await extractVisibleTextFromImageAsync(dataUrl, `lab pdf page ${index}`);
    } catch {
      visionText = "";
    }

    if (!visionText.trim()) {
      pagesWithExtractionFailures.push(index);
    }

    pages.push({
      pageNumber: index,
      text: visionText,
      extractionMethod: visionText.trim() ? "vision" : "unknown",
    });
  }

  return {
    pageCount: pdf.numPages,
    pages,
    sourceText: pages.map((page) => `Page ${page.pageNumber}\n${page.text}`.trim()).join("\n\n"),
    pagesWithExtractionFailures,
  };
}

function rebuildPdfText(items: any[]) {
  const lines = items
    .map((item) => {
      const str = typeof item?.str === "string" ? item.str.trim() : "";
      const x = Number(item?.transform?.[4] ?? 0);
      const y = Number(item?.transform?.[5] ?? 0);

      if (!str) {
        return null;
      }

      return { str, x, y };
    })
    .filter((item): item is { str: string; x: number; y: number } => Boolean(item))
    .sort((left, right) => {
      if (Math.abs(right.y - left.y) > 3) {
        return right.y - left.y;
      }
      return left.x - right.x;
    });

  const grouped: Array<Array<{ str: string; x: number; y: number }>> = [];

  for (const item of lines) {
    const current = grouped[grouped.length - 1];
    if (!current || Math.abs(current[0].y - item.y) > 3) {
      grouped.push([item]);
      continue;
    }

    current.push(item);
  }

  return grouped
    .map((line) => line.sort((left, right) => left.x - right.x).map((item) => item.str).join(" ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function renderPdfPageDataUrlAsync(page: any) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  await page.render({
    canvasContext: context as never,
    canvas: canvas as never,
    viewport,
  }).promise;

  const pngBuffer = await canvas.encode("png");
  return `data:image/png;base64,${pngBuffer.toString("base64")}`;
}

async function extractVisibleTextFromImageAsync(dataUrl: string, label: string) {
  const response = await qwenChatCompletionAsync(
    {
      model: QWEN_LAB_VISION_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Extract visible text from lab report images. Preserve line breaks, numbers, test names, units, flags, and reference ranges. Do not summarize.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract the visible text from this ${label}. Return plain text only.`,
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      enable_thinking: false,
    },
    QWEN_LAB_VISION_TIMEOUT_MS,
  );

  return extractMessageText(response).trim();
}

async function extractLabCandidateAsync(
  extractedDocument: ExtractedLabDocument,
  pendingDocument: PendingLabDocument,
): Promise<LabExtractionResult> {
  const batches = buildLabExtractionBatches(extractedDocument.pages);
  const candidates: LabExtractionCandidate[] = [];
  const warnings: string[] = [];
  const processingNotes: string[] = [];
  let extractionModel: string | null = QWEN_MODEL;

  const outcomes = await mapWithConcurrencyLimit(
    batches,
    Math.min(LAB_EXTRACTION_BATCH_CONCURRENCY, batches.length || 1),
    async (batch): Promise<LabBatchExtractionOutcome> => {
      try {
        return {
          candidate: await extractLabCandidateBatchWithQwenAsync(batch, pendingDocument, extractedDocument.pageCount),
          warnings: [],
          processingNotes: [],
          usedClaude: false,
        };
      } catch (error) {
        const batchLabel = formatBatchLabel(batch);
        const nextProcessingNotes = [
          `Qwen extraction failed for ${batchLabel}: ${error instanceof Error ? error.message : "unknown error"}`,
        ];

        if (ANTHROPIC_API_KEY && CLAUDE_MODEL) {
          try {
            return {
              candidate: await extractLabCandidateBatchWithClaudeAsync(batch, pendingDocument, extractedDocument.pageCount),
              warnings: [`Claude extraction fallback was used for ${batchLabel} after a Qwen extraction failure.`],
              processingNotes: nextProcessingNotes,
              usedClaude: true,
            };
          } catch (fallbackError) {
            nextProcessingNotes.push(
              `Claude extraction fallback failed for ${batchLabel}: ${
                fallbackError instanceof Error ? fallbackError.message : "unknown error"
              }`,
            );
          }
        }

        return {
          candidate: null,
          warnings: [`A portion of the uploaded lab document could not be fully extracted from ${batchLabel}.`],
          processingNotes: nextProcessingNotes,
          usedClaude: false,
        };
      }
    },
  );

  for (const outcome of outcomes) {
    if (outcome.candidate) {
      candidates.push(outcome.candidate);
    }
    warnings.push(...outcome.warnings);
    processingNotes.push(...outcome.processingNotes);
    if (outcome.usedClaude && CLAUDE_MODEL) {
      extractionModel = `${QWEN_MODEL} + ${CLAUDE_MODEL}`;
    }
  }

  let candidate = mergeLabExtractionCandidates(candidates);

  if (!Array.isArray(candidate.results) || candidate.results.length === 0) {
    const heuristicCandidate = buildHeuristicLabExtractionCandidate(extractedDocument);
    if (Array.isArray(heuristicCandidate.results) && heuristicCandidate.results.length) {
      candidate = mergeLabExtractionCandidates([candidate, heuristicCandidate]);
      extractionModel = extractionModel ? `${extractionModel} + heuristic` : "heuristic";
      warnings.push("Heuristic lab-row parsing was used because model-based extraction did not return structured rows.");
      processingNotes.push("Fallback heuristic parsing extracted lab-like rows from the source text.");
    }
  }

  if (batches.length > 1) {
    processingNotes.push(
      `The uploaded document was processed in ${batches.length} extraction batch${batches.length === 1 ? "" : "es"} to avoid long-running model timeouts.`,
    );
  }

  return {
    candidate,
    warnings: dedupeStrings(warnings),
    processingNotes: dedupeStrings(processingNotes),
    extractionModel,
  };
}

async function extractLabCandidateBatchWithQwenAsync(
  batch: LabExtractionBatch,
  pendingDocument: PendingLabDocument,
  pageCount: number,
) {
  const prompt = buildLabExtractionPrompt(batch, pendingDocument, pageCount);
  const completion = await qwenChatCompletionAsync(
    {
      model: QWEN_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a careful lab-data extraction assistant. Output only valid JSON and keep raw fields faithful to the source.",
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
    QWEN_LAB_EXTRACTION_TIMEOUT_MS,
  );

  const parsed = parseJsonLike(extractMessageText(completion));
  if (!parsed) {
    throw new Error("Qwen extraction returned invalid JSON.");
  }

  return (readObject(parsed) as LabExtractionCandidate) ?? {};
}

async function extractLabCandidateBatchWithClaudeAsync(
  batch: LabExtractionBatch,
  pendingDocument: PendingLabDocument,
  pageCount: number,
) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system:
        "You extract structured laboratory results from documents. Return valid JSON only. Keep raw source fields faithful and never invent missing values.",
      messages: [
        {
          role: "user",
          content: buildLabExtractionPrompt(batch, pendingDocument, pageCount),
        },
      ],
    }),
    signal: AbortSignal.timeout(CLAUDE_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Claude extraction request failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = Array.isArray(payload.content)
    ? payload.content
        .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
        .join("")
    : "";
  const parsed = parseJsonLike(text);
  if (!parsed) {
    throw new Error("Claude extraction output was not valid JSON.");
  }

  return (readObject(parsed) as LabExtractionCandidate) ?? {};
}

function buildLabExtractionPrompt(
  batch: LabExtractionBatch,
  pendingDocument: PendingLabDocument,
  pageCount: number,
) {
  const sourcePayload = batch.pages
    .map((page) => `Page ${page.pageNumber} [${page.extractionMethod}]\n${page.compactText}`.trim())
    .join("\n\n");

  return [
    "Return JSON only.",
    "You are extracting structured laboratory results from a patient lab report.",
    "Never invent tests, values, ranges, units, patient identity, or page numbers.",
    "If a field is missing or unclear, use null or an empty array.",
    "Capture every lab result row you can find, even if some fields are incomplete.",
    "Use English for canonical field names, but preserve the source wording in raw fields.",
    "Set confidence on a 0 to 1 scale.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        language: { detected: "language code" },
        patient: {
          name: "string|null",
          sex: "string|null",
          ageText: "string|null",
          patientLabel: "string|null",
        },
        quality: {
          missingInformation: ["string"],
          ambiguities: ["string"],
        },
        results: [
          {
            testNameRaw: "string",
            testNameCanonical: "string|null",
            panelName: "string|null",
            valueRaw: "string",
            unit: "string|null",
            referenceRangeRaw: "string|null",
            flagHint: "high|low|normal|unknown|null",
            pageNumber: 1,
            sourceSnippet: "string|null",
            sourceRowText: "string|null",
            extractionMethod: "text|ocr|vision|unknown",
            confidence: 0.5,
          },
        ],
      },
      null,
      2,
    ),
    "",
    `Source metadata: ${JSON.stringify({
      fileName: null,
      mimeType: pendingDocument.mimeType ?? null,
      sourceType: pendingDocument.sourceType,
      pageCount,
      batchPageNumbers: batch.pages.map((page) => page.pageNumber),
    })}`,
    "",
    `Source text:\n${sourcePayload}`,
  ].join("\n");
}

function buildLabExtractionBatches(pages: ExtractedLabPage[]) {
  const preparedPages = pages
    .map((page) => ({
      ...page,
      compactText: compactLabPageText(page.text),
    }))
    .filter((page) => page.compactText.trim());

  if (!preparedPages.length) {
    return [] as LabExtractionBatch[];
  }

  const batches: LabExtractionBatch[] = [];
  let currentPages: PreparedLabExtractionPage[] = [];
  let currentChars = 0;

  for (const page of preparedPages) {
    const payloadLength = page.compactText.length + 48;
    const wouldOverflow =
      currentPages.length > 0 &&
      (currentPages.length >= LAB_EXTRACTION_BATCH_MAX_PAGES || currentChars + payloadLength > LAB_EXTRACTION_BATCH_MAX_CHARS);

    if (wouldOverflow) {
      batches.push({
        pages: currentPages,
        charCount: currentChars,
      });
      currentPages = [];
      currentChars = 0;
    }

    currentPages.push(page);
    currentChars += payloadLength;
  }

  if (currentPages.length) {
    batches.push({
      pages: currentPages,
      charCount: currentChars,
    });
  }

  return batches;
}

function compactLabPageText(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (!lines.length) {
    return "";
  }

  const prioritized = [
    ...lines.filter(isLikelyLabDataLine),
    ...lines.filter((line) => isLikelyLabContextLine(line) && !isLikelyLabDataLine(line)),
  ];
  const selected = prioritized.length ? prioritized : lines;
  const uniqueLines: string[] = [];
  const seen = new Set<string>();

  for (const line of selected) {
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueLines.push(line);
    if (uniqueLines.length >= LAB_EXTRACTION_PAGE_MAX_LINES) {
      break;
    }
  }

  return uniqueLines.join("\n").slice(0, LAB_EXTRACTION_PAGE_MAX_CHARS);
}

function isLikelyLabDataLine(line: string) {
  if (line.length < 4 || !/[A-Za-z]/.test(line) || !/\d/.test(line)) {
    return false;
  }

  return (
    /(-?\d[\d,.]*)\s*(?:-|to)\s*(-?\d[\d,.]*)/i.test(line) ||
    /(?:<=?|>=?|up to|under|over)\s*-?\d[\d,.]*/i.test(line) ||
    /\b(?:mg\/dL|mmol\/L|g\/dL|IU\/L|U\/L|pg\/mL|ng\/mL|cells?\/u?L|x10\^?\d+\/L|%)\b/i.test(line) ||
    /\b(?:high|low|normal|positive|negative|reactive|nonreactive|critical|abnormal)\b/i.test(line)
  );
}

function isLikelyLabContextLine(line: string) {
  return /\b(?:result|outcome|conclusion|interpretation|specimen|sample|hemolysis|reference range|flag|panel)\b/i.test(line);
}

function formatBatchLabel(batch: LabExtractionBatch) {
  const pageNumbers = batch.pages.map((page) => page.pageNumber);
  if (!pageNumbers.length) {
    return "an empty page batch";
  }

  return pageNumbers.length === 1
    ? `page ${pageNumbers[0]}`
    : `pages ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]}`;
}

function mergeLabExtractionCandidates(candidates: LabExtractionCandidate[]) {
  const mergedResults = candidates.flatMap((candidate) => (Array.isArray(candidate.results) ? candidate.results : []));
  const missingInformation = dedupeStrings(
    candidates.flatMap((candidate) => readStringArray(candidate.quality?.missingInformation)),
  );
  const ambiguities = dedupeStrings(candidates.flatMap((candidate) => readStringArray(candidate.quality?.ambiguities)));
  const candidateWithPatient = candidates.find((candidate) => {
    const patient = candidate.patient ?? {};
    return Boolean(patient.name || patient.sex || patient.ageText || patient.patientLabel);
  });
  const candidateWithLanguage = candidates.find((candidate) => readNullableString(candidate.language?.detected)?.trim());

  return {
    language: {
      detected: readNullableString(candidateWithLanguage?.language?.detected)?.trim() || null,
    },
    patient: {
      name: readNullableString(candidateWithPatient?.patient?.name)?.trim() || null,
      sex: readNullableString(candidateWithPatient?.patient?.sex)?.trim() || null,
      ageText: readNullableString(candidateWithPatient?.patient?.ageText)?.trim() || null,
      patientLabel: readNullableString(candidateWithPatient?.patient?.patientLabel)?.trim() || null,
    },
    quality: {
      missingInformation,
      ambiguities,
    },
    results: mergedResults,
  };
}

function buildHeuristicLabExtractionCandidate(extractedDocument: ExtractedLabDocument): LabExtractionCandidate {
  const results = extractedDocument.pages.flatMap((page) => {
    const parsedRows = page.text
      .split(/\n+/)
      .map((line) => parseHeuristicLabResultLine(line, page.pageNumber, page.extractionMethod))
      .filter(Boolean);

    return parsedRows as NonNullable<LabExtractionCandidate["results"]>;
  });

  return {
    quality: {
      missingInformation: [],
      ambiguities: results.length ? ["Some lab rows were parsed heuristically because structured extraction was incomplete."] : [],
    },
    results,
  };
}

function parseHeuristicLabResultLine(
  rawLine: string,
  pageNumber: number,
  extractionMethod: LabExtractionMethod,
) {
  const line = rawLine.replace(/\s+/g, " ").trim();
  if (!isLikelyLabDataLine(line) || line.length > 220) {
    return null;
  }

  const valueTokenMatches = [...line.matchAll(/-?\d[\d,.]*/g)];
  const valueToken = valueTokenMatches[0]?.[0] ?? null;
  const valueIndex = valueToken ? line.indexOf(valueToken) : -1;
  const testName = valueIndex > 0 ? line.slice(0, valueIndex).replace(/[:\-–]+$/, "").trim() : "";

  if (!testName || !valueToken) {
    return null;
  }

  const rangeMatch = line.match(/(-?\d[\d,.]*)\s*(?:-|to)\s*(-?\d[\d,.]*)/i);
  const referenceRangeRaw = rangeMatch ? rangeMatch[0] : null;
  const trailingText = line.slice(valueIndex + valueToken.length).trim();
  const unit = trailingText
    .replace(referenceRangeRaw ?? "", "")
    .match(/[A-Za-z%/][A-Za-z0-9%/^.:-]*/)?.[0] ?? null;

  return {
    testNameRaw: testName,
    testNameCanonical: null,
    panelName: null,
    valueRaw: valueToken,
    unit,
    referenceRangeRaw,
    flagHint:
      /\bhigh\b/.test(line) || /\bH\b/.test(line)
        ? "high"
        : /\blow\b/.test(line) || /\bL\b/.test(line)
          ? "low"
          : null,
    pageNumber,
    sourceSnippet: line.slice(0, 160),
    sourceRowText: line,
    extractionMethod,
    confidence: 0.2,
  };
}

function buildNormalizedLabReport(
  extraction: LabExtractionResult,
  extractedDocument: ExtractedLabDocument,
  pendingDocument: PendingLabDocument,
): LabAnalysisReport {
  const extractionUsedClaude = Boolean(CLAUDE_MODEL && extraction.extractionModel?.includes(CLAUDE_MODEL));
  const candidate = extraction.candidate;
  const rawResults = Array.isArray(candidate.results) ? candidate.results : [];
  const normalizedResults = rawResults
    .map((row, index) => normalizeLabResultRow(row, index))
    .filter((row): row is LabResultRow => Boolean(row));
  const dedupedResults = dedupeLabResultRows(normalizedResults);
  const documentFindings = extractDocumentFindings(extractedDocument.sourceText, dedupedResults.rows);
  const abnormalRows = dedupedResults.rows.filter((row) => row.flag !== "normal" && row.flag !== "unknown");
  const qualityMissing = dedupeStrings(readStringArray(candidate.quality?.missingInformation));
  const qualityAmbiguities = dedupeStrings(readStringArray(candidate.quality?.ambiguities));
  const fallbackFindings = buildFallbackFindings(abnormalRows, documentFindings);
  const defaultHeadline = buildDefaultLabHeadline(abnormalRows, dedupedResults.rows, documentFindings);
  const defaultBullets = buildDefaultLabBullets(dedupedResults.rows, abnormalRows, documentFindings);

  return {
    id: `lab-${Date.now()}`,
    createdAt: new Date().toISOString(),
    sourceDocument: {
      fileName: pendingDocument.fileName ?? null,
      mimeType: pendingDocument.mimeType ?? null,
      sizeBytes: pendingDocument.sizeBytes ?? null,
      sourceType: pendingDocument.sourceType,
      pageCount: extractedDocument.pageCount,
      persisted: false,
    },
    language: {
      detected: candidate.language?.detected?.trim() || "unknown",
      reportLanguage: "en",
    },
    patient: {
      name: candidate.patient?.name?.trim() || null,
      sex: candidate.patient?.sex?.trim() || null,
      ageText: candidate.patient?.ageText?.trim() || null,
      patientLabel: candidate.patient?.patientLabel?.trim() || null,
    },
    summary: {
      headline: defaultHeadline,
      bullets: defaultBullets,
      overallRisk: deriveOverallRisk(dedupedResults.rows, fallbackFindings),
    },
    abnormalFindings: fallbackFindings,
    results: dedupedResults.rows,
    nextSteps: buildFallbackNextSteps(abnormalRows, fallbackFindings),
    quality: {
      missingInformation: qualityMissing,
      ambiguities: qualityAmbiguities,
      warnings: dedupeStrings([
        ...(dedupedResults.rows.length ? [] : ["No lab rows were extracted from the uploaded document."]),
        ...extraction.warnings,
      ]),
      processingNotes: [
        "Original uploaded lab documents are not persisted locally by the mobile app.",
        extractedDocument.pagesWithExtractionFailures.length
          ? `Some pages could not be fully extracted: ${extractedDocument.pagesWithExtractionFailures.join(", ")}.`
          : "All processed pages produced at least some extractable text.",
        ...(dedupedResults.duplicateCount
          ? [
              `Removed ${dedupedResults.duplicateCount} exact duplicate lab row${dedupedResults.duplicateCount === 1 ? "" : "s"} from the extracted result set.`,
            ]
          : []),
        ...(documentFindings.length
          ? [
              "Qualitative source-text cues were used to supplement structured lab rows when the document contained outcome or specimen-quality language.",
            ]
          : []),
        ...extraction.processingNotes,
      ],
      degradedMode: false,
    },
    sourceText: extractedDocument.sourceText,
    processing: {
      mode: extractionUsedClaude ? "hybrid" : "qwen_only",
      usedClaude: extractionUsedClaude,
      usedMock: false,
      pageCount: extractedDocument.pageCount,
      extractionModes: extractedDocument.pages.map((page) => ({
        pageNumber: page.pageNumber,
        mode: page.extractionMethod,
      })),
    },
    provenance: {
      pagesWithExtractionFailures: extractedDocument.pagesWithExtractionFailures,
      failedPageCount: extractedDocument.pagesWithExtractionFailures.length,
      extractionModel: extraction.extractionModel,
      visionModel: extractedDocument.pages.some((page) => page.extractionMethod !== "text") ? QWEN_LAB_VISION_MODEL : null,
      reasoningModel: null,
    },
  };
}

function normalizeLabResultRow(
  row: NonNullable<LabExtractionCandidate["results"]>[number],
  index: number,
): LabResultRow | null {
  const testNameRaw = readNullableString(row?.testNameRaw)?.trim() ?? "";
  const valueRaw = readNullableString(row?.valueRaw)?.trim() ?? "";

  if (!testNameRaw || !valueRaw) {
    return null;
  }

  const valueNumeric = parseLabNumber(valueRaw);
  const parsedRange = parseReferenceRange(readNullableString(row?.referenceRangeRaw));
  const flag = computeLabFlag(valueNumeric, parsedRange, row?.flagHint ?? null);
  const severity = defaultSeverityForRow(flag, valueNumeric, parsedRange);
  const canonicalName = readNullableString(row?.testNameCanonical)?.trim() || null;
  const unit = readNullableString(row?.unit)?.trim() || inferUnitFromValue(valueRaw);

  return {
    id: `result-${index + 1}-${slugify(canonicalName ?? testNameRaw) || "lab"}`,
    testNameRaw,
    testNameCanonical: canonicalName,
    panelName: readNullableString(row?.panelName)?.trim() || null,
    valueRaw,
    valueNumeric,
    unit,
    referenceRangeRaw: readNullableString(row?.referenceRangeRaw)?.trim() || null,
    referenceLow: parsedRange.low,
    referenceHigh: parsedRange.high,
    flag,
    severity,
    clinicalMeaning: buildFallbackClinicalMeaning(testNameRaw, flag),
    patientExplanation: buildFallbackPatientExplanation(testNameRaw, flag),
    recommendedFollowUp: buildFallbackFollowUp(flag),
    confidence: clampNumber(typeof row?.confidence === "number" ? row.confidence : null, 0, 1) ?? 0.5,
    pageNumber: clampInteger(parseNullableNumber(row?.pageNumber), 1, 10_000),
    sourceSnippet: readNullableString(row?.sourceSnippet)?.trim() || null,
    sourceRowText: readNullableString(row?.sourceRowText)?.trim() || null,
    extractionMethod: readExtractionMethod(row?.extractionMethod),
  };
}

async function enrichLabReportAsync(baseReport: LabAnalysisReport): Promise<LabAnalysisReport> {
  const reasoningPrompt = buildLabReasoningPrompt(baseReport);
  let reasoningPayload: LabReasoningPayload | null = null;
  let processingMode: LabProcessingMode = baseReport.processing.mode;
  let usedClaude = baseReport.processing.usedClaude;
  const warnings = [...baseReport.quality.warnings];
  const processingNotes = [...baseReport.quality.processingNotes];

  if (ANTHROPIC_API_KEY && CLAUDE_MODEL) {
    try {
      reasoningPayload = await anthropicReasoningAsync(reasoningPrompt);
      processingMode = "hybrid";
      usedClaude = true;
    } catch (error) {
      warnings.push("Claude reasoning was unavailable, so the report fell back to Qwen-only interpretation.");
      processingNotes.push(error instanceof Error ? error.message : "Claude reasoning failed.");
    }
  } else if (ANTHROPIC_API_KEY && !CLAUDE_MODEL) {
    processingNotes.push("Claude API key is present, but CLAUDE_MODEL is not configured. Qwen-only mode was used.");
  }

  if (!reasoningPayload) {
    try {
      reasoningPayload = await qwenReasoningAsync(reasoningPrompt);
    } catch (error) {
      warnings.push("Reasoning enrichment was limited, so fallback summary text was used.");
      processingNotes.push(error instanceof Error ? error.message : "Qwen reasoning failed.");
    }
  }

  const mergedResults = mergeResultInsights(baseReport.results, reasoningPayload?.resultInsights);
  const fallbackFindings = buildFallbackFindings(mergedResults.filter(isAbnormalRow), baseReport.abnormalFindings);
  const abnormalFindings = mergeAbnormalFindings(
    fallbackFindings,
    normalizeAbnormalFindings(reasoningPayload?.abnormalFindings, mergedResults),
  );
  const nextSteps = mergeNextSteps(
    buildFallbackNextSteps(mergedResults.filter(isAbnormalRow), abnormalFindings),
    normalizeNextSteps(reasoningPayload?.nextSteps),
  );
  const summary = normalizeSummary(reasoningPayload?.summary, mergedResults, abnormalFindings) ?? {
    headline: baseReport.summary.headline,
    bullets: baseReport.summary.bullets,
    overallRisk: deriveOverallRisk(mergedResults, abnormalFindings),
  };

  return labAnalysisReportSchema.parse({
    ...baseReport,
    summary,
    abnormalFindings,
    results: mergedResults,
    nextSteps,
    quality: {
      missingInformation: dedupeStrings([
        ...baseReport.quality.missingInformation,
        ...readStringArray(reasoningPayload?.quality?.missingInformation),
      ]),
      ambiguities: dedupeStrings([
        ...baseReport.quality.ambiguities,
        ...readStringArray(reasoningPayload?.quality?.ambiguities),
      ]),
      warnings: dedupeStrings([
        ...warnings,
        ...readStringArray(reasoningPayload?.quality?.warnings),
      ]),
      processingNotes: dedupeStrings([
        ...processingNotes,
        ...readStringArray(reasoningPayload?.quality?.processingNotes),
      ]),
      degradedMode: processingMode !== "hybrid",
    },
    processing: {
      ...baseReport.processing,
      mode: processingMode,
      usedClaude,
    },
    provenance: {
      ...baseReport.provenance,
      reasoningModel: usedClaude ? CLAUDE_MODEL : QWEN_LAB_REASONING_MODEL,
    },
  });
}

function buildLabReasoningPrompt(report: LabAnalysisReport) {
  return [
    "Return JSON only.",
    "You are reviewing extracted lab results for a hackathon medical MVP.",
    "Do not diagnose. Be conservative, factual, and patient-safe.",
    "Use the deterministic flag field as the numeric source of truth.",
    "Severity should express prioritization, not numeric direction alone.",
    "Severity must not be lower than the strongest clearly supported abnormal or source-document concern in the input.",
    "Next steps must stay general and non-diagnostic.",
    "If the source excerpt contains qualitative outcome text such as high or critical results, specimen quality warnings, or outside-range language, carry that into the summary as a source-document concern that needs clinical verification.",
    "Do not convert source-document claims into diagnoses; frame them as reported conclusions or qualitative concerns from the uploaded document.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        summary: {
          headline: "string",
          bullets: ["string"],
          overallRisk: "none|mild|moderate|high|critical|unknown",
        },
        abnormalFindings: [
          {
            id: "string",
            title: "string",
            severity: "none|mild|moderate|high|critical|unknown",
            explanation: "string",
            relatedResultIds: ["string"],
            actionability: "urgent_attention|discuss_with_clinician_soon|routine_follow_up_or_monitoring",
          },
        ],
        nextSteps: {
          urgentAttention: ["string"],
          discussWithClinicianSoon: ["string"],
          routineFollowUpOrMonitoring: ["string"],
        },
        resultInsights: [
          {
            resultId: "string",
            severity: "none|mild|moderate|high|critical|unknown",
            clinicalMeaning: "string",
            patientExplanation: "string",
            recommendedFollowUp: "string",
          },
        ],
        quality: {
          missingInformation: ["string"],
          ambiguities: ["string"],
          warnings: ["string"],
          processingNotes: ["string"],
        },
      },
      null,
      2,
    ),
    "",
    `Results:\n${JSON.stringify(
      report.results.map((result) => ({
        id: result.id,
        testNameRaw: result.testNameRaw,
        testNameCanonical: result.testNameCanonical,
        panelName: result.panelName,
        valueRaw: result.valueRaw,
        valueNumeric: result.valueNumeric,
        unit: result.unit,
        referenceRangeRaw: result.referenceRangeRaw,
        referenceLow: result.referenceLow,
        referenceHigh: result.referenceHigh,
        flag: result.flag,
        severity: result.severity,
        pageNumber: result.pageNumber,
        sourceSnippet: result.sourceSnippet,
      })),
      null,
      2,
    )}`,
    "",
    `Existing fallback findings:\n${JSON.stringify(report.abnormalFindings, null, 2)}`,
    "",
    `Source excerpt:\n${buildSourceExcerpt(report.sourceText)}`,
    "",
    `Quality context:\n${JSON.stringify(report.quality, null, 2)}`,
  ].join("\n");
}

async function anthropicReasoningAsync(prompt: string): Promise<LabReasoningPayload> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      system:
        "You are a cautious lab-result summarizer. Output valid JSON only. Do not diagnose or overstate urgency.",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(CLAUDE_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Claude request failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = Array.isArray(payload.content)
    ? payload.content
        .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
        .join("")
    : "";

  return (await parseOrRepairJsonAsync(text)) as LabReasoningPayload;
}

async function qwenReasoningAsync(prompt: string): Promise<LabReasoningPayload> {
  const response = await qwenChatCompletionAsync(
    {
      model: QWEN_LAB_REASONING_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a cautious lab-result summarizer. Output valid JSON only. Do not diagnose or overstate urgency.",
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
    QWEN_LAB_REASONING_TIMEOUT_MS,
  );

  return (await parseOrRepairJsonAsync(extractMessageText(response))) as LabReasoningPayload;
}

function mergeResultInsights(results: LabResultRow[], insights: LabReasoningPayload["resultInsights"]) {
  const byId = new Map<string, NonNullable<LabReasoningPayload["resultInsights"]>[number]>();
  for (const insight of Array.isArray(insights) ? insights : []) {
    if (typeof insight?.resultId === "string") {
      byId.set(insight.resultId, insight);
    }
  }

  return results.map((result) => {
    const insight = byId.get(result.id);
    if (!insight) {
      return result;
    }

    return {
      ...result,
      severity: maxSeverity(result.severity, normalizeSeverity(insight.severity, result.severity)),
      clinicalMeaning: readNullableString(insight.clinicalMeaning)?.trim() || result.clinicalMeaning,
      patientExplanation: readNullableString(insight.patientExplanation)?.trim() || result.patientExplanation,
      recommendedFollowUp: readNullableString(insight.recommendedFollowUp)?.trim() || result.recommendedFollowUp,
    };
  });
}

function normalizeSummary(
  summary: LabReasoningPayload["summary"],
  results: LabResultRow[],
  findings: LabAnalysisReport["abnormalFindings"],
) {
  if (!summary) {
    return null;
  }

  const headline = readNullableString(summary.headline)?.trim();
  const bullets = readStringArray(summary.bullets);
  const derivedRisk = deriveOverallRisk(results, findings);
  const overallRisk = maxSeverity(derivedRisk, normalizeSeverity(summary.overallRisk, derivedRisk));

  if (!headline && !bullets.length) {
    return null;
  }

  return {
    headline: headline || buildDefaultLabHeadline(results.filter(isAbnormalRow), results),
    bullets: bullets.length ? bullets : buildDefaultLabBullets(results, results.filter(isAbnormalRow)),
    overallRisk,
  };
}

function normalizeAbnormalFindings(
  findings: LabReasoningPayload["abnormalFindings"],
  results: LabResultRow[],
): LabAnalysisReport["abnormalFindings"] | null {
  if (!Array.isArray(findings) || !findings.length) {
    return null;
  }

  const validResultIds = new Set(results.map((result) => result.id));

  const normalized = findings
    .map((finding, index) => {
      const title = readNullableString(finding?.title)?.trim();
      const explanation = readNullableString(finding?.explanation)?.trim();
      if (!title || !explanation) {
        return null;
      }

      const relatedResultIds = readStringArray(finding?.relatedResultIds).filter((id) => validResultIds.has(id));

      return {
        id: readNullableString(finding?.id)?.trim() || `finding-${index + 1}`,
        title,
        severity: normalizeSeverity(finding?.severity, "unknown"),
        explanation,
        relatedResultIds,
        actionability: normalizeActionability(finding?.actionability, "routine_follow_up_or_monitoring"),
      };
    })
    .filter((finding): finding is LabAnalysisReport["abnormalFindings"][number] => Boolean(finding));

  return normalized.length ? normalized : null;
}

function normalizeNextSteps(nextSteps: LabReasoningPayload["nextSteps"]) {
  if (!nextSteps) {
    return null;
  }

  const normalized = {
    urgentAttention: readStringArray(nextSteps.urgentAttention),
    discussWithClinicianSoon: readStringArray(nextSteps.discussWithClinicianSoon),
    routineFollowUpOrMonitoring: readStringArray(nextSteps.routineFollowUpOrMonitoring),
  };

  return normalized.urgentAttention.length ||
    normalized.discussWithClinicianSoon.length ||
    normalized.routineFollowUpOrMonitoring.length
    ? normalized
    : null;
}

function buildFallbackFindings(rows: LabResultRow[], documentFindings: LabAbnormalFinding[] = []) {
  const rowFindings = rows
    .filter(isAbnormalRow)
    .slice(0, 4)
    .map((row, index) => ({
      id: `finding-${index + 1}`,
      title: `${row.testNameCanonical ?? row.testNameRaw} is ${row.flag.replaceAll("_", " ")}.`,
      severity: row.severity,
      explanation: row.clinicalMeaning,
      relatedResultIds: [row.id],
      actionability: actionabilityForSeverity(row.severity),
    }));

  return mergeAbnormalFindings(documentFindings, rowFindings);
}

function buildFallbackNextSteps(rows: LabResultRow[], findings: LabAbnormalFinding[] = []) {
  const critical = findings.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const moderate = findings.filter((finding) => finding.severity === "moderate");
  const routine = findings.filter((finding) => finding.severity === "mild" || finding.severity === "unknown");

  return {
    urgentAttention: critical.length
      ? ["Seek prompt clinical review for the highest-severity abnormal findings or source-document concerns in this report."]
      : [],
    discussWithClinicianSoon: moderate.length
      ? ["Review moderate abnormal findings with a clinician soon and correlate with symptoms and prior labs."]
      : [],
    routineFollowUpOrMonitoring: routine.length || (!critical.length && !moderate.length) || rows.some((row) => row.flag === "unknown")
      ? ["Monitor mild or uncertain abnormalities and follow up with repeat testing if clinically appropriate."]
      : [],
  };
}

function finalizeLabReportForStorage(report: LabAnalysisReport, pendingDocument: PendingLabDocument) {
  const patientName = report.patient.name ?? null;
  const sanitizedSourceText = sanitizeLabText(report.sourceText, patientName);

  return labAnalysisReportSchema.parse({
    ...report,
    sourceDocument: {
      ...report.sourceDocument,
      fileName:
        pendingDocument.sourceType === "sample" ? pendingDocument.fileName ?? report.sourceDocument.fileName ?? null : null,
      mimeType: pendingDocument.mimeType ?? report.sourceDocument.mimeType ?? null,
      sizeBytes: pendingDocument.sizeBytes ?? report.sourceDocument.sizeBytes ?? null,
      sourceType: pendingDocument.sourceType,
      persisted: false,
    },
    patient: {
      ...report.patient,
      name: null,
      patientLabel: sanitizeLabText(report.patient.patientLabel ?? "", patientName) || null,
    },
    summary: {
      headline: sanitizeLabText(report.summary.headline, patientName),
      bullets: report.summary.bullets.map((item) => sanitizeLabText(item, patientName)),
      overallRisk: report.summary.overallRisk,
    },
    abnormalFindings: report.abnormalFindings.map((finding) => ({
      ...finding,
      title: sanitizeLabText(finding.title, patientName),
      explanation: sanitizeLabText(finding.explanation, patientName),
    })),
    results: report.results.map((result) => ({
      ...result,
      clinicalMeaning: sanitizeLabText(result.clinicalMeaning, patientName),
      patientExplanation: sanitizeLabText(result.patientExplanation, patientName),
      recommendedFollowUp: sanitizeLabText(result.recommendedFollowUp, patientName),
      sourceSnippet: sanitizeLabText(result.sourceSnippet ?? "", patientName) || null,
      sourceRowText: sanitizeLabText(result.sourceRowText ?? "", patientName) || null,
    })),
    nextSteps: {
      urgentAttention: report.nextSteps.urgentAttention.map((item) => sanitizeLabText(item, patientName)),
      discussWithClinicianSoon: report.nextSteps.discussWithClinicianSoon.map((item) => sanitizeLabText(item, patientName)),
      routineFollowUpOrMonitoring: report.nextSteps.routineFollowUpOrMonitoring.map((item) =>
        sanitizeLabText(item, patientName),
      ),
    },
    quality: {
      missingInformation: dedupeStrings(report.quality.missingInformation.map((item) => sanitizeLabText(item, patientName))),
      ambiguities: dedupeStrings(report.quality.ambiguities.map((item) => sanitizeLabText(item, patientName))),
      warnings: dedupeStrings(report.quality.warnings.map((item) => sanitizeLabText(item, patientName))),
      processingNotes: dedupeStrings([
        ...report.quality.processingNotes.map((item) => sanitizeLabText(item, patientName)),
        "Uploaded lab documents are not persisted locally by the app and may be retained temporarily in a server-side debug archive.",
      ]),
      degradedMode: report.quality.degradedMode,
    },
    sourceText: sanitizedSourceText,
  });
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
    throw new Error(`Qwen request failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

async function parseOrRepairJsonAsync(raw: string) {
  const parsed = parseJsonLike(raw);
  if (parsed) {
    return parsed;
  }

  const response = await qwenChatCompletionAsync(
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
    QWEN_JSON_REPAIR_TIMEOUT_MS,
  );

  const repaired = parseJsonLike(extractMessageText(response));
  if (!repaired) {
    throw new Error("Model output was not valid JSON after repair.");
  }

  return repaired;
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

function readObject(value: unknown) {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : {};
}

function readNullableString(value: unknown) {
  return typeof value === "string" || value === null ? value : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNullableNumber(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInteger(value: number | null, min: number, max: number) {
  if (value == null) {
    return null;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber(value: number | null, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(max, Math.max(min, value));
}

function parseLabNumber(value: string) {
  const match = value.match(/-?\d[\d,.]*/);
  if (!match) {
    return null;
  }

  return normalizeNumericToken(match[0]);
}

function normalizeNumericToken(token: string) {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  let candidate = normalized;
  if (candidate.includes(",") && !candidate.includes(".")) {
    candidate = /,\d{3}\b/.test(candidate) ? candidate.replace(/,/g, "") : candidate.replace(/,/g, ".");
  } else {
    candidate = candidate.replace(/,/g, "");
  }

  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReferenceRange(value: string | null) {
  if (!value) {
    return { low: null, high: null, mode: "unknown" as const };
  }

  const compact = value.replace(/\s+/g, " ").trim();
  const between = compact.match(/(-?\d[\d,.]*)\s*(?:-|to)\s*(-?\d[\d,.]*)/i);
  if (between) {
    return {
      low: normalizeNumericToken(between[1]),
      high: normalizeNumericToken(between[2]),
      mode: "between" as const,
    };
  }

  const lessThan = compact.match(/(?:<=?|up to|under)\s*(-?\d[\d,.]*)/i);
  if (lessThan) {
    return {
      low: null,
      high: normalizeNumericToken(lessThan[1]),
      mode: "upper_only" as const,
    };
  }

  const greaterThan = compact.match(/(?:>=?|more than|over)\s*(-?\d[\d,.]*)/i);
  if (greaterThan) {
    return {
      low: normalizeNumericToken(greaterThan[1]),
      high: null,
      mode: "lower_only" as const,
    };
  }

  return { low: null, high: null, mode: "unknown" as const };
}

function computeLabFlag(
  valueNumeric: number | null,
  range: { low: number | null; high: number | null; mode: "between" | "upper_only" | "lower_only" | "unknown" },
  flagHint: string | null,
): LabFlag {
  const normalizedHint = typeof flagHint === "string" ? flagHint.trim().toLowerCase() : "";

  if (valueNumeric != null) {
    if (range.mode === "between" && range.low != null && range.high != null) {
      if (valueNumeric < range.low) {
        return "low";
      }
      if (valueNumeric > range.high) {
        return "high";
      }
      return "normal";
    }

    if (range.mode === "upper_only" && range.high != null) {
      return valueNumeric > range.high ? "out_of_range" : "normal";
    }

    if (range.mode === "lower_only" && range.low != null) {
      return valueNumeric < range.low ? "out_of_range" : "normal";
    }
  }

  if (normalizedHint === "high" || normalizedHint === "h") {
    return "high";
  }
  if (normalizedHint === "low" || normalizedHint === "l") {
    return "low";
  }
  if (normalizedHint === "normal") {
    return "normal";
  }

  return "unknown";
}

function defaultSeverityForRow(
  flag: LabFlag,
  valueNumeric: number | null,
  range: { low: number | null; high: number | null; mode: "between" | "upper_only" | "lower_only" | "unknown" },
): LabSeverity {
  if (flag === "normal") {
    return "none";
  }

  if (flag === "unknown") {
    return "unknown";
  }

  if (valueNumeric == null) {
    return "mild";
  }

  const referenceValue =
    flag === "low" ? range.low : flag === "high" || flag === "out_of_range" ? range.high ?? range.low : null;

  if (referenceValue == null || referenceValue === 0) {
    return "mild";
  }

  const distanceRatio = Math.abs(valueNumeric - referenceValue) / Math.abs(referenceValue);

  if (distanceRatio >= 0.75) {
    return "high";
  }
  if (distanceRatio >= 0.25) {
    return "moderate";
  }
  return "mild";
}

function deriveOverallRisk(results: LabResultRow[], findings: LabAnalysisReport["abnormalFindings"]) {
  const severityOrder: LabSeverity[] = ["critical", "high", "moderate", "mild", "unknown", "none"];

  for (const severity of severityOrder) {
    if (findings.some((finding) => finding.severity === severity) || results.some((result) => result.severity === severity)) {
      return severity;
    }
  }

  return "none";
}

function buildDefaultLabHeadline(
  abnormalRows: LabResultRow[],
  allRows: LabResultRow[],
  documentFindings: LabAbnormalFinding[] = [],
) {
  if (!allRows.length) {
    return "Lab report processed, but no structured results could be extracted.";
  }

  if (!abnormalRows.length && documentFindings.length) {
    return documentFindings[0].title;
  }

  if (!abnormalRows.length) {
    return "No clearly abnormal numeric lab results were prioritized from the extracted report.";
  }

  const lead = pickLeadRow(abnormalRows);
  return `${lead.testNameCanonical ?? lead.testNameRaw} is ${lead.flag.replaceAll("_", " ")}, with ${abnormalRows.length} prioritized abnormal finding${abnormalRows.length === 1 ? "" : "s"} overall.`;
}

function buildDefaultLabBullets(
  allRows: LabResultRow[],
  abnormalRows: LabResultRow[],
  documentFindings: LabAbnormalFinding[] = [],
) {
  const bullets: string[] = [];

  if (abnormalRows.length) {
    bullets.push(
      `Prioritized abnormal results: ${abnormalRows
        .slice(0, 3)
        .map((row) => `${row.testNameCanonical ?? row.testNameRaw} (${row.flag.replaceAll("_", " ")})`)
        .join(", ")}.`,
    );
  } else if (documentFindings.length) {
    bullets.push(documentFindings[0].explanation);
  } else {
    bullets.push("No clearly abnormal numeric results were identified from the extracted rows.");
  }

  bullets.push(`Total structured rows extracted: ${allRows.length}.`);

  if (allRows.some((row) => row.flag === "unknown")) {
    bullets.push("Some rows could not be fully normalized and should be reviewed against the source text.");
  }

  return bullets;
}

function buildFallbackClinicalMeaning(testName: string, flag: LabFlag) {
  if (flag === "normal") {
    return `${testName} appears within the stated reference information in this report.`;
  }

  if (flag === "unknown") {
    return `${testName} could not be confidently normalized from the extracted source text.`;
  }

  return `${testName} appears ${flag.replaceAll("_", " ")} relative to the stated reference information.`;
}

function buildFallbackPatientExplanation(testName: string, flag: LabFlag) {
  if (flag === "normal") {
    return `This ${testName} result looks within the range printed on the report.`;
  }

  if (flag === "unknown") {
    return `This ${testName} row needs clinician review because the document text was incomplete or unclear.`;
  }

  return `This ${testName} result looks ${flag.replaceAll("_", " ")} compared with the range printed on the report.`;
}

function buildFallbackFollowUp(flag: LabFlag) {
  if (flag === "normal") {
    return "Routine monitoring only unless symptoms or prior trends suggest otherwise.";
  }

  if (flag === "unknown") {
    return "Review the source report or repeat testing if the exact value or range is clinically important.";
  }

  return "Discuss this result with a clinician and interpret it in the context of symptoms, history, and prior labs.";
}

function normalizeSeverity(value: unknown, fallback: LabSeverity): LabSeverity {
  return value === "none" ||
    value === "mild" ||
    value === "moderate" ||
    value === "high" ||
    value === "critical" ||
    value === "unknown"
    ? value
    : fallback;
}

function normalizeActionability(value: unknown, fallback: LabActionabilityBucket): LabActionabilityBucket {
  return value === "urgent_attention" ||
    value === "discuss_with_clinician_soon" ||
    value === "routine_follow_up_or_monitoring"
    ? value
    : fallback;
}

function actionabilityForSeverity(severity: LabSeverity): LabActionabilityBucket {
  if (severity === "critical" || severity === "high") {
    return "urgent_attention";
  }
  if (severity === "moderate") {
    return "discuss_with_clinician_soon";
  }
  return "routine_follow_up_or_monitoring";
}

function readExtractionMethod(value: unknown): LabExtractionMethod {
  return value === "text" || value === "ocr" || value === "vision" || value === "unknown" ? value : "unknown";
}

function inferUnitFromValue(value: string) {
  const unitMatch = value.match(/[a-zA-Z%/]+$/);
  return unitMatch ? unitMatch[0] : null;
}

function isAbnormalRow(row: LabResultRow) {
  return row.flag !== "normal" && row.flag !== "unknown";
}

function dedupeLabResultRows(rows: LabResultRow[]) {
  const seen = new Set<string>();
  const deduped: LabResultRow[] = [];
  let duplicateCount = 0;

  for (const row of rows) {
    const key = [
      slugify(row.testNameCanonical ?? row.testNameRaw),
      slugify(row.panelName ?? ""),
      row.valueRaw.trim().toLowerCase(),
      (row.referenceRangeRaw ?? "").trim().toLowerCase(),
      (row.unit ?? "").trim().toLowerCase(),
      String(row.pageNumber ?? ""),
      (row.sourceRowText ?? "").trim().toLowerCase(),
    ].join("|");

    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return {
    rows: deduped,
    duplicateCount,
  };
}

function extractDocumentFindings(sourceText: string, results: LabResultRow[]): LabAbnormalFinding[] {
  const findings: LabAbnormalFinding[] = [];
  const normalizedText = sourceText.replace(/[“”]/g, '"');
  const lowerText = normalizedText.toLowerCase();

  const hasOutsideRangeLanguage = /outside the reference range|out of range|above the reference range|below the reference range/.test(lowerText);
  const hasMalignancyLanguage = /\bsuggest malignancy\b|\bsuggests malignancy\b|\bblood cancer\b|\bmalignant\b/.test(lowerText);
  const qualitativeSeverity = detectQualitativeOutcomeSeverity(normalizedText);

  if (qualitativeSeverity || hasOutsideRangeLanguage || hasMalignancyLanguage) {
    const severity = hasMalignancyLanguage ? maxSeverity("high", qualitativeSeverity ?? "moderate") : qualitativeSeverity ?? "moderate";
    const evidence = [
      findSourceLine(normalizedText, /outside the reference range|out of range|above the reference range|below the reference range/i),
      findSourceLine(normalizedText, /^(?:high|moderate|low|critical|positive|reactive)$/i),
      findSourceLine(normalizedText, /suggest malignancy|suggests malignancy|blood cancer|malignant/i),
    ]
      .filter(Boolean)
      .join(" ");

    findings.push({
      id: "document-finding-qualitative-outcome",
      title:
        severity === "critical" || severity === "high"
          ? "Source report includes a high-risk qualitative outcome."
          : "Source report includes a qualitative out-of-range conclusion.",
      severity,
      explanation:
        evidence ||
        "The uploaded document contains qualitative outcome language that should be reviewed even though numeric reference ranges are incomplete.",
      relatedResultIds: matchRelatedResultIds(results, /(tumou?r marker|ca 15\.?3|cea|egfr|ngal|nse|8-ohdg|creatinine|bilirubin|ast|alt|ggt)/i),
      actionability: actionabilityForSeverity(severity),
    });
  }

  const hemolysisLine = findSourceLine(normalizedText, /hemolysis index|hemoly[sz]ed sample/i);
  if (hemolysisLine && !/\bno\b/i.test(hemolysisLine)) {
    const severity = /\+\+\+|\bhigh\b|\bsevere\b|\bsignificant\b/i.test(hemolysisLine) ? "moderate" : "mild";
    findings.push({
      id: "document-finding-hemolysis",
      title: "Source report notes a sample-quality concern from hemolysis.",
      severity,
      explanation: `${hemolysisLine.trim()} This can distort some chemistry values and should be considered when reviewing borderline abnormalities.`,
      relatedResultIds: matchRelatedResultIds(results, /(alp|ast|bilirubin|bun|creatinine|chem|healthcheck|chemistry)/i),
      actionability: actionabilityForSeverity(severity),
    });
  }

  return mergeAbnormalFindings([], findings);
}

function detectQualitativeOutcomeSeverity(sourceText: string): LabSeverity | null {
  const outcomeWindow = captureSourceWindow(sourceText, /(outcome|results|conclusions?)/i, 700);
  const searchTarget = outcomeWindow || sourceText;
  const lowerTarget = searchTarget.toLowerCase();
  const explicitOutcomeLine = findSourceLine(searchTarget, /^["']?(high|moderate|low|critical|positive|reactive)["']?$/i);

  if (/\bcritical\b|\bpanic\b/.test(lowerTarget)) {
    return "critical";
  }
  if (explicitOutcomeLine && /\bhigh\b/i.test(explicitOutcomeLine)) {
    return "high";
  }
  if (explicitOutcomeLine && /\bmoderate\b|\bpositive\b|\breactive\b/i.test(explicitOutcomeLine)) {
    return "moderate";
  }
  if (explicitOutcomeLine && /\blow\b/i.test(explicitOutcomeLine)) {
    return "mild";
  }

  return null;
}

function captureSourceWindow(sourceText: string, pattern: RegExp, maxChars: number) {
  const match = sourceText.match(pattern);
  if (match?.index == null) {
    return "";
  }

  return sourceText.slice(match.index, Math.min(sourceText.length, match.index + maxChars));
}

function findSourceLine(sourceText: string, pattern: RegExp) {
  return (
    sourceText
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => pattern.test(line)) ?? null
  );
}

function matchRelatedResultIds(results: LabResultRow[], pattern: RegExp) {
  return results
    .filter((result) => pattern.test(`${result.testNameRaw} ${result.testNameCanonical ?? ""} ${result.panelName ?? ""}`))
    .map((result) => result.id);
}

function mergeAbnormalFindings(baseFindings: LabAbnormalFinding[], aiFindings: LabAbnormalFinding[] | null) {
  const mergedByKey = new Map<string, LabAbnormalFinding>();

  for (const finding of [...baseFindings, ...(aiFindings ?? [])]) {
    const key = slugify(finding.title) || finding.id;
    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, {
        ...finding,
        relatedResultIds: [...new Set(finding.relatedResultIds)],
      });
      continue;
    }

    mergedByKey.set(key, {
      ...existing,
      severity: maxSeverity(existing.severity, finding.severity),
      explanation: existing.explanation.length >= finding.explanation.length ? existing.explanation : finding.explanation,
      relatedResultIds: [...new Set([...existing.relatedResultIds, ...finding.relatedResultIds])],
      actionability:
        actionabilityRank(finding.actionability) > actionabilityRank(existing.actionability)
          ? finding.actionability
          : existing.actionability,
    });
  }

  return [...mergedByKey.values()].sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
}

function mergeNextSteps(
  base: LabAnalysisReport["nextSteps"],
  nextSteps: LabAnalysisReport["nextSteps"] | null,
): LabAnalysisReport["nextSteps"] {
  if (!nextSteps) {
    return base;
  }

  return {
    urgentAttention: dedupeStrings([...base.urgentAttention, ...nextSteps.urgentAttention]),
    discussWithClinicianSoon: dedupeStrings([...base.discussWithClinicianSoon, ...nextSteps.discussWithClinicianSoon]),
    routineFollowUpOrMonitoring: dedupeStrings([
      ...base.routineFollowUpOrMonitoring,
      ...nextSteps.routineFollowUpOrMonitoring,
    ]),
  };
}

function buildSourceExcerpt(sourceText: string) {
  const trimmed = sourceText.trim();
  if (trimmed.length <= 4000) {
    return trimmed;
  }

  return `${trimmed.slice(0, 4000)}\n\n[truncated source excerpt]`;
}

function pickLeadRow(rows: LabResultRow[]) {
  return [...rows].sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0] ?? rows[0];
}

function maxSeverity(left: LabSeverity, right: LabSeverity): LabSeverity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function severityRank(severity: LabSeverity) {
  switch (severity) {
    case "critical":
      return 6;
    case "high":
      return 5;
    case "moderate":
      return 4;
    case "mild":
      return 3;
    case "unknown":
      return 2;
    case "none":
    default:
      return 1;
  }
}

function actionabilityRank(actionability: LabActionabilityBucket) {
  switch (actionability) {
    case "urgent_attention":
      return 3;
    case "discuss_with_clinician_soon":
      return 2;
    case "routine_follow_up_or_monitoring":
    default:
      return 1;
  }
}

function shouldRetryImageExtractionWithVision(
  pendingDocument: PendingLabDocument,
  extractedDocument: ExtractedLabDocument,
  report: LabAnalysisReport,
) {
  const resolvedMimeType = String(pendingDocument.mimeType ?? "").toLowerCase();
  if (!resolvedMimeType.includes("image")) {
    return false;
  }

  if (!extractedDocument.pages.some((page) => page.extractionMethod === "ocr")) {
    return false;
  }

  if (!resolvedMimeType.includes("png") && !resolvedMimeType.includes("jpeg") && !resolvedMimeType.includes("jpg")) {
    return false;
  }

  if (report.results.length === 0) {
    return true;
  }

  const numericRatio = report.results.filter((result) => result.valueNumeric != null).length / report.results.length;
  const canonicalRatio = report.results.filter((result) => Boolean(result.testNameCanonical)).length / report.results.length;
  if (numericRatio === 0) {
    return true;
  }

  if (numericRatio < 0.5 && canonicalRatio < 0.25) {
    return true;
  }

  const lowerSourceText = extractedDocument.sourceText.toLowerCase();
  return report.results.length < 3 &&
    /(reference range|flag|bargraph|bar graph|hematology|chemistry|complete blood count|continued on next page|panel)/.test(lowerSourceText);
}

function sanitizeLabText(value: string, patientName: string | null) {
  let nextValue = value;

  if (patientName) {
    nextValue = replaceLiteralIgnoreCase(nextValue, patientName, "[redacted name]");
  }

  nextValue = applyRedactionRules(nextValue);

  return nextValue
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function replaceLiteralIgnoreCase(haystack: string, needle: string, replacement: string) {
  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return haystack.replace(new RegExp(escapedNeedle, "giu"), replacement);
}

function applyRedactionRules(value: string) {
  const nameToken = "[\\p{Lu}][\\p{L}'-]+";
  const fullNamePattern = `${nameToken}(?:\\s+${nameToken}){0,3}`;
  const namePrefixPattern =
    "(?:my name is|name is|patient name is|doctor name is|clinician name is|this is|dr\\.?|mr\\.?|mrs\\.?|ms\\.?|tên tôi là|em tên là|tôi tên là|bác sĩ|patient name)";
  const replacements: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted email]"],
    [
      /\b(?:MRN|medical record number|record number|patient id|patient number|national id|passport|cccd|cmnd)\b\s*[:#-]?\s*[A-Z0-9-]{3,}\b/giu,
      "[redacted identifier]",
    ],
    [
      new RegExp(`\\b(${namePrefixPattern})\\s*[:,-]\\s*(${fullNamePattern})`, "giu"),
      (_match, prefix) => `${prefix} [redacted name]`,
    ],
    [new RegExp(`\\b(patient)\\s*:\\s*(${fullNamePattern})`, "giu"), (_match, prefix) => `${prefix}: [redacted name]`],
  ];

  const redacted = replacements.reduce(
    (currentValue, [pattern, replacement]) => currentValue.replace(pattern, replacement as never),
    value,
  );

  return redactLabeledNameLines(redacted);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function dedupeStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))];
}

async function prepareImageForExtractionAsync(inputPath: string) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "elfie-lab-image-"));
  const outputPath = path.join(tempDir, "normalized-image.png");
  const filter = "scale='if(gte(iw,ih),1400,-2)':'if(gte(iw,ih),-2,1400)',format=gray";

  try {
    await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-frames:v", "1", "-vf", filter, outputPath]);
    return {
      tempDir,
      normalizedPath: outputPath,
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function createVisionImageDataUrlAsync(inputPath: string, mimeType: string) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "elfie-lab-vision-"));
  const outputPath = path.join(tempDir, "vision-image.png");
  const filter = "scale='if(gte(iw,ih),1600,-2)':'if(gte(iw,ih),-2,1600)'";

  try {
    await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-frames:v", "1", "-vf", filter, outputPath]);
    const imageBuffer = await fs.readFile(outputPath);
    return `data:image/png;base64,${imageBuffer.toString("base64")}`;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function extractTextWithLocalOcrAsync(imagePath: string): Promise<LocalOcrResult> {
  const [plainTextOutput, tsvOutput] = await Promise.all([
    execFileAsync("tesseract", [
      imagePath,
      "stdout",
      "--oem",
      "1",
      "--psm",
      "6",
      "-c",
      "preserve_interword_spaces=1",
    ]),
    execFileAsync("tesseract", [imagePath, "stdout", "--oem", "1", "--psm", "6", "tsv"]),
  ]);

  const words = tsvOutput.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t"))
    .filter((columns) => columns.length >= 12)
    .map((columns) => ({
      confidence: Number(columns[10]),
      text: columns[11]?.trim() ?? "",
    }))
    .filter((word) => word.text && Number.isFinite(word.confidence) && word.confidence >= 0);

  const averageConfidence = words.length
    ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
    : null;

  return {
    text: plainTextOutput.stdout.trim(),
    averageConfidence,
    wordCount: words.length,
  };
}

function shouldUseLocalOcr(ocrResult: LocalOcrResult) {
  if (!ocrResult.text.trim()) {
    return false;
  }

  if (ocrResult.wordCount >= 40 && ocrResult.text.length >= 180) {
    return true;
  }

  return Boolean(ocrResult.averageConfidence != null && ocrResult.averageConfidence >= 65 && ocrResult.wordCount >= 20);
}

function redactLabeledNameLines(value: string) {
  const labelPattern =
    /^(name|patient|owner|referring physician|ordered by|reported to|method lab technician|technical responsible|doctor|physician|clinician)\s*:\s*(.+)$/iu;
  const pendingLabelPattern =
    /^(name|patient|owner|referring physician|ordered by|reported to|method lab technician|technical responsible|doctor|physician|clinician)\s*:?\s*$/iu;
  const titledNamePattern = /^(dr\.?|mr\.?|mrs\.?|ms\.?|pa|np|rn)\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,3}$/iu;
  const lines = value.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const sameLineMatch = line.match(labelPattern);

    if (sameLineMatch && looksLikeHumanName(sameLineMatch[2])) {
      lines[index] = `${sameLineMatch[1]}: [redacted name]`;
      continue;
    }

    if (pendingLabelPattern.test(line)) {
      const nextLine = lines[index + 1]?.trim() ?? "";
      if (looksLikeHumanName(nextLine)) {
        lines[index + 1] = "[redacted name]";
      }
      continue;
    }

    if (titledNamePattern.test(line)) {
      lines[index] = "[redacted name]";
    }
  }

  return lines.join("\n");
}

function looksLikeHumanName(value: string) {
  if (!value || /\d/.test(value) || value.length > 60) {
    return false;
  }

  const tokens = value
    .replace(/[,:;()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length < 1 || tokens.length > 4) {
    return false;
  }

  return tokens.every((token) => /^[\p{L}'.-]+$/u.test(token));
}

async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  if (!items.length) {
    return [] as TOutput[];
  }

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

function normalizeCompatibleBaseUrl(raw: string) {
  return raw
    .replace(/\/responses\/?$/, "")
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/api\/v2\/apps\/protocols\/compatible-mode\/v1\/?$/, "/compatible-mode/v1")
    .replace(/\/$/, "");
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|timed? out/i.test(error.message));
}
