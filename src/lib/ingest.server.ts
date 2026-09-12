/** Server-only ingestion: extract text from an uploaded kithab, chunk it, embed it. */
import { unzipSync, strFromU8 } from "fflate";
import { embedText } from "./ai.server";

export type ExtractResult = { text: string; pages: number; ocrNeeded: boolean };

export async function extractText(
  bytes: ArrayBuffer,
  fileName: string,
  mimeType: string,
): Promise<ExtractResult> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".txt") || lower.endsWith(".md") || mimeType.startsWith("text/")) {
    return { text: new TextDecoder("utf-8").decode(bytes), pages: 0, ocrNeeded: false };
  }

  if (lower.endsWith(".docx")) {
    const files = unzipSync(new Uint8Array(bytes));
    const doc = files["word/document.xml"];
    if (!doc) throw new Error("This .docx file could not be read. Please save it again or upload it as plain text.");
    const xml = strFromU8(doc);
    const text = xml
      .replace(/<w:p[ >][\s\S]*?(?=<w:p[ >]|$)/g, (m) => `${m}\n`)
      .replace(/<w:br\s*\/>/g, "\n")
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n");
    return { text, pages: 0, ocrNeeded: false };
  }

  if (lower.endsWith(".epub") || mimeType === "application/epub+zip") {
    return extractEpub(bytes);
  }

  if (lower.endsWith(".doc")) {
    throw new Error("Old .doc files are not supported. Please save the file as .docx or plain text (.txt).");
  }

  if (lower.endsWith(".pdf") || mimeType === "application/pdf") {
    const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
    let joined = "";
    let totalPages = 0;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const extracted = await extractPdfText(pdf, { mergePages: false });
      totalPages = extracted.totalPages;
      const pageTexts = Array.isArray(extracted.text) ? extracted.text : [String(extracted.text)];
      joined = pageTexts.map((page, index) => `[ص ${index + 1}]\n${page}`).join("\n\n");
    } catch (error) {
      console.error("PDF text layer could not be read", error);
    }
    const bare = joined.replace(/\s|\[ص \d+\]/g, "").length;
    const density = bare / Math.max(1, totalPages);

    // Scanned PDF: fall back to reading the pages with the model (OCR).
    if (density < 80) {
      const { transcribeDocument } = await import("./ai.server");
      const ocr = await transcribeDocument(bytes, "application/pdf");
      if (ocr.replace(/\s/g, "").length > Math.max(bare, 200)) {
        return { text: ocr, pages: totalPages, ocrNeeded: true };
      }
    }
    if (bare < 40)
      throw new Error(
        "This looks like a scanned book and the pages could not be read automatically. Please upload a clearer scan, a smaller file (fewer pages at a time), or a plain-text version.",
      );
    return { text: joined, pages: totalPages, ocrNeeded: density < 80 };
  }

  throw new Error(
    "Unsupported file type. Upload a PDF, an EPUB, a .docx file, or plain text (.txt / .md).",
  );
}

