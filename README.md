# Caduceus

An open coding agent that runs on [Ollama Cloud](https://docs.ollama.com/cloud). Give it a task in your terminal; it inspects the workspace, edits files, runs commands, and verifies its work in a bounded reason→act loop.

## Status

Early foundation. Working today: the Ollama Cloud client, a self-validating tool registry with three built-in tools (`read_file`, `write_file`, `bash`), and the bounded agent loop with a circuit breaker. Skills, memory, prompt compression, and the evaluation harness are next — see [`docs/`](docs/).

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
