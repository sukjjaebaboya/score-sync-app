const ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const ALLOWED_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (ID_RE.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) return null;

  let candidate: string | null = null;
  if (url.hostname === "youtu.be") {
    candidate = url.pathname.slice(1).split("/")[0] || null;
  } else {
    const v = url.searchParams.get("v");
    if (v) {
      candidate = v;
    } else {
      const shorts = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      const embed = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      candidate = shorts?.[1] ?? embed?.[1] ?? null;
    }
  }
  // Re-validate whatever we pulled out of the URL before trusting it.
  return candidate && ID_RE.test(candidate) ? candidate : null;
}

let apiLoadPromise: Promise<void> | null = null;
const API_LOAD_TIMEOUT_MS = 10000;

export function loadYouTubeIframeApi(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise;
  const promise: Promise<void> = new Promise<void>((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(() => {
      reject(new Error("YouTube API 로딩이 시간 초과되었습니다."));
    }, API_LOAD_TIMEOUT_MS);

    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      prevCallback?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("YouTube API 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(script);
  });
  apiLoadPromise = promise.catch((err: unknown) => {
    apiLoadPromise = null; // allow retry on next call
    throw err;
  });
  return apiLoadPromise;
}

// https://developers.google.com/youtube/iframe_api_reference#onError
export const YT_ERROR_MESSAGES: Record<number, string> = {
  2: "잘못된 video ID입니다.",
  5: "HTML5 플레이어에서 이 영상을 재생할 수 없습니다.",
  100: "영상을 찾을 수 없습니다(삭제되었거나 비공개).",
  101: "영상 소유자가 임베드 재생을 허용하지 않습니다.",
  150: "영상 소유자가 임베드 재생을 허용하지 않습니다.",
};

// Minimal ambient typing for the parts of the IFrame Player API this app uses.
declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }

  namespace YT {
    class Player {
      constructor(el: HTMLElement | string, options: PlayerOptions);
      playVideo(): void;
      pauseVideo(): void;
      setVolume(volume: number): void;
      seekTo(seconds: number, allowSeekAhead: boolean): void;
      getCurrentTime(): number;
      getDuration(): number;
      getPlayerState(): number;
      getIframe(): HTMLIFrameElement;
      destroy(): void;
    }
    interface PlayerOptions {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: Player }) => void;
        onStateChange?: (e: { data: number; target: Player }) => void;
        onError?: (e: { data: number; target: Player }) => void;
      };
    }
    const PlayerState: {
      PLAYING: number;
      PAUSED: number;
      ENDED: number;
      BUFFERING: number;
      CUED: number;
    };
  }
}
