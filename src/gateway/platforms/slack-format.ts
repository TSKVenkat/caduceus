const PROTECT = (i: number) => `\x00PROTECT${i}\x00`;

export function markdownToMrkdwn(text: string): string {
  const protected_: string[] = [];

  const stash = (content: string): string => {
    protected_.push(content);
    return PROTECT(protected_.length - 1);
  };

  let out = text;

  out = out.replace(/```([\s\S]*?)```/g, (m) => stash(m));
  out = out.replace(/`([^`\n]+)`/g, (m) => stash(m));

  out = out.replace(/[<>&]/g, (ch) => (ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;"));
  out = out.replace(/&amp;(amp|lt|gt);/g, "&$1;");

  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => stash(`<${url}|${label}>`));

  out = out.replace(/\*\*(.+?)\*\*/g, (_m, inner: string) => stash(`*${inner}*`));

  out = out.replace(/(?<![*_])\*(?!\*)([^*\n]+?)\*(?!\*)/g, "_$1_");

  out = out.replace(/~~(.+?)~~/g, "~$1~");

  out = out.replace(/^#{1,6}\s+(.+)$/gm, (_m, inner: string) => stash(`*${inner}*`));

  out = out.replace(/^\s*[-*]\s+/gm, "• ");

  for (let i = protected_.length - 1; i >= 0; i--) {
    out = out.split(PROTECT(i)).join(protected_[i] ?? "");
  }

  return out;
}

export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.5) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
