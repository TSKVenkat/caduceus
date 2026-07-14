# Slack Gateway Setup

## Prerequisites

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** (Settings → Socket Mode → ON)
3. Create an **App-Level Token** with `connections:write` scope
4. Subscribe to bot events: `message.im`, `message.channels`, `app_mention`
5. Add bot scopes: `chat:write`, `app_mentions:read`, `im:history`, `im:read`, `files:read`, `files:write`
6. Install app to workspace

## Configure

```bash
export SLACK_BOT_TOKEN=xoxb-your-bot-token
export SLACK_APP_TOKEN=xapp-your-app-token
export SLACK_ALLOWED_USERS=U01ABC2DEF3
```

## Run

```bash
caduceus gateway run
```

The bot responds to DMs automatically and to @mentions in channels it's invited to.
