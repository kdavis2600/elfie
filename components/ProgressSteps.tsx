import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "@/constants/theme";

type ProgressStepsProps = {
  activeStep: number;
  steps: string[];
};

export function ProgressSteps({ activeStep, steps }: ProgressStepsProps) {
  return (
    <View style={styles.container}>
      {steps.map((step, index) => {
        const isDone = index < activeStep;
        const isActive = index === activeStep;

        return (
          <View key={step} style={styles.row}>
            <View style={[styles.dot, isDone && styles.doneDot, isActive && styles.activeDot]} />
            <Text style={[styles.label, isDone && styles.doneLabel, isActive && styles.activeLabel]}>{step}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  doneDot: {
    backgroundColor: colors.ink,
  },
  activeDot: {
    backgroundColor: colors.accent,
    transform: [{ scale: 1.1 }],
  },
  label: {
    ...typography.body,
    fontSize: 15,
    color: colors.textFaint,
  },
  doneLabel: {
    color: colors.ink,
  },
  activeLabel: {
    ...typography.semibold,
    color: colors.ink,
  },
});
