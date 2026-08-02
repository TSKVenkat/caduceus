# Research Report — Agentic AI Messaging Gateway for Caduceus

> **Scope.** How to add a fourth front end to Caduceus — a messaging gateway
> (Slack Socket Mode, WhatsApp via Baileys, Telegram, Discord) — that drives the
> existing single engine in `src/engine/`, with session management, streaming,
> human-in-the-loop approvals, security, and Docker hosting. The reference
> design is the Hermes *Agent framework* gateway (NousResearch/hermes-agent),
> ported into a TypeScript coding agent.
>
> **How to read this.** Each section states the pattern, the evidence (with
> sources), and a concrete recommendation for Caduceus. Bracketed `[Sn]` markers
> point to the source list at the end. Cross-references like `[ARCH §x]` point
> to [ARCHITECTURE.md](ARCHITECTURE.md); `[RR2 §x]` to
> the project research notes.

---

## 0. What Caduceus already has (the porting surface)

The gateway is not a new agent — it is a new *adapter* over the existing
headless engine. Three pieces already in the tree make this a small, idiomatic
addition rather than a rewrite:

- **`src/engine/session.ts` — `buildSession({cwd, client})`.** Builds the tool
  registry (builtins + skills, knowledge, memory, artifacts, MCP, delegate) and
  the tiered system prompt **once**, and returns a `Session`. A gateway should
  call this exactly once per process and share the resulting `registry` /
  `systemPrompt` across all platform conversations, exactly as `src/web/server.ts`
  does with its lazy `enginePromise` `[ARCH §"One engine, three front ends"]`.
- **`src/engine/conversation.ts` — `Conversation`.** Holds multi-turn message
  history (seeded with the stable system prompt so the prefix stays
  cache-friendly) and exposes `send(userText, turn)` with `onEvent` / `onToken`
  callbacks. This is the exact seam a gateway needs: per-session history + a
  streaming hook per turn `[ARCH §"The agent loop"]`.
- **`src/web/server.ts` — the queue-while-in-flight pattern.** The web server
  already keeps a `Map<string, Conversation>` and serializes SSE writes through a
  `queue = queue.then(...)` chain so a second request on the same session does
  not interleave with an in-flight turn. A messaging gateway faces the identical
  problem (a user typing while the agent is still running) and should reuse this
  exact pattern.
- **`src/exec/approval.ts` — `ApprovalRequest`, `Approver`, `classifyCommand`,
  `denyApprover`, `readlineApprover`.** The approval contract already exists: a
  `{tool, command, reason}` request and an `Approver` returning `Promise<boolean>`.
  The CLI's `readlineApprover` is one implementation; a chat-based approver
  (inline buttons / `y`/`N` text) is just another `Approver` against the same
  interface `[ARCH §Sandboxing]`.

**Implication:** the port is mostly *plumbing around* `Conversation` — platform
adapters that translate inbound chat events into `conversation.send(...)` and
route `onToken` / `onEvent` / approval callbacks back out as chat messages.

---

## 1. Single-agent + messaging-gateway architecture

### Pattern

Anthropic's "Building effective agents" is emphatic that the most successful
agent implementations use **simple, composable patterns rather than complex
frameworks**, and that an agent "is typically just an LLM using tools based on
environmental feedback in a loop" `[S1]`. The OpenAI Agents SDK codifies the
same shape: an agent run is a bounded loop over tools, with the application
owning deployment, tool implementations, and state storage while the SDK runs
the loop `[S2]`.

For a *gateway* specifically, the recurring production shape is:

```
                 ┌─────────────────────────────────────────┐
 platform event  │  Platform adapters (plugins)            │
 ──────────────▶ │   slack · whatsapp · telegram · discord │
                 └──────────────────┬──────────────────────┘
                                    │ normalized InboundMessage
                                    ▼
                 ┌─────────────────────────────────────────┐
                 │  Gateway core: session router + bus     │
                 │   - session keying                      │
                 │   - in-flight queue per session         │
                 │   - approval broker                     │
                 │   - delivery idempotency                │
                 └──────────────────┬──────────────────────┘
                                    │ Conversation.send(text, turn)
                                    ▼
                 ┌─────────────────────────────────────────┐
                 │  Caduceus engine (existing)             │
                 │   buildSession() + Conversation         │
                 │   onToken / onEvent / confirm           │
                 └──────────────────┬──────────────────────┘
                                    │ OutboundChunk / ApprovalRequest
                                    ▼
                 ┌─────────────────────────────────────────┐
                 │  Platform adapters (plugins, reused)    │
                 │   post / edit / button / react          │
                 └─────────────────────────────────────────┘
```

