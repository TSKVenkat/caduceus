import { z } from "zod";

const configSchema = z.object({
  apiKey: z.string().min(1, "OLLAMA_API_KEY is required"),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  maxSteps: z.number().int().positive(),
  maxContextTokens: z.number().int().positive(),
  keepRecent: z.number().int().positive(),
  temperature: z.number().min(0),
});

export type Config = z.infer<typeof configSchema>;

const DEFAULTS = {
  baseUrl: "https://ollama.com/v1",
  model: "qwen3-coder:480b-cloud",
  maxSteps: 20,
  maxContextTokens: 32_000,
  keepRecent: 8,
  temperature: 0,
} as const;

/** Resolve configuration from the environment, applying explicit overrides last. */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const result = configSchema.safeParse({
    apiKey: env.OLLAMA_API_KEY ?? "",
    baseUrl: env.OLLAMA_BASE_URL ?? DEFAULTS.baseUrl,
    model: env.CADUCEUS_MODEL ?? DEFAULTS.model,
    maxSteps: env.CADUCEUS_MAX_STEPS ? Number(env.CADUCEUS_MAX_STEPS) : DEFAULTS.maxSteps,
    maxContextTokens: env.CADUCEUS_MAX_CONTEXT_TOKENS
      ? Number(env.CADUCEUS_MAX_CONTEXT_TOKENS)
      : DEFAULTS.maxContextTokens,
    keepRecent: env.CADUCEUS_KEEP_RECENT ? Number(env.CADUCEUS_KEEP_RECENT) : DEFAULTS.keepRecent,
    temperature: env.CADUCEUS_TEMPERATURE ? Number(env.CADUCEUS_TEMPERATURE) : DEFAULTS.temperature,
    ...overrides,
  });

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration — ${detail}`);
  }

  return result.data;
}
