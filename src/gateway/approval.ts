import type { Approver, ApprovalRequest } from "../exec/approval.js";
import type { BasePlatformAdapter } from "./platforms/base.js";

export function createChatApprover(
  adapter: BasePlatformAdapter,
  chatId: string,
  sessionKey: string,
  timeoutMs = 60_000,
): Approver {
  return async (request: ApprovalRequest): Promise<boolean> => {
    const command = `\`${request.command}\``;
    await adapter.sendApprovalRequest(chatId, command, sessionKey);
    return adapter.requestApproval(sessionKey, request.command, timeoutMs);
  };
}
