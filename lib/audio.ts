import { setAudioModeAsync } from "expo-audio";

export async function configureRecordingAudioModeAsync() {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: "duckOthers",
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: false,
  });
}

export function formatDuration(durationMillis: number) {
  const totalSeconds = Math.floor(durationMillis / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function normalizeMetering(metering?: number) {
  if (typeof metering !== "number") {
    return 0.15;
  }

  return Math.min(1, Math.max(0.08, (metering + 60) / 60));
}
