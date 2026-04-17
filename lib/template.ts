import { PdfTemplate, TemplateRegion } from "@/types/template";

const DEFAULT_REGIONS: TemplateRegion[] = [
  { id: "header", label: "Visit summary", x: 0.08, y: 0.08, width: 0.84, height: 0.14 },
  { id: "history", label: "History and findings", x: 0.08, y: 0.28, width: 0.38, height: 0.34 },
  { id: "assessment", label: "Assessment", x: 0.54, y: 0.28, width: 0.38, height: 0.22 },
  { id: "plan", label: "Plan and follow-up", x: 0.08, y: 0.68, width: 0.84, height: 0.22 },
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
  return {
    id: `template-${Date.now()}`,
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
  };
}

export function updateTemplateRegion(
  template: PdfTemplate,
  regionId: TemplateRegion["id"],
  updater: (region: TemplateRegion) => TemplateRegion,
) {
  return {
    ...template,
    regions: template.regions.map((region) => (region.id === regionId ? clampRegion(updater(region)) : region)),
  };
}

export function clampRegion(region: TemplateRegion): TemplateRegion {
  const width = clamp(region.width, 0.16, 0.92);
  const height = clamp(region.height, 0.08, 0.72);
  const x = clamp(region.x, 0.02, 0.98 - width);
  const y = clamp(region.y, 0.02, 0.98 - height);

  return { ...region, x, y, width, height };
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
    return clampRegion({
      ...fallbackRegion,
      ...(isRecord(match)
        ? {
            label: asString(match.label) || fallbackRegion.label,
            x: asNumber(match.x, fallbackRegion.x),
            y: asNumber(match.y, fallbackRegion.y),
            width: asNumber(match.width, fallbackRegion.width),
            height: asNumber(match.height, fallbackRegion.height),
          }
        : null),
    });
  });

  return {
    id: asString(input.id) || `template-${Date.now()}`,
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
