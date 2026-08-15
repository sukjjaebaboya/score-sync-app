import { create } from "zustand";
import type { Anchor, FollowState, MediaSource, ViewerSettings } from "../types";
import { DEFAULT_VIEWER_SETTINGS } from "../types";

interface HistoryEntry {
  anchors: Anchor[];
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type PlaybackState = "unstarted" | "playing" | "paused" | "buffering" | "ended" | "error";

interface AppState {
  // media
  media: MediaSource | null;
  videoBlobUrl: string | null; // only set for local files; tracked so it can be revoked
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  playbackState: PlaybackState;
  playbackError: string | null;

  // pdf
  pdfFileName: string | null;
  pdfSha256: string | null;
  pdfBuffer: ArrayBuffer | null;
  pageCount: number;

  // sync
  anchors: Anchor[];
  history: HistoryEntry[];
  followState: FollowState;
  settings: ViewerSettings;
  syncModeOn: boolean;
  showPracticeControls: boolean;
  returnRequestId: number;

  // persistence
  saveStatus: SaveStatus;
  restored: boolean;

  setYoutubeVideo: (videoId: string) => void;
  setLocalVideo: (fileName: string, blobUrl: string, sha256?: string) => void;
  setLocalVideoHash: (fileName: string, sha256: string) => void;
  clearVideo: () => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (v: boolean) => void;
  setDuration: (d: number) => void;
  setPlaybackState: (s: PlaybackState, error?: string | null) => void;
  setPdf: (fileName: string, sha256: string, buffer: ArrayBuffer, pageCount: number) => void;
  clearPdf: () => void;
  addAnchor: (anchor: Omit<Anchor, "id">) => void;
  adjustAnchorTime: (id: string, deltaSec: number) => void;
  deleteAnchor: (id: string) => void;
  undo: () => void;
  setFollowState: (s: FollowState) => void;
  setSyncModeOn: (v: boolean) => void;
  setShowPracticeControls: (v: boolean) => void;
  requestReturnToPlayhead: () => void;
  loadAnchors: (anchors: Anchor[], settings?: ViewerSettings) => void;
  replaceAnchors: (anchors: Anchor[]) => void;
  setZoom: (z: number) => void;
  setSaveStatus: (s: SaveStatus) => void;
  setRestored: (v: boolean) => void;
}

// A second tap within this time gap and this fraction of the page's
// width/height of an existing anchor is treated as a correction to that
// anchor rather than a new near-duplicate one.
const DUPLICATE_TIME_EPSILON_SEC = 0.15;
const DUPLICATE_DISTANCE_EPSILON = 0.03;

function pushHistory(get: () => AppState, set: (s: Partial<AppState>) => void) {
  const state = get();
  const history = [...state.history, { anchors: state.anchors }].slice(-30);
  set({ history });
}

export const useAppStore = create<AppState>((set, get) => ({
  media: null,
  videoBlobUrl: null,
  currentTime: 0,
  isPlaying: false,
  duration: 0,
  playbackState: "unstarted",
  playbackError: null,

  pdfFileName: null,
  pdfSha256: null,
  pdfBuffer: null,
  pageCount: 0,

  anchors: [],
  history: [],
  followState: "FOLLOWING",
  settings: DEFAULT_VIEWER_SETTINGS,
  syncModeOn: true,
  showPracticeControls: true,
  returnRequestId: 0,

  saveStatus: "idle",
  restored: false,

  setYoutubeVideo: (videoId) => {
    const prevBlob = get().videoBlobUrl;
    if (prevBlob) URL.revokeObjectURL(prevBlob);
    set({
      media: { provider: "youtube", videoId },
      videoBlobUrl: null,
      currentTime: 0,
      duration: 0,
      playbackState: "unstarted",
      playbackError: null,
    });
  },
  setLocalVideo: (fileName, blobUrl, sha256) => {
    const prevBlob = get().videoBlobUrl;
    if (prevBlob) URL.revokeObjectURL(prevBlob);
    set({
      media: { provider: "local", fileName, sha256 },
      videoBlobUrl: blobUrl,
      currentTime: 0,
      duration: 0,
      playbackState: "unstarted",
      playbackError: null,
    });
  },
  setLocalVideoHash: (fileName, sha256) => {
    const current = get().media;
    // Guard against a race where the video was swapped again while the
    // (potentially slow, for large files) hash computation was in flight.
    if (!current || current.provider !== "local" || current.fileName !== fileName) return;
    set({ media: { ...current, sha256 } });
  },
  clearVideo: () => {
    const prevBlob = get().videoBlobUrl;
    if (prevBlob) URL.revokeObjectURL(prevBlob);
    set({
      media: null,
      videoBlobUrl: null,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      playbackState: "unstarted",
      playbackError: null,
    });
  },

  setCurrentTime: (t) => set({ currentTime: t }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
  setPlaybackState: (s, error = null) => set({ playbackState: s, playbackError: error }),

  setPdf: (fileName, sha256, buffer, pageCount) =>
    set({ pdfFileName: fileName, pdfSha256: sha256, pdfBuffer: buffer, pageCount }),
  clearPdf: () =>
    set({ pdfFileName: null, pdfSha256: null, pdfBuffer: null, pageCount: 0, anchors: [], history: [] }),

  addAnchor: (anchor) => {
    const existing = get().anchors.find(
      (a) =>
        a.pageIndex === anchor.pageIndex &&
        Math.abs(a.timeSec - anchor.timeSec) <= DUPLICATE_TIME_EPSILON_SEC &&
        Math.hypot(a.xRatio - anchor.xRatio, a.yRatio - anchor.yRatio) <= DUPLICATE_DISTANCE_EPSILON
    );
    pushHistory(get, set);
    if (existing) {
      // The same point tapped again toggles the marker off.
      set({ anchors: get().anchors.filter((a) => a.id !== existing.id) });
      return;
    }
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    set({ anchors: [...get().anchors, { ...anchor, id }] });
  },

  adjustAnchorTime: (id, deltaSec) => {
    pushHistory(get, set);
    set({
      anchors: get().anchors.map((a) =>
        a.id === id ? { ...a, timeSec: Math.max(0, a.timeSec + deltaSec) } : a
      ),
    });
  },

  deleteAnchor: (id) => {
    pushHistory(get, set);
    set({ anchors: get().anchors.filter((a) => a.id !== id) });
  },

  undo: () => {
    const history = get().history;
    if (history.length === 0) return;
    const last = history[history.length - 1];
    set({ anchors: last.anchors, history: history.slice(0, -1) });
  },

  setFollowState: (s) => set({ followState: s }),
  setSyncModeOn: (v) => set({ syncModeOn: v }),
  setShowPracticeControls: (v) => set({ showPracticeControls: v }),
  requestReturnToPlayhead: () =>
    set({ returnRequestId: get().returnRequestId + 1, followState: "RETURNING" }),

  loadAnchors: (anchors, settings) =>
    set({
      anchors,
      settings: settings
        ? {
            ...settings,
            // Migrate older projects to the second-line follow position.
            focusRatio: DEFAULT_VIEWER_SETTINGS.focusRatio,
            deadZone: DEFAULT_VIEWER_SETTINGS.deadZone,
          }
        : get().settings,
      history: [],
    }),
  replaceAnchors: (anchors) => set({ anchors, history: [] }),

  setZoom: (z) =>
    set({ settings: { ...get().settings, zoom: Math.min(3, Math.max(0.5, z)) } }),

  setSaveStatus: (s) => set({ saveStatus: s }),
  setRestored: (v) => set({ restored: v }),
}));
