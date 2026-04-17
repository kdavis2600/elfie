import { z } from "zod";

export const consultationReportSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  sourceAudio: z.object({
    fileName: z.string().nullable().optional(),
    durationSec: z.number().nullable().optional(),
    sourceType: z.enum(["recorded", "sample", "imported"]),
  }),
  language: z.object({
    detected: z.string(),
    reportLanguage: z.string(),
  }),
  visit: z.object({
    visitReason: z.string(),
    clinicianName: z.string().nullable().optional(),
    patientName: z.string().nullable().optional(),
    visitType: z.enum(["new", "follow_up", "urgent", "unknown"]).optional(),
  }),
  summary: z.object({
    oneLiner: z.string(),
    bullets: z.array(z.string()),
  }),
  soap: z.object({
    subjective: z.object({
      chiefComplaint: z.string(),
      hpi: z.string(),
      symptoms: z.array(z.string()),
      history: z.array(z.string()),
      medicationsMentioned: z.array(z.string()),
      allergiesMentioned: z.array(z.string()),
      patientConcerns: z.array(z.string()),
    }),
    objective: z.object({
      vitals: z.array(z.string()),
      findings: z.array(z.string()),
      testsOrResults: z.array(z.string()),
      observations: z.array(z.string()),
    }),
    assessment: z.object({
      summary: z.string(),
      diagnoses: z.array(
        z.object({
          name: z.string(),
          confidence: z.enum(["confirmed", "likely", "possible", "unclear"]),
        }),
      ),
      differentials: z.array(z.string()),
      redFlags: z.array(z.string()),
    }),
    plan: z.object({
      medications: z.array(z.string()),
      testsOrdered: z.array(z.string()),
      referrals: z.array(z.string()),
      followUp: z.array(z.string()),
      patientInstructions: z.array(z.string()),
      clinicianTasks: z.array(z.string()),
      lifestyleAdvice: z.array(z.string()),
    }),
  }),
  quality: z.object({
    missingInformation: z.array(z.string()),
    ambiguities: z.array(z.string()),
  }),
  transcript: z.object({
    fullText: z.string(),
    segments: z
      .array(
        z.object({
          speaker: z.enum(["doctor", "patient", "unknown"]),
          startSec: z.number().optional(),
          endSec: z.number().optional(),
          text: z.string(),
        }),
      )
      .optional(),
  }),
});

export type ConsultationReportInput = z.infer<typeof consultationReportSchema>;
