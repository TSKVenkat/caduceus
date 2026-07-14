# OpenAI-Compatible API Server

Caduceus exposes an OpenAI-compatible API server for integration with any OpenAI-compatible frontend.

## Quick Start

```bash
export API_SERVER_ENABLED=true
export API_SERVER_KEY=your-secret-key
caduceus api
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | Chat Completions (stateless, streaming supported) |
| `GET` | `/v1/models` | List available models |
| `GET` | `/health` | Health check |

## Authentication

Bearer token via `Authorization: Bearer <API_SERVER_KEY>`. Required when bound to non-loopback addresses.

## Example

```bash
curl http://localhost:8642/v1/chat/completions \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"caduceus","messages":[{"role":"user","content":"Hello!"}]}'
```
