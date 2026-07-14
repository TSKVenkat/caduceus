import { gatewayHome } from "./run.js";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export interface GatewayStatus {
  status: string;
  uptime: number;
  sessions: number;
  home: string;
  version: string;
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const home = gatewayHome();
  let sessionCount = 0;

  try {
    const content = await readFile(join(home, "sessions", "sessions.json"), "utf-8");
    const data = JSON.parse(content) as Record<string, unknown>;
    sessionCount = Object.keys(data).length;
  } catch {
    // no sessions file
  }

  return {
    status: "unknown",
    uptime: process.uptime(),
    sessions: sessionCount,
    home,
    version: process.env.npm_package_version ?? "1.0.0",
  };
}
