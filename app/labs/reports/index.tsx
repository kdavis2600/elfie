import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { TopBackButton } from "@/components/TopBackButton";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { useSession } from "@/lib/session";

export default function PreviousLabReportsScreen() {
  const { isHydrated, storedLabReports } = useSession();

  return (
    <AppScreen scroll contentContainerStyle={styles.content}>
      <StaggeredFadeIn index={0}>
        <View style={styles.header}>
          <TopBackButton label="Home" onPress={() => router.replace("/")} />
          <ScreenIntro
            eyebrow="History"
            title="Previous lab analyses"
            subtitle="Open any saved lab analysis and review the prioritized findings, normalized rows, and sanitized source text."
          />
        </View>
      </StaggeredFadeIn>

      {!isHydrated ? (
        <StaggeredFadeIn index={1}>
          <ActivityIndicator color={colors.accent} />
        </StaggeredFadeIn>
      ) : storedLabReports.length ? (
        <StaggeredFadeIn index={1}>
          <View style={styles.list}>
            {storedLabReports.map((stored, index) => (
              <StaggeredFadeIn key={stored.report.id} index={index} delayMs={60}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/labs/reports/${encodeURIComponent(stored.report.id)}`)}
                  style={({ pressed }) => [styles.reportPill, pressed && styles.reportPillPressed]}
                >
                  <View style={styles.reportMetaRow}>
                    <Text style={styles.reportMeta}>{formatReportTime(stored.report.createdAt)}</Text>
                    <Text style={styles.reportMeta}>·</Text>
                    <Text style={styles.reportMeta}>{formatReportDate(stored.report.createdAt)}</Text>
                    <Text style={styles.reportMeta}>·</Text>
                    <Text style={styles.reportMeta}>{stored.report.processing.mode.replaceAll("_", " ")}</Text>
                  </View>
                  <Text style={styles.reportSummary} numberOfLines={4}>
                    {stored.report.summary.headline}
                  </Text>
                </Pressable>
              </StaggeredFadeIn>
            ))}
          </View>
        </StaggeredFadeIn>
      ) : (
        <StaggeredFadeIn index={1}>
          <SectionCard eyebrow="Saved analyses" title="No previous lab analyses yet">
            <Text style={styles.emptyBody}>Completed lab analyses will appear here once they are saved.</Text>
          </SectionCard>
        </StaggeredFadeIn>
      )}
    </AppScreen>
  );
}

function formatReportTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(value))
    .replace(/\s/g, "");
}

function formatReportDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(new Date(value))
    .replace(",", "");
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
  reportPill: {
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  reportPillPressed: {
    transform: [{ scale: 0.992 }],
    borderColor: "#a9d6ee",
  },
  reportMetaRow: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
    flexWrap: "wrap",
  },
  reportMeta: {
    ...typography.semibold,
    fontSize: 12,
    color: colors.textSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  reportSummary: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  emptyBody: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
});
