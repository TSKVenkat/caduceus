import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type SandboxMode = "off" | "auto" | "on";

export interface ExecPlan {
  file: string;
  args: string[];
  sandboxed: boolean;
}

export interface PlanInput {
  command: string;
  cwd: string;
  mode: SandboxMode;
  hasBwrap: boolean;
  network: boolean;
}

const SENSITIVE_ENV =
  /(API[_-]?KEY|ACCESS[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY)/i;

/**
 * Drop secret-looking variables from the environment handed to a child process,
 * so agent-run commands and generated scripts can't read the agent's own
 * credentials (e.g. OLLAMA_API_KEY). Portable first-layer defense; not a sandbox.
 */
export function scrubbedEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !SENSITIVE_ENV.test(key)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Pure planning: decide how to execute a shell command given the sandbox mode and
 * whether bubblewrap is available. `off` runs bash directly; `on`/`auto` wrap it in
 * bwrap (cwd-confined, network off unless allowed); `on` errors if bwrap is missing
 * while `auto` falls back to an unsandboxed run.
 */
export function planExec(input: PlanInput): ExecPlan {
  const { command, cwd, mode, hasBwrap, network } = input;
  if (mode === "off") {
    return { file: "bash", args: ["-c", command], sandboxed: false };
  }
  if (hasBwrap) {
    return { file: "bwrap", args: [...bwrapArgs(cwd, network), "bash", "-c", command], sandboxed: true };
  }
  if (mode === "on") {
    throw new Error("CADUCEUS_SANDBOX=on but bubblewrap (bwrap) is not installed");
  }
  return { file: "bash", args: ["-c", command], sandboxed: false };
}

function bwrapArgs(cwd: string, network: boolean): string[] {
  const args = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--bind",
    cwd,
    cwd,
    "--chdir",
    cwd,
    "--die-with-parent",
  ];
  if (!network) {
    args.push("--unshare-net");
  }
  return args;
}

let degradeWarned = false;

/** Resolve the exec plan from environment config, warning once on auto-degrade. */
export function buildExec(command: string, cwd: string): ExecPlan {
  const mode = readMode();
  const network = process.env.CADUCEUS_SANDBOX_NET === "1";
  const bwrap = mode === "off" ? false : probeBwrap(network);
  const plan = planExec({ command, cwd, mode, hasBwrap: bwrap, network });
  if (mode === "auto" && !bwrap && !degradeWarned) {
    degradeWarned = true;
    process.stderr.write(
      "caduceus: no working bubblewrap (bwrap) sandbox — running shell WITHOUT OS isolation " +
        "(env scrubbing still applies). Set CADUCEUS_SANDBOX=off to silence / =on to require.\n",
    );
  }
  return plan;
}

function readMode(): SandboxMode {
  const value = process.env.CADUCEUS_SANDBOX;
  return value === "off" || value === "on" ? value : "auto";
}

const probeCache = new Map<boolean, boolean>();

/**
 * Functionally probe bwrap: presence on PATH is not enough — in nested/restricted
 * environments bwrap exists but fails to set up user/network namespaces. We run a
 * trivial `bwrap … true` (matching the network flag) once and cache the result, so
 * we never wrap real commands in a bwrap that would just error out.
 */
function probeBwrap(network: boolean): boolean {
  const cached = probeCache.get(network);
  if (cached !== undefined) {
    return cached;
  }
  let ok = false;
  if (hasBwrapOnPath()) {
    try {
      const args = ["--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev"];
      if (!network) {
        args.push("--unshare-net");
      }
      args.push("true");
      execFileSync("bwrap", args, { stdio: "ignore", timeout: 5000 });
      ok = true;
    } catch {
      ok = false;
    }
  }
  probeCache.set(network, ok);
  return ok;
}

function hasBwrapOnPath(): boolean {
  return (process.env.PATH ?? "").split(":").some((dir) => dir !== "" && existsSync(join(dir, "bwrap")));
}
