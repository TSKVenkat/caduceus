import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dispatchCommand, findCommand, helpText, suggestCommands, type CommandContext } from "../src/commands/registry";
import { ToolRegistry } from "../src/tools/registry";
import { defineTool } from "../src/tools/tool";

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: "echo",
      description: "Return the provided text.",
      schema: z.object({ text: z.string() }),
      async execute({ text }) {
        return text;
      },
    }),
  );
  return {
    registry,
    cwd: "/work",
    skillsDir: "/work/skills",
    sessionDir: "/work/.caduceus/sessions",
    model: "qwen3-coder:480b-cloud",
    usage: () => 1234,
    ...overrides,
  };
}

describe("dispatchCommand", () => {
  it("returns null for non-slash input", async () => {
    expect(await dispatchCommand("hello world", makeContext())).toBeNull();
  });

  it("reports unknown commands", async () => {
    const result = await dispatchCommand("/nope", makeContext());
    expect(result).toEqual({ action: "print", text: expect.stringContaining("Unknown command") });
  });

  it("resolves aliases", () => {
    expect(findCommand("reset")?.name).toBe("new");
    expect(findCommand("exit")?.name).toBe("quit");
    expect(findCommand("commands")?.name).toBe("help");
  });

  it("is case-insensitive", async () => {
    expect(await dispatchCommand("/HELP", makeContext())).toEqual({
      action: "print",
      text: expect.stringContaining("Commands:"),
    });
  });

  it("maps control commands to actions", async () => {
    expect(await dispatchCommand("/new", makeContext())).toEqual({ action: "new" });
    expect(await dispatchCommand("/clear", makeContext())).toEqual({ action: "clear" });
    expect(await dispatchCommand("/quit", makeContext())).toEqual({ action: "quit" });
  });

  it("/tools lists registered tools", async () => {
    const result = await dispatchCommand("/tools", makeContext());
    expect(result).toEqual({ action: "print", text: expect.stringContaining("echo") });
  });

  it("/usage and /model and /cwd reflect context", async () => {
    expect(await dispatchCommand("/usage", makeContext())).toEqual({
      action: "print",
      text: expect.stringContaining("1234"),
    });
    expect(await dispatchCommand("/model", makeContext())).toEqual({
      action: "print",
      text: expect.stringContaining("qwen3-coder"),
    });
    expect(await dispatchCommand("/cwd", makeContext())).toEqual({ action: "print", text: "/work" });
  });

  it("/skills reports an empty directory", async () => {
    const result = await dispatchCommand("/skills", makeContext({ skillsDir: join(tmpdir(), "caduceus-no-skills-xyz") }));
    expect(result).toEqual({ action: "print", text: expect.stringContaining("No skills installed") });
  });

  it("/sessions reports an empty directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "caduceus-sessions-"));
    const result = await dispatchCommand("/sessions", makeContext({ sessionDir: dir }));
    expect(result).toEqual({ action: "print", text: "No saved sessions." });
  });

  it("/sandbox sets the env var from its argument", async () => {
    const result = await dispatchCommand("/sandbox on", makeContext());
    expect(result).toEqual({ action: "print", text: "Sandbox: on" });
    expect(process.env.CADUCEUS_SANDBOX).toBe("on");
    delete process.env.CADUCEUS_SANDBOX;
  });
});

describe("suggestCommands", () => {
  it("returns nothing without a leading slash", () => {
    expect(suggestCommands("hel")).toEqual([]);
  });

  it("filters by name prefix", () => {
    expect(suggestCommands("/s").map((c) => c.name)).toEqual(["sessions", "sandbox", "skills"]);
  });

  it("matches aliases", () => {
    expect(suggestCommands("/res").map((c) => c.name)).toContain("new");
  });

  it("stops suggesting once an argument begins", () => {
    expect(suggestCommands("/sandbox on")).toEqual([]);
  });

  it("lists everything for a bare slash, capped by limit", () => {
    expect(suggestCommands("/", 3)).toHaveLength(3);
  });
});

describe("helpText", () => {
  it("groups commands by category", () => {
    const text = helpText();
    expect(text).toContain("Session:");
    expect(text).toContain("Config:");
    expect(text).toContain("/help");
  });
});
