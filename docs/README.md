# Documentation

- [HLD.md](HLD.md) — high-level design: the system in diagrams (mermaid maps of
  the architecture, the agent loop, a turn, tool safety, the skills hub, MCP).
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the agent is built and why, with
  citations to the research.
- [BENCHMARKS.md](BENCHMARKS.md) — what has been measured (prompt compression),
  the evaluation methodology, and a retracted result kept for the record.
- [REFERENCES.md](REFERENCES.md) — the sources behind the design decisions.
- [ROADMAP.md](ROADMAP.md) — planned work.

## Research write-ups

The full research phase, including how each claim was verified, is preserved:

- [00-RESEARCH-REPORT.md](00-RESEARCH-REPORT.md) — round 1: agent models, context
  engineering, memory, single vs multi-agent, tool use, evaluation reality.
- [01-TECHNICAL-SPEC.md](01-TECHNICAL-SPEC.md) — the technical specification.
- [02-BLOG.md](02-BLOG.md) — a narrative overview.
- [03-BUILD-PLAN.md](03-BUILD-PLAN.md) — the original build plan.
- [04-RESEARCH-REPORT-R2.md](04-RESEARCH-REPORT-R2.md) — round 2: context formats,
  Skills, the open-source agent landscape, compression, Ollama Cloud.
- [05-REVISED-PLAN.md](05-REVISED-PLAN.md) — the revised plan after round 2.

Each research round used a fan-out, fetch, extract, and adversarial-verification
method: multiple search angles, sources fetched, falsifiable claims extracted,
then the most important claims checked by independent skeptics and kept only if
not refuted. The reports state the verification counts and tag every source by
quality.
