import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ChatOptions, ModelClient } from "../src/model/client";
import { run, type RunEvent } from "../src/loop/orchestrator";
import { ToolRegistry } from "../src/tools/registry";
import { defineTool } from "../src/tools/tool";
import type { Message } from "../src/types";

/** Replays a fixed sequence of assistant messages so the loop runs offline. */
class ScriptedClient implements ModelClient {
  private index = 0;
  constructor(private readonly replies: Message[]) {}

  async chat(_messages: Message[], _options?: ChatOptions): Promise<Message> {
    const reply = this.replies[this.index++];
    if (!reply) {
      throw new Error("ScriptedClient ran out of replies");
    }
    return reply;
  }
}

function registryWithEcho(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: "echo",
      description: "Return the provided text.",
      schema: z.object({ text: z.string() }),
      async execute({ text }) {
        return text;
      },
    }),
  );
  return registry;
}

describe("run", () => {
  it("executes a tool call then finishes", async () => {
    const client = new ScriptedClient([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "echo", arguments: { text: "hello" } }],
      },
      { role: "assistant", content: "all done" },
    ]);

    const events: RunEvent[] = [];
    const result = await run("say hello", {
      client,
      registry: registryWithEcho(),
      onEvent: (event) => events.push(event),
    });

    expect(result.stopReason).toBe("done");
    expect(result.steps).toBe(2);
    expect(result.finalText).toBe("all done");

    const toolResult = events.find((event) => event.type === "tool_result");
    expect(toolResult).toMatchObject({ name: "echo", content: "hello", isError: false });
  });

  it("stops at the step budget when the model never finishes", async () => {
    const looping: Message = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_x", name: "echo", arguments: { text: "again" } }],
    };
    const client = new ScriptedClient(Array.from({ length: 5 }, () => structuredClone(looping)));

    const result = await run("loop forever", {
      client,
      registry: registryWithEcho(),
      maxSteps: 3,
    });

    expect(result.stopReason).toBe("max_steps");
    expect(result.steps).toBe(3);
  });

  it("trips the circuit breaker on repeated tool errors", async () => {
    const badCall: Message = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_bad", name: "missing_tool", arguments: {} }],
    };
    const client = new ScriptedClient(Array.from({ length: 5 }, () => structuredClone(badCall)));

    const result = await run("use a missing tool", {
      client,
      registry: registryWithEcho(),
      maxSteps: 10,
    });

    expect(result.stopReason).toBe("circuit_breaker");
    expect(result.steps).toBe(3);
  });
});
