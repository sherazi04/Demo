import { course, program } from "./program";
import { plos } from "./plos";
import { cloPloMap, clos } from "./clos";
import { topics } from "./topics";
import { prereqs } from "./prereqs";
import { cloTopics } from "./clo-topics";
import { misconceptions } from "./misconceptions";

export * from "./types";
export { program, course, plos, clos, cloPloMap, topics, prereqs, cloTopics, misconceptions };

/**
 * The whole declarative spine in one object. Swap the files in this directory
 * to retarget the system to a different course (NFR-CFG-006).
 */
export const curriculum = {
  program,
  course,
  plos,
  clos,
  cloPloMap,
  topics,
  prereqs,
  cloTopics,
  misconceptions,
} as const;

export type Curriculum = typeof curriculum;
