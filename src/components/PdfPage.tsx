import { useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "../lib/pdf";
import type { RenderTask } from "pdfjs-dist";

interface Props {
  page: PDFPageProxy;
  scale: number;
  width: number;
  height: number;
  active: boolean;
}

export function PdfPage({ page, scale, width, height, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(false);

    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const task = page.render({ canvas, canvasContext: ctx, viewport });
    taskRef.current = task;
    task.promise.catch((err) => {
      if (err?.name === "RenderingCancelledException") return;
      setError(true);
    });

    return () => {
      taskRef.current?.cancel();
      taskRef.current = null;
    };
    // Re-render whenever this page becomes active again, or its scale changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, page, scale]);

  if (!active) {
    return <div className="pdf-page-placeholder" style={{ width, height }} />;
  }

  return (
    <div className="pdf-page-canvas-wrap" style={{ width, height }}>
      <canvas ref={canvasRef} style={{ width, height, display: "block" }} />
      {error && (
        <div className="pdf-page-error">
          페이지를 불러오지 못했습니다.
        </div>
      )}
    </div>
  );
}
