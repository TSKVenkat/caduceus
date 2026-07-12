export interface SessionSource {
  platform: string;
  chatId: string;
  chatName?: string;
  chatType: "dm" | "group" | "channel" | "thread";
  userId?: string;
  userName?: string;
  threadId?: string;
  guildId?: string;
  parentChatId?: string;
  messageId?: string;
  isBot?: boolean;
}

export interface MessageEvent {
  text: string;
  messageType: "text" | "command" | "photo" | "voice" | "document" | "location" | "sticker";
  source: SessionSource;
  rawMessage: unknown;
  messageId?: string;
  mediaUrls?: string[];
  mediaTypes?: string[];
  replyToMessageId?: string;
  replyToText?: string;
  internal?: boolean;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  retryable?: boolean;
}

export interface StoredMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolCalls?: unknown;
  toolCallId?: string;
  timestamp?: string;
}

export interface SessionEntry {
  sessionKey: string;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
  origin?: SessionSource;
  displayName?: string;
  platform?: string;
  chatType?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  wasAutoReset?: boolean;
  autoResetReason?: "idle" | "daily" | "suspended";
  resetHadActivity?: boolean;
  isFreshReset?: boolean;
  suspended?: boolean;
  resumePending?: boolean;
  resumeReason?: string;
  lastResumeMarkedAt?: Date;
}
