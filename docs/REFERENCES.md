# References

The sources behind the design decisions. Each was read during the research
phase; the architecture notes in [ARCHITECTURE.md](ARCHITECTURE.md) cite these by
number.

## Agent models and tool use

1. Hermes 3 Technical Report. arXiv:2408.11857, 2024-08.
2. Hermes 4 Technical Report. arXiv:2508.18255, 2025-08.
3. NousResearch/Hermes-4.3-36B, model card (Hugging Face), 2025-08.
4. Live-SWE-agent: a continuously self-evolving software agent.
   arXiv:2511.13646, 2025-11. (Minimal bash toolset plus runtime tool synthesis;
   79.2% on SWE-bench Verified.)
5. MemTool: dynamic tool/MCP context management across multi-turn conversations.
   arXiv:2507.21428, 2025-07.
6. Toolathlon: a benchmark for long-horizon, multi-tool agents (ICLR 2026).
   arXiv:2510.25726, 2025-10.

## Context engineering and memory

7. Architecting an efficient, context-aware multi-agent framework for
   production. Google ADK guidance, developers.googleblog.com, 2025-12.
   (Tiered context: Working Context, Session, Memory, Artifacts; rebuild per
   invocation; artifacts on demand.)
8. AI context engineering. Google Cloud, cloud.google.com, 2026-04.
   (Persistent / semi-persistent / transient layers; context caching.)
9. A file-system abstraction for context engineering. arXiv:2512.05470, 2025-12.
   (Context Constructor to Loader to Evaluator; "everything is a file".)
10. Reflexion: language agents with verbal reinforcement learning.
    arXiv:2303.11366, 2023-03. (Episodic memory of reflections; 91% pass@1 on
    HumanEval without weight updates.)

## Prompt compression

11. LLMLingua and LLMLingua-2 (Microsoft). github.com/microsoft/LLMLingua.
    Task-agnostic prompt compression with a small trained model.

## Agent patterns and evaluation

12. Controlled study of single- vs multi-agent topologies (260 configurations).
    Error amplification rises with decentralization; multi-agent degrades on
    SWE-bench Verified where single-agent baselines exceed 45%. 2026-04.
13. Agentic design patterns (Reflection, Tool Use, Planning, Multi-Agent) and
    workflow patterns (chaining, routing, parallelization, orchestrator-workers,
    evaluator-optimizer). Practitioner syntheses, 2026-05.
14. Scaffolding dominates: the same model swings about 30 points on GAIA and
    5.2 points on SWE-bench Pro from context and tool-calling differences alone.
    Benchmark-contamination analyses, 2026-06.

## Knowledge format

15. Open Knowledge Format (OKF). GoogleCloudPlatform/knowledge-catalog.
    Markdown concept files with YAML frontmatter and a required `type`.

## Tool protocol

16. Model Context Protocol (MCP). modelcontextprotocol.io. Standard for
    connecting agents to external tools and data sources.
