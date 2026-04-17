export type LabDocumentSourceType = "sample" | "pdf" | "image";

export type LabProcessingMode = "mock" | "hybrid" | "qwen_only";

export type LabFlag = "low" | "normal" | "high" | "out_of_range" | "unknown";

export type LabSeverity = "none" | "mild" | "moderate" | "high" | "critical" | "unknown";

export type LabActionabilityBucket =
  | "urgent_attention"
  | "discuss_with_clinician_soon"
  | "routine_follow_up_or_monitoring";

export type LabExtractionMethod = "text" | "ocr" | "vision" | "unknown";

export type PendingLabDocument = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sourceType: LabDocumentSourceType;
};

export type LabResultRow = {
  id: string;
  testNameRaw: string;
  testNameCanonical?: string | null;
  panelName?: string | null;
  valueRaw: string;
  valueNumeric?: number | null;
  unit?: string | null;
  referenceRangeRaw?: string | null;
  referenceLow?: number | null;
  referenceHigh?: number | null;
  flag: LabFlag;
  severity: LabSeverity;
  clinicalMeaning: string;
  patientExplanation: string;
  recommendedFollowUp: string;
  confidence: number;
  pageNumber?: number | null;
  sourceSnippet?: string | null;
  sourceRowText?: string | null;
  extractionMethod?: LabExtractionMethod | null;
};

export type LabAbnormalFinding = {
  id: string;
  title: string;
  severity: LabSeverity;
  explanation: string;
  relatedResultIds: string[];
  actionability: LabActionabilityBucket;
};

export type LabAnalysisReport = {
  id: string;
  createdAt: string;
  sourceDocument: {
    fileName?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    sourceType: LabDocumentSourceType;
    pageCount?: number | null;
    persisted?: false;
  };
  language: {
    detected: string;
    reportLanguage: "en";
  };
  patient: {
    name?: string | null;
    sex?: string | null;
    ageText?: string | null;
    patientLabel?: string | null;
  };
  summary: {
    headline: string;
    bullets: string[];
    overallRisk: LabSeverity;
  };
  abnormalFindings: LabAbnormalFinding[];
  results: LabResultRow[];
  nextSteps: {
    urgentAttention: string[];
    discussWithClinicianSoon: string[];
    routineFollowUpOrMonitoring: string[];
  };
  quality: {
    missingInformation: string[];
    ambiguities: string[];
    warnings: string[];
    processingNotes: string[];
    degradedMode: boolean;
  };
  sourceText: string;
  processing: {
    mode: LabProcessingMode;
    usedClaude: boolean;
    usedMock: boolean;
    pageCount?: number | null;
    extractionModes: Array<{
      pageNumber: number;
      mode: LabExtractionMethod;
    }>;
  };
  provenance: {
    pagesWithExtractionFailures: number[];
    failedPageCount: number;
    extractionModel?: string | null;
    visionModel?: string | null;
    reasoningModel?: string | null;
  };
};

export type StoredLabReport = {
  report: LabAnalysisReport;
  pdfUri?: string | null;
};
