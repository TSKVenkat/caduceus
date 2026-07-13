# Installation

## Prerequisites

- Node.js 20+
- pnpm 10+
- An Ollama Cloud API key

## Install

```bash
git clone https://github.com/TSKVenkat/caduceus.git
cd caduceus
pnpm install
pnpm build
```

## Verify

```bash
export OLLAMA_API_KEY=your-key
pnpm dev "hello"
```

You should see the agent process the task and respond.
