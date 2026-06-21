import type { ToolRegistry } from "../registry";
import { bashTool } from "./bash";
import { readFileTool } from "./read-file";
import { strReplaceTool } from "./str-replace";
import { writeFileTool } from "./write-file";

/** Register the default toolset. Kept minimal by design; capabilities grow via Skills. */
export function registerBuiltins(registry: ToolRegistry): void {
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(strReplaceTool);
  registry.register(bashTool);
}
