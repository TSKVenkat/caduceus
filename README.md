# Caduceus

An open coding agent that runs on [Ollama Cloud](https://docs.ollama.com/cloud). Give it a task in your terminal; it inspects the workspace, edits files, runs commands, and verifies its work in a bounded reason→act loop.

## Status

Early foundation. Working today: the Ollama Cloud client, a self-validating tool registry with three built-in tools (`read_file`, `write_file`, `bash`), the bounded agent loop with a circuit breaker, a tiered system prompt, and Skills with progressive disclosure. Memory, prompt compression, and the evaluation harness are next — see [`docs/`](docs/).

## Skills & project context

The system prompt is assembled in three tiers — **stable** (identity, tools, skill catalog), **context** (project instruction files), **volatile** (timestamp) — in that order, so the long prefix stays cache-friendly.

- **Skills** (procedural — *how* to do things) live in `skills/<name>/SKILL.md` with `name` and `description` frontmatter. Only that metadata is loaded up front; the agent pulls a skill's full instructions on demand via the `load_skill` tool (progressive disclosure). Override the directory with `CADUCEUS_SKILLS_DIR`.
- **Knowledge** (declarative — *facts* about the workspace) uses the [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf): a `knowledge/` bundle of Markdown concept files with YAML frontmatter (required `type`). The concept catalog is advertised in the prompt; the agent loads bodies with `read_concept` and can author durable knowledge back with `write_concept` / `append_log` (the LLM-wiki pattern). Override the directory with `CADUCEUS_KNOWLEDGE_DIR`.
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

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm lint        # eslint
pnpm build       # tsup → dist/
```

## Design

The architecture and the research behind it live in [`docs/`](docs/): the agent follows a layered, cache-stable prompt and a self-registering tool registry, and is evaluated on a private task suite rather than public benchmarks.
