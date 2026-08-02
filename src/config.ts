import { z } from "zod";

const configSchema = z.object({
  apiKey: z.string().min(1, "OLLAMA_API_KEY is required"),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  maxSteps: z.number().int().positive(),
  temperature: z.number().min(0),
  retries: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  fallbackModel: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

const DEFAULTS = {
  baseUrl: "https://ollama.com/v1",
  model: "qwen3.5:397b",
  maxSteps: 20,
  temperature: 0,
  retries: 3,
  timeoutMs: 120_000,
} as const;

/** Resolve configuration from the environment, applying explicit overrides last. */
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const result = configSchema.safeParse({
    apiKey: env.OLLAMA_API_KEY ?? "",
    baseUrl: env.OLLAMA_BASE_URL ?? DEFAULTS.baseUrl,
    model: env.CADUCEUS_MODEL ?? DEFAULTS.model,
    maxSteps: env.CADUCEUS_MAX_STEPS ? Number(env.CADUCEUS_MAX_STEPS) : DEFAULTS.maxSteps,
    temperature: env.CADUCEUS_TEMPERATURE ? Number(env.CADUCEUS_TEMPERATURE) : DEFAULTS.temperature,
    retries: env.CADUCEUS_RETRIES ? Number(env.CADUCEUS_RETRIES) : DEFAULTS.retries,
    timeoutMs: env.CADUCEUS_TIMEOUT_MS ? Number(env.CADUCEUS_TIMEOUT_MS) : DEFAULTS.timeoutMs,
    ...(env.CADUCEUS_FALLBACK_MODEL ? { fallbackModel: env.CADUCEUS_FALLBACK_MODEL } : {}),
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
