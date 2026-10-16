import manifest from "./content/manifest.json";

export type DocsLocale = "en" | "zh";

export interface DocsManifest {
  generatedAt: string;
  sourceRef: string;
  pages: Record<DocsLocale, Record<string, { title: string }>>;
}

export const docsManifest = manifest as DocsManifest;

/** '' | '/' → 'index'; trims stray slashes so route params map onto glob keys. */
export function normalizeSlug(slug: string): string {
  const trimmed = slug.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "index" : trimmed;
}

export function hasPage(locale: DocsLocale, slug: string): boolean {
  return Boolean(docsManifest.pages[locale]?.[slug]);
}

/** Page label for the sidebar; the docs home keeps VitePress' explicit label. */
export function pageTitle(locale: DocsLocale, slug: string): string {
  if (slug === "index") return locale === "zh" ? "首页" : "Home";
  return docsManifest.pages[locale]?.[slug]?.title ?? slug;
}

// Lazy raw imports — Vite emits one tiny chunk per page, so the initial docs
// load ships only the shell while deep pages stay lazily fetchable.
const chunks = import.meta.glob("./content/*/*.md", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

// The glob above misses depth: tinyglobby's `*` matches a single segment, so
// nested pages (plugins/overview.md) come from a second pattern.
const deepChunks = import.meta.glob("./content/*/*/*.md", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

const allChunks = { ...chunks, ...deepChunks };

export interface DocsPage {
  slug: string;
  title: string;
  /** Markdown with frontmatter stripped and VitePress containers normalized. */
  markdown: string;
}

const cache = new Map<string, DocsPage>();

/**
 * VitePress `::: tip Title … :::` containers become `[!TIP] Title` blockquote
 * markers, which the Markdown renderer maps onto styled callouts. Code fences
 * never appear inside containers in this docs set, so line-wise rewriting is
 * safe.
 */
function normalizeContainers(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inContainer = false;
  for (const line of lines) {
    const opening = inContainer ? null : /^:::[ \t]*(tip|info|note|warning|danger)[ \t]*(.*)$/.exec(line);
    if (opening) {
      const kind = opening[1] === "note" ? "info" : opening[1];
      out.push(`> [!${kind.toUpperCase()}]${opening[2] ? ` ${opening[2]}` : ""}`);
      // Blank quote line: keeps the marker its own paragraph so the renderer
      // can drop it and keep the container body.
      out.push(">");
      inContainer = true;
    } else if (inContainer && /^:::[ \t]*$/.test(line)) {
      inContainer = false;
    } else if (inContainer) {
      out.push(`> ${line}`);
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

export async function loadPage(locale: DocsLocale, slug: string): Promise<DocsPage | null> {
  const normalized = normalizeSlug(slug);
  const key = `${locale}/${normalized}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const importer = allChunks[`./content/${locale}/${normalized}.md`];
  if (!importer) return null;
  const raw = (await importer()) as string;
  const withoutFrontmatter = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const page: DocsPage = {
    slug: normalized,
    title: pageTitle(locale, normalized),
    markdown: normalizeContainers(withoutFrontmatter),
  };
  cache.set(key, page);
  return page;
}
