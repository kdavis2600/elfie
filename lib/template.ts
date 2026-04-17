import { applyTemplateHeuristicDiagnostics } from "@/lib/templateLayout";
import {
  PdfTemplate,
  TemplateContentKey,
  TemplateOverflowBehavior,
  TemplateRegion,
  TemplateRegionStyle,
} from "@/types/template";

const STRUCTURE_VERSION = 2;

const DEFAULT_REGION_STYLES: Record<TemplateRegion["id"], TemplateRegionStyle> = {
  header: {
    fontSize: 11.5,
    minFontSize: 9,
    lineHeight: 1.24,
    paddingX: 10,
    paddingY: 8,
    backgroundOpacity: 0.82,
    showLabel: true,
  },
  history: {
    fontSize: 10.8,
    minFontSize: 8.2,
    lineHeight: 1.22,
    paddingX: 10,
    paddingY: 8,
    backgroundOpacity: 0.82,
    showLabel: true,
  },
  assessment: {
    fontSize: 10.8,
    minFontSize: 8.2,
    lineHeight: 1.22,
    paddingX: 10,
    paddingY: 8,
    backgroundOpacity: 0.82,
    showLabel: true,
  },
  plan: {
    fontSize: 10.8,
    minFontSize: 8.2,
    lineHeight: 1.22,
    paddingX: 10,
    paddingY: 8,
    backgroundOpacity: 0.82,
    showLabel: true,
  },
};

const DEFAULT_CONTENT_KEYS: Record<TemplateRegion["id"], TemplateContentKey> = {
  header: "visit_summary",
  history: "history_findings",
  assessment: "assessment_summary",
  plan: "plan_follow_up",
};

const DEFAULT_MAX_LINES: Record<TemplateRegion["id"], number> = {
  header: 5,
  history: 13,
  assessment: 8,
  plan: 9,
};

const DEFAULT_OVERFLOW_BEHAVIOR: TemplateOverflowBehavior = "shrink_then_truncate";

const DEFAULT_REGIONS: TemplateRegion[] = [
  buildDefaultRegion({ id: "header", label: "Visit summary", x: 0.08, y: 0.08, width: 0.84, height: 0.14 }),
  buildDefaultRegion({ id: "history", label: "History and findings", x: 0.08, y: 0.28, width: 0.38, height: 0.34 }),
  buildDefaultRegion({ id: "assessment", label: "Assessment", x: 0.54, y: 0.28, width: 0.38, height: 0.22 }),
  buildDefaultRegion({ id: "plan", label: "Plan and follow-up", x: 0.08, y: 0.68, width: 0.84, height: 0.22 }),
];

export function createDraftTemplate(input: {
  name: string;
  importType: PdfTemplate["importType"];
  sourceUri: string;
  previewUri: string;
  mimeType: string;
  previewMimeType: string;
  width: number;
  height: number;
}): PdfTemplate {
  return applyTemplateHeuristicDiagnostics({
    id: `template-${Date.now()}`,
    structureVersion: STRUCTURE_VERSION,
    name: input.name,
    importType: input.importType,
    sourceUri: input.sourceUri,
    previewUri: input.previewUri,
    mimeType: input.mimeType,
    previewMimeType: input.previewMimeType,
    width: input.width,
    height: input.height,
    createdAt: new Date().toISOString(),
    regions: DEFAULT_REGIONS.map((region) => ({ ...region })),
    sanityCheck: null,
  });
}

export function updateTemplateRegion(
  template: PdfTemplate,
  regionId: TemplateRegion["id"],
  updater: (region: TemplateRegion) => TemplateRegion,
) {
  return {
    ...template,
    sanityCheck: null,
    regions: template.regions.map((region) =>
      region.id === regionId ? clearRegionDiagnostics(clampRegion(updater(region))) : region,
    ),
  };
}

export function clampRegion(region: TemplateRegion): TemplateRegion {
  const width = clamp(region.width, 0.16, 0.92);
  const height = clamp(region.height, 0.08, 0.72);
  const x = clamp(region.x, 0.02, 0.98 - width);
  const y = clamp(region.y, 0.02, 0.98 - height);

  return {
    ...region,
    x,
    y,
    width,
    height,
    contentKey: region.contentKey ?? DEFAULT_CONTENT_KEYS[region.id],
    maxLines: typeof region.maxLines === "number" && Number.isFinite(region.maxLines) ? Math.max(2, Math.round(region.maxLines)) : DEFAULT_MAX_LINES[region.id],
    blankWhenMissing: typeof region.blankWhenMissing === "boolean" ? region.blankWhenMissing : true,
    overflowBehavior: region.overflowBehavior ?? DEFAULT_OVERFLOW_BEHAVIOR,
    style: normalizeRegionStyle(region.id, region.style),
  };
}

export function findTemplateRegion(template: PdfTemplate, regionId: TemplateRegion["id"]) {
  return template.regions.find((region) => region.id === regionId) ?? template.regions[0];
}

