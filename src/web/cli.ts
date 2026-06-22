#!/usr/bin/env node
import { existsSync } from "node:fs";
import { startServer } from "./server";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const port = startServer();
process.stdout.write(`Caduceus web UI → http://localhost:${port}\n`);
