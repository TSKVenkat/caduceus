import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export function extractNumericPart(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

export function stripJidSuffix(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

export async function loadLidMappings(sessionDir: string): Promise<Map<string, string>> {
  const mappings = new Map<string, string>();
  try {
    const files = await readdir(sessionDir);
    for (const file of files) {
      if (!file.startsWith("lid-mapping-")) continue;
      try {
        const content = await readFile(join(sessionDir, file), "utf-8");
        const data = JSON.parse(content) as Record<string, string>;
        for (const [key, value] of Object.entries(data)) {
          mappings.set(key, value);
          mappings.set(value, key);
        }
      } catch {
        // corrupt or unreadable — skip
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  return mappings;
}

export function canonicalizeIdentifier(jid: string, mappings: Map<string, string>): string {
  const bare = stripJidSuffix(jid);
  const seen = new Set<string>();
  const candidates: string[] = [bare];
  let current = bare;

  while (mappings.has(current) && !seen.has(current)) {
    seen.add(current);
    const next = mappings.get(current);
    if (!next) break;
    current = next;
    candidates.push(current);
  }

  const numeric = candidates.filter((c) => /^\d+$/.test(c)).sort((a, b) => b.length - a.length)[0];
  const best = numeric ?? candidates.map((c) => c.replace(/\D/g, "")).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  return (best || bare) + "@s.whatsapp.net";
}

export async function canonicalWhatsAppId(jid: string, sessionDir: string): Promise<string> {
  const mappings = await loadLidMappings(sessionDir);
  return canonicalizeIdentifier(jid, mappings);
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export function isDmJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net");
}

export function getExtensionFromMimeType(mimetype: string): string {
  const sub = mimetype.split("/")[1]?.split(";")[0];
  if (!sub) return "bin";
  const map: Record<string, string> = {
    jpeg: "jpg",
    jpg: "jpg",
    png: "png",
    gif: "gif",
    webp: "webp",
    ogg: "ogg",
    mpeg: "mp3",
    mp4: "mp4",
    pdf: "pdf",
    "vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    zip: "zip",
    plain: "txt",
    "markdown": "md",
    json: "json",
  };
  return map[sub] ?? sub;
}
