export type SavedAudioImport = {
  id: string;
  uri: string;
  fileName: string;
  mimeType: string;
  durationSec?: number | null;
  sizeBytes?: number | null;
  importedAt: string;
};
