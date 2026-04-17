import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenIntro } from "@/components/ScreenIntro";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { TopBackButton } from "@/components/TopBackButton";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { persistImportedAudioAsync } from "@/lib/storage";
import { useSession } from "@/lib/session";
import { SavedAudioImport } from "@/types/import";

export default function ImportAudioScreen() {
  const { importedAudioHistory, removeImportedAudio, saveImportedAudio, setPendingAudio } = useSession();
  const [isBusy, setIsBusy] = useState(false);

  async function handleChooseFromFiles() {
    if (isBusy) {
      return;
    }

    try {
      setIsBusy(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const safeFileName = asset.name ?? `consultation-${Date.now()}.m4a`;
      const persistedUri = await persistImportedAudioAsync(asset.uri, buildTargetName(safeFileName));
      const savedImport: SavedAudioImport = {
        id: `audio-import-${Date.now()}`,
        uri: persistedUri,
        fileName: safeFileName,
        mimeType: normalizeMimeType(asset.mimeType, safeFileName),
        durationSec: null,
        sizeBytes: asset.size ?? null,
        importedAt: new Date().toISOString(),
      };

      await saveImportedAudio(savedImport);
      setPendingAudio({
        uri: persistedUri,
        fileName: savedImport.fileName,
        durationSec: savedImport.durationSec ?? null,
        mimeType: savedImport.mimeType,
        sourceType: "imported",
      });
      router.push("/processing");
    } catch (error) {
      console.error(error);
      Alert.alert(
        "Could not import audio",
        error instanceof Error ? error.message : "The audio file could not be prepared.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUseRecentImport(entry: SavedAudioImport) {
    if (isBusy) {
      return;
    }

    try {
      setIsBusy(true);
      const info = await FileSystem.getInfoAsync(entry.uri);

      if (!info.exists) {
        await removeImportedAudio(entry.id);
        Alert.alert("File unavailable", "That imported file is no longer on this device. Please choose it again.");
        return;
      }

      setPendingAudio({
        uri: entry.uri,
        fileName: entry.fileName,
        durationSec: entry.durationSec ?? null,
        mimeType: entry.mimeType,
        sourceType: "imported",
      });
      router.push("/processing");
    } catch (error) {
      console.error(error);
      Alert.alert(
        "Could not open imported audio",
        error instanceof Error ? error.message : "Please choose the file again from Files.",
      );
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
            eyebrow="Audio import"
            title="Bring in an existing recording."
            subtitle="Choose an audio file from Files, or reopen a recent import without browsing again."
          />
        </View>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={1}>
        <SectionCard eyebrow="From Files" title="Choose a recording">
          <Text style={styles.body}>
            Works well with audio saved from Voice Memos, iCloud Drive, Dropbox, Google Drive, or files transferred from
            another device.
          </Text>
          <Text style={styles.helper}>Supported formats include MP3, M4A, WAV, AAC, and MP4 audio.</Text>
          <PrimaryButton label="Choose from Files" onPress={handleChooseFromFiles} disabled={isBusy} />
        </SectionCard>
      </StaggeredFadeIn>

      <StaggeredFadeIn index={2}>
        <View style={styles.historySection}>
          <Text style={styles.sectionLabel}>Recent imports</Text>
          {importedAudioHistory.length ? (
            <View style={styles.list}>
              {importedAudioHistory.map((entry, index) => (
                <StaggeredFadeIn key={entry.id} index={index} delayMs={60}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => handleUseRecentImport(entry)}
                    style={({ pressed }) => [styles.importPill, pressed && styles.importPillPressed]}
                  >
                    <View style={styles.importMetaRow}>
                      <Text style={styles.importMeta}>{formatImportTime(entry.importedAt)}</Text>
                      <Text style={styles.importMeta}>·</Text>
                      <Text style={styles.importMeta}>{formatImportDate(entry.importedAt)}</Text>
                      <Text style={styles.importMeta}>·</Text>
                      <Text style={styles.importMeta}>{formatImportSecondaryMeta(entry)}</Text>
                    </View>
                    <Text style={styles.importName} numberOfLines={2}>
                      {entry.fileName}
                    </Text>
                  </Pressable>
                </StaggeredFadeIn>
              ))}
            </View>
          ) : (
            <SectionCard title="No imported audio yet">
              <Text style={styles.body}>Imported recordings will stay here so you can reopen them without browsing again.</Text>
            </SectionCard>
          )}
        </View>
      </StaggeredFadeIn>

    </AppScreen>
  );
}

function buildTargetName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const ext = getExtension(cleaned);
  const base = ext ? cleaned.slice(0, -ext.length - 1) : cleaned;
  return `${base || "consultation"}-${Date.now()}${ext ? `.${ext}` : ""}`;
}

function getExtension(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() ?? "" : "";
}

function normalizeMimeType(mimeType: string | null | undefined, fileName: string) {
  if (mimeType?.trim()) {
    return mimeType;
  }

  const ext = getExtension(fileName);
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "aac":
      return "audio/aac";
    case "mp4":
    case "m4a":
      return "audio/mp4";
    default:
      return "audio/m4a";
  }
}

function formatImportTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(value))
    .replace(/\s/g, "");
}

function formatImportDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(new Date(value))
    .replace(",", "");
}

function formatImportSecondaryMeta(entry: SavedAudioImport) {
  const ext = getExtension(entry.fileName).toUpperCase() || "AUDIO";
  const size = entry.sizeBytes ? formatByteSize(entry.sizeBytes) : null;
  return size ? `${ext} ${size}` : ext;
}

function formatByteSize(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
    lineHeight: 18,
    color: colors.textSoft,
  },
  historySection: {
    gap: spacing.md,
  },
  sectionLabel: {
    ...typography.semibold,
    color: colors.accent,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  list: {
    gap: spacing.md,
  },
  importPill: {
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  importPillPressed: {
    transform: [{ scale: 0.992 }],
    borderColor: "#ffd3ea",
  },
  importMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    alignItems: "center",
  },
  importMeta: {
    ...typography.semibold,
    fontSize: 12,
    color: colors.textSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  importName: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
});
