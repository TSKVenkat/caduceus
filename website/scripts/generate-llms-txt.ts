import { glob } from "node:fs/promises";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function generate(): Promise<void> {
  const docsDir = join(__dirname, "..", "docs");
  const outDir = join(__dirname, "..", "static");
  await mkdir(outDir, { recursive: true });

  const files: string[] = [];
  for await (const entry of glob("**/*.md", { cwd: docsDir })) {
    files.push(entry);
  }
  files.sort();

  let summary = "# Caduceus Agent Documentation\n\n";
  let full = summary;

  for (const file of files) {
    try {
      const content = await readFile(join(docsDir, file), "utf-8");
      summary += `## ${file}\n\n${content.slice(0, 2000)}...\n\n`;
      full += `## ${file}\n\n${content}\n\n`;
    } catch {
      // skip unreadable
    }
  }

  await writeFile(join(outDir, "llms.txt"), summary);
  await writeFile(join(outDir, "llms-full.txt"), full);
  console.log(`Generated llms.txt (${files.length} docs)`);
}

generate().catch(console.error);