A **normalized message bus** (`InboundMessage`, `OutboundChunk`,
`ApprovalRequest`, `ApprovalResponse`) sits between the platform adapters and
the engine. Each adapter is a pair `(ingest, emit)` translating one platform's
wire format to/from the normalized types. The engine never sees Slack or
WhatsApp — it sees `Conversation.send`.

### One-process-per-platform vs. one process with multiple adapters

| | One process, multiple adapters | One process per platform |
|---|---|---|
| **State sharing** | Trivial: one `buildSession`, one `registry`, shared MCP connections, shared memory/knowledge dirs | Must be rehydrated per process or via a shared store |
| **Cache reuse** | One stable system prefix across all platforms maximizes prompt-cache hits `[S11]` | Each process maintains its own cache relationship |
| **Failure isolation** | A crash takes down all platforms | A crash is scoped to one platform |
| **Scaling** | Vertical; one Node event loop | Horizontal; can scale Slack independently of WhatsApp |
| **Token/credential collision** | Must serialize per-platform tokens in-process (see §7) | Natural isolation |

**Recommendation.** Caduceus is a single-agent, single-cwd coding tool, not a
multi-tenant SaaS — **one process, multiple adapters** is the right default. It
matches the existing "one engine, three front ends" principle `[ARCH]`, keeps the
prompt-cache prefix stable `[S11]`, and lets the existing `.caduceus/` state
directory (sessions, skills, memory) be shared. Reserve separate processes only
if a specific platform's library is crash-prone (Baileys' WhatsApp Web
reverse-engineering can be brittle `[S7]`) — in that case run Baileys in a child
worker process and bridge over a normalized IPC channel, keeping the engine in
the parent.

**Adapter pattern contract** (TypeScript sketch):

```ts
interface InboundMessage {
  platform: "slack" | "whatsapp" | "telegram" | "discord";
  sessionKey: string;        // see §2
  userId: string;            // for allowlist (§5)
  text: string;
  threadTs?: string;         // platform-native reply anchor
  raw: unknown;              // original payload, for audit logs
}

interface PlatformAdapter {
  name: string;
  start(onMessage: (m: InboundMessage) => void): Promise<void>;
  send(key: string, chunk: OutboundChunk): Promise<DeliveredMessage>;
  edit(key: string, messageId: string, chunk: OutboundChunk): Promise<void>;
  presentApproval(req: ApprovalRequest): Promise<ApprovalResponse>;
  stop(): Promise<void>;
}
```

Each adapter registers `ingest` + `emit` against this interface; the gateway
core is platform-agnostic. This is the same shape as the MCP client adapter in
`src/mcp/` (`connectMcpServers` adapting external tools into the registry)
`[ARCH §MCP]` — extend that idiom to messaging.

---

## 2. Session management for messaging

### Keying: per-user vs per-chat vs per-thread

- **Slack:** a channel can have many users; a *thread* is the natural
  conversation boundary. Use `${teamId}:${channelId}:${threadTs}` as the session
  key. In a DM, `channelId` alone suffices. Slack threads map cleanly onto a
  `Conversation` (one history per thread).
- **WhatsApp (Baileys):** chats are 1:1 or group. Key per-`jid`; for groups,
  require an @-mention or a prefix to avoid the agent answering every message
  `[S7]`.
- **Telegram:** `chatId` identifies the conversation; forum topics add
  `message_thread_id` `[S5]`. Key `${chatId}:${messageThreadId?}`.
- **Discord:** `${guildId}:${channelId}:${threadId?}`.

**Recommendation:** a **composite, platform-qualified session key**
`${platform}:${platformNativeId}`. Within a session, the agent's working
context is the conversation; across sessions, shared *memory* (not shared
history) carries lessons forward — matching Caduceus's existing split between
`Conversation` (per-session history) and `memory/` (cross-session episodic)
`[ARCH §Memory]`.

### Concurrent users and queuing while in-flight

An agent turn can take seconds to minutes. A second message arriving mid-turn
must not start a parallel turn on the same `Conversation` (that would corrupt
the shared message history and break prompt-cache prefix stability `[S11]`).
The web server already solves this with a per-session `queue = queue.then(...)`
chain in `src/web/server.ts`. **Reuse it verbatim**: one in-flight promise per
session key, incoming messages enqueue against it, and a short "I'm still
working on your last request" acknowledgment can be sent if the queue depth
exceeds one.

### Reset policies (context/cost control)

