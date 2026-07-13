import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { WhatsAppPlatformConfig } from "../config.js";
import type { MessageEvent, SendResult, SessionSource } from "../types.js";
import { BasePlatformAdapter } from "./base.js";
import {
  isGroupJid,
  canonicalizeIdentifier,
  loadLidMappings,
  getExtensionFromMimeType,
} from "./whatsapp-lid.js";

const CHUNK_LIMIT = 4096;
const CHUNK_DELAY_MS = 300;
const SMALL_TEXT_EXTS = [".md", ".txt", ".csv", ".json", ".yaml", ".yml"];
const SMALL_TEXT_MAX_BYTES = 100 * 1024;

interface BaileysSock {
  user?: { id?: string };
  ev: EventEmitter;
  sendMessage: (jid: string, content: unknown, opts?: unknown) => Promise<{ key: { id?: string } }>;
  sendPresenceUpdate: (type: string, jid?: string) => Promise<unknown>;
  logout?: () => Promise<unknown>;
  destroy?: () => Promise<void>;
}

export class WhatsAppAdapter extends BasePlatformAdapter {
  private _config: WhatsAppPlatformConfig;
  private _sock: BaileysSock | null = null;
  private _sessionPath: string;
  private _cacheDir: string;
  private _recentlySent = new Set<string>();
  private _reconnecting = false;
  private _events = new EventEmitter();

  constructor(config: WhatsAppPlatformConfig) {
    super();
    this._config = config;
    const home = process.env.CADUCEUS_HOME ?? join(homedir(), ".caduceus");
    this._sessionPath = join(home, "whatsapp", "session");
    this._cacheDir = config.cacheDir;
  }

  override get connectedPlatforms(): string[] {
    return ["whatsapp"];
  }

  on(event: "connected" | "qr" | "disconnected", listener: (...args: unknown[]) => void): this {
    this._events.on(event, listener);
    return this;
  }

