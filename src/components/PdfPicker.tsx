import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { sha256OfFile } from "../lib/db";
import { loadPdfDocument, PdfPasswordCancelledError } from "../lib/pdf";

const MAX_PDF_MB = 150;
const PAGE_COUNT_WARN_THRESHOLD = 200;

interface PdfPickerProps {
  className?: string;
  label?: string;
}

export function PdfPicker({ className = "pdf-pick", label = "PDF 선택" }: PdfPickerProps) {
  const [loading, setLoading] = useState(false);
  const setPdf = useAppStore((state) => state.setPdf);

  async function handlePickPdf(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      alert("PDF 파일이 아닙니다.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      alert(`파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(0)}MB). ${MAX_PDF_MB}MB 이하만 지원합니다.`);
      event.target.value = "";
      return;
    }

    setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const hash = await sha256OfFile(file);
      const document = await loadPdfDocument(buffer);
      if (
        document.numPages > PAGE_COUNT_WARN_THRESHOLD &&
        !window.confirm(
          `이 PDF는 ${document.numPages}페이지입니다. 페이지가 많으면 태블릿에서 느려질 수 있습니다. 계속하시겠습니까?`
        )
      ) {
        return;
      }
      setPdf(file.name, hash, buffer, document.numPages);
    } catch (error) {
      if (!(error instanceof PdfPasswordCancelledError)) {
        alert(`PDF를 불러오지 못했습니다: ${(error as Error).message}`);
      }
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  return (
    <label className={className} aria-busy={loading}>
      <span>{loading ? "PDF 불러오는 중…" : label}</span>
      <input type="file" accept="application/pdf,.pdf" onChange={handlePickPdf} disabled={loading} />
    </label>
  );
}
