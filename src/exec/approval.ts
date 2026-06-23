import { createInterface } from "node:readline/promises";

/** A request to run something risky, shown to the user before it executes. */
export interface ApprovalRequest {
  tool: string;
  command: string;
  reason: string;
}

/** Returns true to allow the command, false to refuse it. */
export type Approver = (request: ApprovalRequest) => Promise<boolean>;

export type ApprovalMode = "allow" | "deny" | "prompt";

interface Rule {
  re: RegExp;
  reason: string;
}

/**
 * Patterns for shell commands that are destructive, irreversible, or escalate
 * privilege. This is a confirmation aid, not a sandbox — OS isolation and env
 * scrubbing in `sandbox.ts` are the real containment. It errs toward flagging
 * (a false prompt is cheap; a silent `rm -rf` is not).
 */
const RULES: Rule[] = [
  { re: /\brm\b[^|;&\n]*\s-\S*r/i, reason: "recursive file deletion (irreversible)" },
  { re: /\b(curl|wget|fetch)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, reason: "piping a downloaded script straight into a shell" },
  { re: /\bsudo\b/i, reason: "running a command as root via sudo" },
  { re: /\bchmod\b\s+(-R\b\s+)?(777|[0-7]*7{2})\b/i, reason: "making files world-writable" },
  { re: /\bchmod\b\s+-R\b/i, reason: "recursive permission change" },
  { re: /\bdd\b[^\n]*\bof=\/dev\//i, reason: "raw write to a block device" },
  { re: /\bmkfs\b/i, reason: "formatting a filesystem" },
  { re: />\s*\/(etc|boot|sys|dev|usr|bin|lib|var)\b/i, reason: "overwriting a system path" },
  { re: /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i, reason: "shutting down or rebooting the machine" },
  { re: /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;/, reason: "fork bomb" },
  { re: /\bgit\s+push\b[^\n]*(\s--force\b|\s-f\b)/i, reason: "force-pushing to a git remote" },
  { re: /\bgit\s+(reset\s+--hard|clean\s+-\S*f)/i, reason: "discarding uncommitted changes irreversibly" },
];

/** Classify a shell command; `dangerous` commands should be confirmed before running. */
export function classifyCommand(command: string): { dangerous: boolean; reason?: string } {
  for (const rule of RULES) {
    if (rule.re.test(command)) {
      return { dangerous: true, reason: rule.reason };
    }
  }
  return { dangerous: false };
}

/** Resolve the approval mode from CADUCEUS_APPROVAL; default to prompting only when interactive. */
export function resolveApprovalMode(): ApprovalMode {
  const value = (process.env.CADUCEUS_APPROVAL ?? "").toLowerCase();
  if (value === "allow" || value === "deny" || value === "prompt") {
    return value;
  }
  return process.stdin.isTTY ? "prompt" : "allow";
}

/** An approver that refuses everything dangerous (for `deny` mode / non-interactive). */
export const denyApprover: Approver = async () => false;

/** A readline-based approver for the non-interactive CLI path (prompts on stderr). */
export function readlineApprover(): Approver {
  return async (request) => {
    process.stderr.write(`\nApproval needed (${request.reason}):\n  ${request.command}\n`);
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = (await rl.question("Run this command? [y/N] ")).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    } finally {
      rl.close();
    }
  };
}

/** Build the approver for the one-shot CLI from the resolved mode. */
export function cliApprover(mode: ApprovalMode): Approver | undefined {
  if (mode === "allow") {
    return undefined;
  }
  return mode === "deny" ? denyApprover : readlineApprover();
}