A coding-agent conversation over chat grows unboundedly without intervention.
Three complementary controls, all already foreshadowed by Caduceus's tiered
context model `[ARCH §"The system prompt"]`:

1. **Idle timeout.** Reset (or archive) a `Conversation` after N minutes of
   inactivity (e.g. 30 min). Frees memory; the next message starts fresh with
   the stable system prompt (which re-caches cheaply `[S11]`).
2. **Daily reset.** Bound cost: a session persists for at most one calendar day,
   then is archived to `.caduceus/sessions/` (the existing store) and a new
   `Conversation` is seeded. The old one is resumable on demand.
3. **Compression before reset.** Before discarding, flush a Reflexion-style
   memory entry summarizing what was learned, so the next session recalls it
   via `memory/` rather than re-reading history `[ARCH §Memory]` `[S10]`.

### Cross-session memory

Caduceus already has this: episodic `memory/` is loaded by `buildSession` and
injected into the context tier `[ARCH §Memory]`. A messaging session should
write to the same `memory/` directory, so a lesson learned over Slack is
available over WhatsApp. **Do not** share live `Conversation` history across
sessions — that would merge unrelated threads and break cache prefixes.

---

## 3. Streaming agent output to chat platforms ("post-then-edit")

### The pattern

LLM responses are produced token-by-token; chat platforms are message-oriented.
The standard reconciliation is **post-then-edit**: post a placeholder message,
then progressively edit it as tokens arrive, throttled to avoid rate limits.
This is the chat analog of Caduceus's existing `onToken` streaming hook
(`Conversation.send(..., { onToken })`).

### Per-platform capabilities

| Platform | Post | Edit | Notes |
|---|---|---|---|
| **Slack** | `chat.postMessage` | `chat.update` (same `channel`+`ts`) | Edits supported; rate-limited (~1 req/sec per channel for bursts). Socket Mode receives the resulting events `[S3]` |
| **Telegram** | `sendMessage` | `editMessageText` (same `chat_id`+`message_id`) | Edits supported; Bot API 10.1 adds `sendRichMessageDraft` / `sendMessageDraft` for native streaming drafts `[S5]` |
| **WhatsApp (Baileys)** | `sendMessage` | **No first-class edit.** Baileys can send a *deletion + rewrite*, but WhatsApp itself has no public "edit message" for bot-style automation; edits are client features with tight windows | Append new messages instead of editing; see §5 on the 24-hour rule `[S7]` |
| **Discord** | `createMessage` | `editMessage` | Edits supported; rate limits are token-bucket per route |

### Throttling, chunking, and when to give up on editing

- **Throttle edits to ~1 update/sec** (or coalesce N tokens before an edit).
  Slack and Telegram both rate-limit aggressive edits; a flood of `chat.update`
  calls will 429. Caduceus's `onToken` fires per token — buffer into a
  `pendingText` string and flush on a 1s interval or a size threshold.
- **Chunk on whitespace** so edits land at readable boundaries, not mid-word.
- **Give up on editing and append** when (a) the platform has no edit support
  (WhatsApp), (b) the message exceeds the platform's max length (Slack
  ≈ 40,000 chars/block; Telegram 4096 chars/message), or (c) the edit API
  returns `too_many_requests` repeatedly. At that point, post a *new* message
  and continue streaming into it. Keep a per-session "current streaming
  message" handle `{platform, channel, messageId}` so the next chunk knows
  whether to edit or append.

**Recommendation.** Implement a `StreamingPost` helper in the gateway core
that takes an `onToken`-style async iterator and a `PlatformAdapter`, and
encapsulates the edit-vs-append decision. Adapters expose `send` and `edit`;
the helper owns throttling, length caps, and the fallback-to-append rule. This
keeps platform-specific limits out of the engine.

---

## 4. Human-in-the-loop approvals over chat

### The contract already exists

`src/exec/approval.ts` defines `ApprovalRequest {tool, command, reason}` and
`Approver = (req) => Promise<boolean>`, plus `classifyCommand` flagging
destructive patterns (recursive delete, `sudo`, `curl|sh`, force-push, etc.)
`[ARCH §Sandboxing]`. The CLI's `readlineApprover` is one `Approver`; the
gateway needs a **chat-based `Approver`** against the identical interface. The
`Conversation` already forwards `confirm` through to `runTurn`
(`src/engine/conversation.ts:46`).

### Surfacing approvals

- **Inline buttons** where supported: Slack Block Kit `actions` blocks with
  Approve/Deny buttons (delivered over Socket Mode `[S3]`); Telegram
  `InlineKeyboardMarkup` with callback buttons `[S5]`; Discord buttons.
  Buttons are unambiguous and produce a structured `ApprovalResponse` with one
  tap.
