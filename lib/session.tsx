import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";

import { LabAnalysisReport, PendingLabDocument, StoredLabReport } from "@/types/labReport";
import { SavedAudioImport } from "@/types/import";
import { normalizeStoredReportTranscript } from "@/lib/transcript";
import {
  clearTemplateAsync,
  deletePersistedFileAsync,
  loadImportedAudioHistoryAsync,
  loadLabReportHistoryAsync,
  loadReportHistoryAsync,
  loadTemplateAsync,
  saveLabReportHistoryAsync,
  saveLatestLabReportAsync,
  saveImportedAudioHistoryAsync,
  saveLatestReportAsync,
  saveReportHistoryAsync,
  saveTemplateAsync,
} from "@/lib/storage";
import { ConsultationReport, PendingAudio, StoredReport } from "@/types/report";
import { PdfTemplate } from "@/types/template";

type SessionContextValue = {
  isHydrated: boolean;
  storedReports: StoredReport[];
  storedLabReports: StoredLabReport[];
  importedAudioHistory: SavedAudioImport[];
  currentReport: ConsultationReport | null;
  latestStored: StoredReport | null;
  currentPdfUri: string | null;
  currentLabReport: LabAnalysisReport | null;
  latestLabStored: StoredLabReport | null;
  currentLabPdfUri: string | null;
  currentTemplate: PdfTemplate | null;
  pendingAudio: PendingAudio | null;
  pendingLabDocument: PendingLabDocument | null;
  setPendingAudio: (audio: PendingAudio | null) => void;
  setPendingLabDocument: (document: PendingLabDocument | null) => void;
  getStoredReport: (reportId: string) => StoredReport | null;
  getStoredLabReport: (reportId: string) => StoredLabReport | null;
  saveImportedAudio: (value: SavedAudioImport) => Promise<void>;
  removeImportedAudio: (importId: string) => Promise<void>;
  setReport: (report: ConsultationReport, pdfUri?: string | null) => Promise<void>;
  setLabReport: (report: LabAnalysisReport, pdfUri?: string | null) => Promise<void>;
  setTemplate: (template: PdfTemplate | null) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [storedReports, setStoredReports] = useState<StoredReport[]>([]);
  const [storedLabReports, setStoredLabReports] = useState<StoredLabReport[]>([]);
  const [importedAudioHistory, setImportedAudioHistory] = useState<SavedAudioImport[]>([]);
  const [currentReport, setCurrentReport] = useState<ConsultationReport | null>(null);
  const [latestStored, setLatestStored] = useState<StoredReport | null>(null);
  const [currentPdfUri, setCurrentPdfUri] = useState<string | null>(null);
  const [currentLabReport, setCurrentLabReport] = useState<LabAnalysisReport | null>(null);
  const [latestLabStored, setLatestLabStored] = useState<StoredLabReport | null>(null);
  const [currentLabPdfUri, setCurrentLabPdfUri] = useState<string | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState<PdfTemplate | null>(null);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [pendingLabDocument, setPendingLabDocument] = useState<PendingLabDocument | null>(null);

  useEffect(() => {
    Promise.all([loadReportHistoryAsync(), loadLabReportHistoryAsync(), loadTemplateAsync(), loadImportedAudioHistoryAsync()])
      .then(([history, labHistory, template, importedAudio]) => {
        const normalizedHistory = history.map(normalizeStoredReportTranscript);
        const latest = normalizedHistory[0] ?? null;
        const latestLab = labHistory[0] ?? null;
        const reportHistoryChanged = JSON.stringify(history) !== JSON.stringify(normalizedHistory);

        setStoredReports(normalizedHistory);
        setStoredLabReports(labHistory);
        setImportedAudioHistory(importedAudio);
        if (latest) {
          setLatestStored(latest);
          setCurrentReport(latest.report);
          setCurrentPdfUri(latest.pdfUri ?? null);
        }

        if (latestLab) {
          setLatestLabStored(latestLab);
          setCurrentLabReport(latestLab.report);
          setCurrentLabPdfUri(latestLab.pdfUri ?? null);
        }

        setCurrentTemplate(template);

        if (reportHistoryChanged) {
          void saveReportHistoryAsync(normalizedHistory);
          if (latest) {
            void saveLatestReportAsync(latest);
          }
        }
      })
      .finally(() => setIsHydrated(true));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      isHydrated,
      storedReports,
      storedLabReports,
      importedAudioHistory,
      currentReport,
      latestStored,
      currentPdfUri,
      currentLabReport,
      latestLabStored,
      currentLabPdfUri,
      currentTemplate,
      pendingAudio,
      pendingLabDocument,
      setPendingAudio,
      setPendingLabDocument,
      getStoredReport: (reportId) => storedReports.find((stored) => stored.report.id === reportId) ?? null,
      getStoredLabReport: (reportId) => storedLabReports.find((stored) => stored.report.id === reportId) ?? null,
      saveImportedAudio: async (value) => {
        const nextHistory = [value, ...importedAudioHistory.filter((entry) => !isSameImportedAudio(entry, value))].slice(0, 8);
        const removedAudio = importedAudioHistory.filter((entry) => !nextHistory.some((nextEntry) => nextEntry.id === entry.id));

        setImportedAudioHistory(nextHistory);
        await saveImportedAudioHistoryAsync(nextHistory);
        await Promise.all(removedAudio.map((entry) => deletePersistedFileAsync(entry.uri)));
      },
      removeImportedAudio: async (importId) => {
        const removedAudio = importedAudioHistory.find((entry) => entry.id === importId) ?? null;
        const nextHistory = importedAudioHistory.filter((entry) => entry.id !== importId);

        setImportedAudioHistory(nextHistory);
        await saveImportedAudioHistoryAsync(nextHistory);
        await deletePersistedFileAsync(removedAudio?.uri ?? null);
      },
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
      setLabReport: async (report, pdfUri) => {
        const stored: StoredLabReport = {
          report,
          pdfUri: pdfUri ?? null,
        };
        const nextHistory = [stored, ...storedLabReports.filter((value) => value.report.id !== stored.report.id)].slice(0, 50);
        const removedReports = storedLabReports.filter(
          (value) => !nextHistory.some((nextValue) => nextValue.report.id === value.report.id),
        );

        setCurrentLabReport(stored.report);
        setCurrentLabPdfUri(stored.pdfUri ?? null);
        setLatestLabStored(stored);
        setStoredLabReports(nextHistory);
        await saveLatestLabReportAsync(stored);
        await saveLabReportHistoryAsync(nextHistory);
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
    [
      currentLabPdfUri,
      currentLabReport,
      currentPdfUri,
      currentReport,
      currentTemplate,
      importedAudioHistory,
      isHydrated,
      latestLabStored,
      latestStored,
      pendingAudio,
      pendingLabDocument,
      storedLabReports,
      storedReports,
    ],
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

function isSameImportedAudio(left: SavedAudioImport, right: SavedAudioImport) {
  return left.fileName === right.fileName && (left.sizeBytes ?? null) === (right.sizeBytes ?? null);
}
