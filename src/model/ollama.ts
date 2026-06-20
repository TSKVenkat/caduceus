import type { Message, ToolCall, ToolSpec } from "../types";
import type { ChatOptions, ModelClient } from "./client";

export interface OllamaClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
}

/** Client for Ollama Cloud's OpenAI-compatible chat completions endpoint. */
export class OllamaClient implements ModelClient {
  constructor(private readonly config: OllamaClientConfig) {}

  async chat(messages: Message[], options: ChatOptions = {}): Promise<Message> {
    const tools = options.tools ?? [];
    const body: ChatCompletionRequest = {
      model: this.config.model,
      messages: messages.map(toApiMessage),
      temperature: options.temperature ?? this.config.temperature ?? 0,
      stream: false,
      ...(tools.length > 0 ? { tools: tools.map(toApiTool) } : {}),
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("Ollama response contained no choices");
    }
    return fromApiMessage(choice.message);
  }
}

interface ApiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ApiMessage {
  role: string;
  content?: string | null;
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}

interface ApiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface ChatCompletionRequest {
  model: string;
  messages: ApiMessage[];
  temperature: number;
  stream: false;
  tools?: ApiTool[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message: ApiMessage }>;
}

function toApiMessage(message: Message): ApiMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

function toApiTool(spec: ToolSpec): ApiTool {
  return {
    type: "function",
    function: { name: spec.name, description: spec.description, parameters: spec.parameters },
  };
}

function fromApiMessage(message: ApiMessage): Message {
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: parseArguments(call.function.arguments),
  }));

  return {
    role: "assistant",
    content: message.content ?? "",
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
