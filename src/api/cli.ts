import { startApiServer } from "./server.js";

export async function runApiCli(argv: string[]): Promise<number> {
  const port = Number(argv[0] ?? process.env.API_SERVER_PORT ?? 8642);
  const host = process.env.API_SERVER_HOST ?? "127.0.0.1";
  const key = process.env.API_SERVER_KEY;

  startApiServer({ port, host, key });

  return 0;
}
