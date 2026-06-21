# Caduceus — agent & contributor notes

Caduceus is an open coding agent that runs on Ollama Cloud.

## Conventions

- TypeScript, ESM, strict mode. Package manager: pnpm.
- Validate external input with Zod at the boundary; keep the rest of the code strongly typed.
- Tools are small and composable, registered in `src/tools`. New capabilities prefer Skills over new tools.
- Keep the system-prompt prefix stable; volatile data (timestamp, memory) goes last.

## Checks before finishing

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass.
- Prefer small, verifiable changes over large rewrites.
