import type { Message } from "../types";

/**
 * Cheap, model-agnostic token estimate. We don't have the served model's
 * tokenizer, so we approximate with a conservative chars-per-token ratio. This
 * is only used to decide *when* to compact, not for billing, so an estimate is
 * sufficient.
 */
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: Message): number {
  let chars = message.content.length;
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      chars += call.name.length + JSON.stringify(call.arguments).length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD;
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}
