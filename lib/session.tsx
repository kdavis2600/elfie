import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

import { normalizeStoredReportTranscript } from "@/lib/transcript";
import {
  clearTemplateAsync,
  deletePersistedFileAsync,
  loadReportHistoryAsync,
  loadTemplateAsync,
  saveLatestReportAsync,
  saveReportHistoryAsync,
  saveTemplateAsync,
} from "@/lib/storage";
import { ConsultationReport, PendingAudio, StoredReport } from "@/types/report";
import { PdfTemplate } from "@/types/template";

type SessionContextValue = {
  isHydrated: boolean;
  storedReports: StoredReport[];
  currentReport: ConsultationReport | null;
  latestStored: StoredReport | null;
  currentPdfUri: string | null;
  currentTemplate: PdfTemplate | null;
  pendingAudio: PendingAudio | null;
  setPendingAudio: (audio: PendingAudio | null) => void;
  getStoredReport: (reportId: string) => StoredReport | null;
  setReport: (report: ConsultationReport, pdfUri?: string | null) => Promise<void>;
  setTemplate: (template: PdfTemplate | null) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [storedReports, setStoredReports] = useState<StoredReport[]>([]);
  const [currentReport, setCurrentReport] = useState<ConsultationReport | null>(null);
  const [latestStored, setLatestStored] = useState<StoredReport | null>(null);
  const [currentPdfUri, setCurrentPdfUri] = useState<string | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState<PdfTemplate | null>(null);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);

  useEffect(() => {
    Promise.all([loadReportHistoryAsync(), loadTemplateAsync()])
      .then(([history, template]) => {
        const normalizedHistory = history.map(normalizeStoredReportTranscript);
        const latest = normalizedHistory[0] ?? null;

        setStoredReports(normalizedHistory);
        if (!latest) {
          setCurrentTemplate(template);
          return;
        }
        setLatestStored(latest);
        setCurrentReport(latest.report);
        setCurrentPdfUri(latest.pdfUri ?? null);
        setCurrentTemplate(template);
      })
      .finally(() => setIsHydrated(true));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      isHydrated,
      storedReports,
      currentReport,
      latestStored,
      currentPdfUri,
      currentTemplate,
      pendingAudio,
      setPendingAudio,
      getStoredReport: (reportId) => storedReports.find((stored) => stored.report.id === reportId) ?? null,
      setReport: async (report, pdfUri) => {
        const stored = normalizeStoredReportTranscript({
          report,
          pdfUri: pdfUri ?? null,
        });
        const nextHistory = [stored, ...storedReports.filter((value) => value.report.id !== stored.report.id)].slice(0, 50);
        const removedReports = storedReports.filter(
          (value) => !nextHistory.some((nextValue) => nextValue.report.id === value.report.id),
        );

        setCurrentReport(stored.report);
        setCurrentPdfUri(stored.pdfUri ?? null);
        setLatestStored(stored);
        setStoredReports(nextHistory);
        await saveLatestReportAsync(stored);
        await saveReportHistoryAsync(nextHistory);
        await Promise.all(removedReports.map((value) => deletePersistedFileAsync(value.pdfUri ?? null)));
      },
      setTemplate: async (template) => {
        setCurrentTemplate(template);
        if (template) {
          await saveTemplateAsync(template);
          return;
        }
        await clearTemplateAsync();
      },
    }),
    [currentPdfUri, currentReport, currentTemplate, isHydrated, latestStored, pendingAudio, storedReports],
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
