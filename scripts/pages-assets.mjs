#!/usr/bin/env node
// Retain the complete previous Pages tree; HTML alone cannot enumerate lazy chunks.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MANIFEST = 'infinia-assets-manifest.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const excluded = (name) => name === MANIFEST || name.split('/').some(
  (part) => part.startsWith('.') || ['_headers', '_redirects', '_worker.js', 'functions'].includes(part),
);

async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (excluded(name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in publish tree: ${name}`);
    if (entry.isDirectory()) result.push(...await files(path.join(dir, entry.name), `${name}/`));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort();
}

function validate(manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid assets manifest');
  const seen = new Set();
  for (const { name, sha256, contentBase64 } of manifest.files) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(name)
      || name.startsWith('/') || name.split('/').some((p) => !p || p === '.' || p === '..')
      || excluded(name) || seen.has(name) || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`Invalid manifest entry: ${name}`);
    }
    if (contentBase64 !== undefined && (typeof contentBase64 !== 'string'
      || !name.endsWith('.html')
      || Buffer.from(contentBase64, 'base64').toString('base64') !== contentBase64
      || digest(Buffer.from(contentBase64, 'base64')) !== sha256)) {
      throw new Error(`Invalid embedded HTML: ${name}`);
    }
    seen.add(name);
  }
  return manifest.files;
}

export async function retain({ stage, origin, fresh = false, previous = '', fetcher = fetch }) {
  const current = new Set(await files(stage));
  const get = async (name) => {
    const response = await fetcher(`${origin}/${name}`, {
      redirect: 'follow', signal: AbortSignal.timeout(30000), cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${name}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const restore = async (name, data) => {
    // Current build wins for shells/public files; old hashed filenames survive.
    if (current.has(name)) return;
    const dest = path.join(stage, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
  };
  if (previous) {
    for (const name of await files(previous)) await restore(name, await readFile(path.join(previous, name)));
  } else if (!fresh) {
    let entries;
    try {
      entries = validate(JSON.parse((await get(MANIFEST)).toString('utf8')));
    } catch (error) {
      throw new Error(`Cannot retain the previous Pages deployment: ${error.message}. `
        + 'For migration, use --previous-dist with the COMPLETE previous project tree. '
        + 'Use --fresh-project only for an empty project. No publish was performed.');
    }
    for (const { name, sha256, contentBase64 } of entries) {
      if (current.has(name)) continue;
      const data = contentBase64 === undefined ? await get(name) : Buffer.from(contentBase64, 'base64');
      if (digest(data) !== sha256) throw new Error(`Asset checksum mismatch: ${name}; refusing partial publish`);
      await restore(name, data);
    }
  }
  const entries = [];
  for (const name of await files(stage)) {
    const data = await readFile(path.join(stage, name));
    // Cloudflare can inject challenge/beacon scripts into HTML responses.
    // Retain original shells in the manifest instead of re-downloading changed HTML.
    entries.push({ name, sha256: digest(data),
      ...(name.endsWith('.html') ? { contentBase64: data.toString('base64') } : {}),
    });
  }
  validate({ version: 1, files: entries });
  await writeFile(path.join(stage, MANIFEST), JSON.stringify({ version: 1, files: entries }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , stage, origin, fresh, previous] = process.argv;
  retain({ stage, origin, fresh: fresh === '1', previous }).catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}
