import { hasPage, type DocsLocale } from "./content";

/**
 * GitHub-slugger-compatible heading ids (VitePress anchors match this scheme),
 * so markdown-authored `#anchor` links keep working inside the SPA.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2000-\u206f\u2e00-\u2e7f'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, "")
    .replace(/\s+/g, "-");
}

/** Resolves `.`/`..` segments of a docs-relative link against the current page. */
function resolveSlug(currentSlug: string, path: string): string {
  const dir = currentSlug.split("/").slice(0, -1);
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") dir.pop();
    else dir.push(segment);
  }
  return dir.filter(Boolean).join("/");
}

export type ResolvedHref =
  | { kind: "anchor"; hash: string }
  | { kind: "internal"; path: string }
  | { kind: "external"; url: string };

/** VitePress directory links (`/en/skills/`) resolve to the directory's index page. */
function withIndexFallback(locale: DocsLocale, slug: string): string {
  if (slug !== "index" && !hasPage(locale, slug) && hasPage(locale, `${slug}/index`)) {
    return `${slug}/index`;
  }
  return slug;
}

/**
 * Rewrites the href forms found in the docs markdown: page anchors (`#x`),
 * VitePress absolute routes (`/en/plugins/worker`, optional `.md` suffix) and
 * relative links (`../plugins/manifest.md#flownodes`). Everything else is
 * treated as outbound.
 */
export function resolveDocHref(href: string, locale: DocsLocale, currentSlug: string): ResolvedHref {
  if (href.startsWith("#")) return { kind: "anchor", hash: href };
  if (/^(https?:|mailto:)/.test(href)) return { kind: "external", url: href };

  const [path, hash = ""] = href.split("#");
  const suffix = hash ? `#${hash}` : "";

  if (path.startsWith("/en/") || path.startsWith("/zh/") || path === "/en" || path === "/zh") {
    const targetLocale: DocsLocale = path.startsWith("/zh") ? "zh" : "en";
    const raw = path.replace(/^\/(en|zh)\/?/, "").replace(/\.md$/, "").replace(/\/+$/, "");
    const slug = withIndexFallback(targetLocale, raw);
    return { kind: "internal", path: `/docs/${targetLocale}/${slug || "index"}${suffix}` };
  }

  const slug = withIndexFallback(locale, resolveSlug(currentSlug, path.replace(/\.md$/, "").replace(/\/+$/, "")));
  return { kind: "internal", path: `/docs/${locale}/${slug || "index"}${suffix}` };
}
