import * as MailComposer from "expo-mail-composer";
import * as Sharing from "expo-sharing";
import { router } from "expo-router";
import { useEffect } from "react";
import { I18nManager, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandBackground } from "@/components/BrandBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionCard } from "@/components/SectionCard";
import { BulletList, ReportSection } from "@/components/ReportSection";
import { colors, spacing, typography } from "@/constants/theme";
import { useSession } from "@/lib/session";

function isRtlLanguage(code: string) {
  return code.toLowerCase().startsWith("ar");
}

export default function ReportScreen() {
  const { currentPdfUri, currentReport } = useSession();

  useEffect(() => {
    if (!currentReport) {
      router.replace("/");
    }
  }, [currentReport]);

  if (!currentReport) {
    return null;
  }

  const report = currentReport;
  const rtl = isRtlLanguage(report.language.detected) || I18nManager.isRTL;

  async function handleShare() {
    if (!currentPdfUri) {
      return;
    }
    await Sharing.shareAsync(currentPdfUri);
  }

  async function handleEmail() {
    if (!currentPdfUri) {
      return;
    }

    const available = await MailComposer.isAvailableAsync();
    if (!available) {
      return;
    }

    await MailComposer.composeAsync({
      subject: `Elfie Scribe consultation report · ${new Date(report.createdAt).toLocaleDateString()}`,
      body: report.summary.oneLiner,
      attachments: [currentPdfUri],
    });
  }

  return (
    <BrandBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <SectionCard eyebrow="Consultation report" title={report.summary.oneLiner}>
            <Text style={styles.meta}>
              {new Date(report.createdAt).toLocaleString()} · {report.language.detected.toUpperCase()} source
            </Text>
            <BulletList items={report.summary.bullets} />
          </SectionCard>

          <SectionCard eyebrow="Visit" title={report.visit.visitReason}>
            <Text style={styles.meta}>Type: {report.visit.visitType ?? "unknown"}</Text>
          </SectionCard>

          <SectionCard title="SOAP">
            <ReportSection title="Subjective">
              <Text style={styles.body}>{report.soap.subjective.hpi}</Text>
              <BulletList items={report.soap.subjective.symptoms} />
            </ReportSection>
            <ReportSection title="Objective">
              <BulletList
                items={[
                  ...report.soap.objective.vitals,
                  ...report.soap.objective.findings,
                  ...report.soap.objective.testsOrResults,
                  ...report.soap.objective.observations,
                ]}
              />
            </ReportSection>
            <ReportSection title="Assessment">
              <Text style={styles.body}>{report.soap.assessment.summary}</Text>
              <BulletList items={report.soap.assessment.diagnoses.map((item) => `${item.name} (${item.confidence})`)} />
            </ReportSection>
            <ReportSection title="Plan">
              <BulletList
                items={[
                  ...report.soap.plan.medications,
                  ...report.soap.plan.testsOrdered,
                  ...report.soap.plan.referrals,
                  ...report.soap.plan.followUp,
                  ...report.soap.plan.patientInstructions,
                  ...report.soap.plan.clinicianTasks,
                  ...report.soap.plan.lifestyleAdvice,
                ]}
              />
            </ReportSection>
          </SectionCard>

          <SectionCard title="Missing or Ambiguous">
            <ReportSection title="Missing information">
              <BulletList items={report.quality.missingInformation} />
            </ReportSection>
            <ReportSection title="Ambiguities">
              <BulletList items={report.quality.ambiguities} />
            </ReportSection>
          </SectionCard>

          <SectionCard title="Transcript">
            <Text style={[styles.transcript, rtl && styles.rtlTranscript]}>{report.transcript.fullText}</Text>
          </SectionCard>

          <View style={styles.actions}>
            <PrimaryButton label="Share PDF" onPress={handleShare} />
            <PrimaryButton label="Email PDF" onPress={handleEmail} secondary />
            <PrimaryButton label="New recording" onPress={() => router.replace("/")} secondary />
          </View>
        </ScrollView>
      </SafeAreaView>
    </BrandBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  meta: {
    ...typography.medium,
    color: colors.textSoft,
  },
  body: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  transcript: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
  },
  rtlTranscript: {
    writingDirection: "rtl",
    textAlign: "right",
  },
  actions: {
    gap: spacing.md,
  },
});
