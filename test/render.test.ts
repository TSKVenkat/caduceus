import { describe, expect, it } from "vitest";
import { createRenderer, type Writer } from "../src/ui/render";

function buffer(): Writer & { text: string } {
  return {
    text: "",
    isTTY: false,
    write(s: string) {
      this.text += s;
    },
  };
}

describe("createRenderer", () => {
  it("renders the event stream as plain text when color/spinner are off", () => {
    const out = buffer();
    const tokenOut = buffer();
    const r = createRenderer({ color: false, spinner: false, out, tokenOut });

    r.onEvent({ type: "step", n: 1 });
    r.onEvent({ type: "tool_call", call: { id: "1", name: "bash", arguments: { command: "ls" } } });
    r.onEvent({ type: "tool_result", name: "bash", content: "x", isError: false });
    r.onEvent({ type: "tool_result", name: "bash", content: "boom", isError: true });
    r.onToken("hello");
    r.finish();

    expect(out.text).toContain("step 1");
    expect(out.text).toContain("bash");
    expect(out.text).toContain("✓");
    expect(out.text).toContain("✗");
    expect(out.text).not.toContain("["); // no ANSI when color is off
    expect(tokenOut.text).toBe("hello");
  });

  it("emits ANSI color codes when enabled", () => {
    const out = buffer();
    const r = createRenderer({ color: true, spinner: false, out, tokenOut: buffer() });
    r.onEvent({ type: "step", n: 2 });
    expect(out.text).toContain("[");
  });
});
