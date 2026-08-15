import type { Anchor, ViewerSettings } from "../types";

export interface PageLayout {
  pageIndex: number;
  top: number; // document Y of page top, in CSS px at current zoom
  width: number;
  height: number;
  scale: number; // this page's own render scale (pages may have different native sizes)
}

/** Convert an anchor's (pageIndex, yRatio) into an absolute document-Y in CSS px. */
export function anchorDocumentY(anchor: Anchor, pages: PageLayout[]): number {
  const page = pages[anchor.pageIndex];
  if (!page) return 0;
  return page.top + anchor.yRatio * page.height;
}

export function sortedAnchors(anchors: Anchor[]): Anchor[] {
  return [...anchors].sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * Linear interpolation of the expected document-Y position for a given
 * playback time, using the surrounding anchors. Holds the nearest anchor's
 * position outside the anchor range.
 */
export function documentYAtTime(
  timeSec: number,
  anchors: Anchor[],
  pages: PageLayout[]
): number | null {
  if (anchors.length === 0) return null;
  const sorted = sortedAnchors(anchors);

  if (timeSec <= sorted[0].timeSec) {
    return anchorDocumentY(sorted[0], pages);
  }
  const last = sorted[sorted.length - 1];
  if (timeSec >= last.timeSec) {
    return anchorDocumentY(last, pages);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (timeSec >= a.timeSec && timeSec <= b.timeSec) {
      const span = b.timeSec - a.timeSec;
      const progress = span <= 0 ? 0 : (timeSec - a.timeSec) / span;
      const ay = anchorDocumentY(a, pages);
      const by = anchorDocumentY(b, pages);
      return ay + progress * (by - ay);
    }
  }
  return anchorDocumentY(last, pages);
}

/** Target scrollTop so the focus point (focusRatio down the viewport) lands on documentY. */
export function targetScrollTop(
  documentY: number,
  viewportHeight: number,
  focusRatio: number
): number {
  return Math.max(0, documentY - viewportHeight * focusRatio);
}

/**
 * Whether the current scrollTop already keeps documentY inside the safe
 * dead-zone band of the viewport (no need to move).
 */
export function isInsideDeadZone(
  documentY: number,
  scrollTop: number,
  viewportHeight: number,
  deadZone: [number, number]
): boolean {
  if (viewportHeight <= 0) return true;
  const ratio = (documentY - scrollTop) / viewportHeight;
  return ratio >= deadZone[0] && ratio <= deadZone[1];
}

export function computeAutoScrollTarget(
  timeSec: number,
  anchors: Anchor[],
  pages: PageLayout[],
  viewportHeight: number,
  settings: ViewerSettings,
  currentScrollTop: number
): { target: number; shouldMove: boolean } {
  const docY = documentYAtTime(timeSec, anchors, pages);
  if (docY === null) return { target: currentScrollTop, shouldMove: false };

  const inZone = isInsideDeadZone(
    docY,
    currentScrollTop,
    viewportHeight,
    settings.deadZone
  );
  if (inZone) {
    return { target: currentScrollTop, shouldMove: false };
  }
  return {
    target: targetScrollTop(docY, viewportHeight, settings.focusRatio),
    shouldMove: true,
  };
}
