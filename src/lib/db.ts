import type { Anchor, MediaSource, ProjectFile, ViewerSettings } from "../types";

const DB_NAME = "score-sync-app";
const STORE = "projects";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // v1 used a single "project" store with one fixed key; drop it and
      // start clean with the per-project keyed store.
      if (e.oldVersion < 2 && db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(key: string, project: ProjectFile): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(project, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProject(key: string): Promise<ProjectFile | null> {
  const db = await openDb();
  const result = await new Promise<ProjectFile | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as ProjectFile) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export interface ProjectListEntry {
  key: string;
  project: ProjectFile;
}

export async function listProjects(): Promise<ProjectListEntry[]> {
  const db = await openDb();
  const result = await new Promise<ProjectListEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const entries: ProjectListEntry[] = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        entries.push({ key: String(cursor.key), project: cursor.value as ProjectFile });
        cursor.continue();
      } else {
        resolve(entries);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  db.close();
  return result.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt));
}

export async function deleteProject(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function sha256OfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return sha256OfBuffer(buf);
}

export async function sha256OfBuffer(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf.slice(0));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function downloadJson(project: ProjectFile, filename: string): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Deferred revoke: some browsers (notably older Safari) start the download
  // asynchronously and an immediate revoke can race it.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// --- validation -----------------------------------------------------------

export class ProjectValidationError extends Error {}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isRatio(v: unknown): v is number {
  return isFiniteNumber(v) && v >= -0.5 && v <= 1.5; // small overscroll tolerance
}

function validateMedia(media: unknown): MediaSource {
  if (!media || typeof media !== "object") throw new ProjectValidationError("media 필드가 없습니다.");
  const m = media as Record<string, unknown>;
  if (m.provider === "youtube") {
    if (typeof m.videoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(m.videoId)) {
      throw new ProjectValidationError("YouTube videoId가 올바르지 않습니다.");
    }
    return { provider: "youtube", videoId: m.videoId };
  }
  if (m.provider === "local") {
    if (typeof m.fileName !== "string") throw new ProjectValidationError("local media에 fileName이 없습니다.");
    const sha256 = typeof m.sha256 === "string" ? m.sha256 : undefined;
    return { provider: "local", fileName: m.fileName, sha256 };
  }
  throw new ProjectValidationError("media.provider가 youtube/local이 아닙니다.");
}

function validateViewer(viewer: unknown, fallback: ViewerSettings): ViewerSettings {
  if (!viewer || typeof viewer !== "object") return fallback;
  const v = viewer as Record<string, unknown>;
  const deadZone =
    Array.isArray(v.deadZone) && v.deadZone.length === 2 && v.deadZone.every(isFiniteNumber)
      ? ([v.deadZone[0], v.deadZone[1]] as [number, number])
      : fallback.deadZone;
  return {
    zoom: isFiniteNumber(v.zoom) ? Math.min(3, Math.max(0.3, v.zoom)) : fallback.zoom,
    focusRatio: isFiniteNumber(v.focusRatio) ? Math.min(1, Math.max(0, v.focusRatio)) : fallback.focusRatio,
    deadZone,
    peekReturnDelayMs: isFiniteNumber(v.peekReturnDelayMs) ? v.peekReturnDelayMs : fallback.peekReturnDelayMs,
    returnDurationMs: isFiniteNumber(v.returnDurationMs) ? v.returnDurationMs : fallback.returnDurationMs,
  };
}

function validateAnchor(a: unknown, index: number, pageCount: number): Anchor {
  if (!a || typeof a !== "object") throw new ProjectValidationError(`anchors[${index}]가 객체가 아닙니다.`);
  const anchor = a as Record<string, unknown>;
  if (typeof anchor.id !== "string") throw new ProjectValidationError(`anchors[${index}].id가 없습니다.`);
  if (!isFiniteNumber(anchor.timeSec) || anchor.timeSec < 0) {
    throw new ProjectValidationError(`anchors[${index}].timeSec 값이 올바르지 않습니다.`);
  }
  if (!Number.isInteger(anchor.pageIndex) || (anchor.pageIndex as number) < 0) {
    throw new ProjectValidationError(`anchors[${index}].pageIndex 값이 올바르지 않습니다.`);
  }
  if (pageCount > 0 && (anchor.pageIndex as number) >= pageCount) {
    throw new ProjectValidationError(
      `anchors[${index}].pageIndex(${anchor.pageIndex})가 PDF 페이지 수(${pageCount})를 벗어납니다.`
    );
  }
  if (!isRatio(anchor.xRatio) || !isRatio(anchor.yRatio)) {
    throw new ProjectValidationError(`anchors[${index}]의 좌표 비율이 올바르지 않습니다.`);
  }
  return {
    id: anchor.id,
    timeSec: anchor.timeSec as number,
    pageIndex: anchor.pageIndex as number,
    xRatio: anchor.xRatio as number,
    yRatio: anchor.yRatio as number,
  };
}

/**
 * Validate an arbitrary JSON payload into a ProjectFile. `expectedPageCount`
 * (when known) rejects anchors that point past the currently-loaded PDF.
 */
export function validateProjectFile(data: unknown, expectedPageCount = 0): ProjectFile {
  if (!data || typeof data !== "object") throw new ProjectValidationError("JSON이 객체가 아닙니다.");
  const d = data as Record<string, unknown>;
  if (d.schemaVersion !== 2) throw new ProjectValidationError("schemaVersion이 2가 아닙니다.");

  const media = validateMedia(d.media);

  if (!d.pdf || typeof d.pdf !== "object") throw new ProjectValidationError("pdf 필드가 없습니다.");
  const pdfRaw = d.pdf as Record<string, unknown>;
  if (typeof pdfRaw.name !== "string" || typeof pdfRaw.sha256 !== "string") {
    throw new ProjectValidationError("pdf.name 또는 pdf.sha256이 올바르지 않습니다.");
  }
  const pageCount = Number.isInteger(pdfRaw.pageCount) ? (pdfRaw.pageCount as number) : 0;

  if (!Array.isArray(d.anchors)) throw new ProjectValidationError("anchors가 배열이 아닙니다.");
  const pageCountForCheck = expectedPageCount > 0 ? expectedPageCount : pageCount;
  const anchors = d.anchors.map((a, i) => validateAnchor(a, i, pageCountForCheck));

  const seen = new Set<string>();
  for (const a of anchors) {
    if (seen.has(a.id)) throw new ProjectValidationError(`anchor id가 중복됩니다: ${a.id}`);
    seen.add(a.id);
  }

  const viewer = validateViewer(d.viewer, {
    zoom: 1,
    focusRatio: 0.38,
    deadZone: [0.3, 0.62],
    peekReturnDelayMs: 5000,
    returnDurationMs: 420,
  });

  return {
    schemaVersion: 2,
    media,
    pdf: { name: pdfRaw.name, sha256: pdfRaw.sha256, pageCount },
    viewer,
    anchors,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : new Date().toISOString(),
  };
}

export function readJsonFile(file: File, expectedPageCount = 0): Promise<ProjectFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        resolve(validateProjectFile(parsed, expectedPageCount));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
