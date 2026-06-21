const { add, sub, mul, div } = require("./ops");

function calculate(a, op, b) {
  switch (op) {
    case "+":
      return add(a, b);
    case "-":
      return sub(a, b);
    case "*":
      return mul(a, b);
    case "/":
      return div(a, b);
    default:
      throw new Error(`unknown operator: ${op}`);
  }
}

module.exports = { calculate };
