# Caduceus

An open coding agent that runs on [Ollama Cloud](https://docs.ollama.com/cloud). Give it a task in your terminal; it inspects the workspace, edits files, runs commands, and verifies its work in a bounded reason→act loop.

## Status

Early foundation. Working today: the Ollama Cloud client; a self-validating tool registry with built-in tools (`read_file`, `write_file`, `str_replace`, `bash`); the bounded agent loop with a circuit breaker; a tiered system prompt; Skills with progressive disclosure; an OKF knowledge layer; episodic memory; and **real prompt compression** via Microsoft's LLMLingua (`pnpm compress`; see [`compressor/`](compressor/)). The `str_replace` tool does surgical search/replace edits (token-cheap) instead of whole-file rewrites. A fair evaluation harness is next — see [`docs/`](docs/).

## Skills & project context

The system prompt is assembled in three tiers — **stable** (identity, tools, skill catalog), **context** (project instruction files), **volatile** (timestamp) — in that order, so the long prefix stays cache-friendly.

- **Skills** (procedural — *how* to do things) live in `skills/<name>/SKILL.md` with `name` and `description` frontmatter. Only that metadata is loaded up front; the agent pulls a skill's full instructions on demand via the `load_skill` tool (progressive disclosure). The agent can also **grow its own skill library at runtime** with `create_skill` (Voyager-style procedural memory) — saving a reusable procedure (and optional script) for future runs. Override the directory with `CADUCEUS_SKILLS_DIR`.
- **Knowledge** (declarative — *facts* about the workspace) uses the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf): a `knowledge/` bundle of Markdown concept files with YAML frontmatter (required `type`). The concept catalog is advertised in the prompt; the agent loads bodies with `read_concept` and can author durable knowledge back with `write_concept` / `append_log` (the LLM-wiki pattern). Override the directory with `CADUCEUS_KNOWLEDGE_DIR`.
- **Memory** (episodic — *lessons* from past tasks) is a flat-file `memory/` of Markdown notes (Reflexion-style). Titles are advertised in the prompt; the agent pulls relevant ones on demand with `recall` and records durable lessons with `remember`. Writes are intentionally strict (indiscriminate memory makes an agent worse), and storage dedupes by title. No vector store — transparent, like Anthropic's `/memories`. Override the directory with `CADUCEUS_MEMORY_DIR`.
- **Context files** `AGENTS.md`, `CLAUDE.md`, and `.cursorrules` in the working directory are loaded into the prompt automatically.

Skills and knowledge are distinct layers built on one shared Markdown+frontmatter substrate (`src/markdown/frontmatter.ts`): Skills carry procedures and executable resources; OKF carries cross-linked facts the agent can read and maintain.

## Quick start

```bash
pnpm install
export OLLAMA_API_KEY=...        # from https://ollama.com
pnpm dev "list the files in this directory and summarize the project"
```

Build a distributable CLI:

```bash
pnpm build
node dist/cli.js "your task"
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_API_KEY` | _required_ | Ollama Cloud API key |
| `OLLAMA_BASE_URL` | `https://ollama.com/v1` | OpenAI-compatible endpoint |
| `CADUCEUS_MODEL` | `qwen3-coder:480b-cloud` | Model id |
| `CADUCEUS_MAX_STEPS` | `20` | Loop iteration budget |
| `CADUCEUS_TEMPERATURE` | `0` | Sampling temperature |

CLI flags `--model` and `--max-steps` override the environment.

## Sandboxing

The `bash` tool (and any agent-generated scripts it runs) executes with defense-in-depth:

- **Env scrubbing (always on):** secret-looking variables (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, passwords, …) are stripped from the child environment, so agent-run code can't read the agent's own credentials.
- **OS sandbox via [bubblewrap](https://github.com/containers/bubblewrap):** when `bwrap` is present, commands run cwd-confined (writes limited to the workspace) with **network off by default**. No root required.
- **Graceful degradation:** if `bwrap` is missing, `auto` (default) warns once and runs unsandboxed; `CADUCEUS_SANDBOX=on` makes it a hard requirement; `off` disables it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CADUCEUS_SANDBOX` | `auto` | `off` / `auto` / `on` (require bwrap) |
| `CADUCEUS_SANDBOX_NET` | `0` | `1` to allow network inside the sandbox |

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm lint        # eslint
pnpm build       # tsup → dist/
```

## Design

The architecture and the research behind it live in [`docs/`](docs/): the agent follows a layered, cache-stable prompt and a self-registering tool registry, and is evaluated on a private task suite rather than public benchmarks.
