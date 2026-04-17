import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { LabReportDetailScreen } from "@/components/LabReportDetailScreen";
import { useSession } from "@/lib/session";

export default function LabReportByIdScreen() {
  const params = useLocalSearchParams<{ reportId?: string }>();
  const { getStoredLabReport, isHydrated } = useSession();
  const reportId = typeof params.reportId === "string" ? decodeURIComponent(params.reportId) : "";
  const storedReport = reportId ? getStoredLabReport(reportId) : null;

  useEffect(() => {
    if (isHydrated && !storedReport) {
      router.replace("/labs/reports");
    }
  }, [isHydrated, storedReport]);

  if (!storedReport) {
    return null;
  }

  return <LabReportDetailScreen storedReport={storedReport} onBack={() => router.replace("/labs/reports")} backLabel="History" />;
}
