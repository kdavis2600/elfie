import { ConsultationReport, PendingAudio } from "@/types/report";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8787";

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

  const response = await fetch(`${API_BASE_URL}/api/process-audio`, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Failed to process consultation audio.");
  }

  return (await response.json()) as ProcessAudioResult;
}

export async function fetchHealthAsync() {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error("Backend health check failed.");
  }
  return response.json();
}

export { API_BASE_URL };
