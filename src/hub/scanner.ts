/**
 * Security scanner for community skill bundles. Ported from the Hermes Skills
 * Hub guard: regex threat patterns + structural checks + invisible-unicode
 * detection produce a verdict (safe/caution/dangerous), which combines with the
 * source's trust level to decide whether an install is allowed, needs
 * confirmation, or is blocked.
 */

export type Severity = "critical" | "high" | "medium" | "low";
export type Verdict = "safe" | "caution" | "dangerous";
export type TrustLevel = "builtin" | "trusted" | "community" | "agent-created";

export interface Finding {
  patternId: string;
  severity: Severity;
  category: string;
  file: string;
  line: number;
  match: string;
  description: string;
}

export interface ScanResult {
  skillName: string;
  source: string;
  trustLevel: TrustLevel;
  verdict: Verdict;
  findings: Finding[];
}

interface ThreatPattern {
  re: RegExp;
  id: string;
  severity: Severity;
  category: string;
  description: string;
}

const p = (re: RegExp, id: string, severity: Severity, category: string, description: string): ThreatPattern => ({
  re,
  id,
  severity,
  category,
  description,
});

/**
 * Threat patterns matched case-insensitively, line by line. A representative
 * port of the Hermes guard set spanning every category; not exhaustive, but it
 * catches the common exfiltration / injection / destructive surfaces.
 */
