import type { Message, ToolSpec } from "../types";

export interface ChatOptions {
  tools?: ToolSpec[];
  temperature?: number;
  signal?: AbortSignal;
}

/** Minimal contract the agent loop depends on; keeps the loop provider-agnostic. */
export interface ModelClient {
  chat(messages: Message[], options?: ChatOptions): Promise<Message>;
}
