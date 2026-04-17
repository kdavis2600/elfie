import { router } from "expo-router";
import { useEffect } from "react";

import { ReportDetailScreen } from "@/components/ReportDetailScreen";
import { useSession } from "@/lib/session";

export default function LatestReportScreen() {
  const { isHydrated, latestStored } = useSession();

  useEffect(() => {
    if (isHydrated && !latestStored) {
      router.replace("/");
    }
  }, [isHydrated, latestStored]);

  if (!latestStored) {
    return null;
  }

  return <ReportDetailScreen storedReport={latestStored} onBack={() => router.replace("/")} backLabel="Back" />;
}
