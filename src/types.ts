export interface Anchor {
  id: string;
  timeSec: number;
  pageIndex: number;
  xRatio: number;
  yRatio: number;
}

export type FollowState = "FOLLOWING" | "PEEKING" | "RETURNING";

export interface ViewerSettings {
  zoom: number;
  focusRatio: number;
  deadZone: [number, number];
  peekReturnDelayMs: number;
  returnDurationMs: number;
}

export type MediaSource =
  | { provider: "youtube"; videoId: string }
  | { provider: "local"; fileName: string; sha256?: string };

export interface PdfInfo {
  name: string;
  sha256: string;
  pageCount: number;
}

export interface ProjectFile {
  schemaVersion: 2;
  media: MediaSource;
  pdf: PdfInfo;
  viewer: ViewerSettings;
  anchors: Anchor[];
  updatedAt: string;
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  zoom: 1.0,
  // Keep the current cue around the second visible score line.
  focusRatio: 0.3,
  deadZone: [0.22, 0.4],
  peekReturnDelayMs: 5000,
  returnDurationMs: 420,
};

/** Stable key identifying a (video, pdf) pairing, used for per-project autosave. */
export function projectKey(media: MediaSource, pdfSha256: string): string {
  const mediaKey =
    media.provider === "youtube" ? `youtube:${media.videoId}` : `local:${media.sha256 ?? media.fileName}`;
  return `${mediaKey}::${pdfSha256}`;
}
