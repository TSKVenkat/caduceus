---
type: Architecture
title: Agent loop
description: The bounded reason/act loop that drives Caduceus.
tags: [architecture, loop]
timestamp: 2026-06-21T00:00:00Z
---

# Agent loop

The loop lives in `src/loop/orchestrator.ts`.

## Flow

1. Assemble the system prompt (stable -> context -> volatile tiers) and the user task.
2. Call the model. It either answers (done) or returns `tool_calls`.
3. Execute each tool through the registry; append results as `tool` messages.
4. Repeat until completion, the step budget is reached, or the circuit breaker trips.

## Stop conditions

| Reason | Trigger |
| --- | --- |
| `done` | The model replies without a tool call. |
| `max_steps` | The step budget is exhausted. |
| `circuit_breaker` | Three consecutive steps end in tool errors. |
