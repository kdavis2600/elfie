import { useMemo, useState } from "react";
import { Image, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "@/constants/theme";
import { TemplateRegion, PdfTemplate } from "@/types/template";

type TemplateRegionEditorProps = {
  template: PdfTemplate;
  selectedRegionId: TemplateRegion["id"];
  onSelectRegion: (regionId: TemplateRegion["id"]) => void;
  onMoveRegion: (regionId: TemplateRegion["id"], nextX: number, nextY: number) => void;
};

export function TemplateRegionEditor({
  template,
  selectedRegionId,
  onSelectRegion,
  onMoveRegion,
}: TemplateRegionEditorProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const aspectRatio = template.width > 0 && template.height > 0 ? template.height / template.width : 1.33;

  function handleLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    setContainerSize({
      width,
      height: width * aspectRatio,
    });
  }

  return (
    <View style={styles.frame} onLayout={handleLayout}>
      {containerSize.width > 0 ? (
        <View style={[styles.canvas, { height: containerSize.height }]}>
          <Image source={{ uri: template.previewUri }} style={styles.preview} resizeMode="contain" />
          {template.regions.map((region) => (
            <DraggableRegion
              key={region.id}
              containerWidth={containerSize.width}
              containerHeight={containerSize.height}
              region={region}
              selected={region.id === selectedRegionId}
              onMoveRegion={onMoveRegion}
              onSelectRegion={onSelectRegion}
            />
          ))}
        </View>
      ) : (
        <View style={styles.placeholder} />
      )}
    </View>
  );
}

type DraggableRegionProps = {
  containerWidth: number;
  containerHeight: number;
  region: TemplateRegion;
  selected: boolean;
  onSelectRegion: (regionId: TemplateRegion["id"]) => void;
  onMoveRegion: (regionId: TemplateRegion["id"], nextX: number, nextY: number) => void;
};

function DraggableRegion({
  containerWidth,
  containerHeight,
  region,
  selected,
  onSelectRegion,
  onMoveRegion,
}: DraggableRegionProps) {
  const responder = useMemo(() => {
    const start = { x: region.x, y: region.y };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.x = region.x;
        start.y = region.y;
        onSelectRegion(region.id);
      },
      onPanResponderMove: (_event, gestureState) => {
        onMoveRegion(region.id, start.x + gestureState.dx / containerWidth, start.y + gestureState.dy / containerHeight);
      },
      onPanResponderRelease: () => {
        onSelectRegion(region.id);
      },
    });
  }, [containerHeight, containerWidth, onMoveRegion, onSelectRegion, region.height, region.id, region.width, region.x, region.y]);

  return (
    <Pressable
      onPress={() => onSelectRegion(region.id)}
      style={[
        styles.region,
        selected ? styles.regionSelected : styles.regionIdle,
        {
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.width * 100}%`,
          height: `${region.height * 100}%`,
        },
      ]}
      {...responder.panHandlers}
    >
      <Text style={[styles.regionLabel, selected && styles.regionLabelSelected]}>{region.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
  },
  canvas: {
    width: "100%",
    position: "relative",
    overflow: "hidden",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  preview: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  placeholder: {
    width: "100%",
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  region: {
    position: "absolute",
    borderRadius: 12,
    padding: spacing.xs,
    justifyContent: "flex-start",
  },
  regionIdle: {
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(20,20,43,0.16)",
  },
  regionSelected: {
    backgroundColor: "rgba(255,2,131,0.18)",
    borderWidth: 2,
    borderColor: colors.accent,
  },
  regionLabel: {
    ...typography.semibold,
    fontSize: 11,
    color: colors.ink,
  },
  regionLabelSelected: {
    color: colors.accent,
  },
});
