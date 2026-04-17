import { Asset } from "expo-asset";
import { useEventListener } from "expo";
import * as Haptics from "expo-haptics";
import { useVideoPlayer, VideoView } from "expo-video";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BrandBackground } from "@/components/BrandBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { UI_PRIVACY_MODE_ENABLED } from "@/lib/privacy";
import { useSession } from "@/lib/session";

let hasSeenIntroThisLaunch = false;

export default function HomeScreen() {
  const { currentTemplate, isHydrated, storedReports, setPendingAudio } = useSession();
  const [introReady, setIntroReady] = useState(false);
  const [introFinished, setIntroFinished] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(hasSeenIntroThisLaunch || Platform.OS === "web");
  const [skipVisible, setSkipVisible] = useState(false);
  const [navBusy, setNavBusy] = useState(false);
  const introFade = useRef(new Animated.Value(1)).current;
  const blackOverlay = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(0)).current;
  const dismissingRef = useRef(false);
  const player = useVideoPlayer(require("../assets/video/intro-optimized.mp4"), (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
    videoPlayer.timeUpdateEventInterval = 0.1;
    videoPlayer.play();
  });

  useFocusEffect(
    useCallback(() => {
      setNavBusy(false);
      return undefined;
    }, []),
  );

  useEffect(() => {
    if (introDismissed) {
      contentFade.setValue(0);
      Animated.timing(contentFade, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }

    contentFade.setValue(0);
  }, [contentFade, introDismissed]);

  useEffect(() => {
    if (introDismissed) {
      setSkipVisible(false);
      return;
    }

    const timer = setTimeout(() => {
      setSkipVisible(true);
    }, 900);

    return () => clearTimeout(timer);
  }, [introDismissed]);

  useEventListener(player, "playToEnd", () => {
    player.pause();
    if (player.duration > 0) {
      player.currentTime = player.duration;
    }
    setIntroFinished(true);
  });

  async function handleSamplePress() {
    if (navBusy) {
      return;
    }

    try {
      setNavBusy(true);
      await Haptics.selectionAsync();
      const asset = Asset.fromModule(require("../assets/audio/sample-consultation-short.mp3"));
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;

      setPendingAudio({
        uri,
        fileName: "sample-consultation-short.mp3",
        durationSec: 90,
        mimeType: "audio/mpeg",
        sourceType: "sample",
      });
      router.push("/processing");
    } catch (error) {
      console.error(error);
      setNavBusy(false);
    }
  }

  function navigateTo(path: Parameters<typeof router.push>[0]) {
    if (navBusy) {
      return;
    }

    setNavBusy(true);
    router.push(path);
  }

  function handleIntroDismiss(force = false) {
    if ((!introFinished && !force) || dismissingRef.current) {
      return;
    }

    dismissingRef.current = true;
    player.pause();

    Animated.parallel([
      Animated.timing(blackOverlay, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(introFade, {
        toValue: 0,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) {
        dismissingRef.current = false;
        return;
      }

      setIntroDismissed(true);
      hasSeenIntroThisLaunch = true;
      Animated.timing(blackOverlay, {
        toValue: 0,
        duration: 160,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        dismissingRef.current = false;
      });
    });
  }

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.homeLayer, { opacity: contentFade }]}>
        <BrandBackground>
          <ScrollView contentContainerStyle={styles.content}>
            <StaggeredFadeIn index={0}>
              <View style={styles.hero}>
                <Image source={require("../assets/branding/elfie-logo.png")} style={styles.logo} resizeMode="contain" />
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Clinical documentation</Text>
                </View>
                {UI_PRIVACY_MODE_ENABLED ? (
                  <View style={styles.privacyBadge}>
                    <Text style={styles.privacyBadgeText}>Privacy mode</Text>
                  </View>
                ) : null}
                <Text style={styles.title}>Clinical notes, ready when the visit ends.</Text>
                <Text style={styles.subtitle}>
                  Record the conversation, review the note in app, and share a PDF when needed.
                </Text>
                {UI_PRIVACY_MODE_ENABLED ? (
                  <Text style={styles.privacyCopy}>
                    Direct identifiers are redacted before note extraction, and PDF exports omit the full transcript.
                  </Text>
                ) : null}
              </View>
            </StaggeredFadeIn>

            <StaggeredFadeIn index={1}>
              <View style={styles.actions}>
                <PrimaryButton label="Start recording" onPress={() => navigateTo("/record")} disabled={navBusy} />
                <PrimaryButton label="Open sample consultation" onPress={handleSamplePress} secondary disabled={navBusy} />
                <Pressable
                  accessibilityRole="button"
                  disabled={navBusy}
                  onPress={() => navigateTo("/template")}
                  style={({ pressed }) => [styles.templatePill, navBusy && styles.disabledPill, pressed && styles.templatePillPressed]}
                >
                  <Text style={styles.templatePillLabel}>Import template</Text>
                </Pressable>
              </View>
            </StaggeredFadeIn>

            {currentTemplate ? (
              <StaggeredFadeIn index={2}>
                <Pressable
                  accessibilityRole="button"
                  disabled={navBusy}
                  onPress={() => navigateTo("/template")}
                  style={({ pressed }) => [styles.pressableCard, navBusy && styles.disabledPill, pressed && styles.pressableCardPressed]}
                >
                  <SectionCard eyebrow="Active template" title={currentTemplate.name}>
                    <Text style={styles.cardBody}>PDF exports will use this form layout.</Text>
                  </SectionCard>
                </Pressable>
              </StaggeredFadeIn>
            ) : null}

            {!isHydrated ? (
              <StaggeredFadeIn index={3}>
                <ActivityIndicator color={colors.ink} />
              </StaggeredFadeIn>
            ) : null}

            <StaggeredFadeIn index={4}>
              <View style={styles.historyFooter}>
                <PrimaryButton label="Previous Reports" onPress={() => navigateTo("/reports")} secondary disabled={navBusy} />
                {isHydrated ? (
                  <Text style={styles.historyCaption}>
                    {storedReports.length ? `${storedReports.length} saved consultation notes` : "No saved consultation notes yet"}
                  </Text>
                ) : null}
              </View>
            </StaggeredFadeIn>
          </ScrollView>
        </BrandBackground>
      </Animated.View>

      {!introDismissed ? (
        <Pressable
          onPress={() => handleIntroDismiss()}
          style={styles.introPressable}
          accessibilityRole={introFinished ? "button" : undefined}
          accessibilityHint={introFinished ? "Continues to the home screen" : undefined}
        >
          <Animated.View style={[styles.introLayer, { opacity: introFade }]}>
            {!introReady ? <View style={styles.introFallback} /> : null}
            <VideoView
              player={player}
              style={styles.introVideo}
              contentFit="cover"
              nativeControls={false}
              allowsPictureInPicture={false}
              onFirstFrameRender={() => setIntroReady(true)}
            />
            {introFinished ? (
              <View style={styles.introPromptWrap}>
                <Text style={styles.introPrompt}>Tap anywhere to continue</Text>
              </View>
            ) : null}
            {skipVisible ? (
              <View style={styles.skipWrap}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => handleIntroDismiss(true)}
                  style={({ pressed }) => [styles.skipButton, pressed && styles.skipButtonPressed]}
                >
                  <Text style={styles.skipLabel}>Skip intro</Text>
                </Pressable>
              </View>
            ) : null}
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.blackOverlay, { opacity: blackOverlay }]} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000",
  },
  homeLayer: {
    flex: 1,
  },
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
  privacyBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "#f6d28b",
    backgroundColor: "#fff7e6",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  privacyBadgeText: {
    ...typography.semibold,
    fontSize: 12,
    color: "#8a5a00",
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
  privacyCopy: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 23,
    color: "#8a5a00",
  },
  actions: {
    gap: spacing.md,
  },
  templatePill: {
    alignSelf: "center",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "#fff4fa",
    borderWidth: 1,
    borderColor: "#ffd3ea",
  },
  templatePillPressed: {
    transform: [{ scale: 0.99 }],
    borderColor: colors.accent,
  },
  templatePillLabel: {
    ...typography.semibold,
    fontSize: 14,
    color: colors.accent,
  },
  disabledPill: {
    opacity: 0.55,
  },
  pressableCard: {
    borderRadius: radius.md,
  },
  pressableCardPressed: {
    transform: [{ scale: 0.992 }],
  },
  historyFooter: {
    gap: spacing.sm,
  },
  historyCaption: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSoft,
    textAlign: "center",
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
  introPressable: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  introLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  introFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  introVideo: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  introPromptWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 56,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  introPrompt: {
    ...typography.semibold,
    color: "#ffffff",
    fontSize: 14,
    letterSpacing: 0.3,
    backgroundColor: "rgba(20,20,43,0.48)",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  skipWrap: {
    position: "absolute",
    top: 56,
    right: spacing.lg,
  },
  skipButton: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(20,20,43,0.48)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  skipButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  skipLabel: {
    ...typography.semibold,
    color: "#ffffff",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  blackOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
});
