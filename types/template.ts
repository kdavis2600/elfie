export type TemplateImportType = "photo" | "image" | "pdf";

export type TemplateRegionId = "header" | "history" | "assessment" | "plan";

export type TemplateContentKey =
  | "visit_summary"
  | "patient_header"
  | "chief_complaint"
  | "history_findings"
  | "assessment_summary"
  | "diagnoses"
  | "plan_follow_up"
  | "follow_up";

export type TemplateFitRisk = "low" | "medium" | "high";

export type TemplateOverflowBehavior = "shrink_then_truncate" | "truncate";

export type TemplateRegionStyle = {
  fontSize: number;
  minFontSize: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  backgroundOpacity: number;
  showLabel: boolean;
};

export type TemplateRegionDiagnostics = {
  checkedAt: string;
  checker: "heuristic" | "ai";
  overflowRisk: TemplateFitRisk;
  estimatedLines: number;
  availableLines: number;
  didShrink: boolean;
  didTruncate: boolean;
  suggestions: string[];
  preview: string[];
};

export type TemplateRegion = {
  id: TemplateRegionId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  contentKey: TemplateContentKey;
  maxLines?: number | null;
  blankWhenMissing?: boolean;
  overflowBehavior?: TemplateOverflowBehavior;
  style?: TemplateRegionStyle;
  diagnostics?: TemplateRegionDiagnostics | null;
};

export type TemplateSanityCheck = {
  checkedAt: string;
  checker: "heuristic" | "ai";
  overallRisk: TemplateFitRisk;
  summary: string;
  suggestions: string[];
  regionFindings: Array<{
    regionId: TemplateRegionId;
    contentKey: TemplateContentKey;
    overflowRisk: TemplateFitRisk;
    note: string;
  }>;
};

export type PdfTemplate = {
  id: string;
  structureVersion?: number;
  name: string;
  importType: TemplateImportType;
  sourceUri: string;
  previewUri: string;
  mimeType: string;
  previewMimeType: string;
  width: number;
  height: number;
  createdAt: string;
  regions: TemplateRegion[];
  sanityCheck?: TemplateSanityCheck | null;
};
