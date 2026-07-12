import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import yaml from "yaml";
import { z } from "zod";

const homeDir = process.env.CADUCEUS_HOME ?? join(homedir(), ".caduceus");

export const SessionResetPolicySchema = z.object({
  mode: z.enum(["daily", "idle", "both", "none"]).default("both"),
  atHour: z.number().int().min(0).max(23).default(4),
  idleMinutes: z.number().int().positive().default(1440),
  notify: z.boolean().default(true),
  notifyExcludePlatforms: z.array(z.string()).default(["api_server", "webhook"]),
});
export type SessionResetPolicy = z.infer<typeof SessionResetPolicySchema>;

export const StreamingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  editInterval: z.number().positive().default(1.0),
  bufferThreshold: z.number().int().nonnegative().default(40),
  cursor: z.string().default(" ▉"),
  freshFinalAfterSeconds: z.number().nonnegative().default(0),
});
export type StreamingConfig = z.infer<typeof StreamingConfigSchema>;

export const SlackPlatformConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().default(""),
  appToken: z.string().default(""),
  allowedUsers: z.array(z.string()).optional(),
  allowAllUsers: z.boolean().default(false),
  requireMention: z.boolean().default(true),
  strictMention: z.boolean().default(false),
  freeResponseChannels: z.array(z.string()).default([]),
  reactions: z.boolean().default(true),
  replyBroadcast: z.boolean().default(false),
  replyInThread: z.boolean().default(true),
  mentionPatterns: z.array(z.string()).default([]),
  cacheDir: z.string().default(join(homeDir, "cache", "slack")),
});
export type SlackPlatformConfig = z.infer<typeof SlackPlatformConfigSchema>;

export const WhatsAppPlatformConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["bot", "self-chat"]).default("bot"),
  allowedUsers: z.array(z.string()).optional(),
  allowAllUsers: z.boolean().default(false),
  requireMention: z.boolean().default(false),
  replyPrefix: z.string().default(""),
  dmPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
  cacheDir: z.string().default(join(homeDir, "cache", "whatsapp")),
});
export type WhatsAppPlatformConfig = z.infer<typeof WhatsAppPlatformConfigSchema>;

export const GatewayConfigSchema = z.object({
  model: z.string().default("qwen2.5-coder:14b"),
  baseUrl: z.string().default("https://api.ollama.com"),
  maxTurns: z.number().int().positive().default(90),
  apiMaxRetries: z.number().int().nonnegative().default(2),
  sessionReset: SessionResetPolicySchema.default({}),
  groupSessionsPerUser: z.boolean().default(true),
  threadSessionsPerUser: z.boolean().default(false),
  streaming: StreamingConfigSchema.default({}),
  platforms: z
    .object({
      slack: SlackPlatformConfigSchema.optional(),
      whatsapp: WhatsAppPlatformConfigSchema.optional(),
    })
    .default({}),
  unauthorizedDmBehavior: z.enum(["pair", "ignore"]).default("pair"),
  allowAllUsers: z.boolean().default(false),
  allowedUsers: z.array(z.string()).optional(),
});
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function defaultGatewayConfig(): GatewayConfig {
  return GatewayConfigSchema.parse({});
}

export async function loadGatewayConfig(): Promise<GatewayConfig> {
  const configPath = join(homeDir, "config.yaml");
  let fileData: Record<string, unknown> = {};

  try {
    const content = await readFile(configPath, "utf-8");
    fileData = (yaml.parse(content) ?? {}) as Record<string, unknown>;
  } catch {
    // No config file — fall through to defaults + env
  }

  const merged = deepMerge(fileData, envOverrides());

  const parsed = GatewayConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Invalid gateway config: ${parsed.error.message}`);
  }
  return parsed.data;
}

function envOverrides(): Record<string, unknown> {
  const env: Record<string, unknown> = {};

  if (process.env.GATEWAY_ALLOW_ALL_USERS) {
    env.allowAllUsers = process.env.GATEWAY_ALLOW_ALL_USERS === "true";
  }

  if (process.env.SLACK_BOT_TOKEN) {
    const platforms = (env.platforms ?? {}) as Record<string, Record<string, unknown>>;
    platforms.slack = {
      enabled: true,
      botToken: process.env.SLACK_BOT_TOKEN,
      appToken: process.env.SLACK_APP_TOKEN ?? "",
      ...(process.env.SLACK_ALLOWED_USERS
        ? { allowedUsers: process.env.SLACK_ALLOWED_USERS.split(",").map((s) => s.trim()) }
        : {}),
      ...(process.env.SLACK_ALLOW_ALL_USERS
        ? { allowAllUsers: process.env.SLACK_ALLOW_ALL_USERS === "true" }
        : {}),
    };
    env.platforms = platforms;
  }

  if (process.env.WHATSAPP_ENABLED === "true") {
    const platforms = (env.platforms ?? {}) as Record<string, Record<string, unknown>>;
    platforms.whatsapp = {
      enabled: true,
      ...(process.env.WHATSAPP_ALLOWED_USERS
        ? { allowedUsers: process.env.WHATSAPP_ALLOWED_USERS.split(",").map((s) => s.trim()) }
        : {}),
      ...(process.env.WHATSAPP_ALLOW_ALL_USERS
        ? { allowAllUsers: process.env.WHATSAPP_ALLOW_ALL_USERS === "true" }
        : {}),
      ...(process.env.WHATSAPP_MODE ? { mode: process.env.WHATSAPP_MODE } : {}),
    };
    env.platforms = platforms;
  }

  return env;
}

function deepMerge(target: unknown, source: unknown): Record<string, unknown> {
  if (source === null || source === undefined) return (target ?? {}) as Record<string, unknown>;
  if (typeof source !== "object" || Array.isArray(source)) return source as Record<string, unknown>;

  const result: Record<string, unknown> = { ...((target as Record<string, unknown>) ?? {}) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const srcVal = (source as Record<string, unknown>)[key];
    const tgtVal = result[key];
    if (srcVal && typeof srcVal === "object" && !Array.isArray(srcVal) && tgtVal && typeof tgtVal === "object") {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
