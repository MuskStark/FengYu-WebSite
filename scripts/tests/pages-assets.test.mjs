import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MANIFEST, retain } from '../pages-assets.mjs';

async function fixture(t, content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pages-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, data] of Object.entries(content)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), data);
  }
  return dir;
}
const serve = (dir) => async (url) => {
  try { return new Response(await readFile(path.join(dir, new URL(url).pathname))); }
  catch { return new Response('not found', { status: 404 }); }
};

test('successive publishes retain both shells, lazy chunks, fonts and old hashes', async (t) => {
  const old = await fixture(t, {
    'index.html': 'old store shell', 'assets/index-old.js': 'old entry',
    'assets/lazy-old.js': 'lazy module', 'assets/font.woff2': 'font',
    'monitor/index.html': 'monitor shell', 'monitor/assets/index-mon.js': 'monitor entry',
    '_headers': 'control file',
  });
  await retain({ stage: old, fresh: true });
  const stage = await fixture(t, { 'index.html': 'new shell', 'assets/index-new.js': 'new entry' });
  await retain({ stage, origin: 'https://assets.test', fetcher: serve(old) });
  assert.equal(await readFile(path.join(stage, 'index.html'), 'utf8'), 'new shell');
  for (const name of ['assets/index-old.js', 'assets/lazy-old.js', 'assets/font.woff2', 'monitor/index.html', 'monitor/assets/index-mon.js']) {
    assert.deepEqual(await readFile(path.join(stage, name)), await readFile(path.join(old, name)));
  }
  const manifest = JSON.parse(await readFile(path.join(stage, MANIFEST), 'utf8'));
  assert.equal(manifest.files.length, 7);
  assert.ok(manifest.files.every(({ name }) => name !== '_headers'));
});

test('migrates a complete previous tree while giving the new shell precedence', async (t) => {
  const previous = await fixture(t, { 'index.html': 'old', 'assets/old.js': 'old', 'monitor/index.html': 'monitor' });
  const stage = await fixture(t, { 'index.html': 'new' });
  await retain({ stage, previous });
  assert.equal(await readFile(path.join(stage, 'index.html'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(stage, 'monitor/index.html'), 'utf8'), 'monitor');
});

for (const mode of ['missing', 'html', 'corrupt-asset', 'missing-asset', 'traversal']) {
  test(`fails closed on ${mode}`, async (t) => {
    const old = await fixture(t, { 'assets/old.js': 'old' });
    await retain({ stage: old, fresh: true });
    const stage = await fixture(t, { 'index.html': 'new' });
    const fetcher = async (url) => {
      if (mode === 'missing') return new Response('', { status: 404 });
      if (mode === 'html') return new Response('<html>SPA fallback</html>');
      if (url.endsWith(MANIFEST)) {
        if (mode === 'traversal') return Response.json({ version: 1, files: [{ name: '../oops', sha256: 'a'.repeat(64) }] });
        return serve(old)(url);
      }
      return mode === 'missing-asset' ? new Response('', { status: 404 }) : new Response('<html>fallback</html>');
    };
    await assert.rejects(retain({ stage, origin: 'https://assets.test', fetcher }));
    await assert.rejects(readFile(path.join(stage, MANIFEST)));
  });
}


test('retains original HTML even when Cloudflare rewrites served shells', async (t) => {
  const old = await fixture(t, { 'index.html': '<html>store</html>', 'assets/old.js': 'old' });
  await retain({ stage: old, fresh: true });
  await writeFile(path.join(old, 'index.html'), '<html>store<script>injected beacon</script></html>');
  const stage = await fixture(t, { 'monitor/index.html': '<html>monitor</html>' });
  await retain({ stage, origin: 'https://assets.test', fetcher: serve(old) });
  assert.equal(await readFile(path.join(stage, 'index.html'), 'utf8'), '<html>store</html>');
});
