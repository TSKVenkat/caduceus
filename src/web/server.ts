import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadConfig } from "../config";
import { buildSession } from "../engine/session";
import { run } from "../loop/orchestrator";
import { OllamaClient } from "../model/ollama";
import { PAGE } from "./page";

/**
 * A Hermes-style local web server: a single page plus an SSE "run" endpoint that
 * streams the agent's events and tokens to the browser, reusing the same headless
 * engine (buildSession + run) the CLI uses.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html(PAGE));

  app.get("/api/run", (c) => {
    const task = c.req.query("task")?.trim();
    if (!task) {
      return c.text("missing ?task", 400);
    }
    return streamSSE(c, async (stream) => {
      const config = loadConfig();
      const client = new OllamaClient(config);
      const session = await buildSession({ cwd: process.cwd(), client });

      // Serialize writes: onEvent/onToken are synchronous, so chain the async SSE writes.
      let queue: Promise<unknown> = Promise.resolve();
      const emit = (event: string, data: string): void => {
        queue = queue.then(() => stream.writeSSE({ event, data }));
      };

      try {
        const result = await run(task, {
          client,
          registry: session.registry,
          systemPrompt: session.systemPrompt,
          maxSteps: config.maxSteps,
          onEvent: (event) => emit(event.type, JSON.stringify(event)),
          onToken: (text) => emit("token", text),
        });
        await queue;
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            finalText: result.finalText,
            stopReason: result.stopReason,
            steps: result.steps,
          }),
        });
      } catch (error) {
        await queue;
        await stream.writeSSE({
          event: "error",
          data: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await session.close();
      }
    });
  });

  return app;
}

export function startServer(port = Number(process.env.PORT ?? 4100)): number {
  serve({ fetch: createApp().fetch, port });
  return port;
}
