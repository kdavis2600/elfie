import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { normalizeTemplate } from "@/lib/template";
import { StoredLabReport } from "@/types/labReport";
import { SavedAudioImport } from "@/types/import";
import { StoredReport } from "@/types/report";
import { PdfTemplate } from "@/types/template";

const LATEST_REPORT_KEY = "elfie.latest-report";
const REPORT_HISTORY_KEY = "elfie.report-history";
const LATEST_LAB_REPORT_KEY = "elfie.latest-lab-report";
const LAB_REPORT_HISTORY_KEY = "elfie.lab-report-history";
const IMPORTED_AUDIO_HISTORY_KEY = "elfie.imported-audio-history";
const TEMPLATE_KEY = "elfie.template";
const REPORT_DIR = `${FileSystem.documentDirectory ?? ""}elfie`;

async function ensureDirAsync() {
  if (!FileSystem.documentDirectory) {
    return;
  }

  const info = await FileSystem.getInfoAsync(REPORT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(REPORT_DIR, { intermediates: true });
  }
}

export async function persistPdfAsync(sourceUri: string, targetName: string) {
  await ensureDirAsync();
  const targetUri = `${REPORT_DIR}/${targetName}`;
  if (sourceUri === targetUri) {
    return targetUri;
  }
  const existing = await FileSystem.getInfoAsync(targetUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

export async function persistTemplateAssetAsync(sourceUri: string, targetName: string) {
  await ensureDirAsync();
  const targetUri = `${REPORT_DIR}/${targetName}`;
  if (sourceUri === targetUri) {
    return targetUri;
  }
  const existing = await FileSystem.getInfoAsync(targetUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

export async function persistImportedAudioAsync(sourceUri: string, targetName: string) {
  await ensureDirAsync();
  const targetUri = `${REPORT_DIR}/${targetName}`;
  if (sourceUri === targetUri) {
    return targetUri;
  }
  const existing = await FileSystem.getInfoAsync(targetUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

export async function writeTemplateBase64Async(base64: string, targetName: string) {
  await ensureDirAsync();
  const targetUri = `${REPORT_DIR}/${targetName}`;
  const existing = await FileSystem.getInfoAsync(targetUri);
  if (existing.exists) {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
  }
  await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return targetUri;
}

export async function deletePersistedFileAsync(uri?: string | null) {
  if (!uri) {
    return;
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // Best-effort cleanup only.
  }
}

export function collectTemplateAssetUris(template?: PdfTemplate | null) {
  return [...new Set([template?.sourceUri ?? null, template?.previewUri ?? null].filter((value): value is string => Boolean(value)))];
}

export async function deleteTemplateAssetsAsync(template?: PdfTemplate | null) {
  await Promise.all(collectTemplateAssetUris(template).map((uri) => deletePersistedFileAsync(uri)));
}

export async function saveLatestReportAsync(value: StoredReport) {
  await AsyncStorage.setItem(LATEST_REPORT_KEY, JSON.stringify(value));
}

export async function saveReportHistoryAsync(values: StoredReport[]) {
  await AsyncStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(values));
}

export async function saveLatestLabReportAsync(value: StoredLabReport) {
  await AsyncStorage.setItem(LATEST_LAB_REPORT_KEY, JSON.stringify(value));
}

export async function saveLabReportHistoryAsync(values: StoredLabReport[]) {
  await AsyncStorage.setItem(LAB_REPORT_HISTORY_KEY, JSON.stringify(values));
}

export async function saveImportedAudioHistoryAsync(values: SavedAudioImport[]) {
  await AsyncStorage.setItem(IMPORTED_AUDIO_HISTORY_KEY, JSON.stringify(values));
}

export async function loadLatestReportAsync(): Promise<StoredReport | null> {
  try {
    const raw = await AsyncStorage.getItem(LATEST_REPORT_KEY);
    return raw ? (JSON.parse(raw) as StoredReport) : null;
  } catch {
    await AsyncStorage.removeItem(LATEST_REPORT_KEY);
    return null;
  }
}

export async function loadReportHistoryAsync(): Promise<StoredReport[]> {
  const latestStored = await loadLatestReportAsync();

  try {
    const raw = await AsyncStorage.getItem(REPORT_HISTORY_KEY);
    if (!raw) {
      const migrated = latestStored ? [latestStored] : [];
      if (migrated.length) {
        await saveReportHistoryAsync(migrated);
      }
      return migrated;
    }

    const parsed = JSON.parse(raw);
    const history = Array.isArray(parsed) ? parsed.filter(isStoredReport) : [];
    const merged = dedupeStoredReports(latestStored ? [latestStored, ...history] : history);

    if (JSON.stringify(merged) !== JSON.stringify(history)) {
      await saveReportHistoryAsync(merged);
    }

    return merged;
  } catch {
    await AsyncStorage.removeItem(REPORT_HISTORY_KEY);
    const migrated = latestStored ? [latestStored] : [];
    if (migrated.length) {
      await saveReportHistoryAsync(migrated);
    }
    return migrated;
  }
}

export async function loadLatestLabReportAsync(): Promise<StoredLabReport | null> {
  try {
    const raw = await AsyncStorage.getItem(LATEST_LAB_REPORT_KEY);
    return raw ? (JSON.parse(raw) as StoredLabReport) : null;
  } catch {
    await AsyncStorage.removeItem(LATEST_LAB_REPORT_KEY);
    return null;
  }
}

export async function loadLabReportHistoryAsync(): Promise<StoredLabReport[]> {
  const latestStored = await loadLatestLabReportAsync();

  try {
    const raw = await AsyncStorage.getItem(LAB_REPORT_HISTORY_KEY);
    if (!raw) {
      const migrated = latestStored ? [latestStored] : [];
      if (migrated.length) {
        await saveLabReportHistoryAsync(migrated);
      }
      return migrated;
    }

    const parsed = JSON.parse(raw);
    const history = Array.isArray(parsed) ? parsed.filter(isStoredLabReport) : [];
    const merged = dedupeStoredLabReports(latestStored ? [latestStored, ...history] : history);

    if (JSON.stringify(merged) !== JSON.stringify(history)) {
      await saveLabReportHistoryAsync(merged);
    }

    return merged;
  } catch {
    await AsyncStorage.removeItem(LAB_REPORT_HISTORY_KEY);
    const migrated = latestStored ? [latestStored] : [];
    if (migrated.length) {
      await saveLabReportHistoryAsync(migrated);
    }
    return migrated;
  }
}

export async function loadImportedAudioHistoryAsync(): Promise<SavedAudioImport[]> {
  try {
    const raw = await AsyncStorage.getItem(IMPORTED_AUDIO_HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed.filter(isSavedAudioImport) : [];
    const sorted = values.sort((left, right) => {
      const leftTimestamp = Date.parse(left.importedAt);
      const rightTimestamp = Date.parse(right.importedAt);

      if (Number.isNaN(leftTimestamp) || Number.isNaN(rightTimestamp)) {
        return 0;
      }

      return rightTimestamp - leftTimestamp;
    });

    if (JSON.stringify(sorted) !== JSON.stringify(values)) {
      await saveImportedAudioHistoryAsync(sorted);
    }

    return sorted;
  } catch {
    await AsyncStorage.removeItem(IMPORTED_AUDIO_HISTORY_KEY);
    return [];
  }
}

export async function saveTemplateAsync(value: PdfTemplate) {
  await AsyncStorage.setItem(TEMPLATE_KEY, JSON.stringify(value));
}

export async function loadTemplateAsync(): Promise<PdfTemplate | null> {
  try {
    const raw = await AsyncStorage.getItem(TEMPLATE_KEY);
    if (!raw) {
      return null;
    }
    const template = normalizeTemplate(JSON.parse(raw));
    if (template) {
      return template;
    }
  } catch {
    // Fall through to clearing the corrupted template value.
  }

  await AsyncStorage.removeItem(TEMPLATE_KEY);
  return null;
}

export async function clearTemplateAsync() {
  await AsyncStorage.removeItem(TEMPLATE_KEY);
}

function isStoredReport(value: unknown): value is StoredReport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { report?: { id?: unknown } }).report?.id === "string"
  );
}

function isStoredLabReport(value: unknown): value is StoredLabReport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { report?: { id?: unknown } }).report?.id === "string"
  );
}

function isSavedAudioImport(value: unknown): value is SavedAudioImport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { uri?: unknown }).uri === "string" &&
    typeof (value as { fileName?: unknown }).fileName === "string" &&
    typeof (value as { mimeType?: unknown }).mimeType === "string" &&
    typeof (value as { importedAt?: unknown }).importedAt === "string"
  );
}

function dedupeStoredReports(values: StoredReport[]) {
  const seen = new Set<string>();

  return values
    .filter((value) => {
      const id = value.report.id;
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    })
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.report.createdAt);
      const rightTimestamp = Date.parse(right.report.createdAt);

      if (Number.isNaN(leftTimestamp) || Number.isNaN(rightTimestamp)) {
        return 0;
      }

      return rightTimestamp - leftTimestamp;
    });
}

function dedupeStoredLabReports(values: StoredLabReport[]) {
  const seen = new Set<string>();

  return values
    .filter((value) => {
      const id = value.report.id;
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    })
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.report.createdAt);
      const rightTimestamp = Date.parse(right.report.createdAt);

      if (Number.isNaN(leftTimestamp) || Number.isNaN(rightTimestamp)) {
        return 0;
      }

      return rightTimestamp - leftTimestamp;
    });
}
