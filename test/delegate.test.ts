import { describe, expect, it } from "vitest";
import { createDelegateTool } from "../src/loop/delegate";
import type { ChatOptions, ModelClient } from "../src/model/client";
import type { Message } from "../src/types";

/** A subagent client that always answers (no tool calls), so each subrun ends in one step. */
class FixedClient implements ModelClient {
  calls = 0;
  async chat(_messages: Message[], _options?: ChatOptions): Promise<Message> {
    this.calls++;
    return { role: "assistant", content: "FINDING" };
  }
}

describe("delegate", () => {
  it("runs a subagent per task and aggregates digests", async () => {
    const client = new FixedClient();
    const tool = createDelegateTool({ client, cwd: process.cwd(), maxSteps: 3, maxConcurrency: 4 });

    const out = await tool.run({ tasks: ["explore A", "explore B"] }, { cwd: process.cwd() });

    expect(out).toContain("### explore A");
    expect(out).toContain("### explore B");
    expect(out).toContain("FINDING");
    expect(client.calls).toBe(2); // one subagent run per task
  });

  it("rejects more tasks than the concurrency cap", async () => {
    const tool = createDelegateTool({
      client: new FixedClient(),
      cwd: process.cwd(),
      maxConcurrency: 2,
    });
    await expect(
      tool.run({ tasks: ["a", "b", "c"] }, { cwd: process.cwd() }),
    ).rejects.toThrow();
  });
});
