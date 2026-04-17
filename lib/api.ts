import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";

import { ConsultationReport, PendingAudio } from "@/types/report";
import { TemplateImportType } from "@/types/template";

const API_BASE_URL = resolveApiBaseUrl();
const PROCESS_AUDIO_TIMEOUT_MS = 240_000;
const AI_EDIT_TIMEOUT_MS = 90_000;
const TEMPLATE_PREVIEW_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 8_000;

export type ProcessAudioResult = {
  report: ConsultationReport;
  transcript: string;
  detectedLanguage: string;
  usedMock?: boolean;
};

export async function processAudioAsync(audio: PendingAudio): Promise<ProcessAudioResult> {
  const body = new FormData();
  body.append("sourceType", audio.sourceType);
  body.append("durationSec", String(audio.durationSec ?? ""));

  body.append("file", {
    uri: audio.uri,
    name: audio.fileName ?? `consultation-${Date.now()}.m4a`,
    type: audio.mimeType ?? "audio/m4a",
  } as never);

  const response = await fetchWithTimeoutAsync(`${API_BASE_URL}/api/process-audio`, {
    method: "POST",
    body,
  }, PROCESS_AUDIO_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(await readApiErrorAsync(response, "Failed to process consultation audio."));
  }

  return (await response.json()) as ProcessAudioResult;
}

export async function fetchHealthAsync() {
  const response = await fetchWithTimeoutAsync(`${API_BASE_URL}/health`, undefined, HEALTH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error("Backend health check failed.");
  }
  return response.json();
}

export async function editReportWithAiAsync(input: {
  report: ConsultationReport;
  instruction: string;
}) {
  const response = await fetchWithTimeoutAsync(`${API_BASE_URL}/api/edit-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  }, AI_EDIT_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(await readApiErrorAsync(response, "Failed to update the consultation note."));
  }

  return (await response.json()) as {
    report: ConsultationReport;
  };
}

export async function createTemplatePreviewAsync(input: {
  uri: string;
  fileName: string;
  mimeType: string;
  importType: TemplateImportType;
}) {
  const body = new FormData();
  body.append("importType", input.importType);
  body.append("file", {
    uri: input.uri,
    name: input.fileName,
    type: input.mimeType,
  } as never);

  const response = await fetchWithTimeoutAsync(`${API_BASE_URL}/api/template-preview`, {
    method: "POST",
    body,
  }, TEMPLATE_PREVIEW_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(await readApiErrorAsync(response, "Failed to prepare template preview."));
  }

  return (await response.json()) as {
    previewBase64: string;
    mimeType: string;
    width: number;
    height: number;
  };
}

export { API_BASE_URL };

function resolveApiBaseUrl() {
  const explicitUrl = sanitizeBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const expoHost = extractHost(Constants.expoConfig?.hostUri ?? null);
  const bundleHost = extractHost(readBundleScriptUrl());
  const webHost = Platform.OS === "web" && typeof window !== "undefined" ? window.location.hostname : null;
  const detectedHost = expoHost ?? bundleHost ?? webHost;

  if (detectedHost) {
    return `http://${detectedHost}:8787`;
  }

  return Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://127.0.0.1:8787";
}

function sanitizeBaseUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\/$/, "");
  return trimmed ? trimmed : null;
}

function readBundleScriptUrl() {
  const sourceCode = (NativeModules as { SourceCode?: { scriptURL?: string } }).SourceCode;
  return typeof sourceCode?.scriptURL === "string" ? sourceCode.scriptURL : null;
}

function extractHost(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    if (value.includes("://")) {
      return new URL(value).hostname;
    }
  } catch {
    // Fall back to the host parsing below.
  }

  return value
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .trim() || null;
}

async function readApiErrorAsync(response: Response, fallback: string) {
  const text = await response.text();
  if (!text.trim()) {
    return fallback;
  }

  try {
    const payload = JSON.parse(text) as { message?: unknown };
    if (typeof payload.message === "string" && payload.message.trim()) {
      if (/application failed to respond/i.test(payload.message)) {
        return "The note service took too long to respond. Please try again.";
      }
      return payload.message;
    }
  } catch {
    // Fall through to the raw text heuristics below.
  }

  if (/<[a-z][\s\S]*>/i.test(text)) {
    return fallback;
  }

  return text.length <= 240 ? text : fallback;
}

async function fetchWithTimeoutAsync(url: string, init?: RequestInit, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(resolveTimeoutMessage(url, timeoutMs));
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /aborted|timed? out/i.test(error.message));
}

function resolveTimeoutMessage(url: string, timeoutMs: number) {
  if (url.endsWith("/api/process-audio")) {
    return "Processing took too long to respond. Please retry the consultation audio.";
  }

  if (url.endsWith("/api/edit-report")) {
    return "AI editing took too long to respond. Please try a shorter instruction or retry.";
  }

  if (url.endsWith("/api/template-preview")) {
    return "Template preview took too long to prepare. Please try a smaller file or import a photo instead.";
  }

  return `Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`;
}
