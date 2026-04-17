import { ConsultationReport, StoredReport, TranscriptSegment } from "../types/report";

const SPEAKER_PATTERN = /(doctor|patient|clinician|speaker\s*1|speaker\s*one|speaker\s*2|speaker\s*two|unknown)\s*:/gi;

export function normalizeConsultationReport(report: ConsultationReport): ConsultationReport {
  const fullText = report.transcript.fullText.trim();
  const segments = normalizeTranscriptSegments(fullText, report.transcript.segments);

  return {
    ...report,
    transcript: {
      fullText,
      segments: segments.length ? segments : undefined,
    },
  };
}

export function normalizeStoredReportTranscript(stored: StoredReport): StoredReport {
  return {
    ...stored,
    report: normalizeConsultationReport(stored.report),
  };
}

export function normalizeTranscriptSegments(
  fullText: string,
  segments?: ConsultationReport["transcript"]["segments"],
): TranscriptSegment[] {
  const normalizedSegments = normalizeProvidedSegments(segments);
  if (normalizedSegments.length) {
    return normalizedSegments;
  }

  const parsedFromLabels = parseSpeakerTaggedTranscript(fullText);
  if (parsedFromLabels.length) {
    return parsedFromLabels;
  }

  const trimmed = fullText.trim();
  return trimmed ? [{ speaker: "unknown", text: trimmed }] : [];
}

function normalizeProvidedSegments(segments?: ConsultationReport["transcript"]["segments"]): TranscriptSegment[] {
  if (!segments?.length) {
    return [];
  }

  return segments
    .map((segment) => ({
      speaker: normalizeSpeaker(segment.speaker),
      startSec: typeof segment.startSec === "number" ? segment.startSec : undefined,
      endSec: typeof segment.endSec === "number" ? segment.endSec : undefined,
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

function parseSpeakerTaggedTranscript(fullText: string): TranscriptSegment[] {
  const matches = [...fullText.matchAll(SPEAKER_PATTERN)];
  if (!matches.length) {
    return [];
  }

  const segments: TranscriptSegment[] = [];

  matches.forEach((match, index) => {
    const label = match[1] ?? "unknown";
    const start = match.index ?? 0;
    const contentStart = start + match[0].length;
    const nextStart = matches[index + 1]?.index ?? fullText.length;
    const text = fullText.slice(contentStart, nextStart).trim();

    if (!text) {
      return;
    }

    segments.push({
      speaker: normalizeSpeaker(label),
      text,
    });
  });

  return segments;
}

function normalizeSpeaker(value: string): TranscriptSegment["speaker"] {
  const normalized = value.trim().toLowerCase();

  if (normalized === "doctor" || normalized === "clinician" || normalized === "speaker 1" || normalized === "speaker one") {
    return "doctor";
  }

  if (normalized === "patient" || normalized === "speaker 2" || normalized === "speaker two") {
    return "patient";
  }

  return "unknown";
}
