---
type: Convention
title: Error code convention
description: How to construct an error code from a kind string.
---

# Error code convention

An error code is built from the `kind` string:

1. Uppercase it.
2. Replace each space with an underscore (`_`).
3. Prefix the result with `E_`.

Examples:

- `"not_found"` -> `"E_NOT_FOUND"`
- `"bad input"` -> `"E_BAD_INPUT"`
