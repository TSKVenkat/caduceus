import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Conversation } from "../src/engine/conversation";
import { listSessions, loadSession, saveSession } from "../src/engine/store";
import type { ChatOptions, ModelClient } from "../src/model/client";
import { ToolRegistry } from "../src/tools/registry";
import type { Message } from "../src/types";

class SeqClient implements ModelClient {
  lastMessages: Message[] = [];
  private index = 0;
  constructor(private readonly replies: string[]) {}
  async chat(messages: Message[], _options?: ChatOptions): Promise<Message> {
    this.lastMessages = messages;
    return { role: "assistant", content: this.replies[this.index++] ?? "done" };
  }
}

describe("Conversation", () => {
  it("keeps history and context across turns", async () => {
    const client = new SeqClient(["one", "two"]);
    const convo = new Conversation({
      client,
      registry: new ToolRegistry(),
      systemPrompt: "system prompt",
    });

    expect((await convo.send("hello")).finalText).toBe("one");
    expect((await convo.send("again")).finalText).toBe("two");

    expect(convo.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    // The second turn's model call saw the prior turn's context.
    const seen = client.lastMessages.map((m) => m.content);
    expect(seen).toContain("hello");
    expect(seen).toContain("one");
    expect(seen).toContain("again");
  });

  it("resumes from a provided history", () => {
    const prior: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "earlier" },
    ];
    const convo = new Conversation({
      client: new SeqClient([]),
      registry: new ToolRegistry(),
      systemPrompt: "sys",
      messages: prior,
    });
    expect(convo.messages).toHaveLength(2);
  });
});

describe("session store", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "caduceus-sess-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a session and lists it", async () => {
    const session = {
      id: "abc",
      created: "2026-06-22T00:00:00Z",
      updated: "2026-06-22T00:01:00Z",
      messages: [{ role: "system" as const, content: "s" }],
    };
    await saveSession(dir, session);
    await expect(loadSession(dir, "abc")).resolves.toEqual(session);
    expect((await listSessions(dir)).map((s) => s.id)).toEqual(["abc"]);
    await expect(loadSession(dir, "missing")).resolves.toBeNull();
  });
});
