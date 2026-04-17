import { StyleSheet, View } from "react-native";

import { colors } from "@/constants/theme";

type WaveformProps = {
  level: number;
};

export function Waveform({ level }: WaveformProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: 28 }).map((_, index) => {
        const distance = Math.abs(index - 13.5);
        const base = Math.max(0.16, 1 - distance / 14);
        const height = 18 + base * 70 * level;

        return (
          <View
            key={index}
            style={[
              styles.bar,
              {
                height,
                opacity: 0.35 + base * 0.65,
                backgroundColor: index % 4 === 0 ? colors.accent : colors.ink,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
    minHeight: 110,
  },
  bar: {
    width: 8,
    borderRadius: 999,
  },
});