export const THREAT_PATTERNS: ThreatPattern[] = [
  // Exfiltration — leaking secrets over the network
  p(/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "env_exfil_curl", "critical", "exfiltration", "curl command interpolating a secret environment variable"),
  p(/wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "env_exfil_wget", "critical", "exfiltration", "wget command interpolating a secret environment variable"),
  p(/fetch\s*\([^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|API)/i, "env_exfil_fetch", "critical", "exfiltration", "fetch() call interpolating a secret environment variable"),
  p(/requests\.(get|post|put|patch)\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD)/i, "env_exfil_requests", "critical", "exfiltration", "HTTP request with a secret variable"),
  // Exfiltration — credential stores
  p(/base64[^\n]*env/i, "encoded_exfil", "high", "exfiltration", "base64 encoding combined with environment access"),
  p(/(\$HOME\/\.ssh|~\/\.ssh)/i, "ssh_dir_access", "high", "exfiltration", "references the user SSH directory"),
  p(/(\$HOME\/\.aws|~\/\.aws)/i, "aws_dir_access", "high", "exfiltration", "references the user AWS credentials directory"),
  p(/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, "read_secrets_file", "critical", "exfiltration", "reads a known secrets file"),
  p(/printenv|env\s*\|/i, "dump_all_env", "high", "exfiltration", "dumps all environment variables"),
  p(/os\.getenv\s*\(\s*[^)]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i, "python_getenv_secret", "critical", "exfiltration", "reads a secret via os.getenv()"),
  p(/process\.env\[/i, "node_process_env", "high", "exfiltration", "accesses process.env (Node.js environment)"),
  // Exfiltration — markdown/link based
  p(/!\[.*\]\(https?:\/\/[^)]*\$\{?/i, "md_image_exfil", "high", "exfiltration", "markdown image URL with variable interpolation (image-based exfil)"),

  // Prompt injection
  p(/ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+instructions/i, "prompt_injection_ignore", "critical", "injection", "prompt injection: ignore previous instructions"),
  p(/do\s+not\s+(?:\w+\s+)*tell\s+(?:\w+\s+)*the\s+user/i, "deception_hide", "critical", "injection", "instructs the agent to hide information from the user"),
  p(/system\s+prompt\s+override/i, "sys_prompt_override", "critical", "injection", "attempts to override the system prompt"),
  p(/disregard\s+(?:\w+\s+)*(your|all|any)\s+(?:\w+\s+)*(instructions|rules|guidelines)/i, "disregard_rules", "critical", "injection", "instructs the agent to disregard its rules"),
  p(/output\s+(?:\w+\s+)*(system|initial)\s+prompt/i, "leak_system_prompt", "high", "injection", "attempts to extract the system prompt"),
  p(/<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i, "html_comment_injection", "high", "injection", "hidden instructions in an HTML comment"),

  // Destructive operations
  p(/rm\s+-rf\s+\//i, "destructive_root_rm", "critical", "destructive", "recursive delete from root"),
  p(/rm\s+(-[^\s]*)?r.*\$HOME/i, "destructive_home_rm", "critical", "destructive", "recursive delete targeting the home directory"),
  p(/chmod\s+777/i, "insecure_perms", "medium", "destructive", "sets world-writable permissions"),
  p(/>\s*\/etc\//i, "system_overwrite", "critical", "destructive", "overwrites a system configuration file"),
  p(/\bmkfs\b/i, "format_filesystem", "critical", "destructive", "formats a filesystem"),
  p(/\bdd\s+.*if=.*of=\/dev\//i, "disk_overwrite", "critical", "destructive", "raw disk write operation"),

  // Persistence
  p(/\bcrontab\b/i, "persistence_cron", "medium", "persistence", "modifies cron jobs"),
  p(/\.(bashrc|zshrc|profile|bash_profile|zprofile|zlogin)\b/i, "shell_rc_mod", "medium", "persistence", "modifies a shell startup file"),

  // Network / remote execution
  p(/(curl|wget)\s+[^\n]*\|\s*(bash|sh|zsh|python)/i, "pipe_to_shell", "critical", "network", "pipes a downloaded script straight into a shell"),
  p(/\bnc\s+-[^\n]*\s+-e\b/i, "reverse_shell_nc", "critical", "network", "netcat reverse shell"),

  // Obfuscation
  p(/eval\s*\(\s*(atob|base64|Buffer\.from)/i, "eval_decoded", "critical", "obfuscation", "evaluates decoded/obfuscated content"),
  p(/exec\s*\(\s*(base64|codecs\.decode)/i, "exec_decoded", "critical", "obfuscation", "executes decoded/obfuscated content"),

  // Privilege escalation declared in frontmatter
  p(/^allowed-tools\s*:/i, "allowed_tools_field", "high", "privilege_escalation", "skill pre-declares allowed-tools (pre-approves tool access)"),
];

/** Zero-width and bidi characters used to hide text or smuggle instructions. */
const INVISIBLE_CHARS = [
  "​", "‌", "‍", "⁠", "﻿", "­",
  "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩",
];

const SCANNABLE_EXTENSIONS = new Set([
  ".md", ".markdown", ".sh", ".bash", ".py", ".js", ".ts", ".rb", ".pl",
  ".txt", ".json", ".yaml", ".yml", ".toml", ".env", ".cfg", ".ini",
]);

const SUSPICIOUS_BINARY_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".class", ".pyc", ".wasm",
]);

const MAX_SINGLE_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILE_COUNT = 100;

function extname(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function isScannable(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base === "SKILL.md" || SCANNABLE_EXTENSIONS.has(extname(path));
}

function scanText(path: string, content: string): Finding[] {
  if (!isScannable(path)) {
    return [];
  }
  const findings: Finding[] = [];
  const lines = content.split("\n");
  const seen = new Set<string>();

  for (const pattern of THREAT_PATTERNS) {
    lines.forEach((line, index) => {
      const lineNo = index + 1;
      const key = `${pattern.id}:${lineNo}`;
      if (seen.has(key) || !pattern.re.test(line)) {
        return;
      }
      seen.add(key);
      const trimmed = line.trim();
      findings.push({
        patternId: pattern.id,
        severity: pattern.severity,
        category: pattern.category,
        file: path,
        line: lineNo,
        match: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
        description: pattern.description,
      });
    });
  }

  lines.forEach((line, index) => {
    for (const char of INVISIBLE_CHARS) {
      if (line.includes(char)) {
        const code = char.codePointAt(0) ?? 0;
        findings.push({
          patternId: "invisible_unicode",
          severity: "high",
          category: "injection",
          file: path,
          line: index + 1,
          match: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
          description: "invisible unicode character (possible text hiding/injection)",
        });
        break;
      }
    }
  });

  return findings;
}

/** A skill ready for scanning: its files keyed by POSIX-relative path. */
export interface ScanInput {
  name: string;
  files: Record<string, string>;
}

function checkStructure(files: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  const names = Object.keys(files);
  let total = 0;

  if (names.length > MAX_FILE_COUNT) {
    findings.push({ patternId: "too_many_files", severity: "medium", category: "structural", file: "", line: 0, match: `${names.length} files`, description: `skill has ${names.length} files (limit ${MAX_FILE_COUNT})` });
  }

  for (const [path, content] of Object.entries(files)) {
    const size = Buffer.byteLength(content, "utf8");
    total += size;
    if (size > MAX_SINGLE_FILE_BYTES) {
      findings.push({ patternId: "oversized_file", severity: "medium", category: "structural", file: path, line: 0, match: `${Math.round(size / 1024)}KB`, description: `file is ${Math.round(size / 1024)}KB (limit ${MAX_SINGLE_FILE_BYTES / 1024}KB)` });
    }
    if (SUSPICIOUS_BINARY_EXTENSIONS.has(extname(path))) {
      findings.push({ patternId: "binary_file", severity: "critical", category: "structural", file: path, line: 0, match: `binary: ${extname(path)}`, description: `binary/executable file (${extname(path)}) should not be in a skill` });
    }
  }

  if (total > MAX_TOTAL_BYTES) {
    findings.push({ patternId: "oversized_skill", severity: "medium", category: "structural", file: "", line: 0, match: `${Math.round(total / 1024)}KB`, description: `total skill size ${Math.round(total / 1024)}KB exceeds ${MAX_TOTAL_BYTES / 1024}KB` });
  }

  return findings;
}

function determineVerdict(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === "critical")) {
    return "dangerous";
  }
  if (findings.some((f) => f.severity === "high" || f.severity === "medium")) {
    return "caution";
  }
  return "safe";
}

/** Repos whose skills are trusted. Matched on exact `owner/repo`, not a prefix. */
const TRUSTED_REPOS = new Set(["anthropics/skills", "openai/skills"]);

/**
 * Resolve a trust level from a source string. The string is either a trust
 * keyword (`builtin`/`agent-created`/`official`) or an `owner/repo[/...]`
 * identifier. Trust is granted only on an exact `owner/repo` match so a repo
 * like `openai/evilfork` cannot impersonate a trusted source by prefix.
 */
export function resolveTrustLevel(source: string): TrustLevel {
  const lower = source.toLowerCase();
  if (lower === "builtin") {
    return "builtin";
  }
  if (lower === "agent-created") {
    return "agent-created";
  }
  if (lower === "official") {
    return "trusted";
  }
  const parts = lower.split("/");
  if (parts.length >= 2 && TRUSTED_REPOS.has(`${parts[0]}/${parts[1]}`)) {
    return "trusted";
  }
  return "community";
}

/**
 * Scan an in-memory skill bundle and produce a verdict. `trustLevel`, when
 * provided by a source adapter, is authoritative; otherwise it is derived from
 * `source`.
 */
export function scanBundle(input: ScanInput, source: string, trustLevel?: TrustLevel): ScanResult {
  const findings: Finding[] = [
    ...checkStructure(input.files),
    ...Object.entries(input.files).flatMap(([path, content]) => scanText(path, content)),
  ];
  return {
    skillName: input.name,
    source,
    trustLevel: trustLevel ?? resolveTrustLevel(source),
    verdict: determineVerdict(findings),
    findings,
  };
}

const VERDICT_INDEX: Record<Verdict, number> = { safe: 0, caution: 1, dangerous: 2 };

type Decision = "allow" | "ask" | "block";

// rows: trust level → [safe, caution, dangerous]
const INSTALL_POLICY: Record<TrustLevel, [Decision, Decision, Decision]> = {
  builtin: ["allow", "allow", "allow"],
  trusted: ["allow", "allow", "block"],
  community: ["allow", "block", "block"],
  "agent-created": ["allow", "allow", "ask"],
};

export type InstallDecision = "allow" | "ask" | "block";

export interface InstallVerdict {
  decision: InstallDecision;
  reason: string;
}

/** Combine scan verdict + trust level into an install decision. `force` overrides a block. */
export function decideInstall(result: ScanResult, force = false): InstallVerdict {
  const policy = INSTALL_POLICY[result.trustLevel] ?? INSTALL_POLICY.community;
  const decision = policy[VERDICT_INDEX[result.verdict]];
  const tag = `${result.trustLevel} source, ${result.verdict} verdict, ${result.findings.length} finding(s)`;

  if (decision === "allow") {
    return { decision: "allow", reason: `Allowed (${tag})` };
  }
  if (force) {
    return { decision: "allow", reason: `Force-installed despite ${tag}` };
  }
  if (decision === "ask") {
    return { decision: "ask", reason: `Needs confirmation (${tag})` };
  }
  return { decision: "block", reason: `Blocked (${tag}). Use --force to override.` };
}

/** Render a scan result as a compact, human-readable report. */
export function formatScanReport(result: ScanResult, force = false): string {
  const lines = [`Scan: ${result.skillName} (${result.source}/${result.trustLevel})  Verdict: ${result.verdict.toUpperCase()}`];
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  for (const f of [...result.findings].sort((a, b) => order[a.severity] - order[b.severity])) {
    lines.push(`  ${f.severity.toUpperCase().padEnd(8)} ${f.category.padEnd(16)} ${`${f.file}:${f.line}`.padEnd(28)} ${f.description}`);
  }
  const { decision, reason } = decideInstall(result, force);
  const status = decision === "allow" ? "ALLOWED" : decision === "ask" ? "NEEDS CONFIRMATION" : "BLOCKED";
  lines.push(`Decision: ${status} — ${reason}`);
  return lines.join("\n");
}
