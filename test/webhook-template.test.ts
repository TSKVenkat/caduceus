import { describe, it, expect } from "vitest";
import { renderTemplate, resolvePath } from "../src/webhook/template.js";

const payload = {
  repository: { full_name: "org/repo" },
  number: 42,
  pull_request: {
    title: "Fix bug",
    user: { login: "alice" },
    html_url: "https://github.com/org/repo/pull/42",
  },
  action: "opened",
  labels: ["bug", "urgent"],
  nested: { deeply: { value: "found" } },
};

describe("resolvePath", () => {
  it("resolves top-level keys", () => {
    expect(resolvePath(payload, "number")).toBe(42);
  });

  it("resolves nested dot paths", () => {
    expect(resolvePath(payload, "repository.full_name")).toBe("org/repo");
    expect(resolvePath(payload, "pull_request.user.login")).toBe("alice");
  });

  it("resolves deeply nested paths", () => {
    expect(resolvePath(payload, "nested.deeply.value")).toBe("found");
  });

  it("returns undefined for missing keys", () => {
    expect(resolvePath(payload, "nonexistent")).toBeUndefined();
    expect(resolvePath(payload, "repository.missing")).toBeUndefined();
  });

  it("handles non-object traversal gracefully", () => {
    expect(resolvePath(payload, "number.invalid")).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  it("substitutes simple fields", () => {
    const result = renderTemplate("PR #{number}: {pull_request.title}", payload);
    expect(result).toBe("PR #42: Fix bug");
  });

  it("substitutes nested fields", () => {
    const result = renderTemplate("Repo: {repository.full_name}", payload);
    expect(result).toBe("Repo: org/repo");
  });

  it("leaves unmatched placeholders as-is", () => {
    const result = renderTemplate("Hello {nonexistent}", payload);
    expect(result).toBe("Hello {nonexistent}");
  });

  it("handles {__raw__} by dumping the full payload", () => {
    const result = renderTemplate("Payload: {__raw__}", payload);
    expect(result).toContain("\"number\": 42");
    expect(result).toContain("org/repo");
  });

  it("serializes arrays as JSON", () => {
    const result = renderTemplate("Labels: {labels}", payload);
    expect(result).toBe('Labels: ["bug","urgent"]');
  });

  it("handles multiple substitutions in one template", () => {
    const template = "{action} by {pull_request.user.login} on {repository.full_name}";
    expect(renderTemplate(template, payload)).toBe("opened by alice on org/repo");
  });

  it("handles empty payload", () => {
    expect(renderTemplate("Hello {name}", {})).toBe("Hello {name}");
  });
});
