import { PropsWithChildren, useEffect, useRef } from "react";
import { Animated, Easing, StyleProp, ViewStyle } from "react-native";

type StaggeredFadeInProps = PropsWithChildren<{
  index?: number;
  delayMs?: number;
  stepMs?: number;
  durationMs?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
  resetKey?: string | number | boolean | null;
}>;

export function StaggeredFadeIn({
  children,
  index = 0,
  delayMs = 0,
  stepMs = 50,
  durationMs = 220,
  distance = 10,
  style,
  resetKey,
}: StaggeredFadeInProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(distance)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(distance);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: durationMs,
        delay: delayMs + index * stepMs,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: durationMs,
        delay: delayMs + index * stepMs,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delayMs, distance, durationMs, index, opacity, resetKey, stepMs, translateY]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
