import type { MessageEvent, SessionSource, SendResult } from "../types.js";

export type MessageHandler = (event: MessageEvent) => Promise<void>;

export type ApprovalChoice = "once" | "session" | "always" | "deny";

export interface ApprovalPending {
  command: string;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

const CONTROL_COMMANDS = ["/stop", "/new", "/reset", "/queue", "/steer", "/approve", "/deny", "/status"];

export function isControlCommand(text: string): boolean {
  const trimmed = text.trim();
  return CONTROL_COMMANDS.some((cmd) => trimmed.startsWith(cmd));
}

export function buildSessionKey(
  source: SessionSource,
  groupSessionsPerUser = true,
  threadSessionsPerUser = false,
): string {
  const parts = ["agent", "main", source.platform, source.chatType, source.chatId];

  if (source.chatType === "dm") {
    if (source.threadId) parts.push(source.threadId);
  } else {
    if (source.threadId) parts.push(source.threadId);
    if (groupSessionsPerUser && !source.threadId && source.userId) {
      parts.push(source.userId);
    } else if (threadSessionsPerUser && source.threadId && source.userId) {
      parts.push(source.userId);
    }
  }

  return parts.join(":");
}

export abstract class BasePlatformAdapter {
  protected _activeSessions = new Map<string, AbortController>();
  protected _pendingMessages = new Map<string, MessageEvent>();
  protected _messageHandler?: MessageHandler;
  protected _approvals = new Map<string, ApprovalPending>();

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract send(chatId: string, content: string, opts?: { replyTo?: string; threadId?: string }): Promise<SendResult>;
  abstract sendApprovalRequest(chatId: string, command: string, sessionKey: string): Promise<void>;

  async editMessage(_chatId: string, _messageId: string, _content: string): Promise<SendResult> {
    return { success: false, error: "editMessage not supported" };
  }

  async deleteMessage(_chatId: string, _messageId: string): Promise<boolean> {
    return false;
  }

  async sendTyping(_chatId: string): Promise<void> {}

  async sendImage(chatId: string, filepath: string, opts?: { caption?: string }): Promise<SendResult> {
    return this.send(chatId, `[Image: ${opts?.caption ?? filepath}]`);
  }

  async sendVoice(chatId: string, filepath: string, opts?: { caption?: string }): Promise<SendResult> {
    return this.send(chatId, `[Voice: ${opts?.caption ?? filepath}]`);
  }

  async sendDocument(chatId: string, filepath: string, opts?: { fileName?: string }): Promise<SendResult> {
    return this.send(chatId, `[Document: ${opts?.fileName ?? filepath}]`);
  }

  setMessageHandler(handler: MessageHandler): void {
    this._messageHandler = handler;
  }

  resolveApproval(sessionKey: string, choice: ApprovalChoice): void {
    const pending = this._approvals.get(sessionKey);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._approvals.delete(sessionKey);
    pending.resolve(choice !== "deny");
  }

  requestApproval(sessionKey: string, command: string, timeoutMs = 60_000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this._approvals.delete(sessionKey);
        resolve(false);
      }, timeoutMs);

      this._approvals.set(sessionKey, { command, resolve, timer });
    });
  }

  async handleMessage(event: MessageEvent): Promise<void> {
    const sessionKey = buildSessionKey(event.source);

    if (this._activeSessions.has(sessionKey)) {
      if (isControlCommand(event.text)) {
        await this._dispatch(event);
        return;
      }
      this._pendingMessages.set(sessionKey, event);
      const controller = this._activeSessions.get(sessionKey);
      controller?.abort();
      return;
    }

    await this._dispatch(event);
  }

  claimSession(sessionKey: string): AbortController {
    const controller = new AbortController();
    this._activeSessions.set(sessionKey, controller);
    return controller;
  }

  releaseSession(sessionKey: string): void {
    this._activeSessions.delete(sessionKey);
  }

  getPendingMessage(sessionKey: string): MessageEvent | undefined {
    return this._pendingMessages.get(sessionKey);
  }

  clearPendingMessage(sessionKey: string): void {
    this._pendingMessages.delete(sessionKey);
  }

  get connectedPlatforms(): string[] {
    return [];
  }

  protected async _dispatch(event: MessageEvent): Promise<void> {
    if (this._messageHandler) {
      await this._messageHandler(event);
    }
  }
}
