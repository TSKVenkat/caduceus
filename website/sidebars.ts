import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    "installation",
    "configuration",
    {
      label: "Gateway",
      items: ["gateway/slack", "gateway/whatsapp", "gateway/docker"],
    },
    {
      label: "API",
      items: ["api/openai-compatible"],
    },
    {
      label: "Reference",
      items: ["reference/environment-variables"],
    },
  ],
};

export default sidebars;
