import * as DocumentPicker from "expo-document-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { TemplateRegionEditor } from "@/components/TemplateRegionEditor";
import { TopBackButton } from "@/components/TopBackButton";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { createTemplatePreviewAsync, runTemplateSanityCheckAsync } from "@/lib/api";
import {
  applyTemplateHeuristicDiagnostics,
  getTemplateContentOption,
  TEMPLATE_CONTENT_OPTIONS,
} from "@/lib/templateLayout";
import { createDraftTemplate, findTemplateRegion, updateTemplateRegion } from "@/lib/template";
import { useSession } from "@/lib/session";
import {
  collectTemplateAssetUris,
  deletePersistedFileAsync,
  persistTemplateAssetAsync,
  writeTemplateBase64Async,
} from "@/lib/storage";
import { PdfTemplate, TemplateContentKey, TemplateImportType, TemplateRegion, TemplateSanityCheck } from "@/types/template";

const REGION_STEP = 0.02;
const SIZE_STEP = 0.04;

export default function TemplateScreen() {
  const { currentTemplate, currentReport, setTemplate } = useSession();
  const [draftTemplate, setDraftTemplate] = useState<PdfTemplate | null>(() =>
    currentTemplate ? applyTemplateHeuristicDiagnostics(currentTemplate, currentReport) : null,
  );
  const [templateName, setTemplateName] = useState(currentTemplate?.name ?? "");
  const [selectedRegionId, setSelectedRegionId] = useState<TemplateRegion["id"]>(currentTemplate?.regions[0]?.id ?? "header");
  const [isBusy, setIsBusy] = useState(false);
  const [isSpotChecking, setIsSpotChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotCheckError, setSpotCheckError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftTemplate && currentTemplate) {
      setDraftTemplate(applyTemplateHeuristicDiagnostics(currentTemplate, currentReport));
      setTemplateName(currentTemplate.name);
      setSelectedRegionId(currentTemplate.regions[0]?.id ?? "header");
    }
  }, [currentReport, currentTemplate, draftTemplate]);

  useEffect(() => {
    setDraftTemplate((current) => (current ? applyTemplateHeuristicDiagnostics(current, currentReport) : current));
  }, [currentReport]);

  const selectedRegion = useMemo(
    () => (draftTemplate ? findTemplateRegion(draftTemplate, selectedRegionId) : null),
    [draftTemplate, selectedRegionId],
  );
  const selectedContentOption = selectedRegion ? getTemplateContentOption(selectedRegion.contentKey) : null;
  const isWorking = isBusy || isSpotChecking;

  function setDraftTemplateWithDiagnostics(updater: (current: PdfTemplate) => PdfTemplate) {
    setDraftTemplate((current) => (current ? applyTemplateHeuristicDiagnostics(updater(current), currentReport) : current));
    setSpotCheckError(null);
  }

  async function handleImport(importType: TemplateImportType) {
    if (isWorking) {
      return;
    }

    setError(null);
    const createdUris: string[] = [];

    try {
      setIsBusy(true);

      if (importType === "pdf") {
        const result = await DocumentPicker.getDocumentAsync({
          type: "application/pdf",
          copyToCacheDirectory: true,
          multiple: false,
        });

        if (result.canceled) {
          return;
        }

        const asset = result.assets[0];
        const persistedSourceUri = await persistTemplateAssetAsync(
          asset.uri,
          buildTargetName(asset.name ?? `template-${Date.now()}.pdf`, "pdf"),
        );
        createdUris.push(persistedSourceUri);
        const preview = await createTemplatePreviewAsync({
          uri: persistedSourceUri,
          fileName: asset.name ?? `template-${Date.now()}.pdf`,
          mimeType: asset.mimeType ?? "application/pdf",
          importType,
        });
        const previewUri = await writeTemplateBase64Async(
          preview.previewBase64,
          buildTargetName(asset.name ?? `template-preview-${Date.now()}.png`, "png"),
        );
        createdUris.push(previewUri);

        const draft = createDraftTemplate({
          name: stripExtension(asset.name ?? "Imported template"),
          importType,
          sourceUri: persistedSourceUri,
          previewUri,
          mimeType: asset.mimeType ?? "application/pdf",
          previewMimeType: preview.mimeType,
          width: preview.width,
          height: preview.height,
        });

        await replaceDraftTemplateAsync(draft);
        createdUris.length = 0;
        return;
      }

      const pickerResult =
        importType === "photo"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              quality: 0.9,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.9,
            });

      if (pickerResult.canceled) {
        return;
      }

      const asset = pickerResult.assets[0];
      const manipulated = await manipulateAsync(asset.uri, [], {
        compress: 0.92,
        format: SaveFormat.JPEG,
      });
      const targetName = buildTargetName(asset.fileName ?? `${importType}-template-${Date.now()}.jpg`, "jpg");
      const previewUri = await persistTemplateAssetAsync(manipulated.uri, targetName);
      createdUris.push(previewUri);
      const draft = createDraftTemplate({
        name: stripExtension(asset.fileName ?? (importType === "photo" ? "Camera template" : "Imported template")),
        importType,
        sourceUri: previewUri,
        previewUri,
        mimeType: "image/jpeg",
        previewMimeType: "image/jpeg",
        width: manipulated.width,
        height: manipulated.height,
      });

      await replaceDraftTemplateAsync(draft);
      createdUris.length = 0;
    } catch (importError) {
      console.error(importError);
      setError(resolveImportErrorMessage(importType, importError));
      await Promise.all(createdUris.map((uri) => deletePersistedFileAsync(uri)));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSave() {
    if (!draftTemplate || isWorking) {
      return;
    }

    setIsBusy(true);

    const nextTemplate = {
      ...draftTemplate,
      name: templateName.trim() || "Clinic template",
    };

    try {
      await setTemplate(nextTemplate);
      await cleanupTemplateReplacementAsync(currentTemplate, nextTemplate);
      router.back();
    } catch (error) {
      console.error(error);
      Alert.alert("Could not save template", resolveTemplateSaveError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleMoveRegion(regionId: TemplateRegion["id"], nextX: number, nextY: number) {
    setDraftTemplateWithDiagnostics((current) =>
      updateTemplateRegion(current, regionId, (region) => ({
        ...region,
        x: nextX,
        y: nextY,
      })),
    );
  }

  function adjustSelectedRegion(mode: "left" | "right" | "up" | "down" | "wider" | "narrower" | "taller" | "shorter") {
    if (!selectedRegion) {
      return;
    }

    setDraftTemplateWithDiagnostics((current) =>
      updateTemplateRegion(current, selectedRegion.id, (region) => {
        switch (mode) {
          case "left":
            return { ...region, x: region.x - REGION_STEP };
          case "right":
            return { ...region, x: region.x + REGION_STEP };
          case "up":
            return { ...region, y: region.y - REGION_STEP };
          case "down":
            return { ...region, y: region.y + REGION_STEP };
          case "wider":
            return { ...region, width: region.width + SIZE_STEP };
          case "narrower":
            return { ...region, width: region.width - SIZE_STEP };
          case "taller":
            return { ...region, height: region.height + SIZE_STEP };
          case "shorter":
            return { ...region, height: region.height - SIZE_STEP };
        }
      }),
    );
  }

  function handleSelectContentKey(contentKey: TemplateContentKey) {
    if (!selectedRegion) {
      return;
    }

    setDraftTemplateWithDiagnostics((current) =>
      updateTemplateRegion(current, selectedRegion.id, (region) => ({
        ...region,
        contentKey,
      })),
    );
  }

  function handleToggleRegionLabel() {
    if (!selectedRegion) {
      return;
    }

    setDraftTemplateWithDiagnostics((current) =>
      updateTemplateRegion(current, selectedRegion.id, (region) => ({
        ...region,
        style: region.style
          ? {
              ...region.style,
              showLabel: !region.style.showLabel,
            }
          : {
              fontSize: 11,
              minFontSize: 8,
              lineHeight: 1.25,
              paddingX: 10,
              paddingY: 8,
              backgroundOpacity: 0.82,
              showLabel: false,
            },
      })),
    );
  }

  async function handleRunSpotCheck() {
    if (!draftTemplate || isWorking) {
      return;
    }

    try {
      setIsSpotChecking(true);
      setSpotCheckError(null);
      const sanityCheck = await runTemplateSanityCheckAsync({
        template: draftTemplate,
        report: currentReport,
      });

      setDraftTemplate((current) => (current ? mergeAiSanityCheck(current, sanityCheck) : current));
    } catch (spotCheckError) {
      console.error(spotCheckError);
      setSpotCheckError(resolveSpotCheckErrorMessage(spotCheckError));
    } finally {
      setIsSpotChecking(false);
    }
  }

  async function handleRemove() {
    Alert.alert("Remove template?", "Future PDFs will use the standard note layout until a new template is imported.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            setIsBusy(true);
            const uris = [...new Set([...collectTemplateAssetUris(draftTemplate), ...collectTemplateAssetUris(currentTemplate)])];
            await Promise.all(uris.map((uri) => deletePersistedFileAsync(uri)));
            setDraftTemplate(null);
            setTemplateName("");
            await setTemplate(null);
            router.back();
          } catch (error) {
            console.error(error);
            Alert.alert("Could not remove template", resolveTemplateSaveError(error));
          } finally {
            setIsBusy(false);
          }
        },
      },
    ]);
  }

  async function replaceDraftTemplateAsync(nextTemplate: PdfTemplate) {
    await cleanupTemplateReplacementAsync(draftTemplate, nextTemplate, currentTemplate);
    const hydratedTemplate = applyTemplateHeuristicDiagnostics(nextTemplate, currentReport);
    setDraftTemplate(hydratedTemplate);
    setTemplateName(hydratedTemplate.name);
    setSelectedRegionId(hydratedTemplate.regions[0]?.id ?? "header");
    setSpotCheckError(null);
  }

  return (
    <AppScreen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <StaggeredFadeIn index={0}>
        <View style={styles.header}>
          <TopBackButton label="Home" onPress={() => router.replace("/")} disabled={isWorking} />
          <ScreenIntro
            eyebrow="Template"
            title="Use your clinic’s form as the PDF layout."
            subtitle="Import a blank form and Elfie will suggest where the note should be filled. Adjust the placement only if something looks off."
          />
        </View>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1}>
        <SectionCard eyebrow="Import" title="Choose a source">
          <View style={styles.importActions}>
            <PrimaryButton label="Take photo" onPress={() => handleImport("photo")} secondary disabled={isWorking} />
            <PrimaryButton label="Choose photo" onPress={() => handleImport("image")} secondary disabled={isWorking} />
            <PrimaryButton label="Import PDF" onPress={() => handleImport("pdf")} secondary disabled={isWorking} />
          </View>
          {isBusy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.caption}>Preparing the template preview…</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </SectionCard>
      </StaggeredFadeIn>

      {draftTemplate ? (
        <>
          <StaggeredFadeIn index={2}>
            <SectionCard eyebrow="Template details" title="Template name">
              <TextInput
                value={templateName}
                onChangeText={setTemplateName}
                placeholder="Clinic template"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
              <Text style={styles.caption}>
                Suggested fill regions are already in place. Drag or nudge them only if you want to refine the fit.
              </Text>
            </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={3}>
            <SectionCard eyebrow="Layout" title="Review the suggested fill regions">
              <TemplateRegionEditor
                template={draftTemplate}
                selectedRegionId={selectedRegionId}
                onSelectRegion={setSelectedRegionId}
                onMoveRegion={handleMoveRegion}
              />
              <View style={styles.regionChips}>
                {draftTemplate.regions.map((region) => (
                  <Pressable
                    key={region.id}
                    accessibilityRole="button"
                    onPress={() => setSelectedRegionId(region.id)}
                    style={({ pressed }) => [
                      styles.regionChip,
                      region.id === selectedRegionId && styles.regionChipSelected,
                      pressed && styles.regionChipPressed,
                    ]}
                  >
                    <Text style={[styles.regionChipLabel, region.id === selectedRegionId && styles.regionChipLabelSelected]}>
                      {region.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.adjustGrid}>
                {[
                  { label: "Left", mode: "left" },
                  { label: "Up", mode: "up" },
                  { label: "Right", mode: "right" },
                  { label: "Down", mode: "down" },
                  { label: "Wider", mode: "wider" },
                  { label: "Narrower", mode: "narrower" },
                  { label: "Taller", mode: "taller" },
                  { label: "Shorter", mode: "shorter" },
                ].map((item) => (
                  <Pressable
                    key={item.mode}
                    accessibilityRole="button"
                    onPress={() => adjustSelectedRegion(item.mode as Parameters<typeof adjustSelectedRegion>[0])}
                    style={({ pressed }) => [styles.adjustButton, pressed && styles.adjustButtonPressed]}
                  >
                    <Text style={styles.adjustLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              {selectedRegion && selectedContentOption ? (
                <View style={styles.mappingPanel}>
                  <Text style={styles.mappingTitle}>Mapped content for {selectedRegion.label}</Text>
                  <Text style={styles.caption}>
                    {selectedContentOption.label}: {selectedContentOption.description}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleToggleRegionLabel}
                    style={({ pressed }) => [styles.toggleChip, pressed && styles.contentChipPressed]}
                  >
                    <Text style={styles.toggleChipLabel}>
                      {selectedRegion.style?.showLabel === false ? "Overlay heading hidden" : "Overlay heading visible"}
                    </Text>
                  </Pressable>
                  <View style={styles.contentChips}>
                    {TEMPLATE_CONTENT_OPTIONS.map((option) => (
                      <Pressable
                        key={option.key}
                        accessibilityRole="button"
                        onPress={() => handleSelectContentKey(option.key)}
                        style={({ pressed }) => [
                          styles.contentChip,
                          option.key === selectedRegion.contentKey && styles.contentChipSelected,
                          pressed && styles.contentChipPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.contentChipLabel,
                            option.key === selectedRegion.contentKey && styles.contentChipLabelSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={4}>
            <SectionCard eyebrow="Sanity check" title="Make sure the text layer still looks clean">
              <View style={styles.sanityHeader}>
                <View
                  style={[
                    styles.riskBadge,
                    draftTemplate.sanityCheck?.overallRisk === "high"
                      ? styles.riskBadgeHigh
                      : draftTemplate.sanityCheck?.overallRisk === "medium"
                        ? styles.riskBadgeMedium
                        : styles.riskBadgeLow,
                  ]}
                >
                  <Text
                    style={[
                      styles.riskBadgeLabel,
                      draftTemplate.sanityCheck?.overallRisk === "high"
                        ? styles.riskBadgeLabelHigh
                        : draftTemplate.sanityCheck?.overallRisk === "medium"
                          ? styles.riskBadgeLabelMedium
                          : styles.riskBadgeLabelLow,
                    ]}
                  >
                    {(draftTemplate.sanityCheck?.checker ?? "heuristic").toUpperCase()} ·{" "}
                    {(draftTemplate.sanityCheck?.overallRisk ?? "low").toUpperCase()} RISK
                  </Text>
                </View>
                <Text style={styles.caption}>
                  {draftTemplate.sanityCheck?.summary ?? "The layout is using the local fit heuristic right now."}
                </Text>
              </View>
              {draftTemplate.sanityCheck?.suggestions.length ? (
                <View style={styles.suggestionList}>
                  {draftTemplate.sanityCheck.suggestions.map((suggestion) => (
                    <Text key={suggestion} style={styles.suggestionItem}>
                      - {suggestion}
                    </Text>
                  ))}
                </View>
              ) : null}
              <View style={styles.regionDiagnosticsList}>
                {draftTemplate.regions.map((region) => {
                  const contentOption = getTemplateContentOption(region.contentKey);
                  const aiFinding = draftTemplate.sanityCheck?.regionFindings.find((finding) => finding.regionId === region.id);
                  const risk = aiFinding?.overflowRisk ?? region.diagnostics?.overflowRisk ?? "low";

                  return (
                    <View key={region.id} style={styles.regionDiagnosticRow}>
                      <View style={styles.regionDiagnosticCopy}>
                        <Text style={styles.regionDiagnosticTitle}>{region.label}</Text>
                        <Text style={styles.regionDiagnosticMeta}>
                          {contentOption.label} · {risk.toUpperCase()} risk
                        </Text>
                        <Text style={styles.regionDiagnosticNote}>
                          {aiFinding?.note ??
                            region.diagnostics?.suggestions[0] ??
                            `${contentOption.label} looks stable in the current region.`}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              <PrimaryButton
                label={isSpotChecking ? "Running AI spot-check…" : "Run AI spot-check"}
                onPress={handleRunSpotCheck}
                secondary
                disabled={isWorking}
              />
              <Text style={styles.caption}>
                The AI check is optional and only reviews layout quality. Saving the template does not depend on it.
              </Text>
              {spotCheckError ? <Text style={styles.error}>{spotCheckError}</Text> : null}
            </SectionCard>
          </StaggeredFadeIn>

          <StaggeredFadeIn index={5}>
            <View style={styles.actions}>
              <PrimaryButton label="Use template" onPress={handleSave} disabled={isWorking} />
              <PrimaryButton label="Remove template" onPress={handleRemove} secondary disabled={isWorking} />
            </View>
          </StaggeredFadeIn>
        </>
      ) : currentTemplate ? (
        <StaggeredFadeIn index={2}>
          <SectionCard eyebrow="Current template" title={currentTemplate.name}>
            <Text style={styles.caption}>A template is already saved and will be used for future PDF exports.</Text>
            <View style={styles.actions}>
              <PrimaryButton label="Remove template" onPress={handleRemove} secondary disabled={isWorking} />
            </View>
          </SectionCard>
        </StaggeredFadeIn>
      ) : (
        null
      )}
    </AppScreen>
  );
}

function buildTargetName(fileName: string, fallbackExtension: string) {
  const safeName = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return `${safeName || `template-${Date.now()}`}.${fallbackExtension}`;
}

function stripExtension(value: string) {
  return value.replace(/\.[^.]+$/, "");
}

function resolveImportErrorMessage(importType: TemplateImportType, error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (importType === "pdf") {
    return "Could not prepare the PDF preview. Check the connection and try again, or import a photo instead.";
  }

  return "Could not import the template. Please try again.";
}

async function cleanupTemplateReplacementAsync(
  previousTemplate?: PdfTemplate | null,
  nextTemplate?: PdfTemplate | null,
  preservedTemplate?: PdfTemplate | null,
) {
  const preservedUris = new Set([...collectTemplateAssetUris(nextTemplate), ...collectTemplateAssetUris(preservedTemplate)]);
  const removableUris = collectTemplateAssetUris(previousTemplate).filter((uri) => !preservedUris.has(uri));
  await Promise.all(removableUris.map((uri) => deletePersistedFileAsync(uri)));
}

function resolveTemplateSaveError(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The template could not be saved right now. Please try again.";
}

function mergeAiSanityCheck(template: PdfTemplate, sanityCheck: TemplateSanityCheck): PdfTemplate {
  return {
    ...template,
    sanityCheck,
    regions: template.regions.map((region) => {
      const finding = sanityCheck.regionFindings.find((entry) => entry.regionId === region.id);
      if (!finding) {
        return region;
      }

      return {
        ...region,
        diagnostics: {
          checkedAt: sanityCheck.checkedAt,
          checker: "ai",
          overflowRisk: finding.overflowRisk,
          estimatedLines: region.diagnostics?.estimatedLines ?? 0,
          availableLines: region.diagnostics?.availableLines ?? 0,
          didShrink: region.diagnostics?.didShrink ?? false,
          didTruncate: region.diagnostics?.didTruncate ?? false,
          suggestions: [...new Set([finding.note, ...(region.diagnostics?.suggestions ?? [])].filter(Boolean))],
          preview: region.diagnostics?.preview ?? [],
        },
      };
    }),
  };
}

function resolveSpotCheckErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "The AI spot-check could not run right now. You can still save the template and rely on the local fit check.";
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
  importActions: {
    gap: spacing.md,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  caption: {
    ...typography.body,
    color: colors.textSoft,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.medium,
    color: colors.ink,
  },
  regionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  regionChip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  regionChipSelected: {
    borderColor: colors.accent,
    backgroundColor: "#fff4fa",
  },
  regionChipPressed: {
    transform: [{ scale: 0.99 }],
  },
  regionChipLabel: {
    ...typography.medium,
    color: colors.ink,
    fontSize: 13,
  },
  regionChipLabelSelected: {
    color: colors.accent,
  },
  adjustGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  adjustButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  adjustButtonPressed: {
    transform: [{ scale: 0.99 }],
    backgroundColor: "#e7e8f2",
  },
  adjustLabel: {
    ...typography.semibold,
    fontSize: 13,
    color: colors.ink,
  },
  actions: {
    gap: spacing.md,
  },
  mappingPanel: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  mappingTitle: {
    ...typography.semibold,
    color: colors.ink,
  },
  contentChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  toggleChip: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  toggleChipLabel: {
    ...typography.medium,
    color: colors.ink,
    fontSize: 13,
  },
  contentChip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contentChipSelected: {
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  contentChipPressed: {
    transform: [{ scale: 0.99 }],
  },
  contentChipLabel: {
    ...typography.medium,
    color: colors.ink,
    fontSize: 13,
  },
  contentChipLabelSelected: {
    ...typography.semibold,
  },
  sanityHeader: {
    gap: spacing.sm,
  },
  riskBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  riskBadgeLow: {
    backgroundColor: "#eef8f1",
  },
  riskBadgeMedium: {
    backgroundColor: "#fff3df",
  },
  riskBadgeHigh: {
    backgroundColor: "#ffe8e3",
  },
  riskBadgeLabel: {
    ...typography.semibold,
    fontSize: 12,
  },
  riskBadgeLabelLow: {
    color: "#1c7c43",
  },
  riskBadgeLabelMedium: {
    color: "#986200",
  },
  riskBadgeLabelHigh: {
    color: "#c43b18",
  },
  suggestionList: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  suggestionItem: {
    ...typography.body,
    color: colors.ink,
  },
  regionDiagnosticsList: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  regionDiagnosticRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.md,
  },
  regionDiagnosticCopy: {
    gap: 2,
  },
  regionDiagnosticTitle: {
    ...typography.semibold,
    color: colors.ink,
  },
  regionDiagnosticMeta: {
    ...typography.medium,
    color: colors.textSoft,
    fontSize: 13,
  },
  regionDiagnosticNote: {
    ...typography.body,
    color: colors.ink,
  },
});
