import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildSystemPrompt } from "../src/prompt/system";
import { ToolRegistry } from "../src/tools/registry";
import { defineTool } from "../src/tools/tool";

function registryWithEcho(): ToolRegistry {
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
  return registry;
}

describe("buildSystemPrompt", () => {
  it("orders tiers stable -> context -> volatile", () => {
    const prompt = buildSystemPrompt({
      registry: registryWithEcho(),
      skills: [{ name: "summarize-diff", description: "Summarize changes.", dir: "/s", path: "/s/SKILL.md" }],
      contextFiles: [{ name: "AGENTS.md", content: "Project rules here." }],
      concepts: [{ id: "tables/orders", type: "Table", description: "Orders.", path: "/k/tables/orders.md" }],
      now: new Date("2026-06-21T00:00:00.000Z"),
    });

    expect(prompt).toContain("You are Caduceus");
    expect(prompt).toContain("- echo: Return the provided text.");
    expect(prompt).toContain("- summarize-diff: Summarize changes.");
    expect(prompt).toContain("## Project context: AGENTS.md");
    expect(prompt).toContain("Project rules here.");
    expect(prompt).toContain("## Knowledge (OKF)");
    expect(prompt).toContain("- tables/orders (Table): Orders.");
    expect(prompt).toContain("Current time: 2026-06-21T00:00:00.000Z");

    const skillsAt = prompt.indexOf("## Skills");
    const contextAt = prompt.indexOf("## Project context");
    const knowledgeAt = prompt.indexOf("## Knowledge (OKF)");
    const timeAt = prompt.indexOf("Current time:");
    expect(skillsAt).toBeGreaterThan(-1);
    expect(skillsAt).toBeLessThan(contextAt);
    expect(contextAt).toBeLessThan(knowledgeAt);
    expect(knowledgeAt).toBeLessThan(timeAt);
  });

  it("omits the skills section when there are no skills", () => {
    const prompt = buildSystemPrompt({ registry: registryWithEcho() });
    expect(prompt).not.toContain("## Skills");
  });
});
