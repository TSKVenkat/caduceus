import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/tools/registry";
import { defineTool, ToolArgsError } from "../src/tools/tool";

const echo = defineTool({
  name: "echo",
  description: "Return the provided text.",
  schema: z.object({ text: z.string() }),
  async execute({ text }) {
    return text;
  },
});

describe("ToolRegistry", () => {
  it("registers and lists tools", () => {
    const registry = new ToolRegistry();
    registry.register(echo);
    expect(registry.list().map((t) => t.name)).toEqual(["echo"]);
    expect(registry.get("echo")).toBe(echo);
  });

  it("rejects duplicate names", () => {
    const registry = new ToolRegistry();
    registry.register(echo);
    expect(() => registry.register(echo)).toThrow(/already registered/);
  });

  it("registerAll registers an iterable of tools", () => {
    const registry = new ToolRegistry();
    registry.registerAll([echo]);
    expect(registry.list().map((t) => t.name)).toEqual(["echo"]);
  });

  it("exposes specs with JSON Schema parameters", () => {
    const registry = new ToolRegistry();
    registry.register(echo);
    const [spec] = registry.specs();
    expect(spec?.name).toBe("echo");
    expect(spec?.parameters).toMatchObject({ type: "object" });
  });
});

describe("defineTool", () => {
  it("validates arguments before executing", async () => {
    await expect(echo.run({ text: 42 }, { cwd: process.cwd() })).rejects.toBeInstanceOf(
      ToolArgsError,
    );
  });

  it("passes parsed arguments through", async () => {
    await expect(echo.run({ text: "hi" }, { cwd: process.cwd() })).resolves.toBe("hi");
  });
});
