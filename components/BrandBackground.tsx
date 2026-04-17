import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { colors } from "@/constants/theme";

export function BrandBackground({ children }: PropsWithChildren) {
  return (
    <LinearGradient colors={[colors.background, "#ffffff"]} style={styles.container}>
      <View style={[styles.glow, styles.pinkGlow]} />
      <View style={[styles.glow, styles.blueGlow]} />
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  glow: {
    position: "absolute",
    borderRadius: 999,
    opacity: 0.18,
  },
  pinkGlow: {
    top: -60,
    right: -80,
    width: 240,
    height: 240,
    backgroundColor: colors.accent,
  },
  blueGlow: {
    bottom: 80,
    left: -110,
    width: 260,
    height: 260,
    backgroundColor: colors.accentGlow,
  },
});
