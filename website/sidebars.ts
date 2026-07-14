import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    "installation",
    "configuration",
    {
      type: "category",
      label: "Gateway",
      items: ["gateway/slack", "gateway/whatsapp", "gateway/docker"],
    },
    {
      type: "category",
      label: "API",
      items: ["api/openai-compatible"],
    },
    {
      type: "category",
      label: "Reference",
      items: ["reference/environment-variables"],
    },
  ],
};

export default sidebars;
