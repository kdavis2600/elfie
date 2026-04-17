export type TemplateImportType = "photo" | "image" | "pdf";

export type TemplateRegionId = "header" | "history" | "assessment" | "plan";

export type TemplateRegion = {
  id: TemplateRegionId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTemplate = {
  id: string;
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
};
