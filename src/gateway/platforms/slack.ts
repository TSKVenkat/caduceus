import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import type { SlackPlatformConfig } from "../config.js";
import type { MessageEvent, SendResult, SessionSource } from "../types.js";
import { BasePlatformAdapter } from "./base.js";
import { markdownToMrkdwn, chunkText } from "./slack-format.js";

const CHUNK_LIMIT = 39_000;

interface SlackAppInterface {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  event(type: string, handler: (args: unknown) => Promise<void>): void;
  action(id: string | RegExp, handler: (args: unknown) => Promise<void>): void;
  client: {
    auth?: { test?: () => Promise<{ user_id?: string }> };
    chat: {
      postMessage: (args: unknown) => Promise<{ ts?: string }>;
      update: (args: unknown) => Promise<unknown>;
    };
    files?: { info: (args: unknown) => Promise<unknown> };
  };
}

interface ApprovalActionPayload {
  sessionKey: string;
  choice: "once" | "session" | "always" | "deny";
}

function parseApprovalValue(value: string): ApprovalActionPayload | null {
  const [sessionKey, choice] = value.split(":");
  if (!sessionKey || !choice) return null;
  if (!["once", "session", "always", "deny"].includes(choice)) return null;
  return { sessionKey, choice: choice as ApprovalActionPayload["choice"] };
}

export class SlackAdapter extends BasePlatformAdapter {
  private _config: SlackPlatformConfig;
  private _botUserId = "";
  private _app: SlackAppInterface | null = null;  private _messageSeen = new Set<string>();
  private _cacheDir: string;

  constructor(config: SlackPlatformConfig) {
    super();
    this._config = config;
    this._cacheDir = config.cacheDir;
  }

  override get connectedPlatforms(): string[] {
    return ["slack"];
  }

  async connect(): Promise<boolean> {
    if (!this._config.botToken || !this._config.appToken) return false;

    try {
      const { App } = await import("@slack/bolt");
      const app = new App({
        token: this._config.botToken,
        appToken: this._config.appToken,
        socketMode: true,
      }) as unknown as SlackAppInterface;
      this._app = app;

      const auth = await app.client.auth?.test?.();
      if (auth?.user_id) this._botUserId = auth.user_id;

      this._registerHandlers(app);
      await app.start();
      return true;
    } catch (err) {
      console.error("Slack connect failed:", err);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this._app?.stop();
    this._app = null;
  }

  async send(chatId: string, content: string, opts?: { replyTo?: string; threadId?: string }): Promise<SendResult> {
    if (!this._app?.client) return { success: false, error: "Not connected" };

    const formatted = markdownToMrkdwn(content);
    const chunks = chunkText(formatted, CHUNK_LIMIT);
    let firstTs: string | undefined;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const result = await this._app.client.chat.postMessage({
          channel: chatId,
          text: chunks[i],
          thread_ts: opts?.threadId,
          reply_broadcast: i === 0 && opts?.threadId ? false : undefined,
          mrkdwn: true,
          unfurl_media: false,
        });
        if (i === 0 && result.ts) firstTs = result.ts;
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: true, messageId: firstTs };
  }

