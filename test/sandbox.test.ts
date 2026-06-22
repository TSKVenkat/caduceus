import { describe, expect, it } from "vitest";
import { planExec, scrubbedEnv } from "../src/exec/sandbox";

const base = { command: "echo hi", cwd: "/work" };

describe("planExec", () => {
  it("runs bash directly when sandbox is off", () => {
    const plan = planExec({ ...base, mode: "off", hasBwrap: true, network: false });
    expect(plan).toEqual({ file: "bash", args: ["-c", "echo hi"], sandboxed: false });
  });

  it("wraps in bwrap (cwd-confined, network off) when available", () => {
    const plan = planExec({ ...base, mode: "auto", hasBwrap: true, network: false });
    expect(plan.file).toBe("bwrap");
    expect(plan.sandboxed).toBe(true);
    expect(plan.args).toContain("--unshare-net");
    expect(plan.args.slice(-3)).toEqual(["bash", "-c", "echo hi"]);
    expect(plan.args).toContain("--chdir");
    expect(plan.args[plan.args.indexOf("--chdir") + 1]).toBe("/work");
  });

  it("keeps network when explicitly allowed", () => {
    const plan = planExec({ ...base, mode: "on", hasBwrap: true, network: true });
    expect(plan.args).not.toContain("--unshare-net");
  });

  it("errors when sandbox=on but bwrap is missing", () => {
    expect(() => planExec({ ...base, mode: "on", hasBwrap: false, network: false })).toThrow(/bubblewrap/);
  });

  it("degrades to unsandboxed under auto when bwrap is missing", () => {
    const plan = planExec({ ...base, mode: "auto", hasBwrap: false, network: false });
    expect(plan).toEqual({ file: "bash", args: ["-c", "echo hi"], sandboxed: false });
  });
});

describe("scrubbedEnv", () => {
  it("drops secret-looking variables and keeps normal ones", () => {
    const env = scrubbedEnv({
      PATH: "/usr/bin",
      HOME: "/home/u",
      OLLAMA_API_KEY: "secret",
      GITHUB_TOKEN: "t",
      DB_PASSWORD: "p",
      AWS_SECRET_ACCESS_KEY: "s",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.OLLAMA_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });
});
