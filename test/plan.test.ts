import { describe, expect, it } from "vitest";
import { planTool } from "../src/tools/builtin/plan";

const ctx = { cwd: process.cwd() };

describe("update_plan", () => {
  it("renders a checklist with a progress count", async () => {
    const out = await planTool.run(
      {
        steps: [
          { step: "Read the config", status: "done" },
          { step: "Apply the change", status: "in_progress" },
          { step: "Run the tests" },
        ],
      },
      ctx,
    );
    expect(out).toContain("Plan (1/3 done):");
    expect(out).toContain("[x] Read the config");
    expect(out).toContain("[~] Apply the change");
    expect(out).toContain("[ ] Run the tests");
  });

  it("defaults missing status to pending", async () => {
    const out = await planTool.run({ steps: [{ step: "Only step" }] }, ctx);
    expect(out).toContain("[ ] Only step");
    expect(out).toContain("Plan (0/1 done):");
  });

  it("rejects an empty plan", async () => {
    await expect(planTool.run({ steps: [] }, ctx)).rejects.toBeTruthy();
  });
});
