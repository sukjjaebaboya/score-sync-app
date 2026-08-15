import { useEffect, useRef, useState, useCallback } from "react";
import { useAppStore } from "../store/useAppStore";
import { loadPdfDocument, type PDFPageProxy } from "../lib/pdf";
import { PdfPage } from "./PdfPage";
import { computeAutoScrollTarget, type PageLayout } from "../lib/geometry";
import "./ScoreViewer.css";

const RENDER_BUFFER_PAGES = 1;
const SCROLL_SETTLE_MS = 150;
const SAME_PAGE_SCROLL_MS = 380;
const PAGE_TURN_SCROLL_MS = 680;
const ANCHOR_TOGGLE_RADIUS_PX = 28;
const SCORE_SIDE_GUTTER_PX = 36;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function ScoreViewer() {
  const pdfBuffer = useAppStore((s) => s.pdfBuffer);
  const zoom = useAppStore((s) => s.settings.zoom);
  const anchors = useAppStore((s) => s.anchors);
  const followState = useAppStore((s) => s.followState);
  const returnRequestId = useAppStore((s) => s.returnRequestId);
  const syncModeOn = useAppStore((s) => s.syncModeOn);
  const showPracticeControls = useAppStore((s) => s.showPracticeControls);
  const currentTime = useAppStore((s) => s.currentTime);
  const addAnchor = useAppStore((s) => s.addAnchor);
  const deleteAnchor = useAppStore((s) => s.deleteAnchor);

  const [pageProxies, setPageProxies] = useState<PDFPageProxy[]>([]);
  const [layouts, setLayouts] = useState<PageLayout[]>([]);
  const [containerWidth, setContainerWidth] = useState(800);
  const [scrollTopState, setScrollTopState] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const returnTimer = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const layoutsRef = useRef<PageLayout[]>([]);
  const returnAnimRef = useRef<{ start: number; from: number; to: number } | null>(null);
  const followAnimRef = useRef<{
    start: number;
    from: number;
    to: number;
    duration: number;
  } | null>(null);

  // Load PDF document; render page 1 first for a fast first paint, then fetch
  // the remaining page proxies progressively in the background.
  useEffect(() => {
    if (!pdfBuffer) {
      setPageProxies([]);
      return;
    }
    let cancelled = false;
    setPdfError(null);
    setPageProxies([]);
    setPdfLoading(true);

    loadPdfDocument(pdfBuffer)
      .then(async (pdf) => {
        if (cancelled) return;
        const first = await pdf.getPage(1);
        if (cancelled) return;
        setPageProxies([first]);
        setPdfLoading(false);
        for (let i = 2; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          if (cancelled) return;
          setPageProxies((prev) => [...prev, page]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setPdfLoading(false);
        setPdfError(err?.message ?? "PDF를 불러오지 못했습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [pdfBuffer]);

  // Track container width for responsive fit.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute page layouts (top offset + rendered height + per-page scale)
  // whenever pages, width, or zoom change. Each page uses its own native
  // width so mixed page sizes still fit the viewport correctly.
  useEffect(() => {
    if (pageProxies.length === 0 || containerWidth === 0) return;
    let top = 0;
    const next: PageLayout[] = pageProxies.map((page, idx) => {
      const baseWidth = page.getViewport({ scale: 1 }).width;
      const fitWidth = Math.max(1, containerWidth - SCORE_SIDE_GUTTER_PX * 2);
      const pageScale = (fitWidth / baseWidth) * zoom;
      const vp = page.getViewport({ scale: pageScale });
      const layout: PageLayout = {
        pageIndex: idx,
        top,
        width: vp.width,
        height: vp.height,
        scale: pageScale,
      };
      top += vp.height + 6; // thin divider gap
      return layout;
    });
    setLayouts(next);
    layoutsRef.current = next;
  }, [pageProxies, containerWidth, zoom]);

  const totalHeight = layouts.length > 0 ? layouts[layouts.length - 1].top + layouts[layouts.length - 1].height : 0;

  const applyScrollTop = useCallback((value: number) => {
    const el = containerRef.current;
    if (!el) return;
    isProgrammaticScroll.current = true;
    el.scrollTop = value;
    // Clear the flag on next frame so genuine user scroll events after this are detected.
    requestAnimationFrame(() => {
      isProgrammaticScroll.current = false;
    });
  }, []);

  function pageIndexAtY(documentY: number, pageLayouts: PageLayout[]): number {
    for (const layout of pageLayouts) {
      if (documentY < layout.top + layout.height + 6) return layout.pageIndex;
    }
    return pageLayouts.at(-1)?.pageIndex ?? 0;
  }

  // Autoscroll loop. Reads the latest store state via getState() on every
  // frame instead of depending on currentTime/anchors/settings so the RAF
  // loop itself is created once and never torn down/rebuilt on every
  // playhead tick (which happens ~10x/sec from YouTube polling).
  useEffect(() => {
    function tick(now: number) {
      const el = containerRef.current;
      const layouts = layoutsRef.current;
      const state = useAppStore.getState();

      if (el && layouts.length > 0) {
        const viewportHeight = el.clientHeight;

        if (state.followState === "FOLLOWING") {
          returnAnimRef.current = null;
          const { target, shouldMove } = computeAutoScrollTarget(
            state.currentTime,
            state.anchors,
            layouts,
            viewportHeight,
            state.settings,
            el.scrollTop
          );

          if (prefersReducedMotion()) {
            followAnimRef.current = null;
            if (shouldMove) applyScrollTop(target);
          } else {
            let animation = followAnimRef.current;

            if (!animation && shouldMove) {
              const focusOffset = viewportHeight * state.settings.focusRatio;
              const fromPage = pageIndexAtY(el.scrollTop + focusOffset, layouts);
              const toPage = pageIndexAtY(target + focusOffset, layouts);
              animation = {
                start: now,
                from: el.scrollTop,
                to: target,
                duration: fromPage === toPage ? SAME_PAGE_SCROLL_MS : PAGE_TURN_SCROLL_MS,
              };
              followAnimRef.current = animation;
            }

            if (animation) {
              // Keep one continuous animation even while the playhead advances.
              // This prevents page turns from looking like several small clicks.
              if (shouldMove) animation.to = target;
              const progress = Math.min(1, (now - animation.start) / animation.duration);
              const eased = 1 - Math.pow(1 - progress, 3);
              applyScrollTop(animation.from + (animation.to - animation.from) * eased);
              if (progress >= 1) followAnimRef.current = null;
            }
          }
        } else if (state.followState === "RETURNING") {
          followAnimRef.current = null;
          const { target } = computeAutoScrollTarget(
            state.currentTime,
            state.anchors,
            layouts,
            viewportHeight,
            state.settings,
            el.scrollTop
          );

          if (prefersReducedMotion()) {
            applyScrollTop(target);
            returnAnimRef.current = null;
            state.setFollowState("FOLLOWING");
          } else {
            if (!returnAnimRef.current) {
              returnAnimRef.current = { start: now, from: el.scrollTop, to: target };
            } else {
              returnAnimRef.current.to = target; // playhead may keep moving during the return
            }
            const { start, from, to } = returnAnimRef.current;
            const duration = Math.max(1, state.settings.returnDurationMs);
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            if (t >= 1) {
              applyScrollTop(to);
              returnAnimRef.current = null;
              state.setFollowState("FOLLOWING");
            } else {
              applyScrollTop(from + (to - from) * eased);
            }
          }
        } else {
          followAnimRef.current = null;
          returnAnimRef.current = null;
        }
      }
      rafId.current = requestAnimationFrame(tick);
    }
    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [applyScrollTop]);

  // Explicit "return to playhead" request (play button / 현재 위치 button).
  const setFollowState = useAppStore((s) => s.setFollowState);
  useEffect(() => {
    if (returnRequestId === 0) return;
    if (returnTimer.current) window.clearTimeout(returnTimer.current);
    setFollowState("RETURNING");
  }, [returnRequestId, setFollowState]);

  function handleUserScroll() {
    setScrollTopState(containerRef.current?.scrollTop ?? 0);
    if (isProgrammaticScroll.current) return;
    const state = useAppStore.getState();
    if (state.followState !== "PEEKING") state.setFollowState("PEEKING");

    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const latest = useAppStore.getState();
      if (!latest.isPlaying) return; // paused: hold position until user resumes/returns
      if (returnTimer.current) window.clearTimeout(returnTimer.current);
      returnTimer.current = window.setTimeout(() => {
        latest.setFollowState("RETURNING");
      }, latest.settings.peekReturnDelayMs);
    }, SCROLL_SETTLE_MS);
  }

  function handlePageClick(pageIndex: number, e: React.MouseEvent<HTMLDivElement>) {
    if (!syncModeOn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;

    const existing = anchors.find((anchor) => {
      if (anchor.pageIndex !== pageIndex) return false;
      const dx = (anchor.xRatio - xRatio) * rect.width;
      const dy = (anchor.yRatio - yRatio) * rect.height;
      return Math.hypot(dx, dy) <= ANCHOR_TOGGLE_RADIUS_PX;
    });

    if (existing) {
      deleteAnchor(existing.id);
      return;
    }

    addAnchor({ timeSec: currentTime, pageIndex, xRatio, yRatio });
  }

  if (!pdfBuffer) {
    return <div className="score-viewer score-empty">PDF를 선택하세요.</div>;
  }

  if (pdfError) {
    return <div className="score-viewer score-empty score-error">{pdfError}</div>;
  }

  const viewportHeight = containerRef.current?.clientHeight ?? 600;
  const visibleTop = scrollTopState - viewportHeight * RENDER_BUFFER_PAGES;
  const visibleBottom = scrollTopState + viewportHeight * (1 + RENDER_BUFFER_PAGES);

  return (
    <div className="score-viewer">
      {pdfLoading && <div className="score-loading">악보를 불러오는 중…</div>}
      <div className="score-scroll" ref={containerRef} onScroll={handleUserScroll}>
        <div className="score-doc" style={{ height: totalHeight }}>
          {layouts.map((layout) => {
            const active = layout.top + layout.height >= visibleTop && layout.top <= visibleBottom;
            const page = pageProxies[layout.pageIndex];
            return (
              <div
                key={layout.pageIndex}
                className="score-page-wrap"
                style={{
                  position: "absolute",
                  top: layout.top,
                  left: "50%",
                  width: layout.width,
                  height: layout.height,
                  transform: "translateX(-50%)",
                }}
                onClick={(e) => handlePageClick(layout.pageIndex, e)}
              >
                {page && (
                  <PdfPage
                    page={page}
                    scale={layout.scale}
                    width={layout.width}
                    height={layout.height}
                    active={active}
                  />
                )}
                {showPracticeControls && anchors
                  .filter((a) => a.pageIndex === layout.pageIndex)
                  .map((a) => (
                    <button
                      key={a.id}
                      className="anchor-marker"
                      style={{ top: `${a.yRatio * 100}%` }}
                      title={`${a.timeSec.toFixed(2)}초 체크포인트 — 눌러서 삭제`}
                      aria-label={`${a.timeSec.toFixed(2)}초 체크포인트 삭제`}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteAnchor(a.id);
                      }}
                    >
                      ✓
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      {import.meta.env.DEV && (
        <div className={`follow-state-badge follow-${followState.toLowerCase()}`}>{followState}</div>
      )}
    </div>
  );
}
