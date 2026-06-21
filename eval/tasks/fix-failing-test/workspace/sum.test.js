const assert = require("node:assert");
const { sum } = require("./sum");

assert.strictEqual(sum(2, 3), 5);
assert.strictEqual(sum(-1, 1), 0);
assert.strictEqual(sum(0, 0), 0);
console.log("ok");
