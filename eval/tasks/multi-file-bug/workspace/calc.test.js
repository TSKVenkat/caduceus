const assert = require("node:assert");
const { calculate } = require("./calculator");

assert.strictEqual(calculate(6, "/", 2), 3);
assert.strictEqual(calculate(2, "+", 3), 5);
assert.strictEqual(calculate(4, "*", 5), 20);
assert.strictEqual(calculate(9, "-", 4), 5);
console.log("ok");
