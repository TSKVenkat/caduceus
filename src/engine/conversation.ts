import { runTurn, type RunOptions, type RunResult } from "../loop/orchestrator";
import type { ModelClient } from "../model/client";
import type { ToolRegistry } from "../tools/registry";
import type { Message } from "../types";

export interface ConversationOptions {
  client: ModelClient;
  registry: ToolRegistry;
  systemPrompt: string;
  /** Resume from a prior history (should begin with the system message). */
  messages?: Message[];
  maxSteps?: number;
  cwd?: string;
  /** Session-wide approval gate for risky tool actions. */
  confirm?: RunOptions["confirm"];
}

/** Per-turn knobs forwarded to the loop (events, streaming, cancellation, compression). */
export type TurnOptions = Pick<
  RunOptions,
  "onEvent" | "onToken" | "signal" | "compressor" | "compressMinChars" | "compressRate"
>;

/**
 * A multi-turn conversation. Holds the message history (seeded once with the
 * stable system prompt) and runs one bounded turn per {@link send}, keeping the
 * history — and the cache-friendly stable prefix — across turns.
 */
export class Conversation {
  readonly messages: Message[];

  constructor(private readonly options: ConversationOptions) {
    this.messages =
      options.messages && options.messages.length > 0
        ? [...options.messages]
        : [{ role: "system", content: options.systemPrompt }];
  }

  async send(userText: string, turn: TurnOptions = {}): Promise<RunResult> {
    this.messages.push({ role: "user", content: userText });
    return runTurn(this.messages, {
      client: this.options.client,
      registry: this.options.registry,
      maxSteps: this.options.maxSteps,
      cwd: this.options.cwd,
      ...(this.options.confirm ? { confirm: this.options.confirm } : {}),
      ...turn,
    });
  }
}
