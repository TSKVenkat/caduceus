// ASCII-art logos for the welcome banner, generated with figlet (ANSI Shadow
// and Standard fonts). The block logo is used on wide terminals, the compact one
// when there is not enough width.

export const BLOCK_LOGO: string[] = [
  " ██████╗ █████╗ ██████╗ ██╗   ██╗ ██████╗███████╗██╗   ██╗███████╗",
  "██╔════╝██╔══██╗██╔══██╗██║   ██║██╔════╝██╔════╝██║   ██║██╔════╝",
  "██║     ███████║██║  ██║██║   ██║██║     █████╗  ██║   ██║███████╗",
  "██║     ██╔══██║██║  ██║██║   ██║██║     ██╔══╝  ██║   ██║╚════██║",
  "╚██████╗██║  ██║██████╔╝╚██████╔╝╚██████╗███████╗╚██████╔╝███████║",
  " ╚═════╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚═════╝╚══════╝ ╚═════╝ ╚══════╝",
];

export const COMPACT_LOGO: string[] = [
  "   ____          _                          ",
  "  / ___|__ _  __| |_   _  ___ ___ _   _ ___ ",
  " | |   / _` |/ _` | | | |/ __/ _ \\ | | / __|",
  " | |__| (_| | (_| | |_| | (_|  __/ |_| \\__ \\",
  "  \\____\\__,_|\\__,_|\\__,_|\\___\\___|\\__,_|___/",
];

/** Pick a logo that fits the terminal width. */
export function pickLogo(width: number): string[] {
  return width >= 70 ? BLOCK_LOGO : COMPACT_LOGO;
}
