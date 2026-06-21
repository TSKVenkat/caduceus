const assert = require("node:assert");
const { fizzbuzz } = require("./fizzbuzz");

assert.strictEqual(fizzbuzz(3), "Fizz");
assert.strictEqual(fizzbuzz(5), "Buzz");
assert.strictEqual(fizzbuzz(15), "FizzBuzz");
assert.strictEqual(fizzbuzz(2), "2");
console.log("ok");
