import { Asset } from "expo-asset";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { BrandBackground } from "@/components/BrandBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionCard } from "@/components/SectionCard";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { useSession } from "@/lib/session";

export default function HomeScreen() {
  const { isHydrated, latestStored, setPendingAudio } = useSession();

  async function handleSamplePress() {
    await Haptics.selectionAsync();
    const asset = Asset.fromModule(require("../assets/audio/sample-consultation.mp3"));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;

    setPendingAudio({
      uri,
      fileName: "sample-consultation.mp3",
      durationSec: 154,
      mimeType: "audio/mpeg",
      sourceType: "sample",
    });
    router.push("/processing");
  }

  return (
    <BrandBackground>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Image source={require("../assets/branding/elfie-logo.png")} style={styles.logo} resizeMode="contain" />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Elfie brand system</Text>
          </View>
          <Text style={styles.title}>From consultation to note in one tap.</Text>
          <Text style={styles.subtitle}>
            Record the visit, let Qwen structure the note, and leave the room with a polished report ready to share.
          </Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton label="Start recording" onPress={() => router.push("/record")} />
          <PrimaryButton label="Use sample consultation" onPress={handleSamplePress} secondary />
        </View>

        {!isHydrated ? (
          <ActivityIndicator color={colors.ink} />
        ) : latestStored?.report ? (
          <Pressable onPress={() => router.push("/report")} style={styles.pressableCard}>
            <SectionCard eyebrow="Recent report" title={latestStored.report.summary.oneLiner}>
              <Text style={styles.cardMeta}>
                {new Date(latestStored.report.createdAt).toLocaleString()} · {latestStored.report.language.detected.toUpperCase()}
              </Text>
              <Text style={styles.cardBody}>{latestStored.report.visit.visitReason}</Text>
            </SectionCard>
          </Pressable>
        ) : (
          <SectionCard eyebrow="Demo ready" title="No report yet">
            <Text style={styles.cardBody}>
              The sample file in this repo is ready for the first end-to-end run once the backend is listening.
            </Text>
          </SectionCard>
        )}
      </ScrollView>
    </BrandBackground>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 88,
    paddingBottom: 40,
    gap: spacing.xl,
  },
  hero: {
    gap: spacing.md,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#ffd3ea",
    backgroundColor: "#fff4fa",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    ...typography.semibold,
    fontSize: 12,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  title: {
    ...typography.title,
    fontSize: 38,
    lineHeight: 44,
  },
  subtitle: {
    ...typography.body,
    fontSize: 17,
    lineHeight: 26,
    color: colors.textSoft,
  },
  actions: {
    gap: spacing.md,
  },
  pressableCard: {
    borderRadius: radius.md,
  },
  cardMeta: {
    ...typography.medium,
    color: colors.textSoft,
  },
  cardBody: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
});
