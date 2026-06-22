import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "../tools/tool";

export interface StdioServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpServer {
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioServer | HttpServer;

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpConnection {
  tools: Tool[];
  close(): Promise<void>;
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

/** Load an MCP config file ({ mcpServers: { name: {command|url} } }), or null if absent/invalid. */
export async function loadMcpConfig(path: string): Promise<McpConfig | null> {
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<McpConfig>;
  if (!parsed || typeof parsed.mcpServers !== "object" || parsed.mcpServers === null) {
    return null;
  }
  return { mcpServers: parsed.mcpServers };
}

/** Connect to each configured MCP server and adapt their tools into our registry. */
export async function connectMcpServers(config: McpConfig): Promise<McpConnection> {
  const clients: Client[] = [];
  const tools: Tool[] = [];

  for (const [name, server] of Object.entries(config.mcpServers)) {
    const client = new Client({ name: "caduceus", version: "0.0.0" });
    try {
      await client.connect(transportFor(server));
      tools.push(...(await clientTools(name, client)));
      clients.push(client);
    } catch (error) {
      process.stderr.write(`caduceus: MCP server '${name}' failed: ${asMessage(error)}\n`);
      await client.close().catch(() => {});
    }
  }

  return {
    tools,
    async close() {
      await Promise.all(clients.map((client) => client.close().catch(() => {})));
    },
  };
}

function transportFor(server: McpServerConfig) {
  if ("url" in server) {
    return new StreamableHTTPClientTransport(
      new URL(server.url),
      server.headers ? { requestInit: { headers: server.headers } } : undefined,
    );
  }
  return new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    ...(server.env ? { env: server.env } : {}),
  });
}

/** List a connected client's tools and wrap each as a registry Tool (namespaced by server). */
export async function clientTools(serverName: string, client: Client): Promise<Tool[]> {
  const defs: McpToolDef[] = [];
  let cursor: string | undefined;
  do {
    const page = (await client.listTools(cursor ? { cursor } : undefined)) as {
      tools: McpToolDef[];
      nextCursor?: string;
    };
    defs.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);

  return defs.map((def) => ({
    name: `mcp__${serverName}__${def.name}`,
    description: def.description ?? `${def.name} (MCP server: ${serverName})`,
    parameters: def.inputSchema ?? { type: "object", properties: {} },
    async run(rawArgs: unknown) {
      const result = (await client.callTool({
        name: def.name,
        arguments: (rawArgs ?? {}) as Record<string, unknown>,
      })) as McpCallResult;
      return formatResult(result);
    },
  }));
}

function formatResult(result: McpCallResult): string {
  const text = (result.content ?? [])
    .map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`))
    .join("\n")
    .trim();
  const body = text || (result.structuredContent ? JSON.stringify(result.structuredContent) : "");
  if (result.isError) {
    throw new Error(body || "MCP tool returned an error");
  }
  return body || "(no output)";
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
