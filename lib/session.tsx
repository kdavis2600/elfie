import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

import { loadLatestReportAsync, saveLatestReportAsync } from "@/lib/storage";
import { ConsultationReport, PendingAudio, StoredReport } from "@/types/report";

type SessionContextValue = {
  isHydrated: boolean;
  currentReport: ConsultationReport | null;
  latestStored: StoredReport | null;
  currentPdfUri: string | null;
  pendingAudio: PendingAudio | null;
  setPendingAudio: (audio: PendingAudio | null) => void;
  setReport: (report: ConsultationReport, pdfUri?: string | null) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [currentReport, setCurrentReport] = useState<ConsultationReport | null>(null);
  const [latestStored, setLatestStored] = useState<StoredReport | null>(null);
  const [currentPdfUri, setCurrentPdfUri] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);

  useEffect(() => {
    loadLatestReportAsync()
      .then((stored) => {
        if (!stored) {
          return;
        }
        setLatestStored(stored);
        setCurrentReport(stored.report);
        setCurrentPdfUri(stored.pdfUri ?? null);
      })
      .finally(() => setIsHydrated(true));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      isHydrated,
      currentReport,
      latestStored,
      currentPdfUri,
      pendingAudio,
      setPendingAudio,
      setReport: async (report, pdfUri) => {
        const stored = { report, pdfUri: pdfUri ?? null };
        setCurrentReport(report);
        setCurrentPdfUri(pdfUri ?? null);
        setLatestStored(stored);
        await saveLatestReportAsync(stored);
      },
    }),
    [currentPdfUri, currentReport, isHydrated, latestStored, pendingAudio],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider");
  }
  return context;
}
