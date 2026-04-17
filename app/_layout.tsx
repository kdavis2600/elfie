import { Stack } from "expo-router";
import { Asset } from "expo-asset";
import * as SplashScreen from "expo-splash-screen";
import {
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
  useFonts,
} from "@expo-google-fonts/be-vietnam-pro";
import { useEffect } from "react";

import { SessionProvider } from "@/lib/session";

SplashScreen.preventAutoHideAsync().catch(() => null);

export default function RootLayout() {
  const [loaded, error] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });

  useEffect(() => {
    Asset.loadAsync([require("../assets/branding/elfie-logo.png")]).catch(() => null);
  }, []);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync().catch(() => null);
    }
  }, [error, loaded]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <SessionProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
        }}
      />
    </SessionProvider>
  );
}
