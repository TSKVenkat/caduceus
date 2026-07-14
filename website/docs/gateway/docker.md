# Docker Hosting

## Quick Start

```bash
CADUCEUS_UID=$(id -u) CADUCEUS_GID=$(id -g) \
OLLAMA_API_KEY=your-key \
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
docker compose up -d
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| `gateway` | (none) | Slack + WhatsApp gateway (outbound only) |
| `web` | `127.0.0.1:4100` | Web dashboard (opt-in: `--profile web`) |
| `api` | `127.0.0.1:8642` | OpenAI-compatible API (opt-in: `--profile api`) |

## Data Persistence

State is persisted in `~/.caduceus` mounted at `/opt/data`:
- `sessions/` — conversation transcripts
- `whatsapp/session/` — Baileys auth state
- `cache/` — downloaded media files
