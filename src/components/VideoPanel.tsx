import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { setVideoController } from "../lib/videoController";
import { extractYouTubeId, loadYouTubeIframeApi, YT_ERROR_MESSAGES } from "../lib/youtube";
import { sha256OfFile } from "../lib/db";
import "./VideoPanel.css";

export function VideoPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YT.Player | null>(null);
  const pollRef = useRef<number | null>(null);
  const volumeRef = useRef(100);

  const [ytInput, setYtInput] = useState("");
  const [ytLoadError, setYtLoadError] = useState<string | null>(null);
  const [volume, setVolume] = useState(100);

  const media = useAppStore((s) => s.media);
  const videoBlobUrl = useAppStore((s) => s.videoBlobUrl);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const currentTime = useAppStore((s) => s.currentTime);
  const duration = useAppStore((s) => s.duration);
  const playbackState = useAppStore((s) => s.playbackState);
  const playbackError = useAppStore((s) => s.playbackError);
  const showPracticeControls = useAppStore((s) => s.showPracticeControls);
  const setYoutubeVideo = useAppStore((s) => s.setYoutubeVideo);
  const setLocalVideo = useAppStore((s) => s.setLocalVideo);
  const setLocalVideoHash = useAppStore((s) => s.setLocalVideoHash);
  const clearVideo = useAppStore((s) => s.clearVideo);
  const setCurrentTime = useAppStore((s) => s.setCurrentTime);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const setDuration = useAppStore((s) => s.setDuration);
  const setPlaybackState = useAppStore((s) => s.setPlaybackState);
  const requestReturnToPlayhead = useAppStore((s) => s.requestReturnToPlayhead);
  const anchorCount = useAppStore((s) => s.anchors.length);

  const source = media?.provider ?? "none";

  // --- local <video> wiring ---
  useEffect(() => {
    if (source !== "local") return;
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onPlay = () => {
      setIsPlaying(true);
      setPlaybackState("playing");
      requestReturnToPlayhead();
    };
    const onPause = () => {
      setIsPlaying(false);
      setPlaybackState("paused");
    };
    const onEnded = () => setPlaybackState("ended");
    const onWaiting = () => setPlaybackState("buffering");
    const onLoaded = () => setDuration(video.duration || 0);
    const onError = () => setPlaybackState("error", "로컬 영상을 재생할 수 없습니다.");
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);

    setVideoController({
      play: () => video.play(),
      pause: () => video.pause(),
      seekBy: (d) => {
        video.currentTime = Math.max(0, video.currentTime + d);
      },
    });

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      setVideoController(null);
    };
  }, [source, videoBlobUrl, setCurrentTime, setIsPlaying, setDuration, setPlaybackState, requestReturnToPlayhead]);

  // --- YouTube IFrame API wiring ---
  useEffect(() => {
    if (source !== "youtube" || media?.provider !== "youtube") return;
    const videoId = media.videoId;
    let cancelled = false;
    setYtLoadError(null);

    loadYouTubeIframeApi()
      .then(() => {
        if (cancelled || !ytContainerRef.current) return;
        const player = new window.YT.Player(ytContainerRef.current, {
          videoId,
          playerVars: { playsinline: 1, controls: 0, modestbranding: 1, rel: 0 },
          events: {
            onReady: (e) => {
              setDuration(e.target.getDuration());
              e.target.setVolume(volumeRef.current);
              const iframe = e.target.getIframe();
              iframe.classList.add("video-el", "youtube");
              iframe.style.width = "100%";
              iframe.style.height = "100%";

              setVideoController({
                play: () => ytPlayerRef.current?.playVideo(),
                pause: () => ytPlayerRef.current?.pauseVideo(),
                seekBy: (d) => {
                  const p = ytPlayerRef.current;
                  if (!p) return;
                  p.seekTo(Math.max(0, p.getCurrentTime() + d), true);
                },
              });

              pollRef.current = window.setInterval(() => {
                const p = ytPlayerRef.current;
                if (p) setCurrentTime(p.getCurrentTime());
              }, 100);
            },
            onStateChange: (e) => {
              const YT = window.YT;
              const playing = e.data === YT.PlayerState.PLAYING;
              setIsPlaying(playing);
              if (playing) {
                setPlaybackState("playing");
                requestReturnToPlayhead();
              } else if (e.data === YT.PlayerState.PAUSED) {
                setPlaybackState("paused");
              } else if (e.data === YT.PlayerState.BUFFERING) {
                setPlaybackState("buffering");
              } else if (e.data === YT.PlayerState.ENDED) {
                setPlaybackState("ended");
              }
            },
            onError: (e) => {
              const message = YT_ERROR_MESSAGES[e.data] ?? `YouTube 오류 (코드 ${e.data})`;
              setPlaybackState("error", message);
            },
          },
        });
        ytPlayerRef.current = player;
      })
      .catch((err) => {
        if (!cancelled) setYtLoadError((err as Error).message);
      });

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
      setVideoController(null);
    };
  }, [
    source,
    media,
    setCurrentTime,
    setIsPlaying,
    setDuration,
    setPlaybackState,
    requestReturnToPlayhead,
  ]);

  function confirmDiscardAnchors(): boolean {
    if (anchorCount === 0) return true;
    return window.confirm(
      `현재 ${anchorCount}개의 앵커가 저장되지 않았을 수 있습니다. JSON으로 백업했는지 확인하세요. 영상을 변경하시겠습니까?`
    );
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirmDiscardAnchors()) {
      e.target.value = "";
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalVideo(file.name, url);
    // Filename alone can collide (same name, different content); hash it in
    // the background so project identity/autosave keys don't rely on the
    // name only. Playback isn't blocked while this runs.
    sha256OfFile(file)
      .then((hash) => setLocalVideoHash(file.name, hash))
      .catch(() => {
        /* hashing is best-effort; project identity still works via filename */
      });
  }

  function loadYouTube() {
    if (!confirmDiscardAnchors()) return;
    const id = extractYouTubeId(ytInput);
    if (!id) {
      alert("YouTube URL을 확인해주세요. youtube.com 또는 youtu.be 주소만 지원합니다.");
      return;
    }
    setYoutubeVideo(id);
  }

  function changeVideo() {
    if (!confirmDiscardAnchors()) return;
    clearVideo();
  }

  function seek(delta: number) {
    if (source === "local" && videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta);
    } else if (source === "youtube" && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(Math.max(0, ytPlayerRef.current.getCurrentTime() + delta), true);
    }
  }

  function togglePlay() {
    if (source === "local" && videoRef.current) {
      const v = videoRef.current;
      if (v.paused) v.play();
      else v.pause();
    } else if (source === "youtube" && ytPlayerRef.current) {
      const p = ytPlayerRef.current;
      if (p.getPlayerState() === window.YT.PlayerState.PLAYING) p.pauseVideo();
      else p.playVideo();
    }
  }

  function changeVolume(nextVolume: number) {
    const next = Math.min(100, Math.max(0, nextVolume));
    volumeRef.current = next;
    setVolume(next);
    if (source === "youtube") ytPlayerRef.current?.setVolume(next);
    if (source === "local" && videoRef.current) videoRef.current.volume = next / 100;
  }

  function seekTo(timeSec: number) {
    const next = Math.min(Math.max(0, timeSec), duration || timeSec);
    if (source === "local" && videoRef.current) {
      videoRef.current.currentTime = next;
    } else if (source === "youtube" && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(next, true);
    }
    setCurrentTime(next);
    requestReturnToPlayhead();
  }

  return (
    <div className="video-panel">
      {source === "none" && (
        <div className="video-pick">
          <div className="video-pick-row">
            <input
              type="text"
              value={ytInput}
              onChange={(e) => setYtInput(e.target.value)}
              placeholder="YouTube URL"
            />
            <button onClick={loadYouTube}>YouTube 불러오기</button>
          </div>
          {ytLoadError && <div className="video-error-text">{ytLoadError}</div>}
          <div className="video-pick-row">
            <label className="local-file-label">
              <span>또는 로컬 영상 파일 선택</span>
              <input type="file" accept="video/*" onChange={onPickFile} />
            </label>
          </div>
        </div>
      )}

      {source !== "none" && (
        <div className="video-shell">
          {source === "local" && (
            <video ref={videoRef} src={videoBlobUrl ?? undefined} playsInline className="video-el local" />
          )}
          {source === "youtube" && (
            <div className="yt-wrap">
              <div ref={ytContainerRef} className="video-el youtube" />
            </div>
          )}
          {/* Always-on mosaic mask: blur stage + opaque pattern stage. Not user-toggleable. */}
          <div className="mosaic-blur" />
          <div className="mosaic-pattern" />
          <button
            type="button"
            className="video-surface-toggle"
            onClick={togglePlay}
            aria-label={isPlaying ? "영상 일시정지" : "영상 재생"}
            title={isPlaying ? "눌러서 일시정지" : "눌러서 재생"}
          />

          {playbackState === "error" && (
            <div className="video-error-overlay">{playbackError ?? "재생 오류가 발생했습니다."}</div>
          )}


          <div className="video-ad-slots" aria-label="광고 배치 영역">
            <aside className="video-ad-slot" data-ad-position="above-play-controls" aria-label="재생 버튼 위 광고 영역">
              <span>광고 영역</span>
            </aside>
            <aside className="video-ad-slot" data-ad-position="above-change-video" aria-label="영상 변경 버튼 위 광고 영역">
              <span>광고 영역</span>
            </aside>
          </div>

          <div className="video-controls">
            {showPracticeControls && (
              <>
                <button onClick={() => seek(-5)} aria-label="5초 뒤로">
                  ⏪ 5s
                </button>
                <button onClick={togglePlay} className="play-btn" aria-label="재생/정지">
                  {isPlaying ? "⏸ 정지" : "▶ 재생"}
                </button>
                <button onClick={() => seek(5)} aria-label="5초 앞으로">
                  5s ⏩
                </button>
                <input
                  className="video-seek-slider"
                  type="range"
                  min="0"
                  max={Math.max(duration, 0.1)}
                  step="0.1"
                  value={Math.min(currentTime, Math.max(duration, 0.1))}
                  onInput={(event) => seekTo(Number(event.currentTarget.value))}
                  disabled={duration <= 0}
                  aria-label="재생 위치"
                  aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
                />
                <span className="time-readout">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <label className="volume-control">
                  <span>음량</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={volume}
                    onInput={(event) => changeVolume(Number(event.currentTarget.value))}
                    aria-label="영상 음량"
                    aria-valuetext={`${volume}%`}
                  />
                  <output>{volume}%</output>
                </label>
              </>
            )}
            <span className="file-name">
              {source === "youtube" && media?.provider === "youtube"
                ? `YouTube: ${media.videoId}`
                : media?.provider === "local"
                  ? media.fileName
                  : ""}
            </span>
            <button onClick={changeVideo} className="change-btn" aria-label="영상 변경">
              영상 변경
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}
