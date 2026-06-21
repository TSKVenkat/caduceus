const assert = require("node:assert");
const { evaluate } = require("./calc");

assert.strictEqual(evaluate("2+3*4"), 14);
assert.strictEqual(evaluate("(2+3)*4"), 20);
assert.strictEqual(evaluate("10/3"), 3);
assert.strictEqual(evaluate("2*(3+4)-5"), 9);
assert.strictEqual(evaluate("100/(2+3)/2"), 10);
console.log("ok");
