# High-Level Design

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?logo=nodedotjs&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?logo=ollama&logoColor=white)
![Ink](https://img.shields.io/badge/Ink%20React-61DAFB?logo=react&logoColor=black)
![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?logo=zod&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-000000?logo=modelcontextprotocol&logoColor=white)

Caduceus is a single-agent coding assistant. You give it a task in the terminal
or the browser; it reads the workspace, edits files, runs commands, and verifies
its work in a bounded reason-act loop. This document is the high-level map. For
detail see [ARCHITECTURE.md](ARCHITECTURE.md); for the research behind the
choices see [REFERENCES.md](REFERENCES.md).

## 1. System context

Who talks to what.

```mermaid
flowchart LR
  user(["Developer"]) --> iface
  subgraph iface["Interfaces"]
    cli["CLI (one-shot)"]
    tui["Interactive TUI"]
    web["Web UI"]
  end
  iface --> engine["Headless engine"]
  engine -->|"chat + tools"| ollama[("Ollama Cloud model")]
  engine --> tools["Built-in tools"]
  engine --> mcp[("MCP servers")]
  engine --> store[("Local store: sessions, skills, knowledge, memory")]
```

## 2. Architecture layers

The three interfaces share one engine, which draws on a set of capabilities.

```mermaid
flowchart TD
  subgraph UI["Interfaces"]
    A1["CLI"]
    A2["TUI (Ink)"]
    A3["Web (Hono + SSE)"]
  end
  subgraph ENG["Engine"]
    B1["Conversation (multi-turn)"]
    B2["Orchestrator (reason-act loop)"]
    B3["Session builder + tiered prompt"]
  end
  subgraph CAP["Capabilities"]
    C1["Tool registry"]
    C2["Skills + hub"]
    C3["Knowledge (OKF)"]
    C4["Memory (episodic)"]
    C5["MCP client"]
    C6["Compression (LLMLingua)"]
  end
  subgraph EXT["External"]
    D1[("Ollama Cloud")]
    D2[("GitHub / URL skills")]
    D3[("MCP servers")]
  end
  UI --> ENG
  ENG --> CAP
  B2 --> D1
  C2 --> D2
  C5 --> D3
```

## 3. The agent loop

Each turn is a bounded loop: think, act with tools, feed results back, repeat
until the model answers or the budget runs out.

```mermaid
flowchart TD
  msg(["User message"]) --> build["Assemble tiered prompt"]
  build --> invoke["Call model with tool specs"]
  invoke --> dec{"Tool calls?"}
  dec -- "no" --> done(["Return answer"])
  dec -- "yes" --> exec["Execute each tool"]
  exec --> feed["Append results to history"]
  feed --> guard{"Budget left and under error limit?"}
  guard -- "yes" --> invoke
  guard -- "no" --> halt(["Stop: budget or circuit breaker"])
```

## 4. Anatomy of a turn

How a single `send` flows through the components.

```mermaid
sequenceDiagram
  actor U as User
  participant C as Conversation
  participant L as Loop
  participant M as Ollama model
  participant T as Tool
  U->>C: send(text)
  C->>L: runTurn(messages)
  loop until done or budget
    L->>M: chat(messages, tools)
    M-->>L: reply (text or tool calls)
    alt tool calls
      L->>T: run(args)
      T-->>L: result
    else final answer
      L-->>C: finalText
    end
  end
  C-->>U: answer
```

## 5. Context assembly

The system prompt is rebuilt every turn in a fixed order, so the long prefix
stays stable and cache-friendly.

```mermaid
flowchart LR
  S["Stable: identity, tools, skill catalog"] --> X["Context: project files, knowledge, memory, artifacts"]
  X --> V["Volatile: timestamp"]
  V --> H["+ conversation history"]
  H --> M[("Model")]
```

## 6. Tool execution: approval and sandbox

Before a shell command runs it is classified for risk and, if flagged, gated;
every tool subprocess gets a scrubbed environment and optional OS isolation.

```mermaid
flowchart TD
  invoke(["Tool call"]) --> kind{"bash command?"}
  kind -- "no" --> run
  kind -- "yes" --> classify["Classify risk"]
  classify --> risky{"Dangerous?"}
  risky -- "no" --> run
  risky -- "yes" --> mode{"Approval mode"}
  mode -- "allow" --> run
  mode -- "deny" --> refuse(["Refused"])
  mode -- "prompt" --> ask{"User approves?"}
  ask -- "no" --> refuse
  ask -- "yes" --> run
  run["Scrub env, optional bubblewrap isolation"] --> result(["Result to model"])
```

## 7. Skills hub: safe install

Community skills are downloaded to quarantine, scanned, and only installed if
the trust level and scan verdict allow it. Provenance is recorded.

```mermaid
flowchart TD
  q["skills install ID"] --> src{"Source"}
  src -- "GitHub" --> fetch["Fetch files"]
  src -- "URL" --> fetch
  fetch --> quar["Quarantine"]
  quar --> scan["Scan: threat patterns, structure, invisible unicode"]
  scan --> verdict["Verdict: safe / caution / dangerous"]
  verdict --> policy{"Trust level x verdict"}
  policy -- "allow" --> install["Install into skills dir"]
  policy -- "ask" --> confirm{"Confirm?"}
  policy -- "block" --> blocked(["Blocked"])
  confirm -- "yes" --> install
  confirm -- "no" --> blocked
  install --> record["Lockfile + audit log"]
```

## 8. MCP integration

External Model Context Protocol servers extend the toolset at runtime.

```mermaid
flowchart LR
  cfg[".caduceus/mcp.json"] --> conn["Connect (stdio / HTTP)"]
  conn --> list["List tools"]
  list --> reg["Register as mcp__server__tool"]
  reg --> avail["Available in the loop"]
  avail -->|"callTool"| server[("MCP server")]
```

## 9. On-disk layout

State lives beside the project; nothing is hidden in a database.

```text
<workspace>/
  skills/                 installed skills (SKILL.md folders)
    .hub/                 hub state: lock.json, audit.log, taps.json, quarantine
  knowledge/              OKF concept files
  memory/                 episodic lessons
  artifacts/              large artifacts pulled on demand
  .caduceus/
    sessions/             saved multi-turn sessions
    mcp.json              MCP server configuration
```

## 10. Design principles

The shape of the system follows the evidence gathered before any code was
written (see [REFERENCES.md](REFERENCES.md)):

- Single agent, not multi-agent: decentralization amplifies errors and degrades
  coding results.
- The scaffold is the product: the same model swings tens of points on
  benchmarks from context and tool-call management alone.
- Context is a tiered, file-like store assembled per turn, not an ever-growing
  buffer.
- A lean toolset that grows through Skills rather than a pile of built-ins.
