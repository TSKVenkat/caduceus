import { describe, expect, it } from "vitest";
import { compactIfNeeded } from "../src/context/compactor";
import { estimateMessagesTokens } from "../src/context/budget";
import type { ChatOptions, ModelClient } from "../src/model/client";
import type { Message } from "../src/types";

class SummaryClient implements ModelClient {
  calls = 0;
  constructor(private readonly summary = "terse summary of earlier steps") {}
  async chat(_messages: Message[], _options?: ChatOptions): Promise<Message> {
    this.calls++;
    return { role: "assistant", content: this.summary };
  }
}

/** Build [system, task, then `steps` assistant(tool_call)+tool pairs]. */
function conversation(steps: number, filler = 400): Message[] {
  const messages: Message[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "the task" },
  ];
  for (let i = 0; i < steps; i++) {
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [{ id: `c${i}`, name: "bash", arguments: { command: `cmd ${i}` } }],
    });
    messages.push({ role: "tool", name: "bash", toolCallId: `c${i}`, content: "x".repeat(filler) });
  }
  return messages;
}

describe("compactIfNeeded", () => {
  it("does nothing when under budget and never calls the model", async () => {
    const client = new SummaryClient();
    const messages = conversation(2);
    const result = await compactIfNeeded(messages, { client, maxTokens: 1_000_000 });
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
    expect(client.calls).toBe(0);
  });

  it("summarizes the middle, preserves head and a clean tail boundary", async () => {
    const client = new SummaryClient();
    const messages = conversation(8);
    const before = estimateMessagesTokens(messages);

    const result = await compactIfNeeded(messages, { client, maxTokens: 100, keepRecent: 8 });

    expect(result.compacted).toBe(true);
    expect(client.calls).toBe(1);
    // Head preserved.
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages[1]?.content).toBe("the task");
    // Summary injected.
    expect(result.messages[2]?.content).toContain("Summary of earlier work");
    // Tail starts on an assistant boundary, not an orphan tool message.
    expect(result.messages[3]?.role).toBe("assistant");
    // Smaller than before.
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.tokensAfter).toBeLessThan(before);
  });

  it("rejects a compaction that would not shrink the history", async () => {
    const client = new SummaryClient("x".repeat(20_000));
    const messages = conversation(8);
    const result = await compactIfNeeded(messages, { client, maxTokens: 100, keepRecent: 8 });
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("keeps tool messages paired with their assistant call after compaction", async () => {
    const client = new SummaryClient();
    const result = await compactIfNeeded(conversation(8), { client, maxTokens: 100, keepRecent: 8 });
    // No tool message may appear without a preceding assistant in the kept tail.
    const tail = result.messages.slice(2);
    for (let i = 0; i < tail.length; i++) {
      if (tail[i]?.role === "tool") {
        expect(tail[i - 1]?.role).toBe("assistant");
      }
    }
  });
});
