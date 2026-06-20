import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface ToolContext {
  /** Working directory tool actions resolve against. */
  cwd: string;
  signal?: AbortSignal;
}

/** Thrown when tool arguments fail schema validation; surfaced to the model as feedback. */
export class ToolArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgsError";
  }
}

/**
 * A registered tool. Arguments are validated at the boundary so the rest of the
 * system never handles untyped input and the registry can stay generic-free.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(rawArgs: unknown, ctx: ToolContext): Promise<string>;
}

export interface ToolDefinition<Args> {
  name: string;
  description: string;
  schema: z.ZodType<Args>;
  execute(args: Args, ctx: ToolContext): Promise<string>;
}

/** Build a type-erased {@link Tool} from a typed definition, validating on each call. */
export function defineTool<Args>(definition: ToolDefinition<Args>): Tool {
  const parameters = zodToJsonSchema(definition.schema, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;

  return {
    name: definition.name,
    description: definition.description,
    parameters,
    async run(rawArgs, ctx) {
      const result = definition.schema.safeParse(rawArgs);
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new ToolArgsError(detail);
      }
      return definition.execute(result.data, ctx);
    },
  };
}
