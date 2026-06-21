// Generates a controlled benchmark of "project convention" tasks.
//
// Each task asks the agent to implement transform(input) following an arbitrary
// rule that it cannot guess. The rule is documented ONLY in an OKF knowledge
// concept (not in the workspace or the test), so success requires reading the
// knowledge layer. The verifier checks held-out inputs (different from the
// examples shown in the concept), so memorizing the examples is not enough.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TASKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "tasks");

const rules = [
  { name: "user-handle", desc: "lowercase the input, replace spaces with underscores, and prefix the result with `u_`.", fn: (s) => "u_" + s.toLowerCase().replaceAll(" ", "_") },
  { name: "ticket-code", desc: "uppercase the input, replace spaces with hyphens, and append the suffix `-T`.", fn: (s) => s.toUpperCase().replaceAll(" ", "-") + "-T" },
  { name: "slug", desc: "lowercase the input, replace spaces with hyphens, and prefix with `s/`.", fn: (s) => "s/" + s.toLowerCase().replaceAll(" ", "-") },
  { name: "shout", desc: "uppercase the input and append three exclamation marks.", fn: (s) => s.toUpperCase() + "!!!" },
  { name: "redact-vowels", desc: "lowercase the input and replace every vowel (a, e, i, o, u) with an asterisk `*`.", fn: (s) => s.toLowerCase().replace(/[aeiou]/g, "*") },
  { name: "reverse-tag", desc: "reverse the characters of the input and wrap the result in angle brackets, e.g. `<...>`.", fn: (s) => "<" + [...s].reverse().join("") + ">" },
  { name: "count-prefix", desc: "prefix the input with its character length followed by a colon, keeping the original text after the colon.", fn: (s) => s.length + ":" + s },
  { name: "dot-key", desc: "lowercase the input, replace spaces with dots, and prefix with `k.`.", fn: (s) => "k." + s.toLowerCase().replaceAll(" ", ".") },
  { name: "hex-mark", desc: "uppercase the input, replace spaces with underscores, and prefix with `0x`.", fn: (s) => "0x" + s.toUpperCase().replaceAll(" ", "_") },
  { name: "pipe-wrap", desc: "lowercase the input and wrap it between pipe characters, e.g. `|...|`.", fn: (s) => "|" + s.toLowerCase() + "|" },
  { name: "double-snake", desc: "uppercase the input and replace each space with a double underscore `__`.", fn: (s) => s.toUpperCase().replaceAll(" ", "__") },
  { name: "trim-three", desc: "lowercase the input, keep only the first three characters, and prefix with `t-`.", fn: (s) => "t-" + s.toLowerCase().slice(0, 3) },
];

const verifyInputs = ["Hello World", "Foo", "Bar Baz Qux"];
const exampleInputs = ["Alpha", "Two Words"];

let count = 0;
for (const rule of rules) {
  const id = `conv-${rule.name}`;
  const dir = join(TASKS_DIR, id);
  await mkdir(join(dir, "workspace"), { recursive: true });
  await mkdir(join(dir, "knowledge", "conventions"), { recursive: true });

  await writeFile(
    join(dir, "prompt.txt"),
    `Implement transform(input) in transform.js so it follows the project's "${rule.name}" string convention. The exact rule is described in the project knowledge — consult it, then implement transform accordingly.\n`,
  );

  await writeFile(
    join(dir, "workspace", "transform.js"),
    `function transform(input) {\n  // TODO: apply the project's "${rule.name}" convention.\n}\n\nmodule.exports = { transform };\n`,
  );

  const examples = exampleInputs.map((s) => `- "${s}" -> "${rule.fn(s)}"`).join("\n");
  await writeFile(
    join(dir, "knowledge", "conventions", `${rule.name}.md`),
    `---\ntype: Convention\ntitle: ${rule.name} convention\ndescription: How to transform a string under the ${rule.name} convention.\n---\n\n# ${rule.name} convention\n\nTo transform a string under the **${rule.name}** convention: ${rule.desc}\n\nExamples:\n\n${examples}\n`,
  );

  const cases = verifyInputs.map((s) => `  [${JSON.stringify(s)}, ${JSON.stringify(rule.fn(s))}]`).join(",\n");
  await writeFile(
    join(dir, "verify.sh"),
    `#!/usr/bin/env bash\nnode -e '\nconst { transform } = require("./transform");\nconst cases = [\n${cases}\n];\nfor (const [input, expected] of cases) {\n  const got = transform(input);\n  if (got !== expected) {\n    console.error("transform(" + JSON.stringify(input) + ") = " + JSON.stringify(got) + ", expected " + JSON.stringify(expected));\n    process.exit(1);\n  }\n}\nconsole.log("ok");\n'\n`,
  );
  count++;
}

console.log(`generated ${count} convention tasks under eval/tasks/conv-*`);
