import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "@/constants/theme";

type ReportSectionProps = {
  title: string;
  children?: ReactNode;
};

export function ReportSection({ title, children }: ReportSectionProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export function BulletList({ items }: { items: string[] }) {
  if (!items.length) {
    return <Text style={styles.empty}>Not captured</Text>;
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} style={styles.row}>
          <View style={styles.bullet} />
          <Text style={styles.item}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    fontSize: 18,
  },
  body: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginTop: 8,
  },
  item: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  empty: {
    ...typography.body,
    color: colors.textFaint,
  },
});
