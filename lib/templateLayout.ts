import { ConsultationReport } from "@/types/report";
import {
  PdfTemplate,
  TemplateContentKey,
  TemplateFitRisk,
  TemplateRegion,
  TemplateRegionDiagnostics,
  TemplateSanityCheck,
} from "@/types/template";

const TARGET_PAGE_WIDTH = 816;
const TARGET_PAGE_HEIGHT = 1056;
const DEFAULT_CHAR_WIDTH_RATIO = 0.56;

type TemplateContentBlock = {
  title: string;
  lines: string[];
};

export type TemplateResolvedRegionLayout = {
  region: TemplateRegion;
  title: string;
  displayLines: string[];
  fontSize: number;
  lineHeight: number;
  diagnostics: TemplateRegionDiagnostics;
};

export type TemplateSpotCheckRegionPayload = {
  id: TemplateRegion["id"];
  label: string;
  contentKey: TemplateContentKey;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  backgroundOpacity: number;
  overflowRisk: TemplateFitRisk;
};

export const TEMPLATE_CONTENT_OPTIONS: Array<{
  key: TemplateContentKey;
  label: string;
  description: string;
}> = [
  {
    key: "visit_summary",
    label: "Visit summary",
    description: "One-line summary with visit reason and date.",
  },
  {
    key: "patient_header",
    label: "Patient header",
    description: "Patient, clinician, date, and reason when available.",
  },
  {
    key: "chief_complaint",
    label: "Chief complaint",
    description: "Short presenting complaint and top symptoms.",
  },
  {
    key: "history_findings",
    label: "History and findings",
    description: "Narrative HPI plus key symptoms and objective findings.",
  },
  {
    key: "assessment_summary",
    label: "Assessment",
    description: "Assessment summary with top diagnoses.",
  },
  {
    key: "diagnoses",
    label: "Diagnoses only",
    description: "Diagnosis-focused list without the longer assessment text.",
  },
  {
    key: "plan_follow_up",
    label: "Plan and follow-up",
    description: "Combined medications, tests, referrals, and instructions.",
  },
  {
    key: "follow_up",
    label: "Follow-up only",
    description: "Follow-up timing and patient instructions.",
  },
];

export function getTemplateContentOption(contentKey: TemplateContentKey) {
  return TEMPLATE_CONTENT_OPTIONS.find((option) => option.key === contentKey) ?? TEMPLATE_CONTENT_OPTIONS[0];
}

export function getTemplateScaledPageSize(template: Pick<PdfTemplate, "width" | "height">) {
  const scale = Math.min(TARGET_PAGE_WIDTH / template.width, TARGET_PAGE_HEIGHT / template.height);
  return {
    pageWidth: Math.round(template.width * scale),
    pageHeight: Math.round(template.height * scale),
  };
}

export function resolveTemplateRegionLayouts(
  template: PdfTemplate,
  report?: ConsultationReport | null,
): TemplateResolvedRegionLayout[] {
  const { pageWidth, pageHeight } = getTemplateScaledPageSize(template);
  const contentMap = buildTemplateContentMap(report);

  return template.regions.map((region) =>
    resolveTemplateRegionLayout(region, contentMap[region.contentKey] ?? contentMap.visit_summary, pageWidth, pageHeight),
  );
}

export function buildTemplateHeuristicSanityCheck(
  template: PdfTemplate,
  report?: ConsultationReport | null,
): TemplateSanityCheck {
  const layouts = resolveTemplateRegionLayouts(template, report);
  const overallRisk = rankHighestRisk(layouts.map((layout) => layout.diagnostics.overflowRisk));
  const suggestions = uniqueStrings(
    layouts.flatMap((layout) => layout.diagnostics.suggestions).filter(Boolean).slice(0, 6),
  );

  return {
    checkedAt: new Date().toISOString(),
    checker: "heuristic",
    overallRisk,
    summary: buildHeuristicSummary(overallRisk),
    suggestions,
    regionFindings: layouts.map((layout) => ({
      regionId: layout.region.id,
      contentKey: layout.region.contentKey,
      overflowRisk: layout.diagnostics.overflowRisk,
      note: buildRegionFinding(layout),
    })),
  };
}

