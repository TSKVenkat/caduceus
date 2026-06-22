import type { Message, ToolCall, ToolSpec } from "../types";
import type { ChatOptions, ModelClient } from "./client";

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OllamaClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  /** Called with token usage after each response that reports it. */
  onUsage?: (usage: Usage) => void;
}

/** Client for Ollama Cloud's OpenAI-compatible chat completions endpoint. */
export class OllamaClient implements ModelClient {
  constructor(private readonly config: OllamaClientConfig) {}

  async chat(messages: Message[], options: ChatOptions = {}): Promise<Message> {
    const tools = options.tools ?? [];
    const stream = Boolean(options.onToken);
    const body: ChatCompletionRequest = {
      model: this.config.model,
      messages: messages.map(toApiMessage),
      temperature: options.temperature ?? this.config.temperature ?? 0,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
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

    if (stream && options.onToken) {
      return this.readStream(response, options.onToken);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("Ollama response contained no choices");
    }
    this.emitUsage(data.usage);
    return fromApiMessage(choice.message);
  }

  private async readStream(response: Response, onToken: (text: string) => void): Promise<Message> {
    if (!response.body) {
      throw new Error("Ollama streaming response had no body");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const calls: Array<{ id: string; name: string; arguments: string }> = [];
    let usage: ChatCompletionResponse["usage"];

    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "" || payload === "[DONE]") {
          continue;
        }
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          continue;
        }
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          onToken(delta.content);
        }
        for (const call of delta?.tool_calls ?? []) {
          const slot = (calls[call.index ?? 0] ??= { id: "", name: "", arguments: "" });
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name = call.function.name;
          if (call.function?.arguments) slot.arguments += call.function.arguments;
        }
        if (chunk.usage) {
          usage = chunk.usage;
        }
      }
    }

    this.emitUsage(usage);
    const toolCalls: ToolCall[] = calls
      .filter((call) => call.name)
      .map((call) => ({ id: call.id, name: call.name, arguments: parseArguments(call.arguments) }));
    return { role: "assistant", content, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
  }

  private emitUsage(usage: ChatCompletionResponse["usage"]): void {
    if (!this.config.onUsage || !usage) {
      return;
    }
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    this.config.onUsage({
      promptTokens,
      completionTokens,
      totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
    });
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
  stream: boolean;
  stream_options?: { include_usage: boolean };
  tools?: ApiTool[];
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface ChatCompletionResponse {
  choices?: Array<{ message: ApiMessage }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
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
