import * as Haptics from "expo-haptics";

export async function triggerPressHapticAsync() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Ignore unsupported haptics platforms and runtime failures.
  }
}
