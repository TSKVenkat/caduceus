import type { Config } from "@docusaurus/types";

const config: Config = {
  title: "Caduceus Agent",
  tagline: "Open coding agent for Ollama Cloud",
  favicon: "img/favicon.ico",
  url: "https://TSKVenkat.github.io",
  baseUrl: "/caduceus/",
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: "Caduceus",
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        {
          href: "https://github.com/TSKVenkat/caduceus",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      copyright: `Copyright © ${new Date().getFullYear()} Caduceus Agent.`,
    },
  },
};

export default config;
