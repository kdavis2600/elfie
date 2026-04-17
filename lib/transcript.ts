import { ConsultationReport, StoredReport, TranscriptSegment } from "../types/report";

const SPEAKER_PATTERN = /(doctor|patient|clinician|speaker\s*1|speaker\s*one|speaker\s*2|speaker\s*two|unknown)\s*:/gi;
const REDACTED_NAME_PATTERN = /\[\s*redacted\s+name\s*\]/gi;

export function normalizeConsultationReport(report: ConsultationReport): ConsultationReport {
  const fullText = cleanPrivacyRedactionText(report.transcript.fullText);
  const segments = normalizeTranscriptSegments(
    fullText,
    report.transcript.segments?.map((segment) => ({
      ...segment,
      text: cleanPrivacyRedactionText(segment.text),
    })),
  );

  return {
    ...report,
    visit: {
      ...report.visit,
      visitReason: cleanPrivacyRedactionText(report.visit.visitReason),
      clinicianName: cleanNullablePrivacyRedactionText(report.visit.clinicianName),
      patientName: cleanNullablePrivacyRedactionText(report.visit.patientName),
    },
    summary: {
      oneLiner: cleanPrivacyRedactionText(report.summary.oneLiner),
      bullets: report.summary.bullets.map(cleanPrivacyRedactionText),
    },
    soap: {
      subjective: {
        chiefComplaint: cleanPrivacyRedactionText(report.soap.subjective.chiefComplaint),
        hpi: cleanPrivacyRedactionText(report.soap.subjective.hpi),
        symptoms: report.soap.subjective.symptoms.map(cleanPrivacyRedactionText),
        history: report.soap.subjective.history.map(cleanPrivacyRedactionText),
        medicationsMentioned: report.soap.subjective.medicationsMentioned.map(cleanPrivacyRedactionText),
        allergiesMentioned: report.soap.subjective.allergiesMentioned.map(cleanPrivacyRedactionText),
        patientConcerns: report.soap.subjective.patientConcerns.map(cleanPrivacyRedactionText),
      },
      objective: {
        vitals: report.soap.objective.vitals.map(cleanPrivacyRedactionText),
        findings: report.soap.objective.findings.map(cleanPrivacyRedactionText),
        testsOrResults: report.soap.objective.testsOrResults.map(cleanPrivacyRedactionText),
        observations: report.soap.objective.observations.map(cleanPrivacyRedactionText),
      },
      assessment: {
        summary: cleanPrivacyRedactionText(report.soap.assessment.summary),
        diagnoses: report.soap.assessment.diagnoses.map((diagnosis) => ({
          ...diagnosis,
          name: cleanPrivacyRedactionText(diagnosis.name),
        })),
        differentials: report.soap.assessment.differentials.map(cleanPrivacyRedactionText),
        redFlags: report.soap.assessment.redFlags.map(cleanPrivacyRedactionText),
      },
      plan: {
        medications: report.soap.plan.medications.map(cleanPrivacyRedactionText),
        testsOrdered: report.soap.plan.testsOrdered.map(cleanPrivacyRedactionText),
        referrals: report.soap.plan.referrals.map(cleanPrivacyRedactionText),
        followUp: report.soap.plan.followUp.map(cleanPrivacyRedactionText),
        patientInstructions: report.soap.plan.patientInstructions.map(cleanPrivacyRedactionText),
        clinicianTasks: report.soap.plan.clinicianTasks.map(cleanPrivacyRedactionText),
        lifestyleAdvice: report.soap.plan.lifestyleAdvice.map(cleanPrivacyRedactionText),
      },
    },
    quality: {
      missingInformation: report.quality.missingInformation.map(cleanPrivacyRedactionText),
      ambiguities: report.quality.ambiguities.map(cleanPrivacyRedactionText),
    },
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
      text: cleanPrivacyRedactionText(segment.text),
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

export function cleanPrivacyRedactionText(value: string): string {
  return value
    .replace(/\b(patient|doctor|clinician|physician)\s+\[\s*redacted\s+name\s*\]\b/giu, "$1")
    .replace(/\b(the patient|the doctor|the clinician|the physician)\s+\[\s*redacted\s+name\s*\]\b/giu, "$1")
    .replace(/\b(dr)\.?\s+\[\s*redacted\s+name\s*\]\b/giu, (_match, title) => preserveReplacementCase(title, "doctor"))
    .replace(/\b(mr|mrs|ms)\.?\s+\[\s*redacted\s+name\s*\]\b/giu, (_match, title) => preserveReplacementCase(title, "patient"))
    .replace(
      /\b(?:my name is|name is|patient name is|doctor name is|clinician name is|this is|tên tôi là|em tên là|tôi tên là)\s+\[\s*redacted\s+name\s*\]\b/giu,
      "",
    )
    .replace(REDACTED_NAME_PATTERN, "")
    .replace(/\b(?:my name is|name is|patient name is|doctor name is|clinician name is|this is|tên tôi là|em tên là|tôi tên là)\b\s*(?=[,.;:!?]|$)/giu, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/(^|[.!?]\s+)[,;:]+\s*/g, "$1")
    .replace(/^[,.;:!?]+\s*/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanNullablePrivacyRedactionText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const cleaned = cleanPrivacyRedactionText(value);
  return cleaned || null;
}

function preserveReplacementCase(sample: string, replacement: string) {
  if (!sample) {
    return replacement;
  }

  if (sample === sample.toUpperCase()) {
    return replacement.toUpperCase();
  }

  if (/^\p{Lu}/u.test(sample)) {
    return `${replacement[0]?.toUpperCase() ?? ""}${replacement.slice(1)}`;
  }

  return replacement;
}
