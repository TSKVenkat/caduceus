import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadConfig } from "../config";
import { Conversation } from "../engine/conversation";
import { buildSession } from "../engine/session";
import { listSessions, loadSession, newSessionId, saveSession, deleteSession, type StoredSession } from "../engine/store";
import { OllamaClient } from "../model/ollama";
import { PAGE } from "./page";

const SESSIONS_DIR = join(process.cwd(), ".caduceus", "sessions");

interface Engine {
  client: OllamaClient;
  registry: Awaited<ReturnType<typeof buildSession>>["registry"];
  systemPrompt: string;
  maxSteps: number;
}

export function createApp(): Hono {
  const app = new Hono();
  const conversations = new Map<string, Conversation>();
  let enginePromise: Promise<Engine> | undefined;
  const stats = { totalRequests: 0, activeConversations: 0, startTime: new Date().toISOString() };

  const getEngine = (): Promise<Engine> => {
    if (!enginePromise) {
      const config = loadConfig();
      const client = new OllamaClient(config);
      enginePromise = buildSession({ cwd: process.cwd(), client }).then((session) => ({
        client,
        registry: session.registry,
        systemPrompt: session.systemPrompt,
        maxSteps: config.maxSteps,
      }));
    }
    return enginePromise;
  };

  app.get("/", (c) => c.html(PAGE));

  app.get("/api/sessions", async (c) => {
    const sessions = await listSessions(SESSIONS_DIR);
    return c.json(sessions.map((s) => ({ id: s.id, updated: s.updated, title: titleOf(s), messages: s.messages.length, created: s.created })));
  });

  app.get("/api/session/:id", async (c) => {
    const session = await loadSession(SESSIONS_DIR, c.req.param("id"));
    if (!session) {
      return c.json({ messages: [] }, 404);
    }
    return c.json({
      id: session.id,
      messages: session.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
    });
  });

  app.delete("/api/session/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await deleteSession(SESSIONS_DIR, id);
    conversations.delete(id);
    return c.json({ success: deleted });
  });

  app.get("/api/models", (c) => {
    return c.json([{ id: process.env.CADUCEUS_MODEL ?? "qwen2.5-coder:14b" }]);
  });

  app.get("/api/stats", () => {
    return new Response(JSON.stringify({
      totalRequests: stats.totalRequests,
      activeConversations: conversations.size,
      uptime: Date.now() - new Date(stats.startTime).getTime(),
      startTime: stats.startTime,
    }), { headers: { "Content-Type": "application/json" } });
  });

  app.get("/api/run", (c) => {
    const task = c.req.query("task")?.trim();
    const sessionId = c.req.query("session")?.trim() || newSessionId();
    if (!task) {
      return c.text("missing ?task", 400);
    }
    stats.totalRequests++;
    return streamSSE(c, async (stream) => {
      const engine = await getEngine();
      let conversation = conversations.get(sessionId);
      if (!conversation) {
        const stored = await loadSession(SESSIONS_DIR, sessionId);
        conversation = new Conversation({
          client: engine.client,
          registry: engine.registry,
          systemPrompt: engine.systemPrompt,
          maxSteps: engine.maxSteps,
          ...(stored ? { messages: stored.messages } : {}),
        });
        conversations.set(sessionId, conversation);
      }
      stats.activeConversations = conversations.size;

      let queue: Promise<unknown> = Promise.resolve();
      const emit = (event: string, data: string): void => {
        queue = queue.then(() => stream.writeSSE({ event, data }));
      };
      emit("session", sessionId);

      try {
        const result = await conversation.send(task, {
          onEvent: (event) => emit(event.type, JSON.stringify(event)),
          onToken: (text) => emit("token", text),
        });
        await queue;
        const now = new Date().toISOString();
        const existing = await loadSession(SESSIONS_DIR, sessionId);
        await saveSession(SESSIONS_DIR, {
          id: sessionId,
          created: existing?.created ?? now,
          updated: now,
          messages: conversation.messages,
        });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            finalText: result.finalText,
            stopReason: result.stopReason,
            steps: result.steps,
            session: sessionId,
          }),
        });
      } catch (error) {
        await queue;
        await stream.writeSSE({
          event: "error",
          data: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  return app;
}

export function startServer(port = Number(process.env.PORT ?? 4100)): number {
  serve({ fetch: createApp().fetch, port });
  return port;
}

function titleOf(session: StoredSession): string {
  const firstUser = session.messages.find((m) => m.role === "user")?.content ?? "(empty)";
  return firstUser.length > 50 ? `${firstUser.slice(0, 49)}…` : firstUser;
}