export function applyTemplateHeuristicDiagnostics(
  template: PdfTemplate,
  report?: ConsultationReport | null,
): PdfTemplate {
  const layouts = resolveTemplateRegionLayouts(template, report);
  const diagnosticsByRegion = new Map(layouts.map((layout) => [layout.region.id, layout.diagnostics]));

  return {
    ...template,
    regions: template.regions.map((region) => ({
      ...region,
      diagnostics: diagnosticsByRegion.get(region.id) ?? null,
    })),
    sanityCheck: buildTemplateHeuristicSanityCheck(template, report),
  };
}

export function buildTemplateSpotCheckPayload(template: PdfTemplate, report?: ConsultationReport | null) {
  const { pageWidth, pageHeight } = getTemplateScaledPageSize(template);
  const layouts = resolveTemplateRegionLayouts(template, report);

  return {
    pageWidth,
    pageHeight,
    regions: layouts.map<TemplateSpotCheckRegionPayload>((layout) => ({
      id: layout.region.id,
      label: layout.region.label,
      contentKey: layout.region.contentKey,
      x: layout.region.x,
      y: layout.region.y,
      width: layout.region.width,
      height: layout.region.height,
      title: layout.title,
      lines: layout.displayLines,
      fontSize: layout.fontSize,
      lineHeight: layout.lineHeight,
      backgroundOpacity: layout.region.style?.backgroundOpacity ?? 0.82,
      overflowRisk: layout.diagnostics.overflowRisk,
    })),
  };
}

function resolveTemplateRegionLayout(
  region: TemplateRegion,
  content: TemplateContentBlock,
  pageWidth: number,
  pageHeight: number,
): TemplateResolvedRegionLayout {
  const style = region.style;
  const maxFontSize = style?.fontSize ?? 11;
  const minFontSize = style?.minFontSize ?? 8;
  const lineHeightRatio = style?.lineHeight ?? 1.25;
  const paddingX = style?.paddingX ?? 10;
  const paddingY = style?.paddingY ?? 8;
  const allowShrink = region.overflowBehavior !== "truncate";
  const rawLines = normalizeContentLines(content.lines, region.blankWhenMissing ?? true);
  const title = style?.showLabel === false ? "" : content.title;

  let fontSize = maxFontSize;
  let wrappedLines = wrapContentLines(rawLines, getCharsPerLine(region.width * pageWidth - paddingX * 2, fontSize));
  let availableLines = calculateAvailableLines(region, pageWidth, pageHeight, fontSize, lineHeightRatio, paddingY, title);

  while (allowShrink && wrappedLines.length > availableLines && fontSize > minFontSize) {
    fontSize = Math.max(minFontSize, Number((fontSize - 0.5).toFixed(1)));
    wrappedLines = wrapContentLines(rawLines, getCharsPerLine(region.width * pageWidth - paddingX * 2, fontSize));
    availableLines = calculateAvailableLines(region, pageWidth, pageHeight, fontSize, lineHeightRatio, paddingY, title);
  }

  const didShrink = fontSize < maxFontSize;
  const estimatedLines = wrappedLines.length;
  const didTruncate = wrappedLines.length > availableLines;
  const displayLines = didTruncate ? truncateWrappedLines(wrappedLines, availableLines) : wrappedLines;
  const overflowRisk = resolveOverflowRisk({
    estimatedLines,
    availableLines,
    didShrink,
    didTruncate,
    rawLines,
  });

  return {
    region,
    title,
    displayLines,
    fontSize,
    lineHeight: Number((fontSize * lineHeightRatio).toFixed(1)),
    diagnostics: {
      checkedAt: new Date().toISOString(),
      checker: "heuristic",
      overflowRisk,
      estimatedLines,
      availableLines,
      didShrink,
      didTruncate,
      suggestions: buildOverflowSuggestions(region, overflowRisk, didShrink, didTruncate, rawLines),
      preview: displayLines.slice(0, 4),
    },
  };
}

