import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

import { ReportDetailScreen } from "@/components/ReportDetailScreen";
import { useSession } from "@/lib/session";

export default function HistoricalReportScreen() {
  const params = useLocalSearchParams<{ reportId?: string | string[] }>();
  const { getStoredReport, isHydrated } = useSession();
  const reportId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;
  const storedReport = reportId ? getStoredReport(decodeURIComponent(reportId)) : null;

  useEffect(() => {
    if (isHydrated && !storedReport) {
      router.replace("/reports");
    }
  }, [isHydrated, storedReport]);

  if (!storedReport) {
    return null;
  }

  return <ReportDetailScreen storedReport={storedReport} onBack={() => router.replace("/reports")} backLabel="Reports" />;
}
