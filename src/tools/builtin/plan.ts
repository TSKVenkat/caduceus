import { z } from "zod";
import { defineTool } from "../tool";

const stepSchema = z.object({
  step: z.string().min(1).describe("A short, concrete step."),
  status: z
    .enum(["pending", "in_progress", "done"])
    .optional()
    .describe("Step status (default: pending). Keep at most one step in_progress."),
});

const schema = z.object({
  steps: z
    .array(stepSchema)
    .min(1)
    .describe("The full plan, resent in full each time. Mark steps done as you finish them."),
});

const MARK: Record<string, string> = { done: "x", in_progress: "~", pending: " " };

function render(steps: Array<{ step: string; status: string }>): string {
  const done = steps.filter((s) => s.status === "done").length;
  const lines = steps.map((s) => `[${MARK[s.status] ?? " "}] ${s.step}`);
  return `Plan (${done}/${steps.length} done):\n${lines.join("\n")}`;
}

/**
 * A lightweight planning tool. The agent maintains an explicit task list for
 * multi-step work and resends the full list each call, marking steps done as it
 * goes. The plan lives in the message history, which keeps long tasks coherent;
 * it is intentionally stateless (no hidden store) so the visible list is always
 * the source of truth.
 */
export const planTool = defineTool({
  name: "update_plan",
  description:
    "Create or update a short task plan for multi-step work (about three or more steps). Pass the full list of steps each time and mark them done as you complete them.",
  schema,
  async execute({ steps }) {
    return render(steps.map((s) => ({ step: s.step, status: s.status ?? "pending" })));
  },
});
