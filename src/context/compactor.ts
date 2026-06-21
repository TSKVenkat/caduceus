import type { ModelClient } from "../model/client";
import type { Message } from "../types";
import { estimateMessagesTokens } from "./budget";

const DEFAULT_KEEP_RECENT = 8;

export interface CompactOptions {
  client: ModelClient;
  /** Compact once the estimated history exceeds this many tokens. */
  maxTokens: number;
  /** Approximate number of trailing messages to keep verbatim. */
  keepRecent?: number;
  signal?: AbortSignal;
}

export interface CompactionResult {
  messages: Message[];
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Summarize older turns when the history grows past the budget, preserving the
 * system prompt and task (the stable, cacheable head) and the most recent turns.
 * The cut is snapped to an assistant-message boundary so tool_call/tool_result
 * pairs are never split, which keeps the message list valid for the API.
 */
export async function compactIfNeeded(
  messages: Message[],
  options: CompactOptions,
): Promise<CompactionResult> {
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const tokensBefore = estimateMessagesTokens(messages);
  const unchanged: CompactionResult = {
    messages,
    compacted: false,
    tokensBefore,
    tokensAfter: tokensBefore,
  };

  // Need system + task + something worth summarizing beyond the kept tail.
  if (tokensBefore <= options.maxTokens || messages.length <= keepRecent + 3) {
    return unchanged;
  }

  const head = messages.slice(0, 2); // [system, task]
  let cut = Math.max(2, messages.length - keepRecent);
  while (cut < messages.length && messages[cut]?.role !== "assistant") {
    cut++;
  }
  if (cut >= messages.length) {
    return unchanged; // no clean boundary; leave it alone
  }

  const middle = messages.slice(2, cut);
  if (middle.length === 0) {
    return unchanged;
  }

  const summary = await summarize(middle, options);
  const compacted: Message[] = [
    ...head,
    { role: "user", content: `Summary of earlier work in this task:\n${summary}` },
    ...messages.slice(cut),
  ];

  // Only accept the compaction if it actually shrinks the history; a verbose
  // summary of a short middle can otherwise grow it.
  const tokensAfter = estimateMessagesTokens(compacted);
  if (tokensAfter >= tokensBefore) {
    return unchanged;
  }

  return { messages: compacted, compacted: true, tokensBefore, tokensAfter };
}

async function summarize(messages: Message[], options: CompactOptions): Promise<string> {
  const transcript = messages.map(renderForSummary).join("\n");
  const reply = await options.client.chat(
    [
      {
        role: "system",
        content:
          "You compress an autonomous coding agent's working history. Produce a concise summary of what was attempted, key findings and file contents, decisions made, and the current state, so the agent can continue without the full transcript. Use terse bullet points and keep concrete identifiers (paths, names, errors).",
      },
      { role: "user", content: transcript },
    ],
    { temperature: 0, ...(options.signal ? { signal: options.signal } : {}) },
  );
  return reply.content.trim();
}

function renderForSummary(message: Message): string {
  const calls = message.toolCalls?.length
    ? ` calls=${message.toolCalls.map((call) => call.name).join(",")}`
    : "";
  const label = message.name ? `${message.role}:${message.name}` : message.role;
  return `[${label}${calls}] ${message.content}`.trim();
}
