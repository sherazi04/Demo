import type { TextBlock } from "./parse";

/**
 * Stage 2 — chunk (design.md §6.5, FR-INT-016).
 *
 * Structure first, size second: split at headings and slide boundaries, then
 * pack the resulting sections to the target token count with overlap, and never
 * break a sentence. A chunk that starts mid-sentence is unusable as a citation
 * and reads as incoherent context to the generator.
 *
 * Pure and dependency-free so the packing rules are unit-testable.
 */

export interface ChunkOptions {
  targetTokens: number;
  overlapTokens: number;
  minTokens: number;
}

export interface ProducedChunk {
  text: string;
  tokenCount: number;
  ordinal: number;
  pageFrom: number | null;
  pageTo: number | null;
  sectionPath: string | null;
}

/**
 * Token estimate, not a tokenizer.
 *
 * The real count comes from the provider; this only has to be good enough to
 * decide where to cut. ~4 characters per token is the usual English
 * approximation, with a word-count floor so a run of very short tokens
 * ("a b c d") is not badly underestimated.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const byChars = Math.ceil(trimmed.length / 4);
  const byWords = Math.ceil(trimmed.split(/\s+/).length * 0.75);
  return Math.max(byChars, byWords);
}

/**
 * Splits on sentence boundaries, keeping the terminator.
 *
 * The lookbehind guards the common abbreviations and decimal numbers that would
 * otherwise produce a "sentence" ending at "Fig." or "0." — a naive split on
 * /[.!?]/ fragments technical prose badly.
 */
export function splitSentences(text: string): string[] {
  const protectedText = text
    .replace(/\b(Fig|Eq|No|Vol|Ch|Sec|Dr|Prof|et al|i\.e|e\.g|cf|vs|approx)\./gi, "$1<DOT>")
    .replace(/(\d)\.(\d)/g, "$1<DOT>$2");

  const parts = protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z(\[«"'])/)
    .map((s) => s.replace(/<DOT>/g, ".").trim())
    .filter((s) => s.length > 0);

  return parts.length > 0 ? parts : [text.trim()].filter((s) => s.length > 0);
}

interface Section {
  blocks: TextBlock[];
  sectionPath: string | null;
}

/** Groups blocks into sections, cutting at every heading and page change. */
function groupIntoSections(blocks: readonly TextBlock[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const block of blocks) {
    // A heading opens a new section; so does a slide boundary, which for a
    // deck is the meaningful unit regardless of heading markup.
    const open = current;
    const startsNew =
      open === null ||
      block.isHeading ||
      (block.page !== null &&
        open.blocks.length > 0 &&
        open.blocks[open.blocks.length - 1]?.page !== block.page &&
        open.blocks[0]?.page !== null);

    if (startsNew) {
      current = { blocks: [block], sectionPath: block.sectionPath };
      sections.push(current);
    } else {
      open.blocks.push(block);
    }
  }

  return sections;
}

export function chunkBlocks(
  blocks: readonly TextBlock[],
  options: ChunkOptions,
): ProducedChunk[] {
  const { targetTokens, overlapTokens, minTokens } = options;
  const chunks: ProducedChunk[] = [];

  for (const section of groupIntoSections(blocks)) {
    // The heading is kept as a prefix of its own section's first chunk: a chunk
    // reading "…quicksort partitions about a pivot" is far more useful when it
    // still says which section it came from.
    const headingText = section.blocks.find((b) => b.isHeading)?.text ?? null;
    const bodyBlocks = section.blocks.filter((b) => !b.isHeading);
    const body = bodyBlocks.map((b) => b.text).join("\n").trim();

    if (body.length === 0) continue;

    const pages = bodyBlocks.map((b) => b.page).filter((p): p is number => p !== null);
    const pageFrom = pages.length > 0 ? Math.min(...pages) : null;
    const pageTo = pages.length > 0 ? Math.max(...pages) : null;

    const sentences = splitSentences(body);
    let buffer: string[] = [];
    let bufferTokens = 0;
    let isFirstOfSection = true;

    const flush = () => {
      if (buffer.length === 0) return;
      const joined = buffer.join(" ").trim();
      if (joined.length === 0) return;

      const withHeading =
        isFirstOfSection && headingText ? `${headingText}\n\n${joined}` : joined;

      chunks.push({
        text: withHeading,
        tokenCount: estimateTokens(withHeading),
        ordinal: chunks.length,
        pageFrom,
        pageTo,
        sectionPath: section.sectionPath,
      });
      isFirstOfSection = false;

      // Carry whole trailing sentences forward as overlap, never a fragment.
      const carried: string[] = [];
      let carriedTokens = 0;
      for (let i = buffer.length - 1; i >= 0; i -= 1) {
        const sentence = buffer[i];
        if (!sentence) continue;
        const cost = estimateTokens(sentence);
        if (carriedTokens + cost > overlapTokens) break;
        carried.unshift(sentence);
        carriedTokens += cost;
      }

      /*
       * When every sentence is longer than the overlap budget, the loop above
       * carries nothing and consecutive chunks share no context at all — the
       * boundary then falls mid-explanation, which is exactly what overlap
       * exists to prevent. Carry the final sentence instead, provided it fits
       * the target; one whole sentence is the smallest meaningful overlap.
       */
      if (carried.length === 0 && buffer.length > 1) {
        const last = buffer[buffer.length - 1];
        if (last && estimateTokens(last) <= targetTokens) {
          carried.push(last);
          carriedTokens = estimateTokens(last);
        }
      }

      buffer = carried;
      bufferTokens = carriedTokens;
    };

    for (const sentence of sentences) {
      const cost = estimateTokens(sentence);

      // A single sentence longer than the target is emitted whole rather than
      // cut — an oversized coherent chunk beats a truncated one.
      if (cost > targetTokens && buffer.length === 0) {
        buffer = [sentence];
        bufferTokens = cost;
        flush();
        continue;
      }

      if (bufferTokens + cost > targetTokens && bufferTokens > 0) {
        flush();
      }

      buffer.push(sentence);
      bufferTokens += cost;
    }

    // Final buffer: fold a too-small tail into the previous chunk of this same
    // section rather than emitting a stub that carries no usable context.
    if (buffer.length > 0) {
      const tailText = buffer.join(" ").trim();
      const tailTokens = estimateTokens(tailText);
      const previous = chunks[chunks.length - 1];

      if (tailTokens < minTokens && previous && previous.sectionPath === section.sectionPath) {
        previous.text = `${previous.text} ${tailText}`.trim();
        previous.tokenCount = estimateTokens(previous.text);
      } else {
        flush();
      }
    }
  }

  // Re-number after the folding above so ordinals stay contiguous.
  return chunks.map((chunk, index) => ({ ...chunk, ordinal: index }));
}
