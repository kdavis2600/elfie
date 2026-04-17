import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { TopBackButton } from "@/components/TopBackButton";
import { colors, spacing, typography } from "@/constants/theme";
import { useSession } from "@/lib/session";
import { PendingLabDocument } from "@/types/labReport";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_LAB_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export default function ImportLabReportScreen() {
  const { setPendingLabDocument } = useSession();
  const [isBusy, setIsBusy] = useState(false);

  async function handleChooseFile() {
    if (isBusy) {
      return;
    }

    try {
      setIsBusy(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: [...SUPPORTED_LAB_MIME_TYPES],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      if ((asset.size ?? 0) > MAX_FILE_SIZE_BYTES) {
        Alert.alert("File too large", "Keep lab documents under 15 MB for this demo.");
        return;
      }

      const mimeType = asset.mimeType ?? inferMimeType(asset.name ?? "");
      if (!isSupportedLabMimeType(mimeType)) {
        Alert.alert("Unsupported file type", "Use PDF, JPG, PNG, WEBP, or HEIC/HEIF for lab uploads.");
        return;
      }

      const document: PendingLabDocument = {
        uri: asset.uri,
        fileName: asset.name ?? `lab-report-${Date.now()}`,
        mimeType,
        sizeBytes: asset.size ?? null,
        sourceType: mimeType.includes("image") ? "image" : "pdf",
      };

      setPendingLabDocument(document);
      router.push("/labs/processing");
    } catch (error) {
      Alert.alert("Could not import lab report", error instanceof Error ? error.message : "The lab document could not be prepared.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AppScreen scroll contentContainerStyle={styles.content}>
      <StaggeredFadeIn index={0}>
        <View style={styles.header}>
          <TopBackButton label="Home" onPress={() => router.replace("/")} disabled={isBusy} />
          <ScreenIntro
            eyebrow="Labs analyzer"
            title="Import a lab report."
            subtitle="Choose a PDF or image from Files. Uploaded source documents are processed ephemerally and not saved."
          />
        </View>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1}>
        <SectionCard eyebrow="From Files" title="Choose PDF or image">
          <Text style={styles.body}>
            PDF, JPG, PNG, WEBP, and HEIC/HEIF inputs are supported. For now, keep files under 15 MB. The app stores the
            generated analysis and PDF, not the uploaded source file itself.
          </Text>
          <Text style={styles.helper}>Small, text-native PDFs will generally process faster and more reliably than large scans.</Text>
          <PrimaryButton label="Choose from Files" onPress={handleChooseFile} disabled={isBusy} />
        </SectionCard>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={2}>
        <SectionCard eyebrow="What happens next" title="Analysis pipeline">
          <Text style={styles.body}>
            The backend extracts source text, normalizes rows, computes numeric abnormal flags in code, and then ranks the
            findings through the full hybrid path or a Qwen-only degraded mode if Claude is unavailable.
          </Text>
        </SectionCard>
      </StaggeredFadeIn>
    </AppScreen>
  );
}

function inferMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".heic")) {
    return "image/heic";
  }
  if (lower.endsWith(".heif")) {
    return "image/heif";
  }
  return "application/pdf";
}

function isSupportedLabMimeType(mimeType: string) {
  return SUPPORTED_LAB_MIME_TYPES.includes(mimeType as (typeof SUPPORTED_LAB_MIME_TYPES)[number]);
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
  body: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  helper: {
    ...typography.medium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSoft,
  },
});
