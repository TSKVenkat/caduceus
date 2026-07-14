import { createHmac, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { renderTemplate, resolvePath } from "./template.js";

export interface WebhookRoute {
  events?: string[];
  secret?: string;
  prompt?: string;
  skills?: string[];
  deliver?: string;
  deliverExtra?: Record<string, string>;
}

export interface WebhookConfig {
  port: number;
  secret?: string;
  routes: Record<string, WebhookRoute>;
}

type WebhookHandler = (prompt: string, route: WebhookRoute) => Promise<string>;

export function createWebhookApp(config: WebhookConfig, handler: WebhookHandler): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", platform: "webhook" }));

  app.post("/webhook/:route", async (c) => {
    const routeName = c.req.param("route");
    const route = config.routes[routeName];

    if (!route) {
      return c.json({ error: "Unknown route" }, 404);
    }

    const body = await c.req.text();
    const secret = route.secret ?? config.secret;
    const signature = c.req.header("x-hub-signature-256") ?? c.req.header("x-webhook-signature") ?? c.req.header("x-gitlab-token");

    if (secret && !validateSig(body, signature, secret)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const eventType = c.req.header("x-github-event") ?? (payload.event_type as string);
    if (route.events && eventType && !route.events.includes(eventType)) {
      return c.json({ status: "ignored", reason: "event not subscribed" });
    }

    const prompt = route.prompt
      ? renderTemplate(route.prompt, payload)
      : JSON.stringify(payload, null, 2).slice(0, 4000);

    try {
      const result = await handler(prompt, route);
      return c.json({ success: true, result: result.slice(0, 1000) });
    } catch (err) {
      return c.json({ error: "Handler failed", detail: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return app;
}

export function startWebhookServer(config: WebhookConfig, handler: WebhookHandler): number {
  serve({ fetch: createWebhookApp(config, handler).fetch, port: config.port });
  console.log(`Webhook server listening on port ${config.port}`);
  return config.port;
}

function validateSig(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  if (secret === "INSECURE_NO_AUTH") return true;

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  if (signature.startsWith("sha256=")) {
    return safeEqual(signature.slice(7), expected);
  }

  if (signature === secret) {
    return true;
  }

  return safeEqual(signature, expected);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export { renderTemplate, resolvePath };
