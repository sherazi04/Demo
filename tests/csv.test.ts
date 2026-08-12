import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvTable } from "@/lib/csv";
import { checkPasswordPolicy } from "@/auth/password-policy";

describe("parseCsv", () => {
  it("parses a simple table", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('name,role\n"Doe, Jane",student')).toEqual([
      ["name", "role"],
      ["Doe, Jane", "student"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('a\n"She said ""hi"""')).toEqual([["a"], ['She said "hi"']]);
  });

  it("supports newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("normalises CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM so the first header is usable", () => {
    const withBom = "﻿email,name\na@b.c,Jo";
    const table = parseCsvTable(withBom);
    expect(table.headers).toEqual(["email", "name"]);
    expect(table.rows[0]?.["email"]).toBe("a@b.c");
  });

  it("does not emit a trailing empty row", () => {
    expect(parseCsv("a\n1\n")).toEqual([["a"], ["1"]]);
  });

  it("pads short rows so every header key exists", () => {
    const table = parseCsvTable("email,name,role\na@b.c,Jo");
    expect(table.rows[0]).toEqual({ email: "a@b.c", name: "Jo", role: "" });
  });

  it("lower-cases and trims headers", () => {
    const table = parseCsvTable(" Email , NAME \nx@y.z,Jo");
    expect(table.headers).toEqual(["email", "name"]);
  });
});

describe("checkPasswordPolicy", () => {
  it("accepts a long passphrase", () => {
    expect(checkPasswordPolicy("correct horse battery staple").ok).toBe(true);
  });

  it("rejects anything under 12 characters", () => {
    const result = checkPasswordPolicy("short1!");
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/12 characters/);
  });

  it("rejects a single repeated character", () => {
    expect(checkPasswordPolicy("aaaaaaaaaaaaaaa").ok).toBe(false);
  });

  it("rejects leading or trailing whitespace", () => {
    expect(checkPasswordPolicy(" a-long-enough-password").ok).toBe(false);
    expect(checkPasswordPolicy("a-long-enough-password ").ok).toBe(false);
  });

  it("does not require symbols or mixed case", () => {
    // Composition rules mostly produce predictable substitutions; length is
    // what the policy actually enforces.
    expect(checkPasswordPolicy("alllowercaseletters").ok).toBe(true);
  });
});
