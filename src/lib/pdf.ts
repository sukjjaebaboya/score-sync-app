import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PasswordException, PasswordResponses } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PDFDocumentProxy = pdfjsLib.PDFDocumentProxy;
export type PDFPageProxy = pdfjsLib.PDFPageProxy;

const base = import.meta.env.BASE_URL;

// Scanned/engraved scores show up in wildly different PDF flavors:
//  - raster scans compressed as JBIG2 or JPEG2000 (need pdf.js's wasm codecs)
//  - vector exports from notation software with non-embedded standard fonts
//    or CJK text in a title block (need cmaps + standard font data)
//  - occasionally password-protected copies
// Without these, affected pages/pdfs render blank or throw, which is the
// exact "white screen" failure mode this app must not have.
const wasmUrl = `${base}pdfjs-wasm/`;
const cMapUrl = `${base}pdfjs-cmaps/`;
const standardFontDataUrl = `${base}pdfjs-standard-fonts/`;
const iccUrl = `${base}pdfjs-iccs/`;

export class PdfPasswordCancelledError extends Error {
  constructor() {
    super("사용자가 비밀번호 입력을 취소했습니다.");
  }
}

/**
 * Prompts for a password when the PDF is encrypted, retrying once on a
 * wrong password. Throws PdfPasswordCancelledError if the user cancels.
 */
function onPassword(callback: (password: string) => void, reason: number) {
  const message =
    reason === PasswordResponses.INCORRECT_PASSWORD
      ? "비밀번호가 올바르지 않습니다. 다시 입력해주세요."
      : "이 PDF는 비밀번호로 보호되어 있습니다. 비밀번호를 입력해주세요.";
  const password = window.prompt(message);
  if (password === null) {
    // pdf.js has no direct "abort" hook here; rejecting the outer task
    // promise is handled by the caller via a dedicated password guard below.
    throw new PdfPasswordCancelledError();
  }
  callback(password);
}

export async function loadPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({
    data: data.slice(0),
    wasmUrl,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    iccUrl,
  });
  task.onPassword = onPassword;
  try {
    return await task.promise;
  } catch (err) {
    if (err instanceof PasswordException) {
      throw new PdfPasswordCancelledError();
    }
    throw err;
  }
}
