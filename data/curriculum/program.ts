import type { CourseSeed, ProgramSeed } from "./types";

export const program: ProgramSeed = {
  code: "BSCS",
  title: "BS Computer Science",
  accreditationBody: "Washington Accord (outcome-based accreditation)",
};

export const course: CourseSeed = {
  code: "CS-201",
  title: "Data Structures & Algorithms",
  creditHours: 3,
  weeks: 14,
};