function buildTemplateContentMap(report?: ConsultationReport | null): Record<TemplateContentKey, TemplateContentBlock> {
  if (!report) {
    return {
      visit_summary: {
        title: "Visit summary",
        lines: ["Follow-up for persistent cough with improving energy.", "Reason: cough and fatigue", "Date: 4/17/2026"],
      },
      patient_header: {
        title: "Patient details",
        lines: ["Patient: [blank when not captured]", "Clinician: [blank when not captured]", "Date: 4/17/2026"],
      },
      chief_complaint: {
        title: "Chief complaint",
        lines: ["Dry cough for 1 week with nasal congestion."],
      },
      history_findings: {
        title: "History and findings",
        lines: [
          "Dry cough worse at night, no shortness of breath, appetite intact.",
          "Symptoms: cough, congestion, sore throat",
          "Findings: afebrile, lungs clear, oxygen saturation normal",
        ],
      },
      assessment_summary: {
        title: "Assessment",
        lines: ["Likely viral upper respiratory infection without red-flag features.", "Diagnosis: viral URI (likely)"],
      },
      diagnoses: {
        title: "Diagnoses",
        lines: ["Viral URI (likely)", "Post-viral cough (possible)"],
      },
      plan_follow_up: {
        title: "Plan and follow-up",
        lines: ["Supportive care, hydration, return if fever or dyspnea develops.", "Follow-up PRN or sooner if worsening."],
      },
      follow_up: {
        title: "Follow-up",
        lines: ["Return if fever, chest pain, or worsening shortness of breath.", "Follow-up in 1 week if not improving."],
      },
    };
  }

  const objectiveItems = [
    ...report.soap.objective.vitals,
    ...report.soap.objective.findings,
    ...report.soap.objective.testsOrResults,
    ...report.soap.objective.observations,
  ];
  const diagnosisItems = report.soap.assessment.diagnoses.map((item) => `${item.name} (${item.confidence})`);
  const planItems = [
    ...report.soap.plan.medications,
    ...report.soap.plan.testsOrdered,
    ...report.soap.plan.referrals,
    ...report.soap.plan.followUp,
    ...report.soap.plan.patientInstructions,
    ...report.soap.plan.clinicianTasks,
    ...report.soap.plan.lifestyleAdvice,
  ];
  const followUpItems = [
    ...report.soap.plan.followUp,
    ...report.soap.plan.patientInstructions,
    ...report.soap.plan.testsOrdered,
  ];

  return {
    visit_summary: {
      title: "Visit summary",
      lines: compactTemplateLines([
        report.summary.oneLiner,
        report.visit.visitReason ? `Reason: ${report.visit.visitReason}` : "",
        report.createdAt ? `Date: ${formatTemplateDate(report.createdAt)}` : "",
      ]),
    },
    patient_header: {
      title: "Patient details",
      lines: compactTemplateLines([
        report.visit.patientName ? `Patient: ${report.visit.patientName}` : "",
        report.visit.clinicianName ? `Clinician: ${report.visit.clinicianName}` : "",
        report.createdAt ? `Date: ${formatTemplateDate(report.createdAt)}` : "",
        report.visit.visitReason ? `Reason: ${report.visit.visitReason}` : "",
      ]),
    },
    chief_complaint: {
      title: "Chief complaint",
      lines: compactTemplateLines([report.soap.subjective.chiefComplaint, ...report.soap.subjective.symptoms.slice(0, 2)]),
    },
    history_findings: {
      title: "History and findings",
      lines: compactTemplateLines([
        report.soap.subjective.hpi,
        ...report.soap.subjective.symptoms.slice(0, 4),
        ...objectiveItems.slice(0, 4),
      ]),
    },
    assessment_summary: {
      title: "Assessment",
      lines: compactTemplateLines([report.soap.assessment.summary, ...diagnosisItems.slice(0, 4)]),
    },
    diagnoses: {
      title: "Diagnoses",
      lines: compactTemplateLines(diagnosisItems.slice(0, 6)),
    },
    plan_follow_up: {
      title: "Plan and follow-up",
      lines: compactTemplateLines(planItems.slice(0, 8)),
    },
    follow_up: {
      title: "Follow-up",
      lines: compactTemplateLines(followUpItems.slice(0, 6)),
    },
  };
}

function compactTemplateLines(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeContentLines(values: string[], blankWhenMissing: boolean) {
  const lines = compactTemplateLines(values);
  if (lines.length || blankWhenMissing) {
    return lines;
  }
  return ["Not stated"];
}

function formatTemplateDate(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleDateString();
}

function getCharsPerLine(innerWidth: number, fontSize: number) {
  const safeInnerWidth = Math.max(48, innerWidth);
  const safeFontSize = Math.max(8, fontSize);
  return Math.max(10, Math.floor(safeInnerWidth / (safeFontSize * DEFAULT_CHAR_WIDTH_RATIO)));
}

function calculateAvailableLines(
  region: TemplateRegion,
  pageWidth: number,
  pageHeight: number,
  fontSize: number,
  lineHeightRatio: number,
  paddingY: number,
  title: string,
) {
  const boxHeight = Math.max(24, region.height * pageHeight - paddingY * 2);
  const lineHeightPx = fontSize * lineHeightRatio;
  const totalLines = Math.max(1, Math.floor(boxHeight / lineHeightPx));
  const titleLines = title ? 1 : 0;
  const maxLines = region.maxLines ?? Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(totalLines - titleLines, maxLines));
}

