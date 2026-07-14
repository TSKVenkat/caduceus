import { describe, it, expect } from "vitest";
import { markdownToMrkdwn, chunkText } from "../src/gateway/platforms/slack-format.js";

describe("markdownToMrkdwn", () => {
  it("converts bold **text** to *text*", () => {
    expect(markdownToMrkdwn("**hello**")).toBe("*hello*");
  });

  it("converts italic *text* to _text_", () => {
    expect(markdownToMrkdwn("*hello*")).toBe("_hello_");
  });

  it("does not confuse bold with italic", () => {
    expect(markdownToMrkdwn("**bold** and _italic_")).toBe("*bold* and _italic_");
  });

  it("converts strikethrough ~~text~~ to ~text~", () => {
    expect(markdownToMrkdwn("~~deleted~~")).toBe("~deleted~");
  });

  it("converts markdown links to Slack link format", () => {
    expect(markdownToMrkdwn("[text](https://example.com)")).toBe("<https://example.com|text>");
  });

  it("converts headers to bold", () => {
    expect(markdownToMrkdwn("# Title")).toBe("*Title*");
    expect(markdownToMrkdwn("### Subsection")).toBe("*Subsection*");
  });

  it("protects code blocks from conversion", () => {
    const result = markdownToMrkdwn("```\n**not bold**\n```");
    expect(result).toContain("**not bold**");
  });

  it("protects inline code from conversion", () => {
    const result = markdownToMrkdwn("run `rm -rf /tmp` now");
    expect(result).toContain("`rm -rf /tmp`");
    expect(result).not.toContain("_rm");
  });

  it("escapes ampersands, angle brackets", () => {
    expect(markdownToMrkdwn("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

describe("chunkText", () => {
  it("returns single chunk when under limit", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits at newline boundaries", () => {
    const text = "line1\nline2\nline3";
    const chunks = chunkText(text, 11);
    expect(chunks.length).toBe(2);
  });

  it("handles text longer than limit without newlines", () => {
    const text = "a".repeat(250);
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBe(3);
    expect(chunks.join("").length).toBe(250);
  });
});
