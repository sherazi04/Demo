import { z } from "zod";
import type { CourseContext } from "./shared";

/**
 * LOM tagging prompt and schema (design.md §6.5 tag stage).
 *
 * The schema is the contract: free-text parsing is prohibited (FR-INT-022), so
 * this Zod object drives both the model's structured output and the runtime
 * validation of what comes back.
 */
export const taggerItemSchema = z.object({
  /** Index into the batch, so a reordered response still maps to the right chunk. */
  index: z.number().int().min(0),
  /** Must exist in this course — anything else is a drift failure. */
  topicCode: z.string(),
  bloomLevel: z.number().int().min(1).max(6),
  difficulty: z.number().min(0).max(1),
  lomFormat: z.enum([
    "definition",
    "worked_example",
    "proof",
    "exercise",
    "figure",
    "code",
    "narrative",
  ]),
  resourceType: z.string(),
  /** Must all exist in this course. */
  cloCodes: z.array(z.string()),
  keywords: z.array(z.string()).max(8),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(400),
});

export const taggerResponseSchema = z.object({
  items: z.array(taggerItemSchema),
});

export type TaggerItem = z.infer<typeof taggerItemSchema>;

/**
 * system[2] for the tag stage. Stable across every batch in a course, so it
 * sits above the volatile chunk text and contributes to the cached prefix.
 */
export function taggerTaskBlock(): string {
  return `TASK — IEEE LOM metadata tagging.

You will receive a batch of numbered content chunks from this course's material. For each chunk, assign metadata. Return one item per chunk, echoing its index.

Fields:

topicCode        The single topic code from the course context that this chunk is chiefly about. Choose the most specific applicable topic. You MUST use a code from the list; do not invent one, and do not return a topic that merely seems related if the chunk is really about something else.

bloomLevel       The highest cognitive level this chunk *supports a learner in reaching*. A definition supports Remember/Understand; a worked example supports Apply; a derivation or a comparison of trade-offs supports Analyse or Evaluate. Judge the content, not its tone.

difficulty       0 to 1, relative to a second-year undergraduate meeting this material for the first time. 0.2 is introductory, 0.5 is typical course level, 0.8 assumes fluency with prerequisites.

lomFormat        definition | worked_example | proof | exercise | figure | code | narrative
                 Pick the dominant form. A paragraph that ends with a small example is still a definition; a step-by-step solution is a worked_example.

resourceType     A short IEEE LOM learning-resource-type label, e.g. "narrative text", "problem statement", "algorithm listing", "diagram caption".

cloCodes         Every CLO from the course context this chunk provides evidence for — often more than one, sometimes none. Use only codes from the list.

keywords         Up to 8 technical terms actually present in the chunk.

confidence       0 to 1: your confidence in the topic and CLO assignment specifically. Be honest and use the full range. A chunk that is boilerplate, a table of contents, a bibliography, or otherwise not really course content should get a LOW confidence — that is the signal a human reviewer needs, and understating your uncertainty defeats the review queue.

reasoning        One or two sentences saying why this topic and level. Name the evidence in the chunk.

Do not tag a chunk as a topic it does not cover just to avoid leaving it unmatched. Low confidence on an honest assignment is far more useful than high confidence on a guess.`;
}

/** The volatile user turn: the actual chunks, after the cache breakpoint. */
export function taggerUserBlock(chunks: Array<{ text: string }>): string {
  const rendered = chunks
    .map((chunk, index) => `### CHUNK ${index}\n${chunk.text}`)
    .join("\n\n");

  return `Tag the following ${chunks.length} chunk(s). Return exactly ${chunks.length} item(s), one per chunk, each echoing its index.\n\n${rendered}`;
}

export type { CourseContext };
