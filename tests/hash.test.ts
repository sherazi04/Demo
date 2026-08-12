import { describe, expect, it } from "vitest";
import { auditHash, canonicalJson, hashJson, sha256 } from "@/lib/hash";

describe("canonicalJson", () => {
  it("sorts keys recursively so equal payloads hash equally", () => {
    const a = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
    const b = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashJson(a)).toBe(hashJson(b));
  });

  it("does not conflate different values", () => {
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }));
  });

  it("preserves array order (order is meaningful)", () => {
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
  });
});

describe("auditHash", () => {
  const base = {
    prevHash: "seed",
    seq: 1,
    actorId: "11111111-1111-4111-8111-111111111111",
    action: "question.generate",
    resourceId: "22222222-2222-4222-8222-222222222222",
    model: "claude-opus-5",
    promptHash: sha256("prompt"),
    outputHash: sha256("output"),
    createdAtIso: "2026-01-01T00:00:00.000Z",
  };

  it("is deterministic", () => {
    expect(auditHash(base)).toBe(auditHash({ ...base }));
  });

  it("changes when any single field changes", () => {
    const original = auditHash(base);
    const mutations: Array<Partial<typeof base>> = [
      { prevHash: "other" },
      { seq: 2 },
      { actorId: "33333333-3333-4333-8333-333333333333" },
      { action: "question.approve" },
      { resourceId: "44444444-4444-4444-8444-444444444444" },
      { model: "claude-opus-4-8" },
      { promptHash: sha256("different") },
      { outputHash: sha256("different") },
      { createdAtIso: "2026-01-01T00:00:01.000Z" },
    ];
    for (const mutation of mutations) {
      expect(auditHash({ ...base, ...mutation })).not.toBe(original);
    }
  });

  it("treats null and empty-string fields as distinct from a populated value", () => {
    expect(auditHash({ ...base, actorId: null })).not.toBe(auditHash(base));
  });

  /**
   * The separator is what stops two different field tuples sharing a pre-image.
   * Plain concatenation would make these two rows hash identically.
   */
  it("is not vulnerable to field-boundary ambiguity", () => {
    const left = auditHash({ ...base, action: "ab", resourceId: "c" });
    const right = auditHash({ ...base, action: "a", resourceId: "bc" });
    expect(left).not.toBe(right);
  });
});
