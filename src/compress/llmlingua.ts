import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

export interface CompressResult {
  compressed: string;
  originTokens: number;
  compressedTokens: number;
}

export interface CompressOptions {
  /** Fraction of tokens to keep (0–1). Lower = more aggressive compression. */
  rate?: number;
}

interface Pending {
  resolve: (result: CompressResult) => void;
  reject: (error: Error) => void;
}

const SERVICE = process.env.CADUCEUS_LLMLINGUA_SERVICE ?? "compressor/llmlingua_service.py";
const DEFAULT_VENV_PYTHON = "compressor/.venv/bin/python";
const PYTHON =
  process.env.CADUCEUS_PYTHON ??
  (existsSync(DEFAULT_VENV_PYTHON) ? DEFAULT_VENV_PYTHON : "python3");

/**
 * Client for the LLMLingua sidecar. Spawns the Python process (which runs the
 * real Microsoft `llmlingua` library), keeps it warm, and dispatches
 * line-delimited JSON requests to it.
 */
export class LLMLinguaCompressor {
  private readonly proc: ChildProcess;
  private readonly input: NodeJS.WritableStream;
  private readonly pending = new Map<number, Pending>();
  private readonly ready: Promise<void>;
  private seq = 0;

  constructor() {
    const env = { ...process.env };
    if (process.env.CADUCEUS_HF_HOME) {
      env.HF_HOME = process.env.CADUCEUS_HF_HOME;
    }
    this.proc = spawn(PYTHON, [SERVICE], { stdio: ["pipe", "pipe", "inherit"], env });
    const stdout = this.proc.stdout;
    const stdin = this.proc.stdin;
    if (!stdout || !stdin) {
      throw new Error("failed to start LLMLingua sidecar (no stdio)");
    }
    this.input = stdin;

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    createInterface({ input: stdout }).on("line", (line) => {
      let msg: {
        type?: string;
        id?: number;
        error?: string;
        compressed?: string;
        originTokens?: number;
        compressedTokens?: number;
      };
      try {
        msg = JSON.parse(line);
      } catch {
        return; // ignore non-JSON output
      }
      if (msg.type === "ready") {
        resolveReady();
        return;
      }
      if (msg.id === undefined) {
        return;
      }
      const pending = this.pending.get(msg.id);
      if (!pending) {
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === "error") {
        pending.reject(new Error(msg.error ?? "compression failed"));
      } else {
        pending.resolve({
          compressed: msg.compressed ?? "",
          originTokens: msg.originTokens ?? 0,
          compressedTokens: msg.compressedTokens ?? 0,
        });
      }
    });

    this.proc.on("exit", (code) => {
      const error = new Error(`LLMLingua sidecar exited (code ${code ?? "unknown"})`);
      rejectReady(error);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  async compress(text: string, options: CompressOptions = {}): Promise<CompressResult> {
    await this.ready;
    const id = ++this.seq;
    return new Promise<CompressResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(`${JSON.stringify({ id, text, rate: options.rate ?? 0.5 })}\n`);
    });
  }

  close(): void {
    this.input.end();
    this.proc.kill();
  }
}
