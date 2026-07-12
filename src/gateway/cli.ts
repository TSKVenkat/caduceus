export async function runGatewayCli(argv: string[]): Promise<number> {
  const subcommand = argv[1] ?? "run";

  switch (subcommand) {
    case "run":
      console.error("gateway run: not yet implemented — see feat/gateway-core branch");
      return 1;
    case "setup":
      console.error("gateway setup: not yet implemented — see feat/docker-hosting branch");
      return 1;
    case "status":
      console.error("gateway status: not yet implemented — see feat/docker-hosting branch");
      return 1;
    case "stop":
      console.error("gateway stop: not yet implemented");
      return 1;
    case "--help":
    case "-h":
    case "help":
      printHelp();
      return 0;
    default:
      console.error(`Unknown gateway subcommand: ${subcommand}`);
      printHelp();
      return 1;
  }
}

function printHelp(): void {
  console.log(`caduceus gateway — messaging gateway management

Usage:
  caduceus gateway run       Start the messaging gateway (connects to Slack/WhatsApp)
  caduceus gateway setup     Interactive setup wizard for platform credentials
  caduceus gateway status    Show gateway status and connected platforms
  caduceus gateway stop      Stop a running gateway
  caduceus gateway help      Show this help message

Environment:
  SLACK_BOT_TOKEN            Slack bot OAuth token (xoxb-)
  SLACK_APP_TOKEN            Slack app-level token for Socket Mode (xapp-)
  WHATSAPP_ENABLED           Set to "true" to enable WhatsApp
  WHATSAPP_ALLOWED_USERS     Comma-separated phone numbers (no +)

Full documentation: https://github.com/TSKVenkat/caduceus/blob/main/HANDOFF.md`);
}
