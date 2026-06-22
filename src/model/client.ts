import type { Message, ToolSpec } from "../types";

export interface ChatOptions {
  tools?: ToolSpec[];
  temperature?: number;
  signal?: AbortSignal;
  /** When set, the client streams and invokes this with each text delta. */
  onToken?: (text: string) => void;
}

/** Minimal contract the agent loop depends on; keeps the loop provider-agnostic. */
export interface ModelClient {
  chat(messages: Message[], options?: ChatOptions): Promise<Message>;
}
