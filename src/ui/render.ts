import type { RunEvent } from "../loop/orchestrator";

export interface Writer {
  write(text: string): void;
  isTTY?: boolean;
}

export interface RendererOptions {
  color?: boolean;
  spinner?: boolean;
  out?: Writer;
  tokenOut?: Writer;
}

export interface Renderer {
  onEvent(event: RunEvent): void;
  onToken(text: string): void;
  finish(): void;
}

const ESC = "\u001b";
const CLEAR_LINE = `\r${ESC}[2K`;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * A small, dependency-free renderer for the agent's event stream: colored step
 * headers, tool calls with status icons, and a live spinner while the model or a
 * tool is working. Degrades to plain text on non-TTY / NO_COLOR.
 */
export function createRenderer(options: RendererOptions = {}): Renderer {
  const out = options.out ?? process.stderr;
  const tokenOut = options.tokenOut ?? process.stdout;
  const color = options.color ?? (Boolean(out.isTTY) && process.env.NO_COLOR === undefined);
  const useSpinner = options.spinner ?? Boolean(out.isTTY);
  const paint = styler(color);

  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;

  function stopSpinner(): void {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
      out.write(CLEAR_LINE);
    }
  }

  function startSpinner(label: string): void {
    if (!useSpinner) {
      return;
    }
    stopSpinner();
    timer = setInterval(() => {
      const glyph = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "";
      frame += 1;
      out.write(`${CLEAR_LINE}${paint.cyan(glyph)} ${paint.dim(label)} `);
    }, 80);
    timer.unref?.();
  }

  return {
    onEvent(event: RunEvent): void {
      stopSpinner();
      switch (event.type) {
        case "step":
          out.write(`\n${paint.bold(paint.cyan(`▸ step ${event.n}`))}\n`);
          startSpinner("thinking…");
          return;
        case "tool_call":
          out.write(
            `  ${paint.gray("→")} ${paint.bold(event.call.name)}${paint.dim(`(${truncate(JSON.stringify(event.call.arguments))})`)}\n`,
          );
          startSpinner(`running ${event.call.name}…`);
          return;
        case "tool_result":
          out.write(`  ${event.isError ? paint.red("✗") : paint.green("✓")} ${paint.dim(event.name)}\n`);
          startSpinner("thinking…");
          return;
        case "compress":
          out.write(
            `  ${paint.yellow("~")} ${paint.dim(`compressed ${event.tool} ${event.beforeTokens}→${event.afterTokens} tok`)}\n`,
          );
          return;
        case "assistant":
          return;
      }
    },
    onToken(text: string): void {
      stopSpinner();
      tokenOut.write(text);
    },
    finish(): void {
      stopSpinner();
    },
  };
}

type Paint = Record<"bold" | "dim" | "red" | "green" | "yellow" | "cyan" | "gray", (s: string) => string>;

function styler(enabled: boolean): Paint {
  const wrap = (code: number) => (text: string) =>
    enabled ? `${ESC}[${code}m${text}${ESC}[0m` : text;
  return {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    cyan: wrap(36),
    gray: wrap(90),
  };
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
