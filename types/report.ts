export type ConsultationReport = {
  id: string;
  createdAt: string;
  sourceAudio: {
    fileName?: string | null;
    durationSec?: number | null;
    sourceType: "recorded" | "sample" | "imported";
  };
  language: {
    detected: string;
    reportLanguage: string;
  };
  visit: {
    visitReason: string;
    clinicianName?: string | null;
    patientName?: string | null;
    visitType?: "new" | "follow_up" | "urgent" | "unknown";
  };
  summary: {
    oneLiner: string;
    bullets: string[];
  };
  soap: {
    subjective: {
      chiefComplaint: string;
      hpi: string;
      symptoms: string[];
      history: string[];
      medicationsMentioned: string[];
      allergiesMentioned: string[];
      patientConcerns: string[];
    };
    objective: {
      vitals: string[];
      findings: string[];
      testsOrResults: string[];
      observations: string[];
    };
    assessment: {
      summary: string;
      diagnoses: Array<{
        name: string;
        confidence: "confirmed" | "likely" | "possible" | "unclear";
      }>;
      differentials: string[];
      redFlags: string[];
    };
    plan: {
      medications: string[];
      testsOrdered: string[];
      referrals: string[];
      followUp: string[];
      patientInstructions: string[];
      clinicianTasks: string[];
      lifestyleAdvice: string[];
    };
  };
  quality: {
    missingInformation: string[];
    ambiguities: string[];
  };
  transcript: {
    fullText: string;
    segments?: Array<{
      speaker: "doctor" | "patient" | "unknown";
      startSec?: number;
      endSec?: number;
      text: string;
    }>;
  };
};

export type PendingAudio = {
  uri: string;
  fileName?: string | null;
  durationSec?: number | null;
  mimeType?: string | null;
  sourceType: ConsultationReport["sourceAudio"]["sourceType"];
};

export type StoredReport = {
  report: ConsultationReport;
  pdfUri?: string | null;
};
