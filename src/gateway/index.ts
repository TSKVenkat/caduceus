export { GatewayConfigSchema, loadGatewayConfig, defaultGatewayConfig } from "./config.js";
export type { GatewayConfig, StreamingConfig, SessionResetPolicy } from "./config.js";
export type { SlackPlatformConfig, WhatsAppPlatformConfig } from "./config.js";

export { BasePlatformAdapter, buildSessionKey, isControlCommand } from "./platforms/base.js";
export type { MessageHandler, ApprovalChoice } from "./platforms/base.js";

export { SessionStore, shouldReset } from "./session.js";

export { StreamConsumer } from "./stream-consumer.js";

export { PairingStore } from "./pairing.js";

export { createChatApprover } from "./approval.js";

export { GatewayRunner, gatewayHome } from "./run.js";

export type {
  SessionSource,
  MessageEvent,
  SendResult,
  StoredMessage,
  SessionEntry,
} from "./types.js";
