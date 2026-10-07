#!/usr/bin/env node
// Vendors the FengYu product docs into the store-web bundle so the official
// site serves its own documentation UI instead of linking out to GitHub Pages.
//
//   node scripts/sync-docs.mjs [--src <path-to-FengYu>/docs]
//
// Source resolution order: --src flag, FENGYU_DOCS env, then the sibling
// checkout ../FengYu/docs. Output: src/intro/docs/content/{en,zh}/**/*.md plus
// content/manifest.json (page titles per locale + the source git ref used for
// "edit this page" links). Re-running mirrors the source: files removed
// upstream disappear from the bundle.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, '..');
const contentDir = join(webRoot, 'src/intro/docs/content');
const LOCALES = ['en', 'zh'];

const flagIndex = process.argv.indexOf('--src');
const source =
  flagIndex !== -1 ? resolve(process.argv[flagIndex + 1])
  : process.env.FENGYU_DOCS ? resolve(process.env.FENGYU_DOCS)
  : resolve(webRoot, '../../FengYu/docs');

if (!existsSync(join(source, 'en')) || !existsSync(join(source, 'zh'))) {
  console.error(`docs source not found: ${source}`);
  console.error('Pass --src <path> or set FENGYU_DOCS to the FengYu repo\'s docs/ directory.');
  process.exit(1);
}

let sourceRef = 'main';
try {
  sourceRef = execFileSync('git', ['-C', source, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  console.warn('could not read git ref from source; manifest will record "main"');
}

/** Title per page: frontmatter `title`, else the first `# ` heading, else the file name. */
function pageTitle(markdown, slug) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const fromFrontmatter = frontmatter && /^title:[ \t]*(.+)$/m.exec(frontmatter[1]);
  if (fromFrontmatter) return fromFrontmatter[1].trim().replace(/^["']|["']$/g, '');
  const heading = /^#[ \t]+(.+)$/m.exec(markdown.slice(frontmatter ? frontmatter[0].length : 0));
  if (heading) return heading[1].trim();
  return slug.split('/').pop() || 'Docs';
}

/** Walks dir recursively and returns absolute .md paths (relativizing once, at the call site). */
async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collect(full) : entry.name.endsWith('.md') ? [full] : [];
  }));
  return files.flat(Infinity);
}

const pages = {};
for (const locale of LOCALES) {
  const localeDir = join(source, locale);
  const files = (await collect(localeDir)).map((file) => relative(localeDir, file));
  pages[locale] = {};
  for (const file of files) {
    const markdown = await readFile(join(localeDir, file), 'utf8');
    const slug = file.replace(/\.md$/, '').replaceAll('\\', '/');
    pages[locale][slug] = { title: pageTitle(markdown, slug) };
  }
}

await rm(contentDir, { recursive: true, force: true });
for (const locale of LOCALES) {
  await mkdir(join(contentDir, locale), { recursive: true });
  await cp(join(source, locale), join(contentDir, locale), { recursive: true, filter: (src) => !src.includes('/.') });
}

const manifest = { generatedAt: new Date().toISOString(), sourceRef, pages };
await writeFile(join(contentDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const total = Object.values(pages).reduce((sum, locale) => sum + Object.keys(locale).length, 0);
console.log(`synced ${total} pages (${LOCALES.map((l) => `${l}: ${Object.keys(pages[l]).length}`).join(', ')}) from ${source} @ ${sourceRef}`);
