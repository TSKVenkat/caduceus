# Caduceus

An open, single-agent **coding agent** that runs on [Ollama Cloud](https://docs.ollama.com/cloud). Give it a task in your terminal (or browser) and it inspects the workspace, edits files, runs commands, and verifies its work in a bounded reason→act loop — with skills, a knowledge layer, memory, prompt compression, sandboxing, subagents, MCP tools, and a streaming CLI/Web UI.

TypeScript · pnpm · Ollama Cloud (OpenAI-compatible). Built from scratch; architecture modeled on the Hermes Agent framework.

```text
▸ step 1
  → write_file({"path":"greet.js","content":"console.log('hello from caduceus');"})
  ✓ write_file
▸ step 2
  → bash({"command":"node greet.js"})
  ✓ bash
▸ step 3
I created greet.js and ran it; it printed "hello from caduceus".

8253 tokens · 12.3s · 3 steps
```

## Features

- **Bounded ReAct loop** with a circuit breaker and a per-task step budget.
- **Tools:** `read_file`, `write_file`, `str_replace` (surgical search/replace edits), `bash`.
- **Skills** — procedural know-how as `SKILL.md` folders with progressive disclosure; the agent can `create_skill` at runtime (Voyager-style).
- **Knowledge (OKF)** — a Markdown concept bundle ([Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)) the agent reads and authors.
- **Memory** — flat-file episodic lessons (`remember`/`recall`), strict-write.
- **Prompt compression** — real [LLMLingua](https://github.com/microsoft/LLMLingua) via a Python sidecar (opt-in).
- **Sandboxing** — env scrubbing always on; bubblewrap OS isolation (network off) with graceful degradation.
- **Subagents** — `delegate` runs isolated subagents for independent, parallel investigation.
- **MCP connectors** — connect to Model Context Protocol servers and use their tools.
- **Multi-turn** — an interactive Ink TUI and a Hermes-style Web UI, both with session persistence, on one shared engine.
- **Reliable** — retries with backoff, request timeouts, optional model fallback, usage reporting.

## Install & run

```bash
pnpm install
export OLLAMA_API_KEY=...        # from https://ollama.com

pnpm dev "summarize this project"   # one-shot task
pnpm dev                            # interactive TUI (multi-turn chat)
pnpm web                            # web UI → http://localhost:4100
```

Build a distributable CLI:

```bash
pnpm build
node dist/cli.js "your task"   # or: caduceus "your task" / caduceus-web
```

The CLI and the web server drive the same headless engine (`src/engine/session.ts` → `run()` / `Conversation`).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_API_KEY` | _required_ | Ollama Cloud API key |
| `OLLAMA_BASE_URL` | `https://ollama.com/v1` | OpenAI-compatible endpoint |
| `CADUCEUS_MODEL` | `qwen3-coder:480b-cloud` | Model id |
| `CADUCEUS_FALLBACK_MODEL` | _unset_ | Model tried once if the primary keeps failing |
| `CADUCEUS_MAX_STEPS` | `20` | Loop iteration budget |
| `CADUCEUS_TEMPERATURE` | `0` | Sampling temperature |
| `CADUCEUS_RETRIES` | `3` | Attempts per request (backoff on 429/5xx/network) |
| `CADUCEUS_TIMEOUT_MS` | `120000` | Per-attempt request timeout |
| `CADUCEUS_STREAM` | `0` | `1` streams the model's output live |
| `CADUCEUS_SANDBOX` | `auto` | `off` / `auto` / `on` (require bwrap) |
| `CADUCEUS_SANDBOX_NET` | `0` | `1` to allow network inside the sandbox |
| `CADUCEUS_COMPRESS` | `0` | `1` compresses large tool output via LLMLingua |
| `CADUCEUS_SKILLS_DIR` / `_KNOWLEDGE_DIR` / `_MEMORY_DIR` / `_ARTIFACTS_DIR` | `skills` / `knowledge` / `memory` / `artifacts` | Where each layer lives |
| `CADUCEUS_MCP_CONFIG` | `.caduceus/mcp.json` | MCP servers config |

CLI flags `--model` and `--max-steps` override the environment.

## How it works

The system prompt is assembled in three tiers — **stable** (identity, tools, skill catalog), **context** (project files, OKF knowledge, memory, artifacts), **volatile** (timestamp) — in that order, so the long prefix stays cache-friendly. Skills and OKF knowledge share one Markdown+frontmatter substrate (`src/markdown/frontmatter.ts`). A `Conversation` keeps history across turns; sessions persist to `.caduceus/sessions`.

- **MCP:** drop a `.caduceus/mcp.json` (`{ "mcpServers": { "name": { "command": "...", "args": [...] } } }` for stdio, or `{ "url": "..." }` for HTTP); tools register as `mcp__<server>__<tool>`.
- **Sandboxing:** secret-looking env vars are stripped from tool subprocesses; with `bwrap` present, shell runs cwd-confined with network off. Without it, `auto` warns and runs unsandboxed.
- **Compression:** see [`compressor/`](compressor/) for the LLMLingua sidecar setup (`pnpm compress`).

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest
pnpm build       # tsup → dist/
```

## License

MIT — see [LICENSE](LICENSE).
