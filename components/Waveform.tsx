import { StyleSheet, View } from "react-native";

import { colors } from "@/constants/theme";

type WaveformProps = {
  level: number;
};

export function Waveform({ level }: WaveformProps) {
  const bars = 20;

  return (
    <View style={styles.row}>
      {Array.from({ length: bars }).map((_, index) => {
        const distance = Math.abs(index - (bars - 1) / 2);
        const base = Math.max(0.16, 1 - distance / (bars / 2));
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
    justifyContent: "center",
    gap: 4,
    minHeight: 110,
  },
  bar: {
    flex: 1,
    maxWidth: 8,
    minWidth: 3,
    borderRadius: 999,
  },
});
