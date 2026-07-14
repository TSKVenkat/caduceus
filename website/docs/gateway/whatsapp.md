# WhatsApp Gateway Setup

## Prerequisites

- Node.js 18+ (Baileys requirement)
- A phone with WhatsApp installed

## Pair

```bash
export WHATSAPP_ENABLED=true
export WHATSAPP_ALLOWED_USERS=15551234567

caduceus whatsapp pair
```

Scan the QR code with WhatsApp → Settings → Linked Devices → Link a Device.

## Run

```bash
caduceus gateway run
```

The session persists in `~/.caduceus/whatsapp/session` — no re-scan needed on restart.

## Modes

- **bot** (default): Dedicated phone number, people message it directly
- **self-chat**: Use your own number, message yourself
