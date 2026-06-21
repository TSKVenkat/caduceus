#!/usr/bin/env bash
node -e '
const { transform } = require("./transform");
const cases = [
  ["Hello World", "0xHELLO_WORLD"],
  ["Foo", "0xFOO"],
  ["Bar Baz Qux", "0xBAR_BAZ_QUX"]
];
for (const [input, expected] of cases) {
  const got = transform(input);
  if (got !== expected) {
    console.error("transform(" + JSON.stringify(input) + ") = " + JSON.stringify(got) + ", expected " + JSON.stringify(expected));
    process.exit(1);
  }
}
console.log("ok");
'
