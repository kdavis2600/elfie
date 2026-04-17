import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ProgressSteps } from "@/components/ProgressSteps";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { TopBackButton } from "@/components/TopBackButton";
import { colors, spacing, typography } from "@/constants/theme";
import { analyzeLabReportAsync } from "@/lib/api";
import { generateLabReportPdfAsync } from "@/lib/pdf";
import { useSession } from "@/lib/session";
import { persistPdfAsync } from "@/lib/storage";

const STEPS = ["Preparing file", "Uploading document", "Extracting rows", "Ranking findings", "Preparing PDF"];

export default function ProcessLabReportScreen() {
  const { pendingLabDocument, setPendingLabDocument, setLabReport } = useSession();
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const completedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!pendingLabDocument) {
      if (!completedRef.current) {
        router.replace("/labs/import");
      }
      return;
    }

    const document = pendingLabDocument;
    completedRef.current = false;

    async function run() {
      try {
        setError(null);
        setIsRunning(true);
        setActiveStep(0);

        const result = await analyzeLabReportAsync(document);
        if (cancelled) {
          return;
        }

        setActiveStep(4);
        const pdfTempUri = await generateLabReportPdfAsync(result.report);
        if (cancelled) {
          return;
        }

        const pdfUri = await persistPdfAsync(pdfTempUri, `${result.report.id}.pdf`);
        await setLabReport(result.report, pdfUri);
        completedRef.current = true;
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPendingLabDocument(null);
        router.replace("/labs/report");
      } catch (runError) {
        setError(runError instanceof Error ? runError.message : "Lab analysis failed.");
      } finally {
        setIsRunning(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [attempt, pendingLabDocument, setLabReport, setPendingLabDocument]);

  useEffect(() => {
    if (!isRunning || activeStep >= STEPS.length - 1) {
      return;
    }

    const timer = setTimeout(() => {
      setActiveStep((current) => Math.min(current + 1, STEPS.length - 1));
    }, 900);

    return () => clearTimeout(timer);
  }, [activeStep, isRunning]);

  return (
    <AppScreen scroll contentContainerStyle={styles.content}>
      <StaggeredFadeIn index={0}>
        <View style={styles.header}>
          <TopBackButton
            label="Labs"
            onPress={() => {
              setPendingLabDocument(null);
              router.replace("/labs/import");
            }}
          />
          <ScreenIntro
            eyebrow="Analyzing"
            title="Processing lab report."
            subtitle="Keep the app open while the document is extracted, normalized, ranked, and exported to PDF."
          />
        </View>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1}>
        <SectionCard eyebrow="In progress" title={error ? "We couldn't finish the analysis" : "Preparing your lab summary"}>
          <ProgressSteps activeStep={activeStep} steps={STEPS} />
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <View style={styles.spinnerRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.caption}>This may take longer than note extraction if the document is scanned.</Text>
            </View>
          )}
        </SectionCard>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={2}>
        <View style={styles.actions}>
          {error ? <PrimaryButton label="Retry" onPress={() => setAttempt((value) => value + 1)} /> : null}
          <PrimaryButton
            label="Back to labs import"
            onPress={() => {
              setPendingLabDocument(null);
              router.replace("/labs/import");
            }}
            secondary
          />
        </View>
      </StaggeredFadeIn>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.md,
  },
  spinnerRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
  },
  caption: {
    ...typography.body,
    color: colors.textSoft,
    flex: 1,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  actions: {
    gap: spacing.md,
  },
});