- **Text `y`/`N` fallback** for WhatsApp (no reliable inline buttons for
  automated accounts `[S7]`) and for users who type instead of tapping. Parse
  the next inbound message from the *same user* on the *same session* as the
  response; ignore messages from other users.

### Request/respond contract, timeouts, default-deny

The OpenAI Agents SDK models this as a `RunToolApprovalItem` that **pauses the
run** until the human responds — the run does not proceed, but it is not
deadlocked because it is suspended, not spinning `[S2]`. Port that semantics:

1. Agent calls a risky tool → `classifyCommand` flags it → the loop pauses,
   holding the `ApprovalRequest`.
2. Adapter posts the request (buttons or `y`/`N`) and parks a `Promise` plus a
   timer.
3. On response (button callback or matching text), the Promise resolves
   `true`/`false`.
4. **Default-deny on timeout** (e.g. 5 minutes): resolve `false`, log the
   denial, and let the agent continue with a tool result of "approval denied by
   user (timeout)". This is the `denyApprover` path already in
   `src/exec/approval.ts:61`.

### Avoiding deadlock

The agent must never block *the event loop* waiting for a human. The pause is
an `await` on a Promise that is resolved asynchronously by the platform's
inbound-event handler. The Node process stays responsive to other sessions and
other platforms. Concretely: the approver Promise lives in a
`Map<approvalId, {resolve, timer}>` keyed by a nonce embedded in the button
`value` / text parse. Timeouts use `setTimeout` and clear on resolution. This
mirrors how `src/web/server.ts` keeps the SSE stream open across a long
`conversation.send` without blocking other requests.

---

## 5. Security for messaging gateways

A coding agent reachable over chat can run shell commands, edit files, and push
git. That is a high-trust surface. Layered defenses, most of which Caduceus
already implements internally `[ARCH §Sandboxing]` — the gateway adds the
*network* layer:

### Allowlists (identity)

- **Slack:** scope the app to one workspace (the bot token is workspace-scoped);
  optionally restrict to a list of `user_id`s and `channel_id`s. Socket Mode
  avoids exposing any public HTTP endpoint at all `[S3]`.
- **WhatsApp:** Baileys exposes the full WhatsApp account; gate by an allowlist
  of phone-number JIDs. Anything outside the list is ignored (not even
  acknowledged) `[S7]`.
- **Telegram:** allowlist `chat_id` values; the bot token is a secret but any
  user can message a bot by default `[S5]`.
- **Discord:** allowlist guild + user IDs.

Load allowlists from env (`CADUCEUS_ALLOWLIST` comma-separated, or a JSON file)
at startup; deny by default if the list is empty *and* the gateway is exposed.

### DM pairing

For platforms where the bot is discoverable (Telegram, Discord), require an
out-of-band pairing step: the operator generates a one-time pairing code, the
user DMs it to the bot, and the resulting `userId` is added to the allowlist.
This prevents drive-by abuse of a publicly-known bot username.

### Secret scrubbing

Already present: `src/exec/sandbox.ts` strips secret-looking environment
variables from tool subprocesses `[ARCH §Sandboxing]`. The gateway adds a
second scrub at the *outbound* boundary — never echo a tool result containing
secret patterns (API keys, tokens) back into chat. A redactor on `OutboundChunk`
before `adapter.send` is cheap insurance.

### Sandboxing command execution

