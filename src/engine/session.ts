import { join, resolve } from "node:path";
import { createArtifactTool, loadArtifacts } from "../artifacts/artifacts";
import { loadContextFiles } from "../context/files";
import { loadBundle } from "../knowledge/okf";
import { createKnowledgeTools } from "../knowledge/tools";
import { createDelegateTool } from "../loop/delegate";
import { connectMcpServers, loadMcpConfig } from "../mcp/client";
import { loadEpisodic } from "../memory/episodic";
import { createMemoryTools } from "../memory/tools";
import type { ModelClient } from "../model/client";
import { buildSystemPrompt } from "../prompt/system";
import { createCreateSkillTool } from "../skills/create-skill-tool";
import { createLoadSkillTool } from "../skills/load-skill-tool";
import { loadSkills } from "../skills/loader";
import { registerBuiltins } from "../tools/builtin";
import { ToolRegistry } from "../tools/registry";

export interface SessionDeps {
  cwd: string;
  client: ModelClient;
}

export interface SessionCounts {
  skills: number;
  contextFiles: number;
  concepts: number;
  memories: number;
  artifacts: number;
  mcpTools: number;
}

export interface Session {
  registry: ToolRegistry;
  systemPrompt: string;
  counts: SessionCounts;
  close(): Promise<void>;
}

/**
 * The headless engine assembly shared by the CLI and the web server: load all
 * context sources from `cwd`, build the tool registry (builtins + skills,
 * knowledge, memory, artifacts, MCP, delegate), and the tiered system prompt.
 */
export async function buildSession({ cwd, client }: SessionDeps): Promise<Session> {
  const skillsDir = resolve(cwd, process.env.CADUCEUS_SKILLS_DIR ?? "skills");
  const knowledgeDir = resolve(cwd, process.env.CADUCEUS_KNOWLEDGE_DIR ?? "knowledge");
  const memoryDir = resolve(cwd, process.env.CADUCEUS_MEMORY_DIR ?? "memory");
  const artifactsDir = resolve(cwd, process.env.CADUCEUS_ARTIFACTS_DIR ?? "artifacts");

  const [skills, contextFiles, concepts, memories, artifacts] = await Promise.all([
    loadSkills(skillsDir),
    loadContextFiles(cwd),
    loadBundle(knowledgeDir),
    loadEpisodic(memoryDir),
    loadArtifacts(artifactsDir),
  ]);

  const registry = new ToolRegistry();
  registerBuiltins(registry);
  if (skills.length > 0) {
    registry.register(createLoadSkillTool(skills));
  }
  registry.register(createCreateSkillTool(skillsDir));
  registry.registerAll(createKnowledgeTools(knowledgeDir));
  registry.registerAll(createMemoryTools(memoryDir));
  registry.register(createArtifactTool(artifactsDir));

  const mcpConfig = await loadMcpConfig(
    process.env.CADUCEUS_MCP_CONFIG ?? join(cwd, ".caduceus", "mcp.json"),
  );
  let closeMcp = async (): Promise<void> => {};
  let mcpTools = 0;
  if (mcpConfig) {
    const mcp = await connectMcpServers(mcpConfig);
    registry.registerAll(mcp.tools);
    closeMcp = mcp.close;
    mcpTools = mcp.tools.length;
  }

  registry.register(createDelegateTool({ client, cwd, maxSteps: 10, maxConcurrency: 4 }));

  const systemPrompt = buildSystemPrompt({
    registry,
    skills,
    contextFiles,
    concepts,
    memories,
    artifacts,
    now: new Date(),
  });

  return {
    registry,
    systemPrompt,
    counts: {
      skills: skills.length,
      contextFiles: contextFiles.length,
      concepts: concepts.length,
      memories: memories.length,
      artifacts: artifacts.length,
      mcpTools,
    },
    close: closeMcp,
  };
}
