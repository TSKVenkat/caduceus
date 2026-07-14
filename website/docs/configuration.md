# Configuration

Caduceus reads configuration from environment variables and an optional `~/.caduceus/config.yaml` file.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_API_KEY` | (required) | Ollama Cloud API key |
| `OLLAMA_BASE_URL` | `https://api.ollama.com` | API base URL |
| `CADUCEUS_MODEL` | `qwen2.5-coder:14b` | Default model |
| `CADUCEUS_APPROVAL` | `prompt` | Approval mode: `allow`/`deny`/`prompt` |
| `CADUCEUS_HOME` | `~/.caduceus` | Data directory |

## Config File

```yaml
# ~/.caduceus/config.yaml
model: "qwen2.5-coder:14b"
streaming:
  enabled: true
  edit_interval: 1.0
session_reset:
  mode: "both"
  idle_minutes: 1440
```

See the [environment variables reference](./reference/environment-variables) for the full list.
