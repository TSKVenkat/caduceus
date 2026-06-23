import { createInterface } from "node:readline/promises";
import { Hub, type ScanResult } from "./hub";

interface SkillsCliOptions {
  skillsDir: string;
  out?: (text: string) => void;
}

function write(out: (t: string) => void, lines: string | string[]): void {
  out((Array.isArray(lines) ? lines.join("\n") : lines) + "\n");
}

async function confirmInstall(scan: ScanResult, report: string): Promise<boolean> {
  process.stdout.write(`${report}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`Install '${scan.skillName}' despite the above? [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/**
 * `caduceus skills <command>` — the full hub interface: search, inspect,
 * install (with a confirmation prompt for risky skills), list, uninstall,
 * audit, and tap management. Returns a process exit code.
 */
export async function runSkillsCli(args: string[], options: SkillsCliOptions): Promise<number> {
  const out = options.out ?? ((t) => process.stdout.write(t));
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const taps = await new Hub({ skillsDir: options.skillsDir }).taps().load();
  const hub = new Hub({ skillsDir: options.skillsDir, taps, ...(token ? { token } : {}) });
  const [command, ...rest] = args;
  const force = rest.includes("--force");
  const positional = rest.filter((a) => !a.startsWith("--"));

  switch (command) {
    case "search": {
      const query = positional.join(" ");
      const results = await hub.search(query);
      if (results.length === 0) {
        write(out, query ? `No skills found for "${query}".` : "No skills found.");
        return 0;
      }
      write(out, [
        `Found ${results.length} skill(s):`,
        ...results.map((r) => `  ${r.name.padEnd(16)} [${r.trustLevel}] ${r.description}\n    ${r.identifier}`),
      ]);
      return 0;
    }
    case "inspect": {
      const meta = await hub.inspect(positional.join("/") || (positional[0] ?? ""));
      if (!meta) {
        write(out, `Could not find '${positional.join(" ")}'.`);
        return 1;
      }
      write(out, [
        `${meta.name}  [${meta.trustLevel}]`,
        meta.description,
        `source: ${meta.source}`,
        `identifier: ${meta.identifier}`,
        ...(meta.tags && meta.tags.length ? [`tags: ${meta.tags.join(", ")}`] : []),
      ]);
      return 0;
    }
    case "install": {
      const token = positional.join("/") || (positional[0] ?? "");
      if (!token) {
        write(out, "Usage: caduceus skills install <identifier|url> [--force]");
        return 1;
      }
      try {
        const result = await hub.install(token, { force, confirm: confirmInstall });
        if (result.status === "declined") {
          write(out, "Install declined.");
          return 1;
        }
        write(out, [result.report, "", `Installed '${result.scan.skillName}' (${result.outcome?.contentHash}).`]);
        return 0;
      } catch (error) {
        write(out, error instanceof Error ? error.message : String(error));
        return 1;
      }
    }
    case "list": {
      const installed = await hub.listInstalled();
      if (installed.length === 0) {
        write(out, "No hub-installed skills.");
        return 0;
      }
      write(out, [
        "Hub-installed skills:",
        ...installed.map((s) => `  ${s.name.padEnd(16)} [${s.trustLevel}] ${s.source}  ${s.scanVerdict}  ${s.identifier}`),
      ]);
      return 0;
    }
    case "uninstall": {
      const name = positional[0];
      if (!name) {
        write(out, "Usage: caduceus skills uninstall <name>");
        return 1;
      }
      try {
        write(out, await hub.uninstall(name));
        return 0;
      } catch (error) {
        write(out, error instanceof Error ? error.message : String(error));
        return 1;
      }
    }
    case "audit": {
      const entries = await hub.audit();
      if (entries.length === 0) {
        write(out, "Audit log is empty.");
        return 0;
      }
      write(out, entries.map((e) => `${e.timestamp}  ${e.action.padEnd(9)} ${e.skill.padEnd(16)} ${e.source}  ${e.verdict}  ${e.extra}`));
      return 0;
    }
    case "tap": {
      const [action, repo, path] = positional;
      const taps = hub.taps();
      if (action === "add" && repo) {
        write(out, (await taps.add(repo, path ?? "skills/")) ? `Tapped ${repo}.` : `${repo} is already tapped.`);
        return 0;
      }
      if (action === "remove" && repo) {
        write(out, (await taps.remove(repo)) ? `Removed tap ${repo}.` : `${repo} was not tapped.`);
        return 0;
      }
      const list = await taps.load();
      write(out, list.length ? ["Taps:", ...list.map((t) => `  ${t.repo}  (${t.path})`)] : "No custom taps.");
      return 0;
    }
    default:
      write(out, [
        "Caduceus skills hub. Commands:",
        "  skills search <query>            Search sources for skills",
        "  skills inspect <id|name>         Preview a skill's metadata",
        "  skills install <id|url> [--force]  Scan and install a skill",
        "  skills list                      List hub-installed skills",
        "  skills uninstall <name>          Remove a hub-installed skill",
        "  skills audit                     Show the install audit log",
        "  skills tap [add|remove] <repo>   Manage custom GitHub sources",
      ]);
      return command ? 1 : 0;
  }
}
