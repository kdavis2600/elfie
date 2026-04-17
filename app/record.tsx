import * as Haptics from "expo-haptics";
import { requestRecordingPermissionsAsync, RecordingPresets, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandBackground } from "@/components/BrandBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionCard } from "@/components/SectionCard";
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

  useEffect(() => {
    async function boot() {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          setPermissionStatus("denied");
          return;
        }

        await configureRecordingAudioModeAsync();
        await recorder.prepareToRecordAsync();
        recorder.record();
        hasStartedRef.current = true;
        setPermissionStatus("granted");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        console.error(error);
        setPermissionStatus("denied");
      }
    }

    boot();

    return () => {
      if (recorderState.isRecording) {
        recorder.stop().catch(() => null);
      }
    };
  }, [recorder]);

  async function handleStop() {
    try {
      await recorder.stop();
      await Haptics.selectionAsync();
      const uri = recorder.uri ?? recorderState.url;
      if (!uri) {
        throw new Error("Recording file was not created.");
      }

      setPendingAudio({
        uri,
        fileName: `consultation-${Date.now()}.m4a`,
        durationSec: Math.round(recorderState.durationMillis / 1000),
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
    if (hasStartedRef.current && recorderState.isRecording) {
      await recorder.stop().catch(() => null);
    }
    setPendingAudio(null);
    router.back();
  }

  return (
    <BrandBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.eyebrow}>Recording</Text>
          <Text style={styles.heading}>Leave the phone on the desk.</Text>
          <Text style={styles.body}>Elfie Scribe keeps the screen awake, captures the conversation, and turns it into a clinician-ready note.</Text>

          <SectionCard eyebrow="Live capture" title={formatDuration(recorderState.durationMillis)}>
            {permissionStatus === "loading" ? (
              <ActivityIndicator color={colors.ink} />
            ) : permissionStatus === "denied" ? (
              <Text style={styles.errorText}>Microphone permission is required to record the consultation.</Text>
            ) : (
              <>
                <Waveform level={normalizeMetering(recorderState.metering)} />
                <Text style={styles.helperText}>
                  {recorderState.isRecording ? "Recording in progress. Tap stop when the visit is done." : "Preparing recorder..."}
                </Text>
              </>
            )}
          </SectionCard>

          <View style={styles.actions}>
            <Pressable
              disabled={!recorderState.isRecording}
              onPress={handleStop}
              style={({ pressed }) => [styles.stopButton, pressed && styles.stopPressed, !recorderState.isRecording && styles.disabled]}
            >
              <View style={styles.stopInner} />
            </Pressable>
            <PrimaryButton label="Cancel" onPress={handleCancel} secondary />
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
  eyebrow: {
    ...typography.semibold,
    fontSize: 13,
    letterSpacing: 0.8,
    color: colors.accent,
    textTransform: "uppercase",
  },
  heading: {
    ...typography.title,
    fontSize: 34,
    lineHeight: 40,
  },
  body: {
    ...typography.body,
    fontSize: 16,
    lineHeight: 24,
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
