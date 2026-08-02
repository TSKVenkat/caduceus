// Formats an amount in cents. Note the special cases.
export function format(cents) {
  if (cents === 0) return "FREE";
  return "$" + (cents / 100).toFixed(2);
}