export function normalizeTemplate(input: unknown): PdfTemplate | null {
  if (!isRecord(input)) {
    return null;
  }

  const sourceUri = asString(input.sourceUri);
  const previewUri = asString(input.previewUri);
  if (!sourceUri || !previewUri) {
    return null;
  }

  const rawRegions = Array.isArray(input.regions) ? input.regions : [];
  const normalizedRegions = DEFAULT_REGIONS.map((fallbackRegion) => {
    const match = rawRegions.find((value) => isRecord(value) && value.id === fallbackRegion.id);
    return clearRegionDiagnostics(clampRegion({
      ...fallbackRegion,
      ...(isRecord(match)
        ? {
            label: asString(match.label) || fallbackRegion.label,
            x: asNumber(match.x, fallbackRegion.x),
            y: asNumber(match.y, fallbackRegion.y),
            width: asNumber(match.width, fallbackRegion.width),
            height: asNumber(match.height, fallbackRegion.height),
            contentKey: readContentKey(match.contentKey, fallbackRegion.contentKey),
            maxLines: asPositiveInteger(match.maxLines, fallbackRegion.maxLines ?? DEFAULT_MAX_LINES[fallbackRegion.id]),
            blankWhenMissing: asBoolean(match.blankWhenMissing, fallbackRegion.blankWhenMissing ?? true),
            overflowBehavior: readOverflowBehavior(match.overflowBehavior, fallbackRegion.overflowBehavior ?? DEFAULT_OVERFLOW_BEHAVIOR),
            style: normalizeRegionStyle(fallbackRegion.id, readRegionStyle(match.style, fallbackRegion.style)),
          }
        : {}),
    }));
  });

  return applyTemplateHeuristicDiagnostics({
    id: asString(input.id) || `template-${Date.now()}`,
    structureVersion: asPositiveInteger(input.structureVersion, STRUCTURE_VERSION),
    name: asString(input.name) || "Clinic template",
    importType: input.importType === "photo" || input.importType === "image" || input.importType === "pdf" ? input.importType : "image",
    sourceUri,
    previewUri,
    mimeType: asString(input.mimeType) || "image/jpeg",
    previewMimeType: asString(input.previewMimeType) || "image/jpeg",
    width: asPositiveNumber(input.width, 816),
    height: asPositiveNumber(input.height, 1056),
    createdAt: asString(input.createdAt) || new Date().toISOString(),
    regions: normalizedRegions,
    sanityCheck: null,
  });
}

function buildDefaultRegion(input: Pick<TemplateRegion, "id" | "label" | "x" | "y" | "width" | "height">): TemplateRegion {
  return {
    ...input,
    contentKey: DEFAULT_CONTENT_KEYS[input.id],
    maxLines: DEFAULT_MAX_LINES[input.id],
    blankWhenMissing: true,
    overflowBehavior: DEFAULT_OVERFLOW_BEHAVIOR,
    style: DEFAULT_REGION_STYLES[input.id],
    diagnostics: null,
  };
}

function clearRegionDiagnostics(region: TemplateRegion): TemplateRegion {
  return {
    ...region,
    diagnostics: null,
  };
}

function normalizeRegionStyle(regionId: TemplateRegion["id"], value?: Partial<TemplateRegionStyle> | null): TemplateRegionStyle {
  return {
    ...DEFAULT_REGION_STYLES[regionId],
    ...(value ?? {}),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asPositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function asPositiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readContentKey(value: unknown, fallback: TemplateContentKey) {
  return value === "visit_summary" ||
    value === "patient_header" ||
    value === "chief_complaint" ||
    value === "history_findings" ||
    value === "assessment_summary" ||
    value === "diagnoses" ||
    value === "plan_follow_up" ||
    value === "follow_up"
    ? value
    : fallback;
}

function readOverflowBehavior(value: unknown, fallback: TemplateOverflowBehavior) {
  return value === "shrink_then_truncate" || value === "truncate" ? value : fallback;
}

function readRegionStyle(value: unknown, fallback?: TemplateRegionStyle) {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    fontSize: asPositiveNumber(value.fontSize, fallback?.fontSize ?? 11),
    minFontSize: asPositiveNumber(value.minFontSize, fallback?.minFontSize ?? 8),
    lineHeight: asPositiveNumber(value.lineHeight, fallback?.lineHeight ?? 1.25),
    paddingX: asPositiveNumber(value.paddingX, fallback?.paddingX ?? 10),
    paddingY: asPositiveNumber(value.paddingY, fallback?.paddingY ?? 8),
    backgroundOpacity: typeof value.backgroundOpacity === "number" && Number.isFinite(value.backgroundOpacity)
      ? clamp(value.backgroundOpacity, 0.2, 1)
      : (fallback?.backgroundOpacity ?? 0.82),
    showLabel: asBoolean(value.showLabel, fallback?.showLabel ?? true),
  };
}
