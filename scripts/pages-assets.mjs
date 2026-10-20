#!/usr/bin/env node
// Retain the complete previous Pages tree; HTML alone cannot enumerate lazy chunks.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MANIFEST = 'infinia-assets-manifest.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const excluded = (name) => name === MANIFEST || name.split('/').some(
  (part) => part.startsWith('.') || ['_headers', '_redirects', '_worker.js', 'functions'].includes(part),
);

// Origin fetches run from deploy hosts whose route to Cloudflare can be slow
// (multi-second first bytes observed in production): the defaults tolerate a
// 2-minute first byte per request with 6 network-error retries, so a bare
// `upgrade.sh` needs no configuration. Both are env-tunable for the
// exceptional routes — NB: `||` not `??`, because deploy-assets.sh's docker
// fallback passes unset vars through as EMPTY STRINGS.
const FETCH_TIMEOUT_MS = Number(process.env.ASSETS_FETCH_TIMEOUT_MS || 120000);
const FETCH_RETRIES = Number(process.env.ASSETS_FETCH_RETRIES || 6);

// HTTP error statuses never retry; everything network-level (headers or body)
// does — the body read must stay inside the retry loop because the timeout
// signal spans the whole transfer: a route that delivers headers and then
// stalls mid-body otherwise escapes as a bare "aborted due to timeout".
class HttpStatusError extends Error {}

const describe = (error) => (error.cause?.code
  ? `${error.message || error.name} [${error.cause.code}]`
  : error.message || error.name || 'unknown error');

// Origin reads must NOT use the global fetch: undici caps the TCP/TLS
// handshake at 10s, and deploy hosts sit on routes that need >10s just to
// connect (curl gets HTTP 200 in ~13s while fetch dies ETIMEDOUT before
// FETCH_TIMEOUT_MS ever applies). A plain https client with one timeout
// spanning handshake AND body, plus keep-alive, survives those routes and
// pays the slow handshake once for the whole retain pass. NB: Cloudflare
// Pages IGNORES Range requests (200 + full body), so byte-resume is not an
// option — retries always restart the file; budget windows accordingly
// (ASSETS_FETCH_TIMEOUT_MS / ASSETS_FETCH_RETRIES in deploy.conf).
const originAgent = new HttpsAgent({ keepAlive: true });
const slowRouteFetch = (url, { signal } = {}) => new Promise((resolve, reject) => {
  const req = httpsRequest(url, { agent: originAgent, headers: { 'accept-encoding': 'identity' } }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('error', reject);
    res.on('end', () => {
      // A truncated body can END cleanly (content-length mismatch): check.
      if (!res.complete) { reject(new Error('truncated response')); return; }
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        arrayBuffer: async () => Buffer.concat(chunks),
      });
    });
  });
  req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('socket timed out')));
  if (signal) {
    if (signal.aborted) req.destroy(new Error('aborted'));
    else signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
  }
  req.on('error', reject);
  req.end();
});

async function fetchOrigin(fetcher, url, name = url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(url, {
        redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store',
      });
      if (!response.ok) throw new HttpStatusError(`HTTP ${response.status}: ${name}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof HttpStatusError || attempt >= FETCH_RETRIES) {
        throw new Error(`${url}: ${describe(error)}`);
      }
      console.error(`fetch ${url} failed (${describe(error)}); retry ${attempt + 1}/${FETCH_RETRIES}`);
      await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
    }
  }
}

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

export async function retain({ stage, origin, fresh = false, previous = '', fetcher = slowRouteFetch }) {
  const current = new Set(await files(stage));
  const get = async (name) => fetchOrigin(fetcher, `${origin}/${name}`, name);
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
