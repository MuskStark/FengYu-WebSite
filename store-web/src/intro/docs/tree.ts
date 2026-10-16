import type { Locale } from "@/i18n";

import { hasPage, pageTitle, type DocsLocale } from "./content";

export interface DocsSection {
  key: string;
  labels: Record<Locale, string>;
  /** Slugs in VitePress sidebar order; missing pages are skipped at render. */
  items: string[];
}

// Mirrors docs/.vitepress/config.ts in the FengYu repo — keep the two in sync
// when sections change upstream (re-running scripts/sync-docs.mjs won't
// restructure the sidebar).
export const DOCS_SECTIONS: DocsSection[] = [
  {
    key: "start",
    labels: { en: "Start", "zh-CN": "开始" },
    items: ["index", "quickstart", "features", "design-system"],
  },
  {
    key: "architecture",
    labels: { en: "Architecture", "zh-CN": "架构" },
    items: [
      "architecture/overview",
      "architecture/backend",
      "architecture/frontend",
      "architecture/desktop",
      "architecture/plugin-system",
    ],
  },
  {
    key: "plugins",
    labels: { en: "Plugins", "zh-CN": "插件" },
    items: [
      "plugins/overview",
      "plugins/getting-started",
      "plugins/manifest",
      "plugins/worker",
      "plugins/ui-microfrontend",
      "plugins/ui-components",
      "plugins/file-io",
      "plugins/database",
      "plugins/ai-tools",
      "plugins/sdk-cli",
      "plugins/marketplace",
      "plugins/i18n",
      "plugins/build-deploy",
      "plugins/official-markdown",
      "plugins/official-excel",
      "plugins/email-center",
      "plugins/official-offlinepython",
      "plugins/official-browser",
      "plugins/pitfalls",
    ],
  },
  {
    key: "guide",
    labels: { en: "Guide", "zh-CN": "指南" },
    items: [
      "guide/ai-chat",
      "guide/ai-agent",
      "guide/flow-nodes",
      "skills/index",
      "guide/database",
      "guide/configuration",
    ],
  },
  {
    key: "reference",
    labels: { en: "Reference", "zh-CN": "参考" },
    items: [
      "reference/rest-api",
      "reference/sse-events",
      "reference/troubleshooting",
      "reference/glossary",
      "reference/changelog",
    ],
  },
];

export interface SidebarGroup {
  key: string;
  label: string;
  items: { slug: string; title: string }[];
}

export function sidebarFor(locale: DocsLocale, uiLocale: Locale, filter = ""): SidebarGroup[] {
  const needle = filter.trim().toLowerCase();
  return DOCS_SECTIONS.flatMap((section) => {
    const items = section.items
      .filter((slug) => hasPage(locale, slug))
      .map((slug) => ({ slug, title: pageTitle(locale, slug) }))
      .filter(({ title, slug }) => !needle || title.toLowerCase().includes(needle) || slug.includes(needle));
    if (items.length === 0) return [];
    return [{ key: section.key, label: section.labels[uiLocale], items }];
  });
}

/** Flattened sidebar order — drives the page's prev/next navigation. */
export function pageNeighbors(locale: DocsLocale, slug: string) {
  const ordered = DOCS_SECTIONS.flatMap((section) => section.items.filter((s) => hasPage(locale, s)));
  const index = ordered.indexOf(slug);
  return {
    prev: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}
