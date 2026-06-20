export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string;
  /** Present on assistant messages that request tool execution. */
  toolCalls?: ToolCall[];
  /** Links a tool result back to the call that produced it. */
  toolCallId?: string;
  /** Tool name, set on `tool` messages. */
  name?: string;
}

/** A tool as advertised to the model (JSON Schema for arguments). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
