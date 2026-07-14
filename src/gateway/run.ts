import { join } from "node:path";
import { homedir } from "node:os";
import { Conversation } from "../engine/conversation.js";
import { buildSession } from "../engine/session.js";
import { OllamaClient } from "../model/ollama.js";
import type { Message } from "../types.js";
import type { GatewayConfig } from "./config.js";
import { loadGatewayConfig } from "./config.js";
import { SessionStore } from "./session.js";
import { StreamConsumer } from "./stream-consumer.js";
import { createChatApprover } from "./approval.js";
import type { BasePlatformAdapter, MessageHandler } from "./platforms/base.js";
import { buildSessionKey, isControlCommand } from "./platforms/base.js";
import type { MessageEvent, SessionSource, StoredMessage } from "./types.js";

interface RunnerState {
  adapters: Map<string, BasePlatformAdapter>;
  conversations: Map<string, Conversation>;
  sessionStore: SessionStore;
  config: GatewayConfig;
  shutdown: boolean;
}

export function gatewayHome(): string {
  return process.env.CADUCEUS_HOME ?? join(homedir(), ".caduceus");
}

export class GatewayRunner {
  private _state: RunnerState | null = null;

  async start(adapterFactories: Array<() => Promise<BasePlatformAdapter>>): Promise<void> {
    const config = await loadGatewayConfig();
    const home = gatewayHome();
    const sessionStore = new SessionStore(join(home, "sessions"));

    const client = new OllamaClient({
      apiKey: process.env.OLLAMA_API_KEY ?? "",
      baseUrl: config.baseUrl,
      model: config.model,
    });
    const _session = await buildSession({ cwd: process.cwd(), client });
    const adapters = new Map<string, BasePlatformAdapter>();

    const messageHandler: MessageHandler = (event) => this._handleMessage(event);

    for (const factory of adapterFactories) {
      const adapter = await factory();
      adapter.setMessageHandler(messageHandler);
      const name = adapter.constructor.name;
      adapters.set(name, adapter);
    }

    this._state = { adapters, conversations: new Map(), sessionStore, config, shutdown: false };

    process.on("SIGINT", () => void this.stop());
    process.on("SIGTERM", () => void this.stop());

    console.log(`Gateway started — ${adapters.size} adapter(s) connected`);
  }

  async stop(): Promise<void> {
    if (!this._state || this._state.shutdown) return;
    this._state.shutdown = true;

    for (const adapter of this._state.adapters.values()) {
      await adapter.disconnect();
    }
    console.log("Gateway stopped");
  }

  private async _handleMessage(event: MessageEvent): Promise<void> {
    if (!this._state) return;
    const { sessionStore, config, conversations, adapters } = this._state;

    const sessionKey = buildSessionKey(event.source, config.groupSessionsPerUser);
    const adapter = _findAdapter(adapters, event.source.platform);
    if (!adapter) return;

    if (!event.internal && !(await this._isAuthorized(event.source, adapter))) {
      return;
    }

    if (isControlCommand(event.text)) {
      await this._handleControlCommand(sessionKey, event, adapter);
      return;
    }

    const entry = await sessionStore.getOrCreateSession(
      event.source,
      config.sessionReset,
      config.groupSessionsPerUser,
    );

    let conversation = conversations.get(sessionKey);
    if (!conversation) {
      const history = await sessionStore.loadTranscript(entry.sessionId);
      const client = new OllamaClient({ apiKey: process.env.OLLAMA_API_KEY ?? "", baseUrl: config.baseUrl, model: config.model });
      conversation = new Conversation({
        client,
        registry: (await buildSession({ cwd: process.cwd(), client })).registry,
        systemPrompt: "",
        messages: history.length > 0 ? toMessages(history) : undefined,
        maxSteps: config.maxTurns,
        confirm: createChatApprover(adapter, event.source.chatId, sessionKey),
      });
      conversations.set(sessionKey, conversation);
    }

    const controller = adapter.claimSession(sessionKey);
    let streamConsumer: StreamConsumer | undefined;
    if (config.streaming.enabled) {
      streamConsumer = new StreamConsumer(adapter, event.source.chatId, event.source.threadId, config.streaming);
    }

    try {
      const result = await conversation.send(event.text, {
        signal: controller.signal,
        onToken: streamConsumer ? (t) => streamConsumer!.onDelta(t) : undefined,
      });

      if (streamConsumer) {
        streamConsumer.finish();
        await streamConsumer.run();
      }

      if (!streamConsumer?.finalResponseSent) {
        await adapter.send(event.source.chatId, result.finalText, { threadId: event.source.threadId });
      }

      await sessionStore.appendToTranscript(entry.sessionId, {
        role: "user",
        content: event.text,
      });
      await sessionStore.appendToTranscript(entry.sessionId, {
        role: "assistant",
        content: result.finalText,
      });
    } finally {
      adapter.releaseSession(sessionKey);
      const pending = adapter.getPendingMessage(sessionKey);
      if (pending) {
        adapter.clearPendingMessage(sessionKey);
        setImmediate(() => void this._handleMessage(pending));
      }
    }
  }

  private async _handleControlCommand(
    sessionKey: string,
    event: MessageEvent,
    adapter: BasePlatformAdapter,
  ): Promise<void> {
    if (!this._state) return;
    const text = event.text.trim();

    if (text === "/stop") {
      adapter.releaseSession(sessionKey);
      await this._state.sessionStore.suspendSession(sessionKey);
      await adapter.send(event.source.chatId, "Session stopped.");
      return;
    }

    if (text === "/new" || text === "/reset") {
      const fresh = await this._state.sessionStore.resetSession(sessionKey);
      this._state.conversations.delete(sessionKey);
      await adapter.send(event.source.chatId, `Session reset — new session: ${fresh?.sessionId ?? "unknown"}`);
      return;
    }

    if (text.startsWith("/approve")) {
      adapter.resolveApproval(sessionKey, "once");
      return;
    }

    if (text === "/deny") {
      adapter.resolveApproval(sessionKey, "deny");
      return;
    }

    if (text === "/status") {
      const sessions = this._state.sessionStore.listSessions();
      await adapter.send(
        event.source.chatId,
        `Gateway running — ${sessions.length} session(s), ${this._state.adapters.size} platform(s)`,
      );
      return;
    }
  }

  private async _isAuthorized(source: SessionSource, _adapter: BasePlatformAdapter): Promise<boolean> {
    if (!this._state) return false;
    if (this._state.config.allowAllUsers) return true;
    if (!this._state.config.allowedUsers || this._state.config.allowedUsers.length === 0) return true;
    return source.userId ? this._state.config.allowedUsers.includes(source.userId) : false;
  }
}

function _findAdapter(adapters: Map<string, BasePlatformAdapter>, platform: string): BasePlatformAdapter | undefined {
  for (const adapter of adapters.values()) {
    if (adapter.connectedPlatforms.includes(platform)) return adapter;
  }
  return adapters.size > 0 ? [...adapters.values()][0] : undefined;
}

function toMessages(history: StoredMessage[]): Message[] {
  return history.map((m) => ({ role: m.role, content: m.content }));
}
