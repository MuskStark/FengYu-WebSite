import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { hasPage, loadPage, normalizeSlug } from '@/intro/docs/content';
import { Markdown } from '@/intro/docs/Markdown';
import { resolveDocHref, slugifyHeading } from '@/intro/docs/links';

describe('docs content', () => {
  it('normalizes route slugs onto page ids', () => {
    expect(normalizeSlug('')).toBe('index');
    expect(normalizeSlug('/plugins/overview/')).toBe('plugins/overview');
  });

  it('knows which vendored pages exist', () => {
    expect(hasPage('en', 'plugins/overview')).toBe(true);
    expect(hasPage('zh', 'guide/ai-agent')).toBe(true);
    expect(hasPage('en', 'nope/missing')).toBe(false);
  });

  it('loads markdown with frontmatter stripped', async () => {
    const page = await loadPage('en', 'quickstart');
    expect(page).not.toBeNull();
    expect(page!.markdown).not.toMatch(/^---/);
  });
});

describe('docs href rewriting', () => {
  it('keeps page anchors and outbound links untouched', () => {
    expect(resolveDocHref('#backend', 'en', 'architecture/backend')).toEqual({ kind: 'anchor', hash: '#backend' });
    expect(resolveDocHref('https://github.com/MuskStark/FengYu', 'en', 'index')).toEqual({
      kind: 'external',
      url: 'https://github.com/MuskStark/FengYu',
    });
  });

  it('maps VitePress absolute routes onto in-app docs paths', () => {
    expect(resolveDocHref('/en/plugins/worker', 'en', 'guide/ai-chat')).toEqual({
      kind: 'internal',
      path: '/docs/en/plugins/worker',
    });
    expect(resolveDocHref('/zh/guide/database', 'en', 'index')).toEqual({
      kind: 'internal',
      path: '/docs/zh/guide/database',
    });
  });

  it('resolves .md-suffixed and directory-style links', () => {
    expect(resolveDocHref('/en/plugins/email-center.md', 'en', 'index')).toEqual({
      kind: 'internal',
      path: '/docs/en/plugins/email-center',
    });
    // Directory link → the directory's index page, when one exists.
    expect(resolveDocHref('/en/skills/', 'en', 'index')).toEqual({
      kind: 'internal',
      path: '/docs/en/skills/index',
    });
  });

  it('resolves relative links against the current page', () => {
    expect(resolveDocHref('../plugins/manifest.md#flownodes', 'en', 'plugins/overview')).toEqual({
      kind: 'internal',
      path: '/docs/en/plugins/manifest#flownodes',
    });
    expect(resolveDocHref('./ai-agent.md#workflow-webhooks', 'en', 'guide/ai-chat')).toEqual({
      kind: 'internal',
      path: '/docs/en/guide/ai-agent#workflow-webhooks',
    });
  });
});

describe('heading slugs', () => {
  it('matches the github-slugger scheme used by authored anchors', () => {
    expect(slugifyHeading('Setup vs. App Mode')).toBe('setup-vs-app-mode');
    expect(slugifyHeading('Worker (JSON-RPC)')).toBe('worker-json-rpc');
    expect(slugifyHeading('概述')).toBe('概述');
  });
});

describe('docs markdown rendering', () => {
  it('turns VitePress containers into styled callouts', () => {
    const { container, queryByText } = render(
      <Markdown markdown={'> [!WARNING] Careful\n>\n> Body text.'} locale="en" slug="index" />,
    );
    const callout = container.querySelector('.docs-callout-warning');
    expect(callout).toBeTruthy();
    expect(callout!.textContent).toContain('Careful');
    expect(callout!.textContent).toContain('Body text.');
    expect(queryByText(/\[!WARNING\]/)).toBeNull();
  });

  it('rewrites internal links to in-app routes', () => {
    const { container } = render(
      <MemoryRouter>
        <Markdown markdown="[guide](/en/guide/ai-agent)" locale="en" slug="index" />
      </MemoryRouter>,
    );
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('/docs/en/guide/ai-agent');
  });

  it('gives headings slug ids for TOC anchors', () => {
    const { container } = render(
      <Markdown markdown={'## Worker (JSON-RPC)'} locale="en" slug="plugins/worker" />,
    );
    expect(container.querySelector('h2')?.id).toBe('worker-json-rpc');
  });
});
