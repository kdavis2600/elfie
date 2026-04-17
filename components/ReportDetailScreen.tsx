import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  I18nManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { TopBackButton } from "@/components/TopBackButton";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { editReportWithAiAsync } from "@/lib/api";
import { generateReportPdfAsync } from "@/lib/pdf";
import { useSession } from "@/lib/session";
import { persistPdfAsync } from "@/lib/storage";
import { normalizeConsultationReport, normalizeTranscriptSegments } from "@/lib/transcript";
import { ConsultationReport, StoredReport, TranscriptSegment } from "@/types/report";

type ReportDetailScreenProps = {
  storedReport: StoredReport;
  onBack: () => void;
  backLabel?: string;
};

type EditorDefinition = {
  id: string;
  title: string;
  description: string;
  placeholder: string;
  format: (report: ConsultationReport) => string;
  apply: (report: ConsultationReport, value: string) => ConsultationReport;
};

export function ReportDetailScreen({ storedReport, onBack, backLabel = "Back" }: ReportDetailScreenProps) {
  const { currentTemplate, setReport } = useSession();
  const [activeTab, setActiveTab] = useState<"report" | "transcript">("report");
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [shareAvailable, setShareAvailable] = useState(true);
  const report = useMemo(() => normalizeConsultationReport(storedReport.report), [storedReport.report]);
  const pdfUri = storedReport.pdfUri ?? null;
  const activeEditor = activeEditorId ? EDITOR_DEFINITIONS[activeEditorId] ?? null : null;

  useEffect(() => {
    setActiveTab("report");
    setActiveEditorId(null);
    setEditorValue("");
    setAiModalVisible(false);
    setAiInstruction("");
  }, [report.id]);

  useEffect(() => {
    let cancelled = false;

    Sharing.isAvailableAsync()
      .then((available) => {
        if (!cancelled) {
          setShareAvailable(available);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rtl = isRtlLanguage(report.language.detected) || I18nManager.isRTL;
  const transcriptTitle = "Transcript";
  const transcriptSegments = useMemo(
    () => normalizeTranscriptSegments(report.transcript.fullText, report.transcript.segments),
    [report.transcript.fullText, report.transcript.segments],
  );
  const isBusy = Boolean(busyMessage);

  function openEditor(id: string) {
    const definition = EDITOR_DEFINITIONS[id];
    if (!definition || isBusy) {
      return;
    }

    setActiveEditorId(id);
    setEditorValue(definition.format(report));
  }

  function closeEditor() {
    if (isBusy) {
      return;
    }

    setActiveEditorId(null);
    setEditorValue("");
  }

  async function commitReportAsync(nextReport: ConsultationReport, actionLabel: string) {
    setBusyMessage(actionLabel);

    try {
      const pdfTempUri = await generateReportPdfAsync(nextReport, currentTemplate);
      const nextPdfUri = await persistPdfAsync(pdfTempUri, `${nextReport.id}.pdf`);
      await setReport(nextReport, nextPdfUri);
      return nextPdfUri;
    } finally {
      setBusyMessage(null);
    }
  }

  async function handleShare() {
    if (!pdfUri || isBusy) {
      return;
    }

    if (!shareAvailable) {
      Alert.alert("Sharing unavailable", "This device or browser does not support native sharing for PDFs.");
      return;
    }

    try {
      await Sharing.shareAsync(pdfUri);
    } catch (error) {
      Alert.alert("Could not share PDF", getErrorMessage(error, "The PDF could not be shared right now."));
    }
  }

  async function handleSaveEditor() {
    if (!activeEditor) {
      return;
    }

    const nextValue = editorValue.trim();
    const previousValue = activeEditor.format(report).trim();

    if (nextValue === previousValue) {
      closeEditor();
      return;
    }

    try {
      const nextReport = activeEditor.apply(report, editorValue);
      await commitReportAsync(nextReport, "Saving report changes...");
      closeEditor();
    } catch (error) {
      Alert.alert("Could not save changes", getErrorMessage(error, "The report could not be updated."));
    }
  }

  async function handleAiEdit() {
    const instruction = aiInstruction.trim();

    if (!instruction || isBusy) {
      return;
    }

    try {
      setBusyMessage("Applying AI changes...");
      const result = await editReportWithAiAsync({
        report,
        instruction,
      });

      const pdfTempUri = await generateReportPdfAsync(result.report, currentTemplate);
      const nextPdfUri = await persistPdfAsync(pdfTempUri, `${result.report.id}.pdf`);
      await setReport(result.report, nextPdfUri);
      setAiInstruction("");
      setAiModalVisible(false);
    } catch (error) {
      Alert.alert("Could not update with AI", getErrorMessage(error, "The AI edit request failed."));
    } finally {
      setBusyMessage(null);
    }
  }

  return (
    <AppScreen scroll contentContainerStyle={styles.content}>
      <StaggeredFadeIn index={0} resetKey={report.id}>
        <View style={styles.headerStack}>
          <TopBackButton label={backLabel} onPress={onBack} disabled={isBusy} />
          <SectionCard eyebrow="Consultation report" title={report.summary.oneLiner}>
            <Text style={styles.meta}>
              {new Date(report.createdAt).toLocaleString()} · {report.language.detected.toUpperCase()}
            </Text>
            <Text style={styles.guidance}>
              Tap any note section below to rewrite it. The keyboard supports typing and dictation.
            </Text>
            <View style={styles.headerActions}>
              <PrimaryButton label="Edit With AI" onPress={() => setAiModalVisible(true)} disabled={isBusy} />
            </View>
            {busyMessage ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.busyText}>{busyMessage}</Text>
              </View>
            ) : null}
          </SectionCard>
        </View>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1} resetKey={report.id}>
        <View style={styles.tabRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab("report")}
            style={({ pressed }) => [styles.tab, activeTab === "report" && styles.tabActive, pressed && styles.tabPressed]}
          >
            <Text style={[styles.tabLabel, activeTab === "report" && styles.tabLabelActive]}>Report</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab("transcript")}
            style={({ pressed }) => [
              styles.tab,
              activeTab === "transcript" && styles.tabActive,
              pressed && styles.tabPressed,
            ]}
          >
            <Text style={[styles.tabLabel, activeTab === "transcript" && styles.tabLabelActive]}>{transcriptTitle}</Text>
          </Pressable>
        </View>
      </StaggeredFadeIn>

      {activeTab === "report" ? (
        <>
          <StaggeredFadeIn index={2} resetKey={report.id}>
              <SectionCard eyebrow="Summary" title="Summary">
                <EditableBlock
                  label="Headline"
                  preview={EDITOR_DEFINITIONS.summaryHeadline.format(report)}
                  onPress={() => openEditor("summaryHeadline")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Bullets"
                  preview={EDITOR_DEFINITIONS.summaryBullets.format(report)}
                  onPress={() => openEditor("summaryBullets")}
                  disabled={isBusy}
                />
              </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={3} resetKey={report.id}>
              <SectionCard eyebrow="Visit" title={report.visit.visitReason}>
                <Text style={styles.meta}>Type: {formatVisitType(report.visit.visitType)}</Text>
                <EditableBlock
                  label="Visit reason"
                  preview={EDITOR_DEFINITIONS.visitReason.format(report)}
                  onPress={() => openEditor("visitReason")}
                  disabled={isBusy}
                />
              </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={4} resetKey={report.id}>
              <SectionCard title="Subjective">
                <EditableBlock
                  label="Chief complaint"
                  preview={EDITOR_DEFINITIONS.subjectiveChiefComplaint.format(report)}
                  onPress={() => openEditor("subjectiveChiefComplaint")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="History of present illness"
                  preview={EDITOR_DEFINITIONS.subjectiveHpi.format(report)}
                  onPress={() => openEditor("subjectiveHpi")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Symptoms"
                  preview={EDITOR_DEFINITIONS.subjectiveSymptoms.format(report)}
                  onPress={() => openEditor("subjectiveSymptoms")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Relevant history"
                  preview={EDITOR_DEFINITIONS.subjectiveHistory.format(report)}
                  onPress={() => openEditor("subjectiveHistory")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Medications mentioned"
                  preview={EDITOR_DEFINITIONS.subjectiveMedications.format(report)}
                  onPress={() => openEditor("subjectiveMedications")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Allergies mentioned"
                  preview={EDITOR_DEFINITIONS.subjectiveAllergies.format(report)}
                  onPress={() => openEditor("subjectiveAllergies")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Patient concerns"
                  preview={EDITOR_DEFINITIONS.subjectiveConcerns.format(report)}
                  onPress={() => openEditor("subjectiveConcerns")}
                  disabled={isBusy}
                />
              </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={5} resetKey={report.id}>
              <SectionCard title="Objective">
                <EditableBlock
                  label="Vitals"
                  preview={EDITOR_DEFINITIONS.objectiveVitals.format(report)}
                  onPress={() => openEditor("objectiveVitals")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Findings"
                  preview={EDITOR_DEFINITIONS.objectiveFindings.format(report)}
                  onPress={() => openEditor("objectiveFindings")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Tests or results"
                  preview={EDITOR_DEFINITIONS.objectiveTests.format(report)}
                  onPress={() => openEditor("objectiveTests")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Observations"
                  preview={EDITOR_DEFINITIONS.objectiveObservations.format(report)}
                  onPress={() => openEditor("objectiveObservations")}
                  disabled={isBusy}
                />
              </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={6} resetKey={report.id}>
              <SectionCard title="Assessment">
                <EditableBlock
                  label="Assessment summary"
                  preview={EDITOR_DEFINITIONS.assessmentSummary.format(report)}
                  onPress={() => openEditor("assessmentSummary")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Diagnoses"
                  preview={EDITOR_DEFINITIONS.assessmentDiagnoses.format(report)}
                  onPress={() => openEditor("assessmentDiagnoses")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Differentials"
                  preview={EDITOR_DEFINITIONS.assessmentDifferentials.format(report)}
                  onPress={() => openEditor("assessmentDifferentials")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Red flags"
                  preview={EDITOR_DEFINITIONS.assessmentRedFlags.format(report)}
                  onPress={() => openEditor("assessmentRedFlags")}
                  disabled={isBusy}
                />
              </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={7} resetKey={report.id}>
              <SectionCard title="Plan">
                <EditableBlock
                  label="Medications"
                  preview={EDITOR_DEFINITIONS.planMedications.format(report)}
                  onPress={() => openEditor("planMedications")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Tests ordered"
                  preview={EDITOR_DEFINITIONS.planTests.format(report)}
                  onPress={() => openEditor("planTests")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Referrals"
                  preview={EDITOR_DEFINITIONS.planReferrals.format(report)}
                  onPress={() => openEditor("planReferrals")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Follow-up"
                  preview={EDITOR_DEFINITIONS.planFollowUp.format(report)}
                  onPress={() => openEditor("planFollowUp")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Patient instructions"
                  preview={EDITOR_DEFINITIONS.planPatientInstructions.format(report)}
                  onPress={() => openEditor("planPatientInstructions")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Clinician tasks"
                  preview={EDITOR_DEFINITIONS.planClinicianTasks.format(report)}
                  onPress={() => openEditor("planClinicianTasks")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Lifestyle advice"
                  preview={EDITOR_DEFINITIONS.planLifestyle.format(report)}
                  onPress={() => openEditor("planLifestyle")}
                  disabled={isBusy}
                />
              </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={8} resetKey={report.id}>
              <SectionCard title="Quality review">
                <EditableBlock
                  label="Missing information"
                  preview={EDITOR_DEFINITIONS.qualityMissing.format(report)}
                  onPress={() => openEditor("qualityMissing")}
                  disabled={isBusy}
                />
                <EditableBlock
                  label="Ambiguities"
                  preview={EDITOR_DEFINITIONS.qualityAmbiguities.format(report)}
                  onPress={() => openEditor("qualityAmbiguities")}
                  disabled={isBusy}
                />
              </SectionCard>
          </StaggeredFadeIn>
        </>
      ) : (
        <StaggeredFadeIn index={2} resetKey={report.id}>
            <SectionCard title={transcriptTitle}>
              <EditableBlock
                label={transcriptTitle}
                preview={EDITOR_DEFINITIONS.transcript.format(report)}
                onPress={() => openEditor("transcript")}
                disabled={isBusy}
              />
              <View style={styles.transcriptList}>
                {transcriptSegments.map((segment, index) => (
                  <TranscriptTurn key={`${segment.speaker}-${index}-${segment.text.slice(0, 24)}`} rtl={rtl} segment={segment} />
                ))}
              </View>
            </SectionCard>
        </StaggeredFadeIn>
      )}

      <StaggeredFadeIn index={10} resetKey={report.id}>
        <View style={styles.actions}>
          <PrimaryButton label="Share PDF" onPress={handleShare} disabled={!pdfUri || isBusy || !shareAvailable} />
        </View>
      </StaggeredFadeIn>

      <Modal visible={Boolean(activeEditor)} transparent animationType="slide" onRequestClose={isBusy ? undefined : closeEditor}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalScrim}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{activeEditor?.title ?? "Edit section"}</Text>
              <Text style={styles.modalBody}>{activeEditor?.description ?? ""}</Text>
              <TextInput
                autoFocus
                multiline
                editable={!isBusy}
                placeholder={activeEditor?.placeholder ?? ""}
                placeholderTextColor={colors.textFaint}
                style={styles.modalInput}
                textAlignVertical="top"
                value={editorValue}
                onChangeText={setEditorValue}
              />
              <View style={styles.modalActions}>
                <PrimaryButton label="Cancel" onPress={closeEditor} secondary disabled={isBusy} style={styles.modalButton} />
                <PrimaryButton label="Save changes" onPress={handleSaveEditor} disabled={isBusy} style={styles.modalButton} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={aiModalVisible}
        transparent
        animationType="slide"
        onRequestClose={isBusy ? undefined : () => setAiModalVisible(false)}
      >
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalScrim}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Edit With AI</Text>
              <Text style={styles.modalBody}>
                Describe the change you want in plain language. The structured report will be updated and the transcript
                will stay as-is.
              </Text>
              <TextInput
                autoFocus
                multiline
                editable={!isBusy}
                placeholder="Example: This looks good but add that the patient has a history of smoking."
                placeholderTextColor={colors.textFaint}
                style={styles.modalInput}
                textAlignVertical="top"
                value={aiInstruction}
                onChangeText={setAiInstruction}
              />
              <View style={styles.modalActions}>
                <PrimaryButton
                  label="Cancel"
                  onPress={() => setAiModalVisible(false)}
                  secondary
                  disabled={isBusy}
                  style={styles.modalButton}
                />
                <PrimaryButton label="Apply with AI" onPress={handleAiEdit} disabled={isBusy} style={styles.modalButton} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AppScreen>
  );
}

function EditableBlock({
  label,
  preview,
  onPress,
  disabled,
}: {
  label: string;
  preview: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.editableBlock, pressed && !disabled && styles.editableBlockPressed, disabled && styles.disabled]}
    >
      <View style={styles.editableHeader}>
        <Text style={styles.editableLabel}>{label}</Text>
        <Text style={styles.editableHint}>Tap to edit</Text>
      </View>
      <Text style={styles.editablePreview} numberOfLines={5}>
        {preview.trim() || "Not captured"}
      </Text>
    </Pressable>
  );
}

function TranscriptTurn({ segment, rtl }: { segment: TranscriptSegment; rtl: boolean }) {
  const isPatient = segment.speaker === "patient";
  const isDoctor = segment.speaker === "doctor";
  const label = isDoctor ? "Doctor" : isPatient ? "Patient" : "Speaker";

  return (
    <View style={[styles.turnCard, isPatient && styles.patientTurnCard]}>
      <Text style={[styles.turnLabel, isPatient && styles.patientTurnLabel]}>{label}</Text>
      <Text style={[styles.turnText, isPatient && styles.patientTurnText, rtl && styles.rtlTranscript]}>{segment.text}</Text>
    </View>
  );
}

function formatListForEditor(items: string[]) {
  return items.join("\n");
}

function parseListFromEditor(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.replace(/^[*-]\s*/, "").trim())
    .filter(Boolean);
}

function formatDiagnosesForEditor(items: ConsultationReport["soap"]["assessment"]["diagnoses"]) {
  return items.map((item) => `${item.name} | ${item.confidence}`).join("\n");
}

function parseDiagnosesFromEditor(value: string): ConsultationReport["soap"]["assessment"]["diagnoses"] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipeMatch = line.match(/^(.*?)\s*\|\s*(confirmed|likely|possible|unclear)$/i);
      const parenMatch = line.match(/^(.*?)\s*\((confirmed|likely|possible|unclear)\)$/i);

      if (pipeMatch) {
        return {
          name: pipeMatch[1].trim(),
          confidence: pipeMatch[2].toLowerCase() as ConsultationReport["soap"]["assessment"]["diagnoses"][number]["confidence"],
        };
      }

      if (parenMatch) {
        return {
          name: parenMatch[1].trim(),
          confidence: parenMatch[2].toLowerCase() as ConsultationReport["soap"]["assessment"]["diagnoses"][number]["confidence"],
        };
      }

      return {
        name: line,
        confidence: "unclear" as const,
      };
    })
    .filter((item) => item.name);
}

function withVisit(report: ConsultationReport, patch: Partial<ConsultationReport["visit"]>): ConsultationReport {
  return {
    ...report,
    visit: {
      ...report.visit,
      ...patch,
    },
  };
}

function withSummary(report: ConsultationReport, patch: Partial<ConsultationReport["summary"]>): ConsultationReport {
  return {
    ...report,
    summary: {
      ...report.summary,
      ...patch,
    },
  };
}

function withSubjective(
  report: ConsultationReport,
  patch: Partial<ConsultationReport["soap"]["subjective"]>,
): ConsultationReport {
  return {
    ...report,
    soap: {
      ...report.soap,
      subjective: {
        ...report.soap.subjective,
        ...patch,
      },
    },
  };
}

function withObjective(
  report: ConsultationReport,
  patch: Partial<ConsultationReport["soap"]["objective"]>,
): ConsultationReport {
  return {
    ...report,
    soap: {
      ...report.soap,
      objective: {
        ...report.soap.objective,
        ...patch,
      },
    },
  };
}

function withAssessment(
  report: ConsultationReport,
  patch: Partial<ConsultationReport["soap"]["assessment"]>,
): ConsultationReport {
  return {
    ...report,
    soap: {
      ...report.soap,
      assessment: {
        ...report.soap.assessment,
        ...patch,
      },
    },
  };
}

function withPlan(report: ConsultationReport, patch: Partial<ConsultationReport["soap"]["plan"]>): ConsultationReport {
  return {
    ...report,
    soap: {
      ...report.soap,
      plan: {
        ...report.soap.plan,
        ...patch,
      },
    },
  };
}

function withQuality(report: ConsultationReport, patch: Partial<ConsultationReport["quality"]>): ConsultationReport {
  return {
    ...report,
    quality: {
      ...report.quality,
      ...patch,
    },
  };
}

function withTranscript(report: ConsultationReport, fullText: string): ConsultationReport {
  return {
    ...report,
    transcript: {
      fullText: fullText.trim(),
      segments: undefined,
    },
  };
}

const EDITOR_DEFINITIONS: Record<string, EditorDefinition> = {
  summaryHeadline: {
    id: "summaryHeadline",
    title: "Edit summary headline",
    description: "Rewrite the main one-line consultation summary.",
    placeholder: "Summarize the consultation in one line.",
    format: (report) => report.summary.oneLiner,
    apply: (report, value) => withSummary(report, { oneLiner: value.trim() }),
  },
  summaryBullets: {
    id: "summaryBullets",
    title: "Edit summary bullets",
    description: "Use one bullet per line.",
    placeholder: "Each line becomes a bullet in the report.",
    format: (report) => formatListForEditor(report.summary.bullets),
    apply: (report, value) => withSummary(report, { bullets: parseListFromEditor(value) }),
  },
  visitReason: {
    id: "visitReason",
    title: "Edit visit reason",
    description: "Rewrite the visit reason shown at the top of the report.",
    placeholder: "State the reason for this consultation.",
    format: (report) => report.visit.visitReason,
    apply: (report, value) => withVisit(report, { visitReason: value.trim() }),
  },
  subjectiveChiefComplaint: {
    id: "subjectiveChiefComplaint",
    title: "Edit chief complaint",
    description: "Update the reported chief complaint.",
    placeholder: "Summarize the main complaint in one or two lines.",
    format: (report) => report.soap.subjective.chiefComplaint,
    apply: (report, value) => withSubjective(report, { chiefComplaint: value.trim() }),
  },
  subjectiveHpi: {
    id: "subjectiveHpi",
    title: "Edit history of present illness",
    description: "Rewrite the history of present illness.",
    placeholder: "Describe the history of present illness.",
    format: (report) => report.soap.subjective.hpi,
    apply: (report, value) => withSubjective(report, { hpi: value.trim() }),
  },
  subjectiveSymptoms: {
    id: "subjectiveSymptoms",
    title: "Edit symptoms",
    description: "Enter one symptom per line.",
    placeholder: "Cough\nShortness of breath\nFatigue",
    format: (report) => formatListForEditor(report.soap.subjective.symptoms),
    apply: (report, value) => withSubjective(report, { symptoms: parseListFromEditor(value) }),
  },
  subjectiveHistory: {
    id: "subjectiveHistory",
    title: "Edit relevant history",
    description: "Enter one history item per line.",
    placeholder: "History of smoking\nHypertension",
    format: (report) => formatListForEditor(report.soap.subjective.history),
    apply: (report, value) => withSubjective(report, { history: parseListFromEditor(value) }),
  },
  subjectiveMedications: {
    id: "subjectiveMedications",
    title: "Edit medications mentioned",
    description: "Enter one medication item per line.",
    placeholder: "Metformin 500 mg daily",
    format: (report) => formatListForEditor(report.soap.subjective.medicationsMentioned),
    apply: (report, value) => withSubjective(report, { medicationsMentioned: parseListFromEditor(value) }),
  },
  subjectiveAllergies: {
    id: "subjectiveAllergies",
    title: "Edit allergies mentioned",
    description: "Enter one allergy per line.",
    placeholder: "Penicillin",
    format: (report) => formatListForEditor(report.soap.subjective.allergiesMentioned),
    apply: (report, value) => withSubjective(report, { allergiesMentioned: parseListFromEditor(value) }),
  },
  subjectiveConcerns: {
    id: "subjectiveConcerns",
    title: "Edit patient concerns",
    description: "Enter one concern per line.",
    placeholder: "Worried about worsening symptoms",
    format: (report) => formatListForEditor(report.soap.subjective.patientConcerns),
    apply: (report, value) => withSubjective(report, { patientConcerns: parseListFromEditor(value) }),
  },
  objectiveVitals: {
    id: "objectiveVitals",
    title: "Edit vitals",
    description: "Enter one vital per line.",
    placeholder: "BP 128/76\nHR 84 bpm",
    format: (report) => formatListForEditor(report.soap.objective.vitals),
    apply: (report, value) => withObjective(report, { vitals: parseListFromEditor(value) }),
  },
  objectiveFindings: {
    id: "objectiveFindings",
    title: "Edit findings",
    description: "Enter one finding per line.",
    placeholder: "Mild wheeze on auscultation",
    format: (report) => formatListForEditor(report.soap.objective.findings),
    apply: (report, value) => withObjective(report, { findings: parseListFromEditor(value) }),
  },
  objectiveTests: {
    id: "objectiveTests",
    title: "Edit tests or results",
    description: "Enter one test or result per line.",
    placeholder: "Chest X-ray pending",
    format: (report) => formatListForEditor(report.soap.objective.testsOrResults),
    apply: (report, value) => withObjective(report, { testsOrResults: parseListFromEditor(value) }),
  },
  objectiveObservations: {
    id: "objectiveObservations",
    title: "Edit observations",
    description: "Enter one observation per line.",
    placeholder: "Patient appears fatigued",
    format: (report) => formatListForEditor(report.soap.objective.observations),
    apply: (report, value) => withObjective(report, { observations: parseListFromEditor(value) }),
  },
  assessmentSummary: {
    id: "assessmentSummary",
    title: "Edit assessment summary",
    description: "Rewrite the assessment summary.",
    placeholder: "Summarize your clinical assessment.",
    format: (report) => report.soap.assessment.summary,
    apply: (report, value) => withAssessment(report, { summary: value.trim() }),
  },
  assessmentDiagnoses: {
    id: "assessmentDiagnoses",
    title: "Edit diagnoses",
    description: "Enter one diagnosis per line using `Diagnosis | confidence`.",
    placeholder: "COPD exacerbation | likely",
    format: (report) => formatDiagnosesForEditor(report.soap.assessment.diagnoses),
    apply: (report, value) => withAssessment(report, { diagnoses: parseDiagnosesFromEditor(value) }),
  },
  assessmentDifferentials: {
    id: "assessmentDifferentials",
    title: "Edit differentials",
    description: "Enter one differential per line.",
    placeholder: "Pneumonia",
    format: (report) => formatListForEditor(report.soap.assessment.differentials),
    apply: (report, value) => withAssessment(report, { differentials: parseListFromEditor(value) }),
  },
  assessmentRedFlags: {
    id: "assessmentRedFlags",
    title: "Edit red flags",
    description: "Enter one red flag per line.",
    placeholder: "Increasing shortness of breath",
    format: (report) => formatListForEditor(report.soap.assessment.redFlags),
    apply: (report, value) => withAssessment(report, { redFlags: parseListFromEditor(value) }),
  },
  planMedications: {
    id: "planMedications",
    title: "Edit medication plan",
    description: "Enter one medication instruction per line.",
    placeholder: "Start inhaled bronchodilator as needed",
    format: (report) => formatListForEditor(report.soap.plan.medications),
    apply: (report, value) => withPlan(report, { medications: parseListFromEditor(value) }),
  },
  planTests: {
    id: "planTests",
    title: "Edit tests ordered",
    description: "Enter one test order per line.",
    placeholder: "CBC",
    format: (report) => formatListForEditor(report.soap.plan.testsOrdered),
    apply: (report, value) => withPlan(report, { testsOrdered: parseListFromEditor(value) }),
  },
  planReferrals: {
    id: "planReferrals",
    title: "Edit referrals",
    description: "Enter one referral per line.",
    placeholder: "Pulmonology follow-up",
    format: (report) => formatListForEditor(report.soap.plan.referrals),
    apply: (report, value) => withPlan(report, { referrals: parseListFromEditor(value) }),
  },
  planFollowUp: {
    id: "planFollowUp",
    title: "Edit follow-up",
    description: "Enter one follow-up item per line.",
    placeholder: "Return in 2 weeks",
    format: (report) => formatListForEditor(report.soap.plan.followUp),
    apply: (report, value) => withPlan(report, { followUp: parseListFromEditor(value) }),
  },
  planPatientInstructions: {
    id: "planPatientInstructions",
    title: "Edit patient instructions",
    description: "Enter one instruction per line.",
    placeholder: "Seek urgent care if breathing worsens",
    format: (report) => formatListForEditor(report.soap.plan.patientInstructions),
    apply: (report, value) => withPlan(report, { patientInstructions: parseListFromEditor(value) }),
  },
  planClinicianTasks: {
    id: "planClinicianTasks",
    title: "Edit clinician tasks",
    description: "Enter one clinician task per line.",
    placeholder: "Review imaging results when available",
    format: (report) => formatListForEditor(report.soap.plan.clinicianTasks),
    apply: (report, value) => withPlan(report, { clinicianTasks: parseListFromEditor(value) }),
  },
  planLifestyle: {
    id: "planLifestyle",
    title: "Edit lifestyle advice",
    description: "Enter one lifestyle recommendation per line.",
    placeholder: "Smoking cessation counseling",
    format: (report) => formatListForEditor(report.soap.plan.lifestyleAdvice),
    apply: (report, value) => withPlan(report, { lifestyleAdvice: parseListFromEditor(value) }),
  },
  qualityMissing: {
    id: "qualityMissing",
    title: "Edit missing information",
    description: "Enter one missing item per line.",
    placeholder: "Family history not discussed",
    format: (report) => formatListForEditor(report.quality.missingInformation),
    apply: (report, value) => withQuality(report, { missingInformation: parseListFromEditor(value) }),
  },
  qualityAmbiguities: {
    id: "qualityAmbiguities",
    title: "Edit ambiguities",
    description: "Enter one ambiguity per line.",
    placeholder: "Onset timing remains unclear",
    format: (report) => formatListForEditor(report.quality.ambiguities),
    apply: (report, value) => withQuality(report, { ambiguities: parseListFromEditor(value) }),
  },
  transcript: {
    id: "transcript",
    title: "Edit transcript",
    description: "Rewrite the saved transcript text directly.",
    placeholder: "Paste or dictate the corrected transcript here.",
    format: (report) => report.transcript.fullText,
    apply: (report, value) => withTranscript(report, value),
  },
};

function isRtlLanguage(code: string) {
  const normalized = code.toLowerCase();
  return ["ar", "fa", "he", "ur"].some((prefix) => normalized.startsWith(prefix));
}

function formatVisitType(value: string | undefined) {
  return (value ?? "unknown").replace("_", " ");
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  headerStack: {
    gap: spacing.md,
  },
  meta: {
    ...typography.medium,
    color: colors.textSoft,
  },
  guidance: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSoft,
  },
  body: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  headerActions: {
    marginTop: spacing.xs,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  busyText: {
    ...typography.medium,
    color: colors.accent,
  },
  tabRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: "#fff4fa",
    borderColor: "#ffd3ea",
  },
  tabPressed: {
    transform: [{ scale: 0.992 }],
  },
  tabLabel: {
    ...typography.semibold,
    fontSize: 14,
    color: colors.ink,
    textAlign: "center",
  },
  tabLabelActive: {
    color: colors.accent,
  },
  editableBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.xs,
  },
  editableBlockPressed: {
    transform: [{ scale: 0.995 }],
    borderColor: "#ffd3ea",
  },
  disabled: {
    opacity: 0.55,
  },
  editableHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  editableLabel: {
    ...typography.semibold,
    fontSize: 14,
  },
  editableHint: {
    ...typography.medium,
    fontSize: 12,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  editablePreview: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkMuted,
  },
  transcriptList: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  turnCard: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  patientTurnCard: {
    backgroundColor: "#f3eefb",
  },
  turnLabel: {
    ...typography.semibold,
    fontSize: 12,
    color: colors.ink,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  patientTurnLabel: {
    color: colors.textSoft,
  },
  turnText: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
  },
  patientTurnText: {
    color: colors.textSoft,
  },
  rtlTranscript: {
    writingDirection: "rtl",
    textAlign: "right",
  },
  actions: {
    gap: spacing.md,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalScrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20, 20, 43, 0.35)",
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl + (Platform.OS === "ios" ? spacing.md : 0),
    gap: spacing.md,
  },
  modalTitle: {
    ...typography.title,
    fontSize: 24,
  },
  modalBody: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  modalInput: {
    minHeight: 220,
    maxHeight: 360,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.ink,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modalButton: {
    flex: 1,
  },
});
