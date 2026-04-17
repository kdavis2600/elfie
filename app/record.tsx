import * as Haptics from "expo-haptics";
import { requestRecordingPermissionsAsync, RecordingPresets, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { Waveform } from "@/components/Waveform";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { configureRecordingAudioModeAsync, formatDuration, normalizeMetering } from "@/lib/audio";
import { useSession } from "@/lib/session";

const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

export default function RecordScreen() {
  useKeepAwake();

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 150);
  const hasStartedRef = useRef(false);
  const { setPendingAudio } = useSession();
  const [permissionStatus, setPermissionStatus] = useState<"loading" | "granted" | "denied">("loading");
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          if (!cancelled) {
            setPermissionStatus("denied");
          }
          return;
        }

        await configureRecordingAudioModeAsync();
        await recorder.prepareToRecordAsync();
        if (cancelled) {
          return;
        }
        recorder.record();
        hasStartedRef.current = true;
        if (!cancelled) {
          setIsPaused(false);
          setPermissionStatus("granted");
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setPermissionStatus("denied");
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
      if (hasStartedRef.current) {
        recorder.stop().catch(() => null);
      }
    };
  }, [recorder]);

  async function handlePauseResume() {
    try {
      if (!hasStartedRef.current) {
        return;
      }

      if (recorderState.isRecording) {
        recorder.pause();
        setIsPaused(true);
        await Haptics.selectionAsync();
        return;
      }

      recorder.record();
      setIsPaused(false);
      await Haptics.selectionAsync();
    } catch (error) {
      console.error(error);
      Alert.alert("Could not update recording", "Pause or resume did not complete successfully.");
    }
  }

  async function handleStop() {
    try {
      await recorder.stop();
      hasStartedRef.current = false;
      await Haptics.selectionAsync();
      setIsPaused(false);
      const uri = recorder.uri ?? recorderState.url;
      if (!uri) {
        throw new Error("Recording file was not created.");
      }

      const finalizedDurationSec =
        Number.isFinite(recorder.currentTime) && recorder.currentTime > 0
          ? Math.round(recorder.currentTime)
          : recorderState.durationMillis > 0
            ? Math.round(recorderState.durationMillis / 1000)
            : null;

      setPendingAudio({
        uri,
        fileName: `consultation-${Date.now()}.m4a`,
        durationSec: finalizedDurationSec,
        mimeType: "audio/mp4",
        sourceType: "recorded",
      });
      router.replace("/processing");
    } catch (error) {
      console.error(error);
      Alert.alert("Could not finish recording", "The audio file was not available after stopping the recorder.");
    }
  }

  async function handleCancel() {
    if (hasStartedRef.current) {
      await recorder.stop().catch(() => null);
    }
    hasStartedRef.current = false;
    setIsPaused(false);
    setPendingAudio(null);
    router.replace("/");
  }

  const isReady = permissionStatus === "granted" && hasStartedRef.current;
  const statusCopy =
    permissionStatus === "loading"
      ? "Preparing microphone..."
      : permissionStatus === "denied"
        ? "Microphone permission is required to record the consultation."
        : recorderState.isRecording
          ? "Recording in progress. Tap pause if you need to stop briefly."
          : isPaused
            ? "Recording paused. Tap resume to continue without losing this recording."
            : "Preparing recorder...";

  return (
    <AppScreen contentStyle={styles.container}>
      <StaggeredFadeIn index={0}>
        <ScreenIntro
          eyebrow="Recording"
          title="Leave the phone on the desk."
          subtitle="Keep the phone nearby and speak naturally. You can pause and resume at any time."
        />
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1}>
        <SectionCard eyebrow="Live capture" title={formatDuration(recorderState.durationMillis)}>
          {permissionStatus === "loading" ? (
            <ActivityIndicator color={colors.ink} />
          ) : permissionStatus === "denied" ? (
            <Text style={styles.errorText}>Microphone permission is required to record the consultation.</Text>
          ) : (
            <>
              <Waveform level={isPaused ? 0.08 : normalizeMetering(recorderState.metering)} />
              <Text style={styles.helperText}>{statusCopy}</Text>
            </>
          )}
        </SectionCard>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={2}>
        <View style={styles.actions}>
          <PrimaryButton
            label={recorderState.isRecording ? "Pause recording" : "Resume recording"}
            onPress={handlePauseResume}
            secondary
            disabled={!isReady}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!isReady}
            onPress={handleStop}
            style={({ pressed }) => [styles.stopButton, pressed && styles.stopPressed, !isReady && styles.disabled]}
          >
            <View style={styles.stopInner} />
          </Pressable>
          <PrimaryButton label="Cancel" onPress={handleCancel} secondary />
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
  helperText: {
    ...typography.body,
    color: colors.textSoft,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
  },
  actions: {
    alignItems: "center",
    gap: spacing.lg,
  },
  stopButton: {
    width: 126,
    height: 126,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 30,
    elevation: 7,
  },
  stopInner: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
  },
  stopPressed: {
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
