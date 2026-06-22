import type { Tool } from "../tool";
import type { ToolRegistry } from "../registry";
import { bashTool } from "./bash";
import { readFileTool } from "./read-file";
import { strReplaceTool } from "./str-replace";
import { writeFileTool } from "./write-file";

/**
 * Single source of truth for the default toolset. Adding a builtin means adding it
 * here — a data-driven registry rather than fragile import-side-effect "auto"
 * registration (which doesn't survive bundling). Kept minimal by design; broader
 * capabilities grow via Skills.
 */
export const builtinTools: readonly Tool[] = [readFileTool, writeFileTool, strReplaceTool, bashTool];

export function registerBuiltins(registry: ToolRegistry): void {
  registry.registerAll(builtinTools);
}
