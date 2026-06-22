import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "../types";

export interface StoredSession {
  id: string;
  created: string;
  updated: string;
  messages: Message[];
}

export function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** List stored sessions in a directory, newest first. Malformed files are skipped. */
export async function listSessions(dir: string): Promise<StoredSession[]> {
  if (!existsSync(dir)) {
    return [];
  }
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const sessions: StoredSession[] = [];
  for (const name of files) {
    try {
      sessions.push(JSON.parse(await readFile(join(dir, name), "utf8")) as StoredSession);
    } catch {
      // skip unreadable/corrupt session files
    }
  }
  sessions.sort((a, b) => b.updated.localeCompare(a.updated));
  return sessions;
}

export async function loadSession(dir: string, id: string): Promise<StoredSession | null> {
  const path = join(dir, `${id}.json`);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as StoredSession;
  } catch {
    return null;
  }
}

export async function saveSession(dir: string, session: StoredSession): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf8");
}
