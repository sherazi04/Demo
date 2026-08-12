import { describe, expect, it } from "vitest";
import { expectedHash, verifyRows, type ChainRow } from "@/governance/chain";

const SEED = "test-genesis";

/** Builds a well-formed chain of `n` rows, so tests can then break it. */
function buildChain(n: number, seed = SEED): ChainRow[] {
  const rows: ChainRow[] = [];
  let prevHash = seed;
  for (let i = 1; i <= n; i += 1) {
    const partial: Omit<ChainRow, "hash"> = {
      seq: i,
      actorId: `actor-${i}`,
      action: "question.generate",
      resourceId: `res-${i}`,
      model: "claude-opus-5",
      promptHash: `prompt-${i}`,
      outputHash: `output-${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      prevHash,
    };
    const hash = expectedHash(partial);
    rows.push({ ...partial, hash });
    prevHash = hash;
  }
  return rows;
}

describe("verifyRows", () => {
  it("accepts an intact chain", () => {
    const result = verifyRows(buildChain(20), SEED);
    expect(result).toEqual({ ok: true, checked: 20 });
  });

  it("accepts an empty log", () => {
    expect(verifyRows([], SEED)).toEqual({ ok: true, checked: 0 });
  });

  it("rejects a chain whose first row does not descend from the seed", () => {
    const rows = buildChain(3, "a-different-seed");
    const result = verifyRows(rows, SEED);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("prev_hash_mismatch");
    expect(result.firstBrokenSeq).toBe(1);
  });

  /** This is the demo's tamper test in miniature (prompt.md §5 step 14). */
  it("detects an edited field and names the row", () => {
    const rows = buildChain(10);
    const target = rows[4];
    expect(target).toBeDefined();
    if (!target) return;
    // Edit the action but leave the stored hash alone, exactly as a direct
    // UPDATE against the table would.
    rows[4] = { ...target, action: "question.approve" };

    const result = verifyRows(rows, SEED);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
    expect(result.firstBrokenSeq).toBe(5);
    expect(result.checked).toBe(4);
  });

  it("detects a deleted row via the seq gap", () => {
    const rows = buildChain(10);
    rows.splice(4, 1);
    const result = verifyRows(rows, SEED);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("seq_gap");
    expect(result.firstBrokenSeq).toBe(6);
  });

  it("detects reordered rows", () => {
    const rows = buildChain(6);
    const a = rows[2];
    const b = rows[3];
    expect(a && b).toBeTruthy();
    if (!a || !b) return;
    rows[2] = b;
    rows[3] = a;
    const result = verifyRows(rows, SEED);
    expect(result.ok).toBe(false);
  });

  /**
   * An attacker who edits a row and recomputes only that row's hash still
   * breaks the link to the next row — this is what the chain buys over
   * per-row checksums.
   */
  it("detects a re-hashed edit because the successor's prev_hash no longer matches", () => {
    const rows = buildChain(8);
    const target = rows[3];
    expect(target).toBeDefined();
    if (!target) return;
    const edited = { ...target, resourceId: "tampered" };
    rows[3] = { ...edited, hash: expectedHash(edited) };

    const result = verifyRows(rows, SEED);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("prev_hash_mismatch");
    expect(result.firstBrokenSeq).toBe(5);
  });

  it("honours expectedFirstSeq so page boundaries are gap-checked", () => {
    const rows = buildChain(10);
    const secondPage = rows.slice(5);
    const firstOfPage = secondPage[0];
    expect(firstOfPage).toBeDefined();
    if (!firstOfPage) return;

    // Correct continuation.
    const ok = verifyRows(secondPage, rows[4]?.hash ?? SEED, 6);
    expect(ok.ok).toBe(true);

    // Claiming the page should have started at 7 exposes the missing row.
    const gap = verifyRows(secondPage, rows[4]?.hash ?? SEED, 7);
    expect(gap.ok).toBe(false);
    expect(gap.reason).toBe("seq_gap");
  });
});
