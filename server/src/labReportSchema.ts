import { z } from "zod";

const labFlagSchema = z.enum(["low", "normal", "high", "out_of_range", "unknown"]);
const labSeveritySchema = z.enum(["none", "mild", "moderate", "high", "critical", "unknown"]);
const actionabilitySchema = z.enum([
  "urgent_attention",
  "discuss_with_clinician_soon",
  "routine_follow_up_or_monitoring",
]);
const extractionMethodSchema = z.enum(["text", "ocr", "vision", "unknown"]);
const processingModeSchema = z.enum(["mock", "hybrid", "qwen_only"]);

export const labResultRowSchema = z.object({
  id: z.string(),
  testNameRaw: z.string(),
  testNameCanonical: z.string().nullable().optional(),
  panelName: z.string().nullable().optional(),
  valueRaw: z.string(),
  valueNumeric: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  referenceRangeRaw: z.string().nullable().optional(),
  referenceLow: z.number().nullable().optional(),
  referenceHigh: z.number().nullable().optional(),
  flag: labFlagSchema,
  severity: labSeveritySchema,
  clinicalMeaning: z.string(),
  patientExplanation: z.string(),
  recommendedFollowUp: z.string(),
  confidence: z.number(),
  pageNumber: z.number().nullable().optional(),
  sourceSnippet: z.string().nullable().optional(),
  sourceRowText: z.string().nullable().optional(),
  extractionMethod: extractionMethodSchema.nullable().optional(),
});

export const labAnalysisReportSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  sourceDocument: z.object({
    fileName: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    sizeBytes: z.number().nullable().optional(),
    sourceType: z.enum(["sample", "pdf", "image"]),
    pageCount: z.number().nullable().optional(),
    persisted: z.literal(false).optional(),
  }),
  language: z.object({
    detected: z.string(),
    reportLanguage: z.literal("en"),
  }),
  patient: z.object({
    name: z.string().nullable().optional(),
    sex: z.string().nullable().optional(),
    ageText: z.string().nullable().optional(),
    patientLabel: z.string().nullable().optional(),
  }),
  summary: z.object({
    headline: z.string(),
    bullets: z.array(z.string()),
    overallRisk: labSeveritySchema,
  }),
  abnormalFindings: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: labSeveritySchema,
      explanation: z.string(),
      relatedResultIds: z.array(z.string()),
      actionability: actionabilitySchema,
    }),
  ),
  results: z.array(labResultRowSchema),
  nextSteps: z.object({
    urgentAttention: z.array(z.string()),
    discussWithClinicianSoon: z.array(z.string()),
    routineFollowUpOrMonitoring: z.array(z.string()),
  }),
  quality: z.object({
    missingInformation: z.array(z.string()),
    ambiguities: z.array(z.string()),
    warnings: z.array(z.string()),
    processingNotes: z.array(z.string()),
    degradedMode: z.boolean(),
  }),
  sourceText: z.string(),
  processing: z.object({
    mode: processingModeSchema,
    usedClaude: z.boolean(),
    usedMock: z.boolean(),
    pageCount: z.number().nullable().optional(),
    extractionModes: z.array(
      z.object({
        pageNumber: z.number(),
        mode: extractionMethodSchema,
      }),
    ),
  }),
  provenance: z.object({
    pagesWithExtractionFailures: z.array(z.number()),
    failedPageCount: z.number(),
    extractionModel: z.string().nullable().optional(),
    visionModel: z.string().nullable().optional(),
    reasoningModel: z.string().nullable().optional(),
  }),
});

export type LabAnalysisReportInput = z.infer<typeof labAnalysisReportSchema>;
