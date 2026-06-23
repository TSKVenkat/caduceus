import { loadSkills } from "../skills/loader";
import { listSessions } from "../engine/store";
import { Hub } from "../hub";
import type { ToolRegistry } from "../tools/registry";

/** What a command asks the host (CLI/TUI) to do. */
export type CommandResult =
  | { action: "print"; text: string }
  | { action: "clear" }
  | { action: "new" }
  | { action: "quit" };

export interface CommandContext {
  registry: ToolRegistry;
  cwd: string;
  skillsDir: string;
  sessionDir: string;
  model: string;
  /** Total tokens used so far this run. */
  usage: () => number;
}

export type CommandCategory = "Session" | "Config" | "Tools & Skills" | "Info";

export interface Command {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  description: string;
  argHint?: string;
  run(arg: string, ctx: CommandContext): Promise<CommandResult> | CommandResult;
}

export const COMMANDS: Command[] = [
  // Session
  { name: "new", aliases: ["reset"], category: "Session", description: "Start a fresh conversation", run: () => ({ action: "new" }) },
  { name: "clear", category: "Session", description: "Clear the screen", run: () => ({ action: "clear" }) },
  {
    name: "sessions",
    category: "Session",
    description: "List saved sessions",
    async run(_arg, ctx) {
      const sessions = await listSessions(ctx.sessionDir);
      if (sessions.length === 0) {
        return { action: "print", text: "No saved sessions." };
      }
      const lines = sessions
        .slice(0, 20)
        .map((s) => {
          const title = s.messages.find((m) => m.role === "user")?.content ?? "(empty)";
          return `  ${s.id}  ${title.slice(0, 50)}`;
        })
        .join("\n");
      return { action: "print", text: `Sessions:\n${lines}` };
    },
  },
  // Config
  {
    name: "model",
    aliases: ["provider"],
    category: "Config",
    description: "Show the current model",
    argHint: "",
    run: (_arg, ctx) => ({ action: "print", text: `Model: ${ctx.model}` }),
  },
  {
    name: "sandbox",
    category: "Config",
    description: "Show or set the sandbox mode (off/auto/on)",
    argHint: "[off|auto|on]",
    run(arg) {
      const value = arg.trim();
      if (value === "off" || value === "auto" || value === "on") {
        process.env.CADUCEUS_SANDBOX = value;
        return { action: "print", text: `Sandbox: ${value}` };
      }
      return { action: "print", text: `Sandbox: ${process.env.CADUCEUS_SANDBOX ?? "auto"}` };
    },
  },
  // Tools & Skills
  {
    name: "tools",
    category: "Tools & Skills",
    description: "List available tools",
    run: (_arg, ctx) => ({
      action: "print",
      text: ["Tools:", ...ctx.registry.list().map((t) => `  ${t.name} — ${t.description}`)].join("\n"),
    }),
  },
  {
    name: "skills",
    category: "Tools & Skills",
    description: "List skills, or search/inspect/install from the hub",
    argHint: "[search <q> | inspect <id> | install <id>]",
    async run(arg, ctx) {
      return skillsCommand(arg, ctx);
    },
  },
  // Info
  { name: "usage", category: "Info", description: "Show token usage so far", run: (_arg, ctx) => ({ action: "print", text: `${ctx.usage()} tokens used this session` }) },
  { name: "cwd", category: "Info", description: "Show the working directory", run: (_arg, ctx) => ({ action: "print", text: ctx.cwd }) },
  { name: "help", aliases: ["commands"], category: "Info", description: "List slash commands", run: () => ({ action: "print", text: helpText() }) },
  { name: "quit", aliases: ["exit"], category: "Info", description: "Exit", run: () => ({ action: "quit" }) },
];

/**
 * `/skills [search|inspect|install] …` — read-only sub-actions plus install.
 * Install runs the full scan, but without an interactive confirmation prompt:
 * skills that need confirmation are deferred to `caduceus skills install` on the
 * command line. Dangerous skills are always blocked.
 */
