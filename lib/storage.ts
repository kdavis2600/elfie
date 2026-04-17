import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { StoredReport } from "@/types/report";

const LATEST_REPORT_KEY = "elfie.latest-report";
const REPORT_DIR = `${FileSystem.documentDirectory ?? ""}elfie`;

async function ensureDirAsync() {
  if (!FileSystem.documentDirectory) {
    return;
  }

  const info = await FileSystem.getInfoAsync(REPORT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(REPORT_DIR, { intermediates: true });
  }
}

export async function persistPdfAsync(sourceUri: string, targetName: string) {
  await ensureDirAsync();
  const targetUri = `${REPORT_DIR}/${targetName}`;
  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

export async function saveLatestReportAsync(value: StoredReport) {
  await AsyncStorage.setItem(LATEST_REPORT_KEY, JSON.stringify(value));
}

export async function loadLatestReportAsync(): Promise<StoredReport | null> {
  const raw = await AsyncStorage.getItem(LATEST_REPORT_KEY);
  return raw ? (JSON.parse(raw) as StoredReport) : null;
}
