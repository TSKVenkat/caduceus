#!/usr/bin/env bash
node -e '
const { transform } = require("./transform");
const cases = [
  ["Hello World", "t-hel"],
  ["Foo", "t-foo"],
  ["Bar Baz Qux", "t-bar"]
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