Already present: bubblewrap confinement to the working directory with
networking off, env scrubbing, and a functional probe that degrades gracefully
`[ARCH §Sandboxing]`. For a chat-reachable agent this is **non-optional** — set
`CADUCEUS_APPROVAL=prompt` (the gateway's chat approver) as the default, and
keep OS isolation on. The classification rules in `approval.ts` are the first
gate; the sandbox is the backstop.

### The WhatsApp 24-hour rule

WhatsApp Business API (Cloud API) restricts businesses to sending *template*
messages outside a 24-hour customer-service window initiated by the user. **Baileys
is not the Business API** — it drives a regular WhatsApp Web account, so the
24-hour template rule does not apply in the same way `[S7]`. **Trade-off:**
Baileys (personal-style account) avoids the template/window constraints but
violates WhatsApp's Terms of Service for automated messaging and carries
ban risk. The Baileys README explicitly disclaims ToS compliance and warns
against bulk/automated messaging `[S7]`. **Recommendation:** for a personal
coding assistant used by the operator and a small allowlist, Baileys is the
pragmatic choice; for any production/shared deployment, use the WhatsApp
Business Cloud API and design around the 24-hour window (queue outbound
messages if the window closed; surface "session expired" to the agent).

### Slack workspace scoping

A Slack app's bot token (`xoxb-`) is scoped to one workspace; the app-level
token (`xapp-`) drives Socket Mode. Scopes are granular (`app_mentions:read`,
`chat:write`, etc.) `[S3]`. Request the minimum scopes; prefer
`app_mention` over `message.im`/`message.channels` to avoid receiving every
message in every channel the bot is in.

---

## 6. Docker hosting for an always-on agent gateway

A messaging gateway must stay up — it is the agent's only door to the user.
Docker best practices (Docker's own guide `[S8]`, tini `[S6]`) map cleanly:

### Non-root user

Docker's `USER` guidance: create a non-root user with an **explicit UID/GID**
(deterministic across rebuilds) and avoid `sudo`, using `gosu` if a privilege
drop is needed `[S8]`. For Caduceus:

```dockerfile
RUN groupadd -r --gid 1001 caduceus \
 && useradd --no-log-init -r --uid 1001 -g caduceus caduceus
USER 1001:1001
```

### tini for PID 1 / zombie reaping

Node.js as PID 1 does not reap orphaned child processes (the agent's `bash`
tool spawns subprocesses), leading to zombie accumulation. tini is "a tiny but
valid `init`" that reaps zombies and forwards signals `[S6]`. Docker ≥ 1.13
bundles tini — pass `--init` to `docker run`, or set it in the ENTRYPOINT
`[S6]`:

```dockerfile
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/gateway.js"]
```

Use the **exec form** so signals reach the right process `[S8]`. With tini,
`SIGTERM` properly terminates Node even without an explicit handler, which
matters for graceful drain (below).

### Volumes for persistent state & secrets

Mount the `.caduceus/` directory (sessions, memory, skills, knowledge, the MCP
config, the audit log) and the Baileys auth state as volumes `[ARCH §"One
engine"]`. Docker's `VOLUME` guidance: use it for "mutable or user-serviceable
parts" `[S8]`. Pass secrets (Slack tokens, Ollama API key) via env vars or
Docker secrets (`--mount type=secret`) — never bake them into the image `[S8]`:

```bash
docker run --init --rm \
  -v "$PWD/.caduceus:/app/.caduceus" \
  -v "$PWD/baileys-auth:/app/baileys-auth" \
  --env-file .env \
  -p 4100:4100 \
  caduceus-gateway:latest
```

### Network mode: host vs. bridge

- **Bridge (default)** is correct for the gateway — it only needs *outbound*
  connections (Slack Socket Mode WebSocket, Telegram getUpdates/webhook,
  Baileys WebSocket, Ollama Cloud API). No inbound ports are required when using
  Socket Mode / getUpdates.
- **`network_mode: host`** is occasionally used when a platform callback must
  reach `localhost` on the host (e.g. a Telegram webhook to a local reverse
  proxy, or the gateway calling a host-local Ollama daemon). It trades
  isolation for convenience and is generally discouraged; prefer explicit port
  publishing or `host.docker.internal` `[S8]`.

**Recommendation:** bridge networking + Socket Mode (Slack) / getUpdates long
polling (Telegram) / WebSocket (Baileys) so **no inbound port is needed at all**.
This is the most secure default and works behind corporate firewalls — exactly
the use case Slack Socket Mode was designed for `[S3]`.

### Healthchecks, graceful shutdown, restart policy

- **HEALTHCHECK** (Dockerfile instruction `[S9]`): a trivial `node -e "fetch('http://localhost:4100/health')"` or an internal liveness probe. Docker restarts
  unhealthy containers when combined with a restart policy.
- **Graceful shutdown / drain:** on `SIGTERM`, stop accepting new turns, let
  in-flight `Conversation.send` calls complete (or checkpoint them to
  `.caduceus/sessions/`), close platform WebSockets cleanly (ack pending
  envelopes for Slack `[S3]`), flush logs, then exit. tini forwards `SIGTERM`
  to Node `[S6]`; an explicit `process.on('SIGTERM')` handler in the gateway
  orchestrates the drain.
- **Restart policy:** `docker run --restart=unless-stopped` (or `on-failure:5`
  to avoid a crash loop storm). For Baileys specifically, auto-reconnect logic
  is essential because the WhatsApp Web WebSocket drops regularly `[S7]`.

### Env-var config & UID/GID remapping

Caduceus already configures via env (`CADUCEUS_APPROVAL`, `CADUCEUS_SKILLS_DIR`,
etc. `[ARCH §Sandboxing]`). Extend with `CADUCEUS_GATEWAY_PLATFORMS`,
`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `TELEGRAM_BOT_TOKEN`, allowlist env vars.
Support UID/GID remapping by honoring `PUID`/`PGID` env vars in an entrypoint
script using `gosu` to drop from root to the configured UID on first start
(common pattern for self-hosted containers) `[S8]`.

---

## 7. Concurrency & isolation

- **One agent instance per session.** One `Conversation` per session key, with
  the in-flight queue (§2) serializing turns. Multiple sessions run concurrently
  in the same Node event loop, sharing the single `buildSession` registry and
  system prompt — this maximizes prompt-cache reuse `[S11]`.
- **Subagent delegation** is already bounded and isolated: `createDelegateTool`
  runs subagents with a step budget and a concurrency cap (`maxSteps: 10,
  maxConcurrency: 4` in `src/engine/session.ts:80`), no nesting `[ARCH
  §Subagents]`. The gateway inherits this for free.
- **No shared mutable state across sessions.** The only shared objects are the
  read-only `registry` and `systemPrompt` (built once) and the append-only
  on-disk stores (`memory/`, `knowledge/`, `artifacts/`). `Conversation`
  instances are private to their session key. This matches Anthropic's
  guidance to keep the agent loop simple and state explicit `[S1]`.
- **Token/credential locks.** Each platform adapter holds its own credentials
  (Slack `xoxb-`/`xapp-`, Telegram bot token, Baileys auth creds). Use a
  per-adapter mutex around token use if a platform serializes on a single
  credential — e.g. one Baileys socket = one WhatsApp account; two sessions
  must not spawn two sockets on the same creds or they will collide and
  invalidate each other's sessions `[S7]`. Slack Socket Mode allows up to 10
  concurrent WebSocket connections for load balancing, but payloads may arrive
  on any of them `[S3]` — if using multiple connections, demux by `envelope_id`
  and route to the owning session.

---

## 8. Reliability

- **Retries with backoff for the LLM provider.** Ollama Cloud is an
  OpenAI-compatible endpoint `[RR2 §5]`; wrap the model client with exponential
  backoff on 429/5xx, a request timeout, and a max-retry cap. The OpenAI
  Agents SDK exposes a `RetryPolicy` abstraction for exactly this `[S2]`;
  Caduceus's `ModelClient` interface (`src/model/client.ts`) is the place to
  add it.
- **Stale-call detection.** Tag each turn with a monotonic `runId`; if a
  streaming `onToken` arrives for a run that the session has superseded (user
  sent a new message that started a fresh turn), discard it. This prevents
  late tokens from a slow first turn bleeding into the second turn's output
  message.
- **Fallback models.** Config already supports a default candidate
  (`qwen3-coder:480b-cloud`) `[RR2 §5]`; add a `CADUCEUS_FALLBACK_MODEL` so a
  primary model outage degrades to a cheaper/smaller model rather than failing
  the turn.
- **Request timeouts.** Per-turn wall-clock cap (e.g. 10 min) via
  `AbortSignal` — the existing `TurnOptions.signal` (`src/engine/conversation.ts:21`)
  already supports cancellation. The gateway sets the signal and aborts on
  timeout, surfacing "timed out" to the user.
- **Idempotency for message delivery.** Reconnects (especially Baileys
  `[S7]` and Slack Socket Mode refreshes `[S3]`) can redeliver inbound events.
  Dedupe on a per-platform idempotency key: Slack `message_ts` / envelope
  `envelope_id` `[S3]`, Telegram `update_id` `[S5]`, Baileys message `key.id`.
  Keep an LRU of seen keys per session. Slack explicitly requires
  acknowledging each envelope `[S3]`; do so *after* enqueuing, not after the
  turn completes, so Slack does not retry.

---

## 9. Observability

Caduceus's `AGENTS.md` already mandates small, verifiable changes and
typecheck/lint/test. The gateway adds three log streams, written to files under
`.caduceus/logs/` (mounted as a volume, §6):

- **`gateway.log`** — structured (JSON) per-event: `{ts, platform, sessionKey,
  event, runId}`. Covers inbound message receipt, session create/reset, turn
  start/stop, outbound post/edit, reconnects.
- **`agent.log`** — the engine's existing event stream (`step`, `assistant`,
  `tool_call`, `tool_result`, `compress` `[ARCH §"The agent loop"]`), tagged
  with `sessionKey` so a chat session's trajectory is reconstructable.
- **`errors.log`** — exceptions, API failures, approval timeouts, sandbox
  denials. Separated so it can be tailed/alerted independently.

**Session trajectories:** persist each turn's message list to
`.caduceus/sessions/` (the existing store used by `src/web/server.ts`), keyed by
session key, so a chat session can be resumed and audited just like a web
session.

**Audit logs for approvals/installs:** the skills hub already keeps an
append-only audit log with content hashes `[ARCH §"Skills hub"]`. Extend the
same append-only audit log to record every approval decision `{ts, sessionKey,
userId, tool, command, verdict, reason}` — this is the safety-critical record
for a chat-reachable agent that can run shell.

---

## 10. Context engineering for messaging agents

Caduceus's three-tier prompt is the central asset to preserve
`[ARCH §"The system prompt"]`:

- **Stable** (identity, tool list, skill catalog) — never changes within a
  session.
- **Context** (project files, knowledge, memories, artifacts) — rebuilt per
  turn from disk.
- **Volatile** (timestamp, per-turn data) — placed last.

Anthropic's prompt-caching documentation is precise about why this ordering
matters and what breaks it `[S11]`:

1. **Cache prefixes are cumulative.** `tools` → `system` → `messages`, in that
   order; a change at any level invalidates that level *and everything after
   it* `[S11]`.
2. **Cache writes happen only at the breakpoint; reads look backward up to 20
   blocks** for an entry an earlier request wrote `[S11]`. So the breakpoint
   must sit on the **last block that stays identical across requests** — i.e.
   the end of the stable prefix, *not* on a per-turn timestamp block.
3. **The classic mistake:** putting `cache_control` on a block that changes
   every request (a timestamp, the incoming user message). The prefix hash
   never matches, the lookback finds no prior write, and you pay for a full
   cache write every turn — exactly the anti-pattern `[S11]`.

**Recommendations for the gateway:**

- **Do not mutate the system prompt mid-conversation.** The stable tier is
  built once by `buildSession` and reused across all sessions and all turns
  `[ARCH]`. A per-platform preamble ("you are speaking over Slack") belongs in
  the *context* or *volatile* tier, not in the stable prefix, or it will
  fragment the cache across platforms `[S11]`.
- **Preserve the breakpoint at the end of the stable prefix.** If the provider
  supports explicit `cache_control` (Anthropic-style `[S11]`), place it on the
  last stable block; for OpenAI-compatible providers (Ollama Cloud `[RR2 §5]`),
  rely on automatic prefix caching and keep the prefix byte-identical across
  turns.
- **Context compression near limits.** Caduceus already has an optional
  LLMLingua-2 compression hook (`src/compress/`) `[ARCH §"Prompt compression"]`.
  In a messaging context, where conversations drift long, enable it
  size-gated so large tool outputs are compressed before they bloat history.
  Pair with the idle/daily reset (§2) as a hard backstop.
- **Memory flush before reset.** On session reset, write a Reflexion-style
  episodic entry to `memory/` summarizing what was done, so the next session
  recalls it without re-reading the full history `[ARCH §Memory]` `[S10]`.
  This is the "context compression when approaching limits" + "memory flush
  before reset" combination, and it is already structurally supported.

---

## 11. Concrete port plan into Caduceus

A minimal, phased port that reuses the existing engine and matches the repo's
conventions (TypeScript, ESM, strict, pnpm; small composable tools under
`src/`; Zod at boundaries `[AGENTS.md]`):

**Phase A — Gateway skeleton (one platform: Slack Socket Mode).**
- New `src/gateway/` with: `types.ts` (`InboundMessage`,
  `OutboundChunk`, `ApprovalRequest`, `ApprovalResponse`, `PlatformAdapter`),
  `core.ts` (session router + per-session in-flight queue, lifted from
  `src/web/server.ts`), `approver.ts` (chat `Approver` implementing the
  `src/exec/approval.ts` `Approver` interface with inline buttons + `y`/`N`
  fallback + default-deny timeout).
- `src/gateway/adapters/slack.ts` using `@slack/socket-mode` + `@slack/web-api`
  (Socket Mode: no inbound port, ideal for Docker `[S3]`).
- `src/gateway/cli.ts` entrypoint (`caduceus-gateway`) wired into `package.json`
  `bin`, mirroring `src/web/cli.ts`.
- Reuses `buildSession` + `Conversation` unchanged.

**Phase B — Streaming post-then-edit.**
- `src/gateway/streaming.ts`: `StreamingPost` helper with throttled edit,
  length caps, fallback-to-append; drives `onToken` from `Conversation.send`.
- Adapter methods `send` / `edit` per the table in §3.

**Phase C — Approvals over chat.**
- Slack Block Kit buttons → `ApprovalResponse`; text `y`/`N` fallback.
- Wire the chat approver into `Conversation` via the existing `confirm` option.

**Phase D — Additional platforms.**
- `src/gateway/adapters/telegram.ts` (getUpdates long polling or webhook;
  `editMessageText` for edits `[S5]`).
- `src/gateway/adapters/whatsapp.ts` (Baileys `[S7]`; append-only, no edit;
  allowlist-gated; 24-hour-rule note documented).
- `src/gateway/adapters/discord.ts` (discord.js; buttons + edits).

**Phase E — Docker hosting.**
- `Dockerfile.gateway` (multi-stage `[S8]`, non-root explicit UID, tini
  ENTRYPOINT `[S6]`, HEALTHCHECK `[S9]`), `.dockerignore`, `docker-compose.yml`
  with volume mounts for `.caduceus/` and Baileys auth, `--restart=unless-stopped`,
  graceful `SIGTERM` drain.

**Phase F — Reliability & observability.**
- LLM client retries/backoff/timeout (`src/model/client.ts`), stale-run
  detection by `runId`, idempotency LRU per platform, fallback model env var.
- Structured `gateway.log` / `agent.log` / `errors.log`; append-only approval
  audit log extending the skills-hub audit pattern `[ARCH §"Skills hub"]`.

**Checks before finishing** (per `AGENTS.md`): `pnpm typecheck`, `pnpm lint`,
`pnpm test` must pass after each phase.

---

## Sources

- `[S1]` Anthropic, "Building effective agents," Dec 2024 —
  https://www.anthropic.com/engineering/building-effective-agents
- `[S2]` OpenAI, "Agents SDK" overview (JS/TS), 2026 —
  https://platform.openai.com/docs/guides/agents  ·  repo:
  https://github.com/openai/openai-agents-js  ·  Human-in-the-loop guide:
  https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
- `[S3]` Slack, "Using Socket Mode" —
  https://api.slack.com/apis/events-api/using-socket-mode  (WebSocket, no
  public Request URL, app-level token, envelope ack, up to 10 connections,
  refresh/disconnect handling)
- `[S5]` Telegram, "Bot API" (editMessageText, sendMessageDraft,
  InlineKeyboardMarkup, getUpdates/setWebhook, update_id) —
  https://core.telegram.org/bots/api
- `[S6]` krallin/tini, "A tiny but valid init for containers" (PID 1, zombie
  reaping, signal forwarding, `--init` flag) —
  https://github.com/krallin/tini
- `[S7]` WhiskeySockets/Baileys, "Socket-based TS/JavaScript API for WhatsApp
  Web" (not the Business API; ToS disclaimer; ban risk for automation) —
  https://github.com/WhiskeySockets/Baileys
- `[S8]` Docker, "Docker build best practices" (multi-stage, non-root USER with
  explicit UID/GID, gosu, VOLUME, exec-form ENTRYPOINT, ephemeral containers) —
  https://docs.docker.com/build/building/best-practices/
- `[S9]` Docker, "Dockerfile reference" (HEALTHCHECK, USER, VOLUME, STOPSIGNAL) —
  https://docs.docker.com/reference/dockerfile/
- `[S10]` Reflexion (episodic memory of reflections) — see [REFERENCES.md §10]
  (arXiv:2303.11366)
- `[S11]` Anthropic, "Prompt caching" (cache_control, prefix hierarchy
  tools→system→messages, 20-block lookback, breakpoint-on-stable-prefix,
  invalidation table, 5-min/1-h TTL) —
  https://docs.claude.com/en/docs/build-with-claude/prompt-caching

**Internal cross-references:** [ARCHITECTURE.md](ARCHITECTURE.md) ·
the project research notes (Hermes Agent framework as
reference architecture; Ollama Cloud as the OpenAI-compatible backend) ·
[REFERENCES.md](REFERENCES.md).

**Note on Hermes Agent gateway.** The existing research
(the project research notes §"Hermes Agent framework")
identifies NousResearch/hermes-agent as the reference architecture and flags
that its specific backend-mode mechanism was *unverified* in the prior round.
The gateway patterns above are synthesized from the primary platform/API
sources `[S1]–[S11]` and Caduceus's own engine; they should be validated
against the hermes-agent source before any verbatim port, per the existing
"verify from code" caveat.
