import { PropsWithChildren, useState } from "react";
import { Animated, LayoutChangeEvent, StyleProp, StyleSheet, ViewStyle } from "react-native";

type ScrollRevealProps = PropsWithChildren<{
  scrollY: Animated.Value;
  viewportHeight: number;
  index?: number;
  style?: StyleProp<ViewStyle>;
  distance?: number;
  scaleFrom?: number;
  parallax?: number;
  startOffset?: number;
  endOffset?: number;
}>;

export function ScrollReveal({
  children,
  scrollY,
  viewportHeight,
  index = 0,
  style,
  distance = 42,
  scaleFrom = 0.965,
  parallax = 10,
  startOffset = 0.84,
  endOffset = 0.22,
}: ScrollRevealProps) {
  const [layoutY, setLayoutY] = useState<number | null>(null);
  const estimatedY = layoutY ?? index * viewportHeight * 0.72;
  const start = estimatedY - viewportHeight * startOffset;
  const end = estimatedY - viewportHeight * endOffset;
  const revealEnd = end <= start ? start + 1 : end;

  const progress = scrollY.interpolate({
    inputRange: [start, revealEnd],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const opacity = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.12, 0.58, 1],
    extrapolate: "clamp",
  });

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [distance, 0],
    extrapolate: "clamp",
  });

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [scaleFrom, 1],
    extrapolate: "clamp",
  });

  const innerTranslateY = scrollY.interpolate({
    inputRange: [start - viewportHeight * 0.25, revealEnd + viewportHeight * 0.5],
    outputRange: [parallax, -parallax],
    extrapolate: "clamp",
  });

  function handleLayout(event: LayoutChangeEvent) {
    setLayoutY(event.nativeEvent.layout.y);
  }

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        styles.outer,
        style,
        {
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <Animated.View
        style={
          parallax
            ? {
                transform: [{ translateY: innerTranslateY }],
              }
            : undefined
        }
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: "100%",
  },
});
