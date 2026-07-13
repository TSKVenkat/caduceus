# Caduceus Agent

Caduceus is an open coding agent that runs on Ollama Cloud. It supports CLI, TUI, web UI, and a messaging gateway (Slack, WhatsApp) — all driving a single headless engine.

## Quick Start

```bash
# Install
pnpm install

# Set your API key
export OLLAMA_API_KEY=your-key

# Run a task
pnpm dev "explain this codebase"

# Or start the interactive TUI
pnpm dev
```

## Gateway

Connect Caduceus to Slack and WhatsApp:

```bash
# Slack setup
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
caduceus gateway run

# WhatsApp setup
export WHATSAPP_ENABLED=true
caduceus whatsapp pair
caduceus gateway run
```

## Docker

```bash
CADUCEUS_UID=$(id -u) CADUCEUS_GID=$(id -g) docker compose up -d
```

See the [gateway docs](./gateway/slack) for detailed setup guides.
