---
type: Convention
title: User ID convention
description: How to construct a user's id from their name.
---

# User ID convention

A user's `id` is derived from their `name`:

1. Lowercase the name.
2. Replace each space with an underscore (`_`).
3. Prefix the result with `usr_`.

Examples:

- `"Alice"` -> `"usr_alice"`
- `"Bob Smith"` -> `"usr_bob_smith"`