  async connect(): Promise<boolean> {
    try {
      const baileys = await import("@whiskeysockets/baileys");
      const makeWASocket = baileys.default ?? baileys.makeWASocket;
      const { state, saveCreds } = await baileys.useMultiFileAuthState(this._sessionPath);
      const { version } = await baileys.fetchLatestBaileysVersion();
      const logger = (await import("pino")).default({ level: "silent" });

      const sock = makeWASocket({
        version,
        logger,
        browser: ["Caduceus Agent", "Chrome", "120.0"],
        printQRInTerminal: false,
        auth: { creds: state.creds, keys: state.keys },
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async () => ({ conversation: "" }),
      }) as unknown as BaileysSock;

      this._sock = sock;

      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", (update: unknown) => void this._onConnectionUpdate(update));
      sock.ev.on("messages.upsert", (data: unknown) => void this._onMessagesUpsert(data));

      return true;
    } catch (err) {
      console.error("WhatsApp connect failed:", err);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this._sock?.ev.removeAllListeners();
    await this._sock?.logout?.();
    this._sock = null;
  }

  async requestPairingCode(phoneNumber: string): Promise<string | null> {
    if (!this._sock) return null;
    try {
      const cleaned = phoneNumber.replace(/[^0-9]/g, "");
      const code = await (this._sock as unknown as { requestPairingCode: (p: string) => Promise<string> }).requestPairingCode(cleaned);
      return code;
    } catch {
      return null;
    }
  }

  async send(chatId: string, content: string): Promise<SendResult> {
    if (!this._sock) return { success: false, error: "Not connected" };

    const chunks = content.match(new RegExp(`[\\s\\S]{1,${CHUNK_LIMIT}}`, "g")) ?? [content];
    let firstId: string | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = i === 0 && this._config.mode === "self-chat" ? this._config.replyPrefix + chunks[i] : chunks[i];
      try {
        const result = await this._sock.sendMessage(chatId, { text: chunk });
        if (i === 0) firstId = result.key.id;
        if (result.key.id) {
          this._recentlySent.add(result.key.id);
          setTimeout(() => this._recentlySent.delete(result.key.id!), 60_000);
        }
        if (i < chunks.length - 1) await delay(CHUNK_DELAY_MS);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: true, messageId: firstId };
  }

  override async editMessage(chatId: string, messageId: string, content: string): Promise<SendResult> {
    if (!this._sock) return { success: false, error: "Not connected" };
    try {
      const result = await this._sock.sendMessage(chatId, {
        text: content,
        edit: { id: messageId, fromMe: true, remoteJid: chatId },
      });
      return { success: true, messageId: result.key.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  }

  override async sendTyping(chatId: string): Promise<void> {
    await this._sock?.sendPresenceUpdate("composing", chatId);
  }

  override async sendImage(chatId: string, filepath: string, opts?: { caption?: string }): Promise<SendResult> {
    if (!this._sock) return { success: false, error: "Not connected" };
    try {
      const buffer = await readFile(filepath);
      const result = await this._sock.sendMessage(chatId, { image: buffer, caption: opts?.caption });
      return { success: true, messageId: result.key.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  override async sendDocument(chatId: string, filepath: string, opts?: { fileName?: string }): Promise<SendResult> {
    if (!this._sock) return { success: false, error: "Not connected" };
    try {
      const buffer = await readFile(filepath);
      const result = await this._sock.sendMessage(chatId, {
        document: buffer,
        fileName: opts?.fileName ?? filepath.split("/").pop() ?? "file",
      });
      return { success: true, messageId: result.key.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendApprovalRequest(chatId: string, command: string, sessionKey: string): Promise<void> {
    const text = `*Approval needed*\n${command}\n\nReply /approve to allow or /deny to reject.\n(session: ${sessionKey.slice(-8)})`;
    await this.send(chatId, text);
  }

  private async _onConnectionUpdate(update: unknown): Promise<void> {
    const u = update as { connection?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } }; qr?: string };
    if (u.qr) this._events.emit("qr", u.qr);

    if (u.connection === "open") {
      this._reconnecting = false;
      this._events.emit("connected");
    }

    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (code !== undefined && code !== 401 && !this._reconnecting) {
        this._reconnecting = true;
        const delayMs = code === 515 ? 1000 : 3000;
        setTimeout(() => void this.connect(), delayMs);
      } else if (code === 401) {
        this._events.emit("disconnected", "logged_out");
      }
    }
  }

  private async _onMessagesUpsert(data: unknown): Promise<void> {
    const d = data as { messages: Array<Record<string, unknown>>; type: string };
    if (d.type !== "notify") return;

    for (const msg of d.messages) {
      const key = msg.key as { fromMe?: boolean; id?: string; remoteJid?: string; participant?: string } | undefined;
      if (!key || key.fromMe) continue;
      if (key.id && this._recentlySent.has(key.id)) continue;

      const jid = key.remoteJid;
      if (!jid) continue;

      const mappings = await loadLidMappings(this._sessionPath);
      const canonicalJid = canonicalizeIdentifier(jid, mappings);
      const isGroup = isGroupJid(jid);
      const senderRaw = key.participant ?? jid;
      const canonicalSender = isGroup ? canonicalizeIdentifier(senderRaw, mappings) : canonicalJid;

      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) continue;

      const { text, type, mimetype } = extractContent(message);
      if (!text && !mimetype) continue;

      if (text && this._config.replyPrefix && text.startsWith(this._config.replyPrefix)) continue;

      const source: SessionSource = {
        platform: "whatsapp",
        chatId: canonicalJid,
        chatType: isGroup ? "group" : "dm",
        userId: canonicalSender,
        messageId: key.id,
      };

      const event: MessageEvent = {
        text: text ?? "",
        messageType: type === "voice" ? "voice" : type === "image" ? "photo" : type === "document" ? "document" : "text",
        source,
        rawMessage: msg,
        messageId: key.id,
      };

      if (mimetype) {
        const buffer = await this._downloadMedia(msg);
        if (buffer) {
          const ext = getExtensionFromMimeType(mimetype);
          const filepath = await this._saveMedia(key.id ?? "unknown", ext, buffer);
          event.mediaUrls = [filepath];
          event.mediaTypes = [mimetype];

          if (type === "document") {
            const injected = await this._tryInjectTextFile(filepath, message);
            if (injected) event.text += injected;
          }
        }
      }

      await this.handleMessage(event);
    }
  }

  private async _downloadMedia(msg: { key?: Record<string, unknown>; message?: Record<string, unknown> }): Promise<Buffer | null> {
    if (!this._sock) return null;
    try {
      const baileys = await import("@whiskeysockets/baileys");
      const buffer = await (baileys.downloadMediaMessage as unknown as (msg: unknown, type: string, opts: unknown, extra: unknown) => Promise<Buffer>)(msg, "buffer", {}, {
        reuploadRequest: (this._sock as unknown as { updateMediaMessage?: unknown }).updateMediaMessage,
      });
      return buffer as Buffer;
    } catch {
      return null;
    }
  }

  private async _saveMedia(id: string, ext: string, buffer: Buffer): Promise<string> {
    await mkdir(this._cacheDir, { recursive: true });
    const filepath = join(this._cacheDir, `${id}.${ext}`);
    await writeFile(filepath, buffer);
    return filepath;
  }

  private async _tryInjectTextFile(filepath: string, _message: Record<string, unknown>): Promise<string> {
    const ext = filepath.slice(filepath.lastIndexOf(".")).toLowerCase();
    if (!SMALL_TEXT_EXTS.includes(ext)) return "";
    try {
      const stats = await readFile(filepath);
      if (stats.byteLength > SMALL_TEXT_MAX_BYTES) return "";
      const content = stats.toString("utf-8");
      const filename = filepath.split("/").pop() ?? "file";
      return `\n\n[Content of ${filename}]:\n${content}`;
    } catch {
      return "";
    }
  }
}

function extractContent(message: Record<string, unknown>): {
  text: string;
  type: string;
  mimetype?: string;
} {
  const conv = message.conversation as string | undefined;
  if (conv) return { text: conv, type: "text" };

  const ext = message.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return { text: ext.text, type: "text" };

  const img = message.imageMessage as { caption?: string; mimetype?: string; url?: string } | undefined;
  if (img) return { text: img.caption ?? "", type: "image", mimetype: img.mimetype };

  const vid = message.videoMessage as { caption?: string; mimetype?: string; url?: string } | undefined;
  if (vid) return { text: vid.caption ?? "", type: "video", mimetype: vid.mimetype };

  const aud = message.audioMessage as { ptt?: boolean; mimetype?: string; url?: string } | undefined;
  if (aud) return { text: "", type: aud.ptt ? "voice" : "audio", mimetype: aud.mimetype };

  const doc = message.documentMessage as { fileName?: string; mimetype?: string; url?: string } | undefined;
  if (doc) return { text: "", type: "document", mimetype: doc.mimetype };

  const loc = message.locationMessage as { degreesLatitude?: number; degreesLongitude?: number } | undefined;
  if (loc) return { text: `Location: ${loc.degreesLatitude}, ${loc.degreesLongitude}`, type: "location" };

  const sticker = message.stickerMessage as { mimetype?: string } | undefined;
  if (sticker) return { text: "", type: "sticker", mimetype: sticker.mimetype };

  return { text: "", type: "unknown" };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
