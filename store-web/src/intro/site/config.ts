export const STORE_URL = "/store";
export const BASE_PATH = "";

/** Outbound links for the official website — all pointing at the real project. */
export const LINKS = {
  github: "https://github.com/MuskStark/FengYu",
  // Docs live on their dedicated subdomain — the infinia-docs Cloudflare
  // Pages project at its root, published from FengYu main's docs.yml
  // publish-infinia job (vitepress build --base=/).
  docs: "https://docs.infinia.fyi/",
  docsAgent: "https://docs.infinia.fyi/en/guide/ai-agent",
  docsSkills: "https://docs.infinia.fyi/en/skills/",
  docsPlugins: "https://docs.infinia.fyi/en/plugins/overview",
  docsMarketplace: "https://docs.infinia.fyi/en/plugins/marketplace",
  docsEmail: "https://docs.infinia.fyi/en/plugins/email-center",
  docsExcel: "https://docs.infinia.fyi/en/plugins/official-excel",
  docsDatabase: "https://docs.infinia.fyi/en/guide/database",
  docsArchitecture: "https://docs.infinia.fyi/en/architecture/overview",
  changelog: "https://docs.infinia.fyi/en/reference/changelog",
  releases: "https://github.com/MuskStark/FengYu/releases",
  issues: "https://github.com/MuskStark/FengYu/issues",
} as const;
