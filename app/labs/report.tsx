import { router } from "expo-router";
import { useEffect } from "react";

import { LabReportDetailScreen } from "@/components/LabReportDetailScreen";
import { useSession } from "@/lib/session";

export default function LatestLabReportScreen() {
  const { isHydrated, latestLabStored } = useSession();

  useEffect(() => {
    if (isHydrated && !latestLabStored) {
      router.replace("/labs/import");
    }
  }, [isHydrated, latestLabStored]);

  if (!latestLabStored) {
    return null;
  }

  return <LabReportDetailScreen storedReport={latestLabStored} onBack={() => router.replace("/")} backLabel="Home" />;
}
