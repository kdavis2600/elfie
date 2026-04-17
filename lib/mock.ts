import { ConsultationReport } from "../types/report";

export function createMockReport(
  sourceType: ConsultationReport["sourceAudio"]["sourceType"],
  overrides?: Partial<ConsultationReport>,
): ConsultationReport {
  const now = new Date().toISOString();

  return {
    id: `mock-${Date.now()}`,
    createdAt: now,
    sourceAudio: {
      fileName: sourceType === "sample" ? "sample-consultation.mp3" : "consultation.m4a",
      durationSec: 154,
      sourceType,
    },
    language: {
      detected: "en",
      reportLanguage: "en",
    },
    visit: {
      visitReason: "Upper respiratory symptoms with cough and fever",
      clinicianName: null,
      patientName: null,
      visitType: "urgent",
    },
    summary: {
      oneLiner:
        "Adult patient with 4 days of fever, cough, sore throat, and fatigue; likely viral upper respiratory infection without red-flag respiratory compromise.",
      bullets: [
        "Symptoms started 4 days ago with cough, sore throat, fatigue, and intermittent fever.",
        "No chest pain, no severe dyspnea, and no medication allergies were clearly stated.",
        "Supportive care, hydration, rest, and follow-up precautions were advised.",
      ],
    },
    soap: {
      subjective: {
        chiefComplaint: "Cough, sore throat, fever, and fatigue.",
        hpi:
          "Patient reports 4 days of cough, sore throat, fatigue, and intermittent fever, with worsening discomfort at night. No clear history of chronic lung disease was mentioned.",
        symptoms: ["Cough", "Sore throat", "Fatigue", "Fever"],
        history: ["Duration approximately 4 days", "No chronic respiratory history explicitly mentioned"],
        medicationsMentioned: ["Paracetamol as needed"],
        allergiesMentioned: [],
        patientConcerns: ["Wants symptom relief", "Concerned about whether antibiotics are needed"],
      },
      objective: {
        vitals: [],
        findings: ["No obvious respiratory distress mentioned in conversation"],
        testsOrResults: [],
        observations: ["Consultation appears outpatient and conversational; no exam values captured."],
      },
      assessment: {
        summary:
          "Most consistent with uncomplicated viral upper respiratory infection; bacterial process not confirmed.",
        diagnoses: [
          { name: "Viral upper respiratory infection", confidence: "likely" },
          { name: "Pharyngitis", confidence: "possible" },
        ],
        differentials: ["Influenza", "COVID-19", "Streptococcal pharyngitis"],
        redFlags: ["Persistent high fever", "Shortness of breath", "Worsening symptoms after initial improvement"],
      },
      plan: {
        medications: ["Continue paracetamol as needed for fever and discomfort"],
        testsOrdered: [],
        referrals: [],
        followUp: ["Reassess if symptoms persist beyond several days or worsen sooner"],
        patientInstructions: [
          "Hydrate well",
          "Rest",
          "Seek urgent care for breathing difficulty, dehydration, or worsening fever",
        ],
        clinicianTasks: ["Document symptom duration and absence of major red flags"],
        lifestyleAdvice: ["Hydration", "Rest", "Limit exertion until improved"],
      },
    },
    quality: {
      missingInformation: [
        "Patient name not stated",
        "Clinician name not stated",
        "Vital signs not documented",
        "Past medical history incomplete",
      ],
      ambiguities: [
        "Exact diagnosis not confirmed in transcript",
        "Medication dosing details were not clearly specified",
      ],
    },
    transcript: {
      fullText:
        "Doctor: Tell me what has been going on. Patient: I have had a fever, sore throat, and cough for about four days and I feel very tired. Doctor: Any trouble breathing or chest pain? Patient: Not really, mostly the cough and feeling weak. Doctor: This sounds more like a viral infection, so rest, fluids, and paracetamol should help. Come back if you are worse or have shortness of breath.",
      segments: [
        {
          speaker: "doctor",
          startSec: 0,
          endSec: 8,
          text: "Tell me what has been going on.",
        },
        {
          speaker: "patient",
          startSec: 8,
          endSec: 26,
          text: "I have had a fever, sore throat, and cough for about four days and I feel very tired.",
        },
        {
          speaker: "doctor",
          startSec: 26,
          endSec: 34,
          text: "Any trouble breathing or chest pain?",
        },
        {
          speaker: "patient",
          startSec: 34,
          endSec: 42,
          text: "Not really, mostly the cough and feeling weak.",
        },
      ],
    },
    ...overrides,
  };
}
