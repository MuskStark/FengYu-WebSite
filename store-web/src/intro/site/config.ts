export const STORE_URL = "/store";
export const BASE_PATH = "";

/** Outbound links for the official website — all pointing at the real project. */
export const LINKS = {
  github: "https://github.com/MuskStark/FengYu",
  // Docs live IN-SITE at /docs — the zone Worker (scripts/docs-worker) serves
  // the infinia-docs Pages project there; the build with --base=/docs/ comes
  // from FengYu main's docs.yml publish-infinia job. No more hopping out to
  // muskstark.github.io.
  docs: "/docs/",
  docsAgent: "/docs/en/guide/ai-agent",
  docsSkills: "/docs/en/skills/",
  docsPlugins: "/docs/en/plugins/overview",
  docsMarketplace: "/docs/en/plugins/marketplace",
  docsEmail: "/docs/en/plugins/email-center",
  docsExcel: "/docs/en/plugins/official-excel",
  docsDatabase: "/docs/en/guide/database",
  docsArchitecture: "/docs/en/architecture/overview",
  changelog: "/docs/en/reference/changelog",
  releases: "https://github.com/MuskStark/FengYu/releases",
  issues: "https://github.com/MuskStark/FengYu/issues",
} as const;
