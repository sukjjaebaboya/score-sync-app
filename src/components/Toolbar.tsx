import { useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { getVideoController } from "../lib/videoController";
import { downloadJson, readJsonFile, ProjectValidationError } from "../lib/db";
import type { MediaSource, ProjectFile } from "../types";
import { PdfPicker } from "./PdfPicker";
import "./Toolbar.css";

function mediaLabel(media: MediaSource | null): string {
  if (!media) return "(영상 없음)";
  return media.provider === "youtube" ? `YouTube ${media.videoId}` : media.fileName;
}

function sameMedia(a: MediaSource | null, b: MediaSource): boolean {
  if (!a) return false;
  if (a.provider !== b.provider) return false;
  if (a.provider === "youtube" && b.provider === "youtube") return a.videoId === b.videoId;
  if (a.provider === "local" && b.provider === "local") return a.fileName === b.fileName;
  return false;
}

export function Toolbar() {
  const [expanded, setExpanded] = useState(false);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const anchors = useAppStore((s) => s.anchors);
  const settings = useAppStore((s) => s.settings);
  const syncModeOn = useAppStore((s) => s.syncModeOn);
  const setSyncModeOn = useAppStore((s) => s.setSyncModeOn);
  const showPracticeControls = useAppStore((s) => s.showPracticeControls);
  const setShowPracticeControls = useAppStore((s) => s.setShowPracticeControls);
  const setZoom = useAppStore((s) => s.setZoom);
  const requestReturnToPlayhead = useAppStore((s) => s.requestReturnToPlayhead);
  const undo = useAppStore((s) => s.undo);
  const replaceAnchors = useAppStore((s) => s.replaceAnchors);
  const media = useAppStore((s) => s.media);
  const pdfFileName = useAppStore((s) => s.pdfFileName);
  const pdfSha256 = useAppStore((s) => s.pdfSha256);
  const pageCount = useAppStore((s) => s.pageCount);
  const clearPdf = useAppStore((s) => s.clearPdf);
  const saveStatus = useAppStore((s) => s.saveStatus);

  const jsonInputRef = useRef<HTMLInputElement>(null);

  function togglePlay() {
    const controller = getVideoController();
    if (!controller) return;
    if (isPlaying) controller.pause();
    else controller.play();
  }

  function handleSave() {
    if (!media || !pdfFileName || !pdfSha256) {
      alert("영상과 PDF를 먼저 불러오세요.");
      return;
    }
    const project: ProjectFile = {
      schemaVersion: 2,
      media,
      pdf: { name: pdfFileName, sha256: pdfSha256, pageCount },
      viewer: settings,
      anchors,
      updatedAt: new Date().toISOString(),
    };
    downloadJson(project, `${pdfFileName}.sync.json`);
  }

  async function handleLoadJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const project = await readJsonFile(file, pageCount);

      if (pdfSha256 && project.pdf.sha256 !== pdfSha256) {
        const proceed = window.confirm(
          `이 JSON은 다른 PDF("${project.pdf.name}")를 위한 기록입니다. 현재 열린 PDF와 좌표가 맞지 않을 수 있습니다. 그래도 적용하시겠습니까?`
        );
        if (!proceed) {
          e.target.value = "";
          return;
        }
      } else if (!sameMedia(media, project.media)) {
        const proceed = window.confirm(
          `이 JSON은 다른 영상("${mediaLabel(project.media)}")을 위한 기록입니다. 시간 좌표가 맞지 않을 수 있습니다. 그래도 적용하시겠습니까?`
        );
        if (!proceed) {
          e.target.value = "";
          return;
        }
      }

      replaceAnchors(project.anchors);
    } catch (err) {
      const message = err instanceof ProjectValidationError ? err.message : (err as Error).message;
      alert(`불러오기 실패: ${message}`);
    }
    e.target.value = "";
  }

  function confirmDiscardAnchors(): boolean {
    if (anchors.length === 0) return true;
    return window.confirm(
      `현재 ${anchors.length}개의 앵커가 저장되지 않았을 수 있습니다. JSON으로 백업했는지 확인하세요. PDF를 변경하시겠습니까?`
    );
  }

  function changePdf() {
    if (!confirmDiscardAnchors()) return;
    clearPdf();
  }

  const saveStatusLabel: Record<typeof saveStatus, string> = {
    idle: "",
    saving: "저장 중…",
    saved: "자동 저장됨",
    error: "자동 저장 실패 — JSON으로 백업하세요",
  };

  return (
    <div className={`toolbar ${expanded ? "toolbar-expanded" : "toolbar-collapsed"}`}>
      <button
        type="button"
        className="toolbar-toggle-button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls="settings-toolbar-content"
      >
        <span>설정</span>
        <span aria-hidden="true">{expanded ? "▼ 접기" : "▲ 열기"}</span>
      </button>

      {expanded && <div className="toolbar-row" id="settings-toolbar-content">
        {!pdfFileName && (
          <PdfPicker />
        )}
        {pdfFileName && (
          <span className="pdf-name">
            📄 {pdfFileName} ({pageCount}p)
            <button className="change-pdf-btn" onClick={changePdf}>
              PDF 변경
            </button>
          </span>
        )}

        <button onClick={togglePlay}>{isPlaying ? "⏸ 정지" : "▶ 재생"}</button>
        <button onClick={requestReturnToPlayhead}>⟳ 현재 위치</button>

        <label className="sync-toggle">
          <input
            type="checkbox"
            checked={syncModeOn}
            onChange={(e) => setSyncModeOn(e.target.checked)}
          />
          싱크 기록 모드 (일시정지 중 탭)
        </label>

        <label className="visibility-controls">
          <input
            type="checkbox"
            checked={showPracticeControls}
            onChange={(event) => setShowPracticeControls(event.target.checked)}
          />
          연습 도구 표시
        </label>

        <div className="zoom-controls">
          <button aria-label="축소" onClick={() => setZoom(settings.zoom - 0.1)}>
            -
          </button>
          <span>{Math.round(settings.zoom * 100)}%</span>
          <button aria-label="확대" onClick={() => setZoom(settings.zoom + 0.1)}>
            +
          </button>
        </div>

        <button onClick={undo}>실행 취소</button>
        <button onClick={handleSave}>JSON 저장</button>
        <button onClick={() => jsonInputRef.current?.click()}>JSON 불러오기</button>
        <input
          ref={jsonInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={handleLoadJson}
        />

        {saveStatus !== "idle" && (
          <span className={`save-status save-status-${saveStatus}`}>{saveStatusLabel[saveStatus]}</span>
        )}
      </div>}

    </div>
  );
}