  override async editMessage(chatId: string, messageId: string, content: string): Promise<SendResult> {
    if (!this._app?.client) return { success: false, error: "Not connected" };

    try {
      await this._app.client.chat.update({
        channel: chatId,
        ts: messageId,
        text: markdownToMrkdwn(content),
      });
      return { success: true, messageId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  }

  async sendApprovalRequest(chatId: string, command: string, sessionKey: string, threadId?: string): Promise<void> {
    if (!this._app?.client) return;

    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Approval needed*\n\`\`\`\n${command}\n\`\`\`` },
      },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Approve" }, action_id: "cad_approve_once", value: `${sessionKey}:once`, style: "primary" },
          { type: "button", text: { type: "plain_text", text: "Approve session" }, action_id: "cad_approve_session", value: `${sessionKey}:session` },
          { type: "button", text: { type: "plain_text", text: "Deny" }, action_id: "cad_deny", value: `${sessionKey}:deny`, style: "danger" },
        ],
      },
    ];

    try {
      await this._app.client.chat.postMessage({
        channel: chatId,
        thread_ts: threadId,
        blocks,
        text: `Approval needed: ${command}`,
        mrkdwn: true,
      });
    } catch {
      // best-effort
    }
  }

  async downloadFile(fileId: string, mimetype: string): Promise<string | null> {
    if (!this._app?.client) return null;

    try {
      const info = await this._app.client.files?.info({ file: fileId });
      const url = (info as { file?: { url_private_download?: string } }).file?.url_private_download;
      if (!url) return null;

      const resp = await fetch(url, { headers: { Authorization: `Bearer ${this._config.botToken}` } });
      if (!resp.ok) return null;

      const buffer = Buffer.from(await resp.arrayBuffer());
      const ext = mimetype.split("/")[1]?.split(";")[0] ?? "bin";
      const filename = `${fileId}.${ext}`;
      await mkdir(this._cacheDir, { recursive: true });
      const filepath = join(this._cacheDir, filename);
      await writeFile(filepath, buffer);
      return filepath;
    } catch {
      return null;
    }
  }

  private _registerHandlers(app: SlackAppInterface): void {
    app.event("message", async (args) => { await this._onMessage(args); });
    app.event("app_mention", async (args) => { await this._onMessage(args); });
    app.action(/^cad_/, (args) => this._onApprovalAction(args));
  }

  private async _onMessage(args: unknown): Promise<void> {
    const { event } = args as { event: Record<string, unknown> };

    if (this._messageSeen.has(String(event.ts ?? ""))) return;
    this._messageSeen.add(String(event.ts ?? ""));

    if (event.bot_id || event.subtype === "bot_message") return;
    if (event.user === this._botUserId) return;

    const text = this._extractText(event);
    if (!text.trim()) return;

    const source = this._deriveSource(event);
    if (!source) return;

    if (!this._shouldProcessChannel(source, text, event)) return;

    const stripped = text.replace(new RegExp(`<@${this._botUserId}>`, "g"), "").trim();

    const gatewayEvent: MessageEvent = {
      text: stripped,
      messageType: "text",
      source,
      rawMessage: event,
      messageId: String(event.ts ?? ""),
    };

    if (event.files && Array.isArray(event.files)) {
      gatewayEvent.mediaUrls = [];
      gatewayEvent.mediaTypes = [];
    }

    await this.handleMessage(gatewayEvent);
  }

  private _extractText(event: Record<string, unknown>): string {
    return String(event.text ?? "");
  }

  private _deriveSource(event: Record<string, unknown>): SessionSource | null {
    const channel = String(event.channel ?? "");
    const channelType = String(event.channel_type ?? "");
    const isDm = channelType === "im" || channel.startsWith("D");
    const threadTs = event.thread_ts
      ? String(event.thread_ts)
      : String(event.ts ?? "");

    return {
      platform: "slack",
      chatId: channel,
      chatType: isDm ? "dm" : "group",
      userId: event.user ? String(event.user) : undefined,
      threadId: threadTs,
      messageId: String(event.ts ?? ""),
    };
  }

  private _shouldProcessChannel(source: SessionSource, text: string, event: Record<string, unknown>): boolean {
    if (source.chatType === "dm") return true;
    if (!this._config.requireMention) return true;
    if (this._config.freeResponseChannels.includes(source.chatId)) return true;
    if (text.includes(`<@${this._botUserId}>`)) return true;
    if (event.thread_ts) return true;
    return false;
  }

  private async _onApprovalAction(args: unknown): Promise<void> {
    const { ack, action, body, respond } = args as {
      ack: () => Promise<void>;
      action: { value: string };
      body: { user?: { id: string; name?: string }; channel?: { id: string }; message?: { ts: string }; response_url?: string };
      respond?: (response: { text: string; replace_original?: boolean }) => Promise<void>;
    };

    await ack();

    const parsed = parseApprovalValue(action.value);
    if (!parsed) return;

    if (this._config.allowedUsers && body.user?.id && !this._config.allowedUsers.includes(body.user.id)) {
      if (!this._config.allowAllUsers) return;
    }

    this.resolveApproval(parsed.sessionKey, parsed.choice);

    const label = parsed.choice === "deny" ? "Denied" : `Approved (${parsed.choice})`;
    const userName = body.user?.name ?? body.user?.id ?? "Unknown";

    if (respond && body.response_url) {
      try {
        await respond({ text: `*${label}* by ${userName}`, replace_original: true });
      } catch {
        // best-effort
      }
    } else if (body.channel?.id && body.message?.ts && this._app?.client) {
      try {
        await this._app.client.chat.update({
          channel: body.channel.id,
          ts: body.message.ts,
          text: `${label} by ${userName}`,
          blocks: [],
        });
      } catch {
        // best-effort
      }
    }
  }
}
