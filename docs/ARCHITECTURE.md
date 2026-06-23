# Architecture

How Caduceus is built and why. Bracketed numbers like [4] point to
[REFERENCES.md](REFERENCES.md).

## Design principles

Three findings from the research phase shaped every decision.

1. Single agent, not multi-agent. A controlled study across 260 configurations
   found that error amplification rises with decentralization, and that
   multi-agent systems degrade on coding benchmarks where a single-agent
   baseline already exceeds 45% success [12]. Caduceus is one agent with a strong
   scaffold. It can spawn bounded, isolated subagents for independent
   sub-investigations, but there is no standing multi-agent topology.

2. The scaffold is the product. The same model swings about 30 points on GAIA
   and 5.2 points on SWE-bench Pro purely from how context and tool calls are
   managed [14]. Effort therefore goes into context assembly, tool design, and
   the loop, not into prompt phrasing.

3. Context is a tiered, file-like store, assembled per turn. Google's ADK
   guidance [7], Google Cloud's context-engineering model [8], and a
   file-system-abstraction paper [9] independently converge on the same shape:
   keep context in layers, rebuild the working context each turn, and pull large
   data on demand rather than holding it in every prompt.

## The agent loop

A bounded reason-act loop lives in `src/loop/orchestrator.ts`.

- `runTurn(messages, options)` runs the loop over a pre-seeded message list and
  returns the updated list plus a result. `run(task, options)` is a one-shot
  wrapper over it.
- Each step sends the conversation and tool specifications to the model, parses
  any tool calls, executes them, and appends the results.
- The loop is bounded by a step budget and a circuit breaker that stops after
  repeated consecutive tool errors. Bounded execution (a few to a dozen steps,
  caps, circuit breakers) is a standard reliability pattern [13].
- Events stream out (`step`, `assistant`, `tool_call`, `tool_result`,
  `compress`) so the CLI, the terminal UI, and the web UI can render progress
  from one source.

## The system prompt: three tiers

`src/prompt/` assembles the prompt in a fixed order so the long prefix stays
stable and cache-friendly [7][8].

- Stable: identity, tool list, skill catalog. Never changes within a session.
- Context: project files, knowledge concepts, memories, artifacts. Rebuilt per
  turn from the on-disk store.
- Volatile: timestamp and other per-turn data, placed last.

Keeping volatile data at the end means the stable prefix can be reused by the
provider's prompt cache across turns.

## Tools

A small, composable toolset is registered in a data-driven registry
(`src/tools/`). The built-in tools are:

- `read_file` (with line ranges and optional line numbers), `write_file`,
  `str_replace` (one unique edit), `multi_edit` (several atomic edits in one
  file), `bash`, `search_code` (ripgrep with a grep fallback), and `list_files`.

The toolset is deliberately lean. New capabilities are expected to arrive as
Skills rather than as a growing pile of built-in tools, following the
minimal-toolset-plus-runtime-synthesis result from Live-SWE-agent [4].

## Skills

Skills are procedural know-how stored as `SKILL.md` folders with YAML
frontmatter (`src/skills/`). They use progressive disclosure: only the name and
description sit in the prompt; the body is loaded on demand with `load_skill`.
The agent can also author a new skill at runtime with `create_skill`, a form of
the runtime tool synthesis described in [4].

### Skills hub

`src/hub/` adds installable skills from GitHub or a URL. Every candidate is
downloaded to a quarantine directory and scanned before installation:

- A scanner checks for threat patterns (secret exfiltration, prompt injection,
  destructive commands, persistence, obfuscation), structural anomalies, and
  invisible-unicode text hiding.
- The verdict (safe, caution, dangerous) is combined with the source's trust
  level in a policy matrix that allows, asks for confirmation, or blocks.
- Installs are recorded in a lockfile with content hashes and an append-only
  audit log.

## Knowledge

Declarative knowledge uses the Open Knowledge Format [15]: Markdown concept files
with YAML frontmatter and a required `type` (`src/knowledge/`). The agent reads
concepts and can author new ones. This is separate from Skills: Skills are
procedural (how to do something), knowledge is declarative (facts), and the two
share one Markdown-plus-frontmatter substrate.

## Memory

Flat-file episodic memory (`src/memory/`) lets the agent record lessons from past
runs and recall them later, with strict-write gating. This follows Reflexion,
where an agent keeps reflective text in an episodic buffer and improves across
trials without weight updates [10].

## Prompt compression

An optional, opt-in compression hook runs the real Microsoft LLMLingua-2 model
as a Python sidecar (`compressor/`, `src/compress/`) [11]. When enabled, large
tool outputs are compressed before they enter the message history. It is lossy
and prose-oriented, so it is off by default and size-gated. Measured results are
in [BENCHMARKS.md](BENCHMARKS.md).

## Sandboxing

Two layers (`src/exec/`):

- Environment scrubbing is always on: secret-looking variables are stripped from
  the environment of tool subprocesses.
- OS isolation via bubblewrap is used when available, confining shell commands to
  the working directory with networking off. A functional probe checks that the
  sandbox actually works before relying on it, and degrades gracefully when it
  does not.

## Subagents

A `delegate` tool (`src/loop/delegate.ts`) runs isolated, bounded subagents for
independent investigations, with a concurrency cap and no nesting. This is the
narrow, controlled use of parallelism that the single-vs-multi-agent evidence
supports [12], not a standing multi-agent system.

## MCP

Caduceus is a Model Context Protocol client [16] (`src/mcp/`). It connects to
configured MCP servers over stdio or HTTP and adapts their tools into the
registry, namespaced as `mcp__<server>__<tool>`. This has been verified
end-to-end against a real filesystem MCP server.

## One engine, three front ends

A shared headless engine (`src/engine/`) assembles the session (tools, skills,
knowledge, memory, MCP) and the tiered prompt, and a `Conversation` object holds
multi-turn history. The command-line one-shot runner, the interactive terminal
UI, and the web UI all drive this same engine, so behavior is identical across
them. Sessions persist to disk and can be resumed.
