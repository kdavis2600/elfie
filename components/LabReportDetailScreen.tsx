import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { TopBackButton } from "@/components/TopBackButton";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { LabAnalysisReport, StoredLabReport } from "@/types/labReport";

type LabReportDetailScreenProps = {
  storedReport: StoredLabReport;
  onBack: () => void;
  backLabel?: string;
};

export function LabReportDetailScreen({
  storedReport,
  onBack,
  backLabel = "Back",
}: LabReportDetailScreenProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "source">("overview");
  const [shareAvailable, setShareAvailable] = useState(true);
  const report = storedReport.report;
  const pdfUri = storedReport.pdfUri ?? null;

  useEffect(() => {
    setActiveTab("overview");
  }, [report.id]);

  useEffect(() => {
    let cancelled = false;

    Sharing.isAvailableAsync()
      .then((available) => {
        if (!cancelled) {
          setShareAvailable(available);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const sortedResults = useMemo(() => sortLabResults(report.results), [report.results]);

  async function handleShare() {
    if (!pdfUri) {
      return;
    }

    if (!shareAvailable) {
      Alert.alert("Sharing unavailable", "This device or browser does not support native sharing for PDFs.");
      return;
    }

    try {
      await Sharing.shareAsync(pdfUri);
    } catch (error) {
      Alert.alert("Could not share PDF", error instanceof Error ? error.message : "The PDF could not be shared right now.");
    }
  }

  return (
    <AppScreen scroll contentContainerStyle={styles.content}>
      <StaggeredFadeIn index={0} resetKey={report.id}>
        <View style={styles.headerStack}>
          <TopBackButton label={backLabel} onPress={onBack} />
          <SectionCard eyebrow="Lab analysis" title={report.summary.headline}>
            <Text style={styles.meta}>
              {new Date(report.createdAt).toLocaleString()} · {(report.language.detected || "unknown").toUpperCase()} ·{" "}
              {report.processing.mode.replaceAll("_", " ")}
            </Text>
            <Text style={styles.guidance}>
              Abnormal findings are prioritized first. Source text below is sanitized and stored without the uploaded lab file.
            </Text>
            <View style={styles.summaryList}>
              {report.summary.bullets.map((bullet, index) => (
                <Text key={`${report.id}-summary-${index}`} style={styles.bullet}>
                  • {bullet}
                </Text>
              ))}
            </View>
            {report.processing.mode !== "hybrid" || report.processing.usedMock ? (
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>
                  {report.processing.usedMock ? "Mock analysis" : "Degraded mode"}
                </Text>
                <Text style={styles.calloutBody}>
                  {report.processing.usedMock
                    ? "This report was generated from fallback mock data because live Qwen inference was unavailable."
                    : "Claude reasoning was unavailable, so this report used the Qwen-only path for extraction and explanation."}
                </Text>
              </View>
            ) : null}
          </SectionCard>
        </View>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1} resetKey={report.id}>
        <View style={styles.tabRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab("overview")}
            style={({ pressed }) => [styles.tab, activeTab === "overview" && styles.tabActive, pressed && styles.tabPressed]}
          >
            <Text style={[styles.tabLabel, activeTab === "overview" && styles.tabLabelActive]}>Overview</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveTab("source")}
            style={({ pressed }) => [styles.tab, activeTab === "source" && styles.tabActive, pressed && styles.tabPressed]}
          >
            <Text style={[styles.tabLabel, activeTab === "source" && styles.tabLabelActive]}>Source text</Text>
          </Pressable>
        </View>
      </StaggeredFadeIn>

      {activeTab === "overview" ? (
        <>
          <StaggeredFadeIn index={2} resetKey={report.id}>
            <SectionCard eyebrow="Document" title="Source document">
              <Text style={styles.metaLine}>Type: {report.sourceDocument.sourceType.toUpperCase()}</Text>
              <Text style={styles.metaLine}>Pages: {report.sourceDocument.pageCount ?? "Unknown"}</Text>
              <Text style={styles.metaLine}>Overall risk: {formatSeverity(report.summary.overallRisk)}</Text>
            </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={3} resetKey={report.id}>
            <SectionCard eyebrow="Priority" title="Abnormal findings">
              {report.abnormalFindings.length ? (
                report.abnormalFindings.map((finding) => (
                  <View key={finding.id} style={styles.findingCard}>
                    <View style={styles.findingHeader}>
                      <Text style={styles.findingTitle}>{finding.title}</Text>
                      <Text style={styles.findingBadge}>{formatSeverity(finding.severity)}</Text>
                    </View>
                    <Text style={styles.findingMeta}>{formatActionability(finding.actionability)}</Text>
                    <Text style={styles.body}>{finding.explanation}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.body}>No prioritized abnormal findings were identified from the structured rows.</Text>
              )}
            </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={4} resetKey={report.id}>
            <SectionCard eyebrow="Next steps" title="Suggested follow-up buckets">
              <NextStepBucket title="Urgent attention" items={report.nextSteps.urgentAttention} />
              <NextStepBucket title="Discuss with clinician soon" items={report.nextSteps.discussWithClinicianSoon} />
              <NextStepBucket
                title="Routine follow-up or monitoring"
                items={report.nextSteps.routineFollowUpOrMonitoring}
              />
            </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={5} resetKey={report.id}>
            <SectionCard eyebrow="Structured rows" title={`Results (${sortedResults.length})`}>
              {sortedResults.length ? (
                sortedResults.map((result) => (
                  <View key={result.id} style={styles.resultCard}>
                    <View style={styles.findingHeader}>
                      <Text style={styles.resultTitle}>{result.testNameCanonical ?? result.testNameRaw}</Text>
                      <Text style={styles.resultFlag}>{formatFlag(result.flag)}</Text>
                    </View>
                    <Text style={styles.findingMeta}>
                      {result.panelName ?? "Uncategorized"} · {formatSeverity(result.severity)}
                    </Text>
                    <View style={styles.resultMetaGrid}>
                      <Text style={styles.resultMeta}>Value: {formatValue(result)}</Text>
                      <Text style={styles.resultMeta}>Range: {result.referenceRangeRaw ?? "Not stated"}</Text>
                      <Text style={styles.resultMeta}>Page: {result.pageNumber ?? "Unknown"}</Text>
                      <Text style={styles.resultMeta}>Confidence: {Math.round(result.confidence * 100)}%</Text>
                    </View>
                    <Text style={styles.body}>{result.clinicalMeaning}</Text>
                    <Text style={styles.bodySoft}>{result.patientExplanation}</Text>
                    {result.recommendedFollowUp ? <Text style={styles.bodySoft}>Follow-up: {result.recommendedFollowUp}</Text> : null}
                    {result.sourceSnippet ? <Text style={styles.resultSnippet}>Snippet: {result.sourceSnippet}</Text> : null}
                  </View>
                ))
              ) : (
                <Text style={styles.body}>No rows were extracted from this lab document.</Text>
              )}
            </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={6} resetKey={report.id}>
            <SectionCard eyebrow="Quality" title="Missing or uncertain information">
              <FlatTextList
                items={[
                  ...report.quality.missingInformation,
                  ...report.quality.ambiguities,
                  ...report.quality.warnings,
                  ...report.quality.processingNotes,
                ]}
                emptyLabel="No quality notes were recorded."
              />
            </SectionCard>
          </StaggeredFadeIn>
        </>
      ) : (
        <StaggeredFadeIn index={2} resetKey={report.id}>
          <SectionCard eyebrow="Sanitized source" title="Source text">
            <Text style={styles.sourceText}>{report.sourceText || "No source text available."}</Text>
          </SectionCard>
        </StaggeredFadeIn>
      )}

      <StaggeredFadeIn index={7} resetKey={report.id}>
        <View style={styles.actions}>
          <PrimaryButton label="Share PDF" onPress={handleShare} disabled={!pdfUri} />
          <PrimaryButton label={backLabel} onPress={onBack} secondary />
        </View>
      </StaggeredFadeIn>
    </AppScreen>
  );
}

function NextStepBucket({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={styles.bucketCard}>
      <Text style={styles.bucketTitle}>{title}</Text>
      <FlatTextList items={items} emptyLabel="Nothing specific in this bucket." />
    </View>
  );
}

function FlatTextList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (!items.length) {
    return <Text style={styles.body}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.summaryList}>
      {items.map((item, index) => (
        <Text key={`${titleCaseSeed(item)}-${index}`} style={styles.bullet}>
          • {item}
        </Text>
      ))}
    </View>
  );
}

function sortLabResults(results: LabAnalysisReport["results"]) {
  const severityRank = new Map<LabSeverityLike, number>([
    ["critical", 0],
    ["high", 1],
    ["moderate", 2],
    ["mild", 3],
    ["unknown", 4],
    ["none", 5],
  ]);
  const flagRank = new Map<LabFlagLike, number>([
    ["out_of_range", 0],
    ["high", 1],
    ["low", 2],
    ["unknown", 3],
    ["normal", 4],
  ]);

  return [...results].sort((left, right) => {
    const severityDelta = (severityRank.get(left.severity) ?? 99) - (severityRank.get(right.severity) ?? 99);
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const flagDelta = (flagRank.get(left.flag) ?? 99) - (flagRank.get(right.flag) ?? 99);
    if (flagDelta !== 0) {
      return flagDelta;
    }

    return (left.testNameCanonical ?? left.testNameRaw).localeCompare(right.testNameCanonical ?? right.testNameRaw);
  });
}

function formatValue(result: LabAnalysisReport["results"][number]) {
  if (!result.unit || result.valueRaw.toLowerCase().includes(result.unit.toLowerCase())) {
    return result.valueRaw || "Not stated";
  }

  return `${result.valueRaw} ${result.unit}`.trim() || "Not stated";
}

function formatSeverity(value: LabSeverityLike) {
  return value.replaceAll("_", " ");
}

function formatActionability(value: LabActionabilityLike) {
  return value.replaceAll("_", " ");
}

function formatFlag(value: LabFlagLike) {
  return value.replaceAll("_", " ");
}

function titleCaseSeed(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

type LabSeverityLike = LabAnalysisReport["summary"]["overallRisk"];
type LabActionabilityLike = LabAnalysisReport["abnormalFindings"][number]["actionability"];
type LabFlagLike = LabAnalysisReport["results"][number]["flag"];

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  headerStack: {
    gap: spacing.md,
  },
  meta: {
    ...typography.medium,
    color: colors.textSoft,
    fontSize: 13,
  },
  guidance: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 21,
  },
  callout: {
    marginTop: spacing.sm,
    backgroundColor: "#fff7e6",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#f6d28b",
    padding: spacing.md,
    gap: spacing.xs,
  },
  calloutTitle: {
    ...typography.semibold,
    color: "#8a5a00",
  },
  calloutBody: {
    ...typography.body,
    color: "#8a5a00",
  },
  summaryList: {
    gap: spacing.xs,
  },
  bullet: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  tabRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#eef8ff",
    borderColor: "#a9d6ee",
  },
  tabPressed: {
    transform: [{ scale: 0.992 }],
  },
  tabLabel: {
    ...typography.semibold,
    fontSize: 14,
    color: colors.ink,
  },
  tabLabelActive: {
    color: "#04506b",
  },
  metaLine: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  findingCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fbfbfe",
    padding: spacing.md,
    gap: spacing.xs,
  },
  findingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  findingTitle: {
    ...typography.semibold,
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  findingBadge: {
    ...typography.semibold,
    fontSize: 12,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  findingMeta: {
    ...typography.medium,
    color: colors.textSoft,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  body: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  bodySoft: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSoft,
  },
  bucketCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fbfbfe",
    padding: spacing.md,
    gap: spacing.sm,
  },
  bucketTitle: {
    ...typography.semibold,
    fontSize: 15,
  },
  resultCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fbfbfe",
    padding: spacing.md,
    gap: spacing.sm,
  },
  resultTitle: {
    ...typography.semibold,
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  resultFlag: {
    ...typography.semibold,
    color: colors.success,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  resultMetaGrid: {
    gap: spacing.xs,
  },
  resultMeta: {
    ...typography.medium,
    color: colors.textSoft,
    fontSize: 13,
  },
  resultSnippet: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSoft,
  },
  sourceText: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 22,
  },
  actions: {
    gap: spacing.md,
  },
});