function htmlToText(html: string): string {
  return html
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-4])[^>]*>/gi, (_m, level) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-4]>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|section|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Reads an EPUB (a zip of XHTML chapters) in reading order via its OPF spine. */
function extractEpub(bytes: ArrayBuffer): ExtractResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new Error("This EPUB file could not be opened. It may be corrupted or password protected.");
  }

  const names = Object.keys(files);
  const decode = (name: string) => strFromU8(files[name]!);

  // Find the package document (.opf) to read the spine order.
  let opfPath: string | null = null;
  const container = names.find((n) => n.toLowerCase() === "meta-inf/container.xml");
  if (container) {
    const match = decode(container).match(/full-path="([^"]+)"/i);
    if (match) opfPath = match[1]!;
  }
  if (!opfPath) opfPath = names.find((n) => n.toLowerCase().endsWith(".opf")) ?? null;

  const docNames: string[] = [];
  if (opfPath && files[opfPath]) {
    const opf = decode(opfPath);
    const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
    const manifest = new Map<string, string>();
    for (const item of opf.match(/<item\b[^>]*\/?>/gi) ?? []) {
      const id = item.match(/\bid="([^"]+)"/i)?.[1];
      const href = item.match(/\bhref="([^"]+)"/i)?.[1];
      if (id && href) manifest.set(id, decodeURIComponent(href));
    }
    for (const ref of opf.match(/<itemref\b[^>]*\/?>/gi) ?? []) {
      const idref = ref.match(/\bidref="([^"]+)"/i)?.[1];
      const href = idref ? manifest.get(idref) : undefined;
      if (!href) continue;
      const full = `${base}${href}`.replace(/[^/]+\/\.\.\//g, "").split("#")[0]!;
      if (files[full]) docNames.push(full);
    }
  }

  if (docNames.length === 0) {
    docNames.push(
      ...names
        .filter((n) => /\.(xhtml|html|htm)$/i.test(n) && !n.startsWith("__MACOSX"))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    );
  }

  const parts: string[] = [];
  for (const name of docNames) {
    const text = htmlToText(decode(name)).trim();
    if (text.length >= 20) parts.push(text);
  }

  const text = parts.join("\n\n");
  if (text.replace(/\s/g, "").length < 40)
    throw new Error(
      "No readable text was found in that EPUB. It may only contain page images — upload a text version instead.",
    );
  return { text, pages: docNames.length, ocrNeeded: false };
}

export type Chunk = { content: string; chapter: string | null; pageLabel: string | null; position: number };

const MAX_CHARS = 1400;
const OVERLAP = 180;

/**
 * Splits a book into passages, tracking `## heading` chapter markers and
 * `[ص 123]` / `[p. 123]` page markers so citations stay accurate.
 */
export function chunkText(raw: string): Chunk[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const chunks: Chunk[] = [];
  let chapter: string | null = null;
  let page: string | null = null;
  let buffer = "";
  let bufferChapter: string | null = null;
  let bufferPage: string | null = null;

  const flush = () => {
    const content = buffer.trim();
    if (content.length >= 40) {
      chunks.push({
        content,
        chapter: bufferChapter,
        pageLabel: bufferPage,
        position: chunks.length,
      });
    }
    const tail = content.slice(-OVERLAP);
    buffer = content.length > OVERLAP ? tail : "";
    bufferChapter = chapter;
    bufferPage = page;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^#{1,4}\s*(.+)$/);
    const pageMatch = trimmed.match(/^\[(?:ص|ص\.|p\.?|page)\s*([\u0660-\u0669\d]+)\]$/i);
    const arabicChapter = trimmed.match(/^(?:باب|فصل|كتاب|مسألة)\s+.{0,80}$/);

    if (pageMatch) {
      page = pageMatch[1] ?? null;
      if (!bufferPage) bufferPage = page;
      continue;
    }
    if (headingMatch) {
      if (buffer.trim().length >= 40) flush();
      chapter = headingMatch[1]!.trim();
      bufferChapter = chapter;
      bufferPage = page;
      continue;
    }
    if (arabicChapter && buffer.trim().length > 200) {
      flush();
      chapter = trimmed;
      bufferChapter = chapter;
    }
    if (!trimmed) {
      buffer += "\n";
      continue;
    }
    if (bufferChapter === null) bufferChapter = chapter;
    if (bufferPage === null) bufferPage = page;
    buffer += `${trimmed}\n`;
    if (buffer.length >= MAX_CHARS) flush();
  }
  if (buffer.trim().length >= 40) {
    chunks.push({
      content: buffer.trim(),
      chapter: bufferChapter,
      pageLabel: bufferPage,
      position: chunks.length,
    });
  }
  return chunks;
}

/** Embeds chunks with limited concurrency; a failed embedding stores the text only. */
export async function embedChunks(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(chunks.length).fill(null);
  const concurrency = 4;
  let index = 0;
  let done = 0;

  async function worker() {
    while (index < chunks.length) {
      const current = index++;
      try {
        results[current] = await embedText(chunks[current]!.content, "document");
      } catch (error) {
        console.error(`Embedding chunk ${current} failed`, error);
        results[current] = null;
      }
      done += 1;
      onProgress?.(done, chunks.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return results;
}
