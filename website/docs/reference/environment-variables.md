# Environment Variables Reference

## Core

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_API_KEY` | (required) | Ollama Cloud API key |
| `OLLAMA_BASE_URL` | `https://api.ollama.com` | API base URL |
| `CADUCEUS_MODEL` | `qwen2.5-coder:14b` | Default model |
| `CADUCEUS_HOME` | `~/.caduceus` | Data directory |
| `CADUCEUS_APPROVAL` | `prompt` | Approval mode |

## Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_ALLOW_ALL_USERS` | `false` | Skip allowlist |
| `SLACK_BOT_TOKEN` | — | `xoxb-` token |
| `SLACK_APP_TOKEN` | — | `xapp-` token for Socket Mode |
| `SLACK_ALLOWED_USERS` | — | Comma-separated Member IDs |
| `WHATSAPP_ENABLED` | `false` | Enable WhatsApp |
| `WHATSAPP_ALLOWED_USERS` | — | Comma-separated phone numbers |
| `WHATSAPP_MODE` | `bot` | `bot` or `self-chat` |

## API Server

| Variable | Default | Description |
|----------|---------|-------------|
| `API_SERVER_ENABLED` | `false` | Enable API server |
| `API_SERVER_PORT` | `8642` | HTTP port |
| `API_SERVER_HOST` | `127.0.0.1` | Bind address |
| `API_SERVER_KEY` | — | Bearer token |

## Docker

| Variable | Default | Description |
|----------|---------|-------------|
| `CADUCEUS_UID` | `10000` | Host UID for file ownership |
| `CADUCEUS_GID` | `10000` | Host GID for file ownership |
