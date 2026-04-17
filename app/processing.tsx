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
import { colors, spacing, typography } from "@/constants/theme";
import { processAudioAsync } from "@/lib/api";
import { createMockReport } from "@/lib/mock";
import { generateReportPdfAsync } from "@/lib/pdf";
import { UI_PRIVACY_MODE_ENABLED } from "@/lib/privacy";
import { useSession } from "@/lib/session";
import { persistPdfAsync } from "@/lib/storage";

const STEPS = ["Preparing recording", "Uploading audio", "Transcribing conversation", "Drafting note", "Preparing PDF"];

export default function ProcessingScreen() {
  const { currentTemplate, pendingAudio, setPendingAudio, setReport } = useSession();
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const completedRef = useRef(false);
  const templateSnapshotRef = useRef(currentTemplate);

  useEffect(() => {
    if (pendingAudio) {
      templateSnapshotRef.current = currentTemplate;
    }
  }, [currentTemplate, pendingAudio?.uri]);

  useEffect(() => {
    let cancelled = false;

    if (!pendingAudio) {
      if (!completedRef.current) {
        router.replace("/");
      }
      return;
    }

    const audio = pendingAudio;
    completedRef.current = false;

    async function run() {
      try {
        setError(null);
        setIsRunning(true);

        setActiveStep(0);
        const result = await processAudioAsync(audio);
        if (cancelled) {
          return;
        }

        setActiveStep(3);
        const report = result.report ?? createMockReport(audio.sourceType);
        const pdfTempUri = await generateReportPdfAsync(report, templateSnapshotRef.current);
        if (cancelled) {
          return;
        }

        setActiveStep(4);
        const pdfUri = await persistPdfAsync(pdfTempUri, `${report.id}.pdf`);
        await setReport(report, pdfUri);
        completedRef.current = true;
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPendingAudio(null);
        router.replace("/report");
      } catch (runError) {
        console.error(runError);
        const message = runError instanceof Error ? runError.message : "Audio processing failed.";
        if (!cancelled) {
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsRunning(false);
        }
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

  function handleBackHome() {
    setPendingAudio(null);
    router.replace("/");
  }

  return (
    <AppScreen contentStyle={styles.container}>
      <StaggeredFadeIn index={0}>
        <ScreenIntro
          eyebrow="Preparing note"
          title="Analyzing the consultation."
          subtitle="Please keep the app open while the note and PDF are prepared."
        >
          {UI_PRIVACY_MODE_ENABLED ? (
            <Text style={styles.privacyCopy}>
              Privacy mode is on. Direct identifiers are redacted before structured extraction, and PDF export omits the
              full transcript.
            </Text>
          ) : null}
        </ScreenIntro>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1}>
        <SectionCard eyebrow="In progress" title={error ? "We couldn't finish the note" : "Preparing your consultation note"}>
          <ProgressSteps activeStep={activeStep} steps={STEPS} />
          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <View style={styles.spinnerRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.caption}>This can take up to a couple of minutes for longer consultations.</Text>
            </View>
          )}
        </SectionCard>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={2}>
        <View style={styles.actions}>
          {error ? <PrimaryButton label="Retry" onPress={() => setAttempt((value) => value + 1)} /> : null}
          <PrimaryButton label="Back home" onPress={handleBackHome} secondary />
        </View>
      </StaggeredFadeIn>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    justifyContent: "space-between",
    gap: spacing.xl,
  },
  privacyCopy: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: "#8a5a00",
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
