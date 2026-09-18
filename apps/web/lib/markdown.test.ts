import { describe, expect, it } from "vitest";
import { markdownToPlainText, parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("marks bold, italic, code, and links", () => {
    const spans = parseInline("a **bold** b *italic* c `code` d");
    expect(spans).toEqual([
      { text: "a " },
      { text: "bold", bold: true },
      { text: " b " },
      { text: "italic", italic: true },
      { text: " c " },
      { text: "code", code: true },
      { text: " d" },
    ]);
  });

  it("keeps stray markers as literal text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
    expect(parseInline("a **broken")).toEqual([{ text: "a **broken" }]);
  });

  it("keeps [n] citations as plain text but links https URLs", () => {
    expect(parseInline("see [1] and [2]")).toEqual([{ text: "see [1] and [2]" }]);
    expect(parseInline("[docs](https://example.com/x)")).toEqual([
      { text: "docs", href: "https://example.com/x" },
    ]);
  });

  it("drops unsafe link targets", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ text: "x" }]);
  });
});

describe("parseMarkdown", () => {
  it("parses headings, paragraphs, lists, quotes, code, and rules", () => {
    const blocks = parseMarkdown(
      [
        "## Title",
        "",
        "Hello **world**.",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
        "",
        "```py",
        "print(1)",
        "```",
        "",
        "---",
      ].join("\n")
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "quote",
      "code",
      "rule",
    ]);
    const list = blocks[2];
    if (!list || list.type !== "list") throw new Error("expected list");
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(2);
  });

  it("parses ordered lists and simple tables", () => {
    const blocks = parseMarkdown(
      ["1. first", "2. second", "", "| A | B |", "| --- | --- |", "| a1 | b1 |"].join("\n")
    );
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
    expect(blocks[1]).toMatchObject({
      type: "table",
      headers: ["A", "B"],
      rows: [["a1", "b1"]],
    });
  });

  it("returns no blocks for empty input", () => {
    expect(parseMarkdown("   \n  ")).toEqual([]);
  });
});

describe("markdownToPlainText", () => {
  it("drops formatting but keeps every word", () => {
    const plain = markdownToPlainText("## Hi\n\nA **bold** claim [1].\n\n- x\n- y");
    expect(plain).toContain("Hi");
    expect(plain).toContain("A bold claim [1].");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("##");
  });
});
