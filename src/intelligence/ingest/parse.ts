import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { IngestStageError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Stage 1 — parse (design.md §6.5).
 *
 * Produces text blocks that carry their own locator, because a chunk without a
 * page or section reference cannot be cited, and an uncitable chunk cannot pass
 * the groundedness check downstream (FR-INT-017).
 */

export interface TextBlock {
  text: string;
  /** 1-based page number where known (PDF, PPTX slides). */
  page: number | null;
  /** Heading trail, e.g. "3 Sorting > 3.2 Quicksort". */
  sectionPath: string | null;
  /** True when this block is itself a heading — the chunker splits on these. */
  isHeading: boolean;
  headingLevel: number | null;
}

export interface ParseResult {
  blocks: TextBlock[];
  pageCount: number | null;
}

export type SupportedMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  | "text/plain"
  | "text/markdown";

export function detectKind(filename: string, mimeType: string): SupportedMime {
  const extension = extname(filename).toLowerCase();
  if (mimeType === "application/pdf" || extension === ".pdf") return "application/pdf";
  if (extension === ".docx" || mimeType.includes("wordprocessingml")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".pptx" || mimeType.includes("presentationml")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (extension === ".md" || extension === ".markdown" || mimeType === "text/markdown") {
    return "text/markdown";
  }
  return "text/plain";
}

export async function parseFile(path: string, filename: string, mimeType: string): Promise<ParseResult> {
  const kind = detectKind(filename, mimeType);
  try {
    switch (kind) {
      case "application/pdf":
        return await parsePdf(path);
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return await parseDocx(path);
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return await parsePptx(path);
      case "text/markdown":
        return parseMarkdown(await readFile(path, "utf8"));
      case "text/plain":
      default:
        return parsePlainText(await readFile(path, "utf8"));
    }
  } catch (error: unknown) {
    throw new IngestStageError(
      "parse",
      `Could not read ${filename}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function parsePdf(path: string): Promise<ParseResult> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const data = new Uint8Array(await readFile(path));
  const pdf = await getDocumentProxy(data);

  // Per-page rather than merged, so every block keeps the page number a
  // citation needs.
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  const blocks: TextBlock[] = [];
  pages.forEach((pageText, index) => {
    const page = index + 1;
    for (const paragraph of splitParagraphs(pageText)) {
      const heading = detectHeading(paragraph);
      blocks.push({
        text: paragraph,
        page,
        sectionPath: null,
        isHeading: heading !== null,
        headingLevel: heading,
      });
    }
  });

  return { blocks: attachSectionPaths(blocks), pageCount: totalPages };
}

async function parseDocx(path: string): Promise<ParseResult> {
  const mammoth = await import("mammoth");
  const buffer = await readFile(path);
  // convertToHtml rather than extractRawText: the HTML retains <h1>..<h6>,
  // which is the only way to recover the heading structure the chunker needs.
  const { value } = await mammoth.convertToHtml({ buffer });

  const blocks: TextBlock[] = [];
  const tagPattern = /<(h[1-6]|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(value)) !== null) {
    const tag = (match[1] ?? "p").toLowerCase();
    const text = stripHtml(match[2] ?? "").trim();
    if (text.length === 0) continue;

    const isHeading = tag.startsWith("h");
    blocks.push({
      text,
      page: null,
      sectionPath: null,
      isHeading,
      headingLevel: isHeading ? Number(tag.slice(1)) : null,
    });
  }

  return { blocks: attachSectionPaths(blocks), pageCount: null };
}

/**
 * PPTX reader. A .pptx is a zip of slideN.xml files; the text lives in <a:t>
 * elements. Written by hand rather than pulling a dependency, because the
 * requirement is only "recover slide text with slide numbers".
 */
async function parsePptx(path: string): Promise<ParseResult> {
  const unzipper = await import("unzipper");
  const directory = await unzipper.Open.file(path);

  const slideFiles = directory.files
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f.path))
    .sort((a, b) => slideNumber(a.path) - slideNumber(b.path));

  const blocks: TextBlock[] = [];

  for (const file of slideFiles) {
    const slide = slideNumber(file.path);
    const xml = (await file.buffer()).toString("utf8");

    const texts: string[] = [];
    const pattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml)) !== null) {
      const text = decodeXmlEntities(match[1] ?? "").trim();
      if (text.length > 0) texts.push(text);
    }
    if (texts.length === 0) continue;

    // The first text run on a slide is its title in essentially every deck,
    // which gives the chunker a real slide boundary to split on.
    const [title, ...body] = texts;
    if (title) {
      blocks.push({
        text: title,
        page: slide,
        sectionPath: null,
        isHeading: true,
        headingLevel: 2,
      });
    }
    if (body.length > 0) {
      blocks.push({
        text: body.join("\n"),
        page: slide,
        sectionPath: null,
        isHeading: false,
        headingLevel: null,
      });
    }
  }

  if (blocks.length === 0) {
    logger.warn("pptx produced no text — the deck may be image-only", { path });
  }
  return { blocks: attachSectionPaths(blocks), pageCount: slideFiles.length };
}

function parseMarkdown(source: string): ParseResult {
  const blocks: TextBlock[] = [];
  let inFence = false;
  let fenceBuffer: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        // A code fence is one indivisible block: splitting it mid-listing would
        // produce a chunk that no longer compiles or reads as code.
        blocks.push({
          text: fenceBuffer.join("\n"),
          page: null,
          sectionPath: null,
          isHeading: false,
          headingLevel: null,
        });
        fenceBuffer = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fenceBuffer.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        text: (heading[2] ?? "").trim(),
        page: null,
        sectionPath: null,
        isHeading: true,
        headingLevel: heading[1]?.length ?? 1,
      });
      continue;
    }
    if (line.trim().length > 0) {
      blocks.push({
        text: line.trim(),
        page: null,
        sectionPath: null,
        isHeading: false,
        headingLevel: null,
      });
    }
  }
  if (fenceBuffer.length > 0) {
    blocks.push({
      text: fenceBuffer.join("\n"),
      page: null,
      sectionPath: null,
      isHeading: false,
      headingLevel: null,
    });
  }

  return { blocks: attachSectionPaths(mergeAdjacentProse(blocks)), pageCount: null };
}

function parsePlainText(source: string): ParseResult {
  const blocks: TextBlock[] = splitParagraphs(source).map((text) => {
    const heading = detectHeading(text);
    return {
      text,
      page: null,
      sectionPath: null,
      isHeading: heading !== null,
      headingLevel: heading,
    };
  });
  return { blocks: attachSectionPaths(blocks), pageCount: null };
}

/**
 * Walks the heading stack so each block knows its section trail. This is what
 * makes `section_path` in a citation meaningful rather than just the nearest
 * heading.
 */
function attachSectionPaths(blocks: TextBlock[]): TextBlock[] {
  const stack: Array<{ level: number; title: string }> = [];

  return blocks.map((block) => {
    if (block.isHeading) {
      const level = block.headingLevel ?? 1;
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
        stack.pop();
      }
      stack.push({ level, title: block.text });
    }
    const path = stack.map((s) => s.title).join(" > ");
    return { ...block, sectionPath: path.length > 0 ? path : null };
  });
}

function mergeAdjacentProse(blocks: TextBlock[]): TextBlock[] {
  const merged: TextBlock[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous && !previous.isHeading && !block.isHeading && previous.page === block.page) {
      previous.text = `${previous.text}\n${block.text}`;
      continue;
    }
    merged.push({ ...block });
  }
  return merged;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

/**
 * Heuristic heading detection for formats that carry no structure (PDF text,
 * plain text): short, unpunctuated lines, or a numbered section prefix.
 */
function detectHeading(text: string): number | null {
  if (text.length > 120) return null;
  const numbered = /^(\d+(\.\d+)*)\s+\S/.exec(text);
  if (numbered) return Math.min((numbered[1]?.split(".").length ?? 1), 6);
  if (/^[A-Z][^.!?]{2,80}$/.test(text) && !text.endsWith(".")) return 2;
  if (/^(chapter|section|part|appendix|lecture)\b/i.test(text)) return 1;
  return null;
}

function stripHtml(html: string): string {
  return decodeXmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function slideNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}
