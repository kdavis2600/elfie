import { useEventListener } from "expo";
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
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { BrandBackground } from "@/components/BrandBackground";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScrollReveal } from "@/components/ScrollReveal";
import { SectionCard } from "@/components/SectionCard";
import { StaggeredFadeIn } from "@/components/StaggeredFadeIn";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { triggerPressHapticAsync } from "@/lib/haptics";
import { useSession } from "@/lib/session";

let hasSeenIntroThisLaunch = false;
const SKIP_INTRO_VISIBLE_MS = 5000;

export default function HomeScreen() {
  const { currentTemplate, isHydrated, storedLabReports, storedReports } = useSession();
  const { height: viewportHeight } = useWindowDimensions();
  const [introReady, setIntroReady] = useState(false);
  const [introFinished, setIntroFinished] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(hasSeenIntroThisLaunch || Platform.OS === "web");
  const [skipVisible, setSkipVisible] = useState(false);
  const [navBusy, setNavBusy] = useState(false);
  const introFade = useRef(new Animated.Value(1)).current;
  const blackOverlay = useRef(new Animated.Value(0)).current;
  const contentFade = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const dismissingRef = useRef(false);
  const player = useVideoPlayer(require("../assets/video/intro-optimized.mp4"), (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
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
    if (introDismissed || introFinished) {
      setSkipVisible(false);
      return;
    }

    setSkipVisible(true);

    const timer = setTimeout(() => {
      setSkipVisible(false);
    }, SKIP_INTRO_VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [introDismissed, introFinished]);

  useEventListener(player, "playToEnd", () => {
    player.pause();
    if (player.duration > 0) {
      player.currentTime = player.duration;
    }
    setIntroFinished(true);
  });

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
    void triggerPressHapticAsync();
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
          <Animated.ScrollView
            contentContainerStyle={styles.content}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
              useNativeDriver: true,
            })}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            <ScrollReveal scrollY={scrollY} viewportHeight={viewportHeight} index={0} distance={28} scaleFrom={0.985} parallax={8}>
              <View style={styles.hero}>
                <Image source={require("../assets/branding/elfie-logo.png")} style={styles.logo} resizeMode="contain" />
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Elfie Scribe</Text>
                </View>
                <Text style={styles.title}>Clinical notes and lab analysis, ready after the visit.</Text>
                <Text style={styles.subtitle}>
                  Run the consultation workflow for visit notes, or switch to the labs analyzer for uploaded PDFs and images.
                </Text>
              </View>
            </ScrollReveal>

            <View style={styles.sectionStack}>
              <ScrollReveal scrollY={scrollY} viewportHeight={viewportHeight} index={1} distance={44} scaleFrom={0.97} parallax={12}>
                <SectionCard eyebrow="Consultation workflow" title="Create a consultation report">
                  <Text style={styles.cardBody}>
                    Record a live visit or import existing audio, then review and edit the structured note before sharing a PDF.
                  </Text>
                  <View style={styles.actions}>
                    <PrimaryButton label="Import Audio" onPress={() => navigateTo("/import-audio")} disabled={navBusy} />
                    <PrimaryButton label="Start Recording" onPress={() => navigateTo("/record")} secondary disabled={navBusy} />
                    <PrimaryButton
                      label={`Previous Reports (${isHydrated ? storedReports.length : 0})`}
                      onPress={() => navigateTo("/reports")}
                      secondary
                      disabled={navBusy}
                    />
                    <PrimaryButton label="Report Template" onPress={() => navigateTo("/template")} secondary disabled={navBusy} />
                  </View>
                  {currentTemplate ? (
                    <Text style={styles.workflowStatus}>Active template: {currentTemplate.name}</Text>
                  ) : (
                    <Text style={styles.workflowStatus}>No report template selected yet.</Text>
                  )}
                </SectionCard>
              </ScrollReveal>

              <ScrollReveal scrollY={scrollY} viewportHeight={viewportHeight} index={2} distance={46} scaleFrom={0.97} parallax={12}>
                <SectionCard eyebrow="Labs analyzer" title="Analyze a lab report">
                  <Text style={styles.cardBody}>
                    Upload a PDF or image, prioritize abnormal findings first, inspect normalized rows, and export a lab analysis PDF.
                  </Text>
                  <View style={styles.actions}>
                    <PrimaryButton label="Analyze Lab Report" onPress={() => navigateTo("/labs/import")} disabled={navBusy} />
                    <PrimaryButton
                      label={`Previous Lab Analyses (${isHydrated ? storedLabReports.length : 0})`}
                      onPress={() => navigateTo("/labs/reports")}
                      secondary
                      disabled={navBusy}
                    />
                  </View>
                </SectionCard>
              </ScrollReveal>
            </View>

            {!isHydrated ? (
              <StaggeredFadeIn index={3}>
                <ActivityIndicator color={colors.ink} />
              </StaggeredFadeIn>
            ) : null}
          </Animated.ScrollView>
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
  workflowStatus: {
    ...typography.medium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSoft,
  },
  sectionStack: {
    gap: spacing.lg,
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
