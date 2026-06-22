import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clientTools } from "../src/mcp/client";

async function connectedClient(): Promise<Client> {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  server.registerTool(
    "add",
    { description: "Add two numbers", inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caduceus-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP adapter", () => {
  it("adapts an MCP server's tools into registry tools and calls them", async () => {
    const client = await connectedClient();
    try {
      const tools = await clientTools("test", client);
      expect(tools.map((t) => t.name)).toEqual(["mcp__test__add"]);

      const [tool] = tools;
      if (!tool) {
        throw new Error("no tool adapted");
      }
      expect(tool.parameters).toMatchObject({ type: "object" });
      await expect(tool.run({ a: 2, b: 3 }, { cwd: process.cwd() })).resolves.toBe("5");
    } finally {
      await client.close();
    }
  });
});