async function skillsCommand(arg: string, ctx: CommandContext): Promise<CommandResult> {
  const [sub, ...words] = arg.trim().split(/\s+/).filter(Boolean);
  const token = words.join(" ");

  if (!sub || sub === "list") {
    const skills = await loadSkills(ctx.skillsDir);
    if (skills.length === 0) {
      return { action: "print", text: "No skills installed. Try /skills search <query>." };
    }
    return { action: "print", text: ["Skills:", ...skills.map((s) => `  ${s.name} — ${s.description}`)].join("\n") };
  }

  const hub = new Hub({ skillsDir: ctx.skillsDir });

  if (sub === "search") {
    const results = await hub.search(token);
    if (results.length === 0) {
      return { action: "print", text: `No skills found for "${token}".` };
    }
    return { action: "print", text: ["Found:", ...results.map((r) => `  ${r.name} [${r.trustLevel}] — ${r.description}\n    ${r.identifier}`)].join("\n") };
  }

  if (sub === "inspect") {
    const meta = await hub.inspect(token);
    if (!meta) {
      return { action: "print", text: `Could not find '${token}'.` };
    }
    return { action: "print", text: `${meta.name} [${meta.trustLevel}]\n${meta.description}\nidentifier: ${meta.identifier}` };
  }

  if (sub === "install") {
    try {
      const result = await hub.install(token, { confirm: () => false });
      if (result.status === "declined") {
        return { action: "print", text: `'${token}' needs confirmation — run: caduceus skills install ${token}` };
      }
      return { action: "print", text: `Installed '${result.scan.skillName}'. Restart the session to load it.` };
    } catch (error) {
      return { action: "print", text: error instanceof Error ? error.message : String(error) };
    }
  }

  return { action: "print", text: "Usage: /skills [search <q> | inspect <id> | install <id>]" };
}

const byName = new Map<string, Command>(
  COMMANDS.flatMap((cmd) => [cmd.name, ...(cmd.aliases ?? [])].map((n) => [n, cmd] as const)),
);

export function findCommand(name: string): Command | undefined {
  return byName.get(name.toLowerCase());
}

/** Parse and run a slash command. Returns null if `input` isn't a slash command. */
export async function dispatchCommand(
  input: string,
  ctx: CommandContext,
): Promise<CommandResult | null> {
  if (!input.startsWith("/")) {
    return null;
  }
  const body = input.slice(1).trim();
  const name = (body.split(/\s+/)[0] ?? "").toLowerCase();
  const arg = body.slice(name.length).trim();
  const command = findCommand(name);
  if (!command) {
    return { action: "print", text: `Unknown command: /${name} (try /help)` };
  }
  return command.run(arg, ctx);
}

/**
 * Suggest commands for autocomplete. Returns matches while the user is still
 * typing the command name (before any whitespace); empty once an argument starts.
 */
export function suggestCommands(input: string, limit = 6): Command[] {
  if (!input.startsWith("/")) {
    return [];
  }
  const body = input.slice(1);
  if (/\s/.test(body)) {
    return [];
  }
  const prefix = body.toLowerCase();
  const matches: Command[] = [];
  for (const cmd of COMMANDS) {
    const names = [cmd.name, ...(cmd.aliases ?? [])];
    if (names.some((n) => n.startsWith(prefix))) {
      matches.push(cmd);
    }
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

export function helpText(): string {
  const categories: CommandCategory[] = ["Session", "Config", "Tools & Skills", "Info"];
  const sections = categories.map((category) => {
    const lines = COMMANDS.filter((c) => c.category === category).map((c) => {
      const names = [`/${c.name}`, ...(c.aliases ?? []).map((a) => `/${a}`)].join(", ");
      return `  ${names}${c.argHint ? ` ${c.argHint}` : ""} — ${c.description}`;
    });
    return `${category}:\n${lines.join("\n")}`;
  });
  return ["Commands:", ...sections].join("\n");
}
