import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandBackground } from "@/components/BrandBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ProgressSteps } from "@/components/ProgressSteps";
import { SectionCard } from "@/components/SectionCard";
import { colors, spacing, typography } from "@/constants/theme";
import { processAudioAsync } from "@/lib/api";
import { createMockReport } from "@/lib/mock";
import { generateReportPdfAsync } from "@/lib/pdf";
import { useSession } from "@/lib/session";
import { persistPdfAsync } from "@/lib/storage";

const STEPS = ["Preparing audio", "Uploading", "Transcribing", "Structuring note", "Generating PDF"];

export default function ProcessingScreen() {
  const { pendingAudio, setPendingAudio, setReport } = useSession();
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!pendingAudio) {
        router.replace("/");
        return;
      }

      try {
        setError(null);
        setIsRunning(true);

        setActiveStep(0);
        const result = await processAudioAsync(pendingAudio);
        if (cancelled) {
          return;
        }

        setActiveStep(3);
        const report = result.report ?? createMockReport(pendingAudio.sourceType);
        const pdfTempUri = await generateReportPdfAsync(report);
        if (cancelled) {
          return;
        }

        setActiveStep(4);
        const pdfUri = await persistPdfAsync(pdfTempUri, `${report.id}.pdf`);
        await setReport(report, pdfUri);
        setPendingAudio(null);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/report");
      } catch (runError) {
        console.error(runError);
        const message = runError instanceof Error ? runError.message : "Audio processing failed.";
        setError(message);
      } finally {
        setIsRunning(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [attempt, pendingAudio, setPendingAudio, setReport]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    if (activeStep >= STEPS.length - 1) {
      return;
    }

    const timer = setTimeout(() => {
      setActiveStep((current) => Math.min(current + 1, STEPS.length - 1));
    }, 900);

    return () => clearTimeout(timer);
  }, [activeStep, isRunning]);

  return (
    <BrandBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Processing</Text>
            <Text style={styles.title}>Turning the consultation into a polished note.</Text>
            <Text style={styles.subtitle}>
              Railway is orchestrating Qwen ASR and the structured extraction pass, then the app assembles the PDF locally.
            </Text>
          </View>

          <SectionCard eyebrow="Happy path" title={error ? "Something needs attention" : "Working through the pipeline"}>
            <ProgressSteps activeStep={activeStep} steps={STEPS} />
            {error ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <View style={styles.spinnerRow}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.caption}>This usually takes one request cycle for ASR and one for report extraction.</Text>
              </View>
            )}
          </SectionCard>

          <View style={styles.actions}>
            {error ? <PrimaryButton label="Retry" onPress={() => setAttempt((value) => value + 1)} /> : null}
            <PrimaryButton label="Back home" onPress={() => router.replace("/")} secondary />
          </View>
        </View>
      </SafeAreaView>
    </BrandBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    justifyContent: "space-between",
    gap: spacing.xl,
  },
  header: {
    gap: spacing.md,
  },
  eyebrow: {
    ...typography.semibold,
    color: colors.accent,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  title: {
    ...typography.title,
    fontSize: 34,
    lineHeight: 40,
  },
  subtitle: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 24,
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