function wrapContentLines(lines: string[], maxChars: number) {
  return lines.flatMap((line) => wrapSingleLine(line, maxChars));
}

function wrapSingleLine(line: string, maxChars: number) {
  const trimmed = line.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.length <= maxChars) {
    return [trimmed];
  }

  const words = trimmed.split(/\s+/);
  const wrapped: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
      continue;
    }

    wrapped.push(current);

    if (word.length > maxChars) {
      wrapped.push(...chunkLongToken(word, maxChars).slice(0, -1));
      current = chunkLongToken(word, maxChars).slice(-1)[0] ?? "";
      continue;
    }

    current = word;
  }

  if (current) {
    wrapped.push(current);
  }

  return wrapped;
}

function chunkLongToken(token: string, maxChars: number) {
  const chunks: string[] = [];
  let cursor = token;

  while (cursor.length > maxChars) {
    chunks.push(`${cursor.slice(0, Math.max(1, maxChars - 1))}-`);
    cursor = cursor.slice(Math.max(1, maxChars - 1));
  }

  if (cursor) {
    chunks.push(cursor);
  }

  return chunks;
}

function truncateWrappedLines(lines: string[], availableLines: number) {
  if (availableLines <= 0) {
    return [];
  }
  if (lines.length <= availableLines) {
    return lines;
  }

  const truncated = lines.slice(0, availableLines);
  const lastLine = truncated[availableLines - 1] ?? "";
  truncated[availableLines - 1] = lastLine.length >= 3 ? `${lastLine.replace(/\.*$/, "").slice(0, Math.max(0, lastLine.length - 1))}…` : "…";
  return truncated;
}

function resolveOverflowRisk(input: {
  estimatedLines: number;
  availableLines: number;
  didShrink: boolean;
  didTruncate: boolean;
  rawLines: string[];
}): TemplateFitRisk {
  if (!input.rawLines.length) {
    return "low";
  }
  if (input.didTruncate || (input.availableLines === 0 && input.rawLines.length > 0)) {
    return "high";
  }
  if (input.didShrink || input.estimatedLines >= Math.max(1, input.availableLines) || input.availableLines <= 2) {
    return "medium";
  }
  return "low";
}

function buildOverflowSuggestions(
  region: TemplateRegion,
  overflowRisk: TemplateFitRisk,
  didShrink: boolean,
  didTruncate: boolean,
  rawLines: string[],
) {
  const suggestions: string[] = [];

  if (didTruncate) {
    suggestions.push("Make this box taller or map a shorter section here.");
  } else if (didShrink) {
    suggestions.push("This field fits only after shrinking the text. A wider or taller box will read better.");
  }

  if (overflowRisk !== "low" && rawLines.length > 2 && region.width < 0.34) {
    suggestions.push("This region is narrow for dense narrative text. Widen it or switch it to a shorter field.");
  }

  if (overflowRisk === "high" && region.height < 0.14) {
    suggestions.push("This region is short for multi-line content. Increase its height.");
  }

  return uniqueStrings(suggestions);
}

function buildHeuristicSummary(overallRisk: TemplateFitRisk) {
  switch (overallRisk) {
    case "high":
      return "One or more fields are likely to clip or truncate in the generated PDF.";
    case "medium":
      return "The layout is usable, but at least one field is tight and may benefit from resizing.";
    default:
      return "The current field layout looks stable for the sample note content.";
  }
}

function buildRegionFinding(layout: TemplateResolvedRegionLayout) {
  const optionLabel = getTemplateContentOption(layout.region.contentKey).label;

  if (layout.diagnostics.didTruncate) {
    return `${optionLabel} is being truncated in this region.`;
  }
  if (layout.diagnostics.didShrink) {
    return `${optionLabel} fits only after shrinking the text.`;
  }
  if (!layout.displayLines.length) {
    return `${optionLabel} is blank unless matching source data exists.`;
  }
  return `${optionLabel} fits within the current bounds.`;
}

function rankHighestRisk(risks: TemplateFitRisk[]): TemplateFitRisk {
  if (risks.includes("high")) {
    return "high";
  }
  if (risks.includes("medium")) {
    return "medium";
  }
  return "low";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
