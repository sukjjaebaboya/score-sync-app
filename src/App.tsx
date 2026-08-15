import { useEffect, useState } from "react";
import { VideoPanel } from "./components/VideoPanel";
import { ScoreViewer } from "./components/ScoreViewer";
import { Toolbar } from "./components/Toolbar";
import { useAppStore } from "./store/useAppStore";
import { saveProject, loadProject } from "./lib/db";
import { projectKey, type ProjectFile } from "./types";
import "./App.css";

function App() {
  const anchors = useAppStore((s) => s.anchors);
  const settings = useAppStore((s) => s.settings);
  const media = useAppStore((s) => s.media);
  const pdfFileName = useAppStore((s) => s.pdfFileName);
  const pdfSha256 = useAppStore((s) => s.pdfSha256);
  const pageCount = useAppStore((s) => s.pageCount);
  const replaceAnchors = useAppStore((s) => s.replaceAnchors);
  const setSaveStatus = useAppStore((s) => s.setSaveStatus);

  // A project only has an identity once both a video and a PDF are loaded.
  // Restoring/autosaving before that would silently mix anchors from an
  // unrelated (video, pdf) pairing into whatever gets picked next.
  const key = media && pdfSha256 ? projectKey(media, pdfSha256) : null;
  const [restoredForKey, setRestoredForKey] = useState<string | null>(null);

  // Restore this specific (video, pdf) project's anchors from IndexedDB.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setRestoredForKey(null);
    loadProject(key)
      .then((project) => {
        if (cancelled) return;
        if (project) replaceAnchors(project.anchors);
        setRestoredForKey(key);
      })
      .catch(() => {
        if (!cancelled) setRestoredForKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [key, replaceAnchors]);

  // Debounced autosave, gated until the restore attempt for this exact key
  // has finished (otherwise an early save would overwrite the stored
  // project with an empty anchor list before restore completes).
  useEffect(() => {
    if (!key || !media || !pdfFileName || !pdfSha256 || restoredForKey !== key) return;
    setSaveStatus("saving");
    const timer = window.setTimeout(async () => {
      const project: ProjectFile = {
        schemaVersion: 2,
        media,
        pdf: { name: pdfFileName, sha256: pdfSha256, pageCount },
        viewer: settings,
        anchors,
        updatedAt: new Date().toISOString(),
      };
      try {
        await saveProject(key, project);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [key, restoredForKey, anchors, settings, media, pdfFileName, pdfSha256, pageCount, setSaveStatus]);

  if (import.meta.env.DEV) {
    (window as unknown as { __store: typeof useAppStore }).__store = useAppStore;
  }

  return (
    <div className="app-shell">
      <VideoPanel />
      <ScoreViewer />
      <Toolbar />
    </div>
  );
}

export default App;
