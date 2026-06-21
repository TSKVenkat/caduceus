#!/usr/bin/env bash
node -e '
const { transform } = require("./transform");
const cases = [
  ["Hello World", "h*ll* w*rld"],
  ["Foo", "f**"],
  ["Bar Baz Qux", "b*r b*z q*x"]
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
