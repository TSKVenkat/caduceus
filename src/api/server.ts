import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadConfig } from "../config.js";
import { Conversation } from "../engine/conversation.js";
import { buildSession } from "../engine/session.js";
import { OllamaClient } from "../model/ollama.js";
import type { Message } from "../types.js";

export interface ApiServerOptions {
  port?: number;
  host?: string;
  key?: string;
}

export function createApiApp(opts: ApiServerOptions = {}): Hono {
  const app = new Hono();
  let enginePromise: Promise<{ client: OllamaClient; registry: Awaited<ReturnType<typeof buildSession>>["registry"]; systemPrompt: string }> | undefined;

  const getEngine = () => {
    if (!enginePromise) {
      const config = loadConfig();
      const client = new OllamaClient(config);
      enginePromise = buildSession({ cwd: process.cwd(), client }).then((s) => ({
        client,
        registry: s.registry,
        systemPrompt: s.systemPrompt,
      }));
    }
    return enginePromise;
  };

  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    const isLoopback = host.startsWith("127.0.0.1") || host.startsWith("localhost");
    if (isLoopback && !opts.key) return next();

    const auth = c.req.header("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: { message: "Missing Authorization header", type: "invalid_request_error" } }, 401);
    }
    const token = auth.slice(7);
    if (opts.key && token !== opts.key) {
      return c.json({ error: { message: "Invalid API key", type: "invalid_request_error" } }, 401);
    }
    return next();
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/v1/models", (c) => {
    const config = loadConfig();
    return c.json({
      object: "list",
      data: [{ id: config.model, object: "model", owned_by: "caduceus" }],
    });
  });

  app.post("/v1/chat/completions", async (c) => {
    const body = await c.req.json<{
      model?: string;
      messages: Array<{ role: string; content: string }>;
      stream?: boolean;
    }>();

    const userMessages: Message[] = body.messages.map((m) => ({
      role: m.role as Message["role"],
      content: m.content,
    }));

    const lastUser = body.messages.filter((m) => m.role === "user").pop();
    if (!lastUser) {
      return c.json({ error: { message: "No user message", type: "invalid_request_error" } }, 400);
    }

    const engine = await getEngine();
    const conversation = new Conversation({
      client: engine.client,
      registry: engine.registry,
      systemPrompt: engine.systemPrompt,
      messages: userMessages.length > 1 ? userMessages.slice(0, -1) : undefined,
    });

    if (body.stream) {
      return streamSSE(c, async (stream) => {
        const result = await conversation.send(lastUser.content, {
          onToken: (text) => {
            stream.writeSSE({
              data: JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: body.model ?? "caduceus",
                choices: [{ index: 0, delta: { content: text } }],
              }),
            });
          },
        });
        void result;
        stream.writeSSE({ data: "[DONE]" });
      });
    }

    const result = await conversation.send(lastUser.content);

    return c.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? "caduceus",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.finalText },
          finish_reason: result.stopReason === "done" ? "stop" : "length",
        },
      ],
    });
  });

  return app;
}

export function startApiServer(opts: ApiServerOptions = {}): number {
  const port = opts.port ?? Number(process.env.API_SERVER_PORT ?? 8642);
  const host = opts.host ?? process.env.API_SERVER_HOST ?? "127.0.0.1";
  const key = opts.key ?? process.env.API_SERVER_KEY;
  serve({ fetch: createApiApp({ port, host, key }).fetch, hostname: host, port });
  console.log(`API server listening on http://${host}:${port}`);
  return port;
}
