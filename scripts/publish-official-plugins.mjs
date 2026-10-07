#!/usr/bin/env node
/**
 * Publish the official FengYu plugins (.fyp) into the Infinia store.
 *
 * For every plugin under OfficialPlugins/, compares the manifest version against
 * the store's FengYu compat catalog (the exact feed the host's plugin updater
 * reads) and publishes whatever is new: ensure-listing + draft release + ticketed
 * upload + immediate platform-admin publish, through /api/v1/admin/plugin-releases
 * (AdminPluginReleaseController — the same intranet path the host-app releases
 * use; the platform admin IS the review decision, and publishing mints the
 * platform Ed25519 signature the host requires for fan.summer.* installs).
 *
 * Idempotent: a plugin whose catalog version already equals the manifest version
 * is skipped, and an older manifest version never downgrades a published one.
 * Run ./dev-install-official-plugins.sh first so dist/*.fyp exist.
 *
 * Usage:
 *   node scripts/publish-official-plugins.mjs [--dry-run] [--plugins markdown,email]
 * Environment:
 *   STORE_API_BASE        store origin                 (default http://localhost:8080)
 *   STORE_ADMIN_EMAIL     PLATFORM_ADMIN login         (required unless --dry-run)
 *   STORE_ADMIN_PASSWORD  PLATFORM_ADMIN password      (required unless --dry-run)
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const OFFICIAL = path.join(REPO, 'OfficialPlugins')
const ALL_PLUGINS = ['markdown', 'excel', 'email', 'offlinepython']

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const pluginsFlag = argv.indexOf('--plugins')
const selected = pluginsFlag >= 0
  ? argv[pluginsFlag + 1].split(',').map((s) => s.trim()).filter(Boolean)
  : ALL_PLUGINS
const base = (argv.indexOf('--base') >= 0 ? argv[argv.indexOf('--base') + 1] : undefined)
  ?? process.env.STORE_API_BASE
  ?? 'http://localhost:8080'

for (const name of selected) {
  if (!ALL_PLUGINS.includes(name)) {
    fail(`unknown plugin '${name}' (known: ${ALL_PLUGINS.join(', ')})`)
  }
}

function log(msg) { console.log(msg) }
function fail(msg) { console.error(`error: ${msg}`); process.exit(1) }

/** SemVer precedence compare (build metadata ignored), pre-release < release. */
function compareSemVer(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim())
    if (!m) fail(`not valid SemVer: ${v}`)
    return { nums: m.slice(1, 4).map(Number), pre: m[4]?.split('.') ?? null }
  }
  const va = parse(a), vb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (va.nums[i] !== vb.nums[i]) return va.nums[i] - vb.nums[i]
  }
  if (va.pre === null && vb.pre === null) return 0
  if (va.pre === null) return 1
  if (vb.pre === null) return -1
  for (let i = 0; i < Math.max(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i], y = vb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny) return Number(x) - Number(y)
    if (nx) return -1
    if (ny) return 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

async function api(method, urlPath, { token, json, body, contentType } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (json !== undefined) headers['content-type'] = 'application/json'
  if (contentType) headers['content-type'] = contentType
  const response = await fetch(base + urlPath, {
    method, headers,
    body: json !== undefined ? JSON.stringify(json) : body,
  })
  const text = await response.text()
  let parsed = text
  try { parsed = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
  if (!response.ok) {
    const detail = typeof parsed === 'object' && parsed ? ` ${parsed.detail ?? ''}` : ` ${text.slice(0, 200)}`
    throw new Error(`${method} ${urlPath} → HTTP ${response.status}${detail}`)
  }
  return parsed
}

async function login() {
  const email = process.env.STORE_ADMIN_EMAIL
  const password = process.env.STORE_ADMIN_PASSWORD
  if (!email || !password) {
    fail('STORE_ADMIN_EMAIL / STORE_ADMIN_PASSWORD are required (a PLATFORM_ADMIN account)')
  }
  const response = await api('POST', '/api/v1/auth/login', { json: { email, password } })
  if (!response?.user?.roles?.includes('PLATFORM_ADMIN')) {
    fail(`${email} is not a PLATFORM_ADMIN account (roles: ${response?.user?.roles})`)
  }
  return response.accessToken
}

async function catalogById() {
  const entries = await api('GET', '/api/v1/compat/fengyu/catalog')
  return new Map(entries.map((e) => [e.id, e]))
}

/** Published releases of one plugin from the admin surface (any channel). */
async function publishedReleases(token, pluginId) {
  return (await api('GET', `/api/v1/admin/plugin-releases?pluginId=${encodeURIComponent(pluginId)}`, { token }))
    .filter((r) => r.status === 'PUBLISHED')
}

/** SemVer channel of a version, mirroring the store's inferChannel. */
function channelOf(version) {
  const label = /^[\d.]+-([a-z]+)/i.exec(version.trim())?.[1]?.toLowerCase() ?? ''
  return ['alpha', 'beta', 'rc', 'nightly'].includes(label) ? label : 'stable'
}

async function main() {
  log(`official plugin publisher → ${base}`)
  const token = dryRun ? null : await login()

  let published = 0, skipped = 0, failed = 0
  for (const name of selected) {
    const dir = path.join(OFFICIAL, `plugin-${name}`)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.base.json'), 'utf8'))
    const id = manifest.id
    if (!id.startsWith('fan.summer.')) fail(`${id} is not an official plugin id`)

    const archive = path.join(dir, 'dist', `${id}-${manifest.version}.fyp`)
    const sidecar = `${archive}.sha256`
    if (!fs.existsSync(archive) || !fs.existsSync(sidecar)) {
      log(`✗ ${id}: ${archive} missing — run ./dev-install-official-plugins.sh first`)
      failed++
      continue
    }
    const expectedSha = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0]
    const bytes = fs.readFileSync(archive)
    const channel = channelOf(manifest.version)

    // The admin release list is the source of truth for "already published": the
    // compat catalog the HOST reads only carries the stable channel by design, so
    // an alpha/beta version lives in the store but deliberately not in that feed.
    const already = dryRun ? [] : await publishedReleases(token, id)
    if (already.some((r) => r.version === manifest.version)) {
      log(`= ${id} ${manifest.version}: already published — skip`)
      skipped++
      continue
    }
    const latestPublished = already.at(0)
    if (latestPublished && compareSemVer(manifest.version, latestPublished.version) < 0) {
      log(`! ${id}: manifest ${manifest.version} is OLDER than published ${latestPublished.version} — refusing downgrade, skip`)
      failed++
      continue
    }

    if (dryRun) {
      log(`~ ${id}: would publish ${manifest.version} (${channel} channel)${latestPublished ? ` (published: ${latestPublished.version})` : ' (new listing)'} — dry run`)
      continue
    }

    try {
      // Resume path: an interrupted earlier run may have left a DRAFT for this
      // exact version (createDraftRelease would reject the duplicate slot).
      const drafts = (await api('GET', `/api/v1/admin/plugin-releases?pluginId=${encodeURIComponent(id)}`, { token }))
        .filter((r) => r.version === manifest.version && r.status !== 'PUBLISHED')
      for (const draft of drafts) {
        await api('DELETE', `/api/v1/admin/plugin-releases/${draft.releaseId}`, { token })
        log(`  cleaned stale ${draft.status} draft ${draft.releaseId}`)
      }

      const start = await api('POST', '/api/v1/admin/plugin-releases', {
        token,
        json: {
          pluginId: id,
          version: manifest.version,
          filename: path.basename(archive),
          size: bytes.length,
          name: manifest.name,
          summary: manifest.description,
          category: manifest.category,
          requiresHost: manifest.engines?.fengyu,
          permissions: manifest.permissions ?? [],
          changelog: `Official FengYu plugin release ${manifest.version} (auto-published from the FengYu-WebSite repository).`,
        },
      })
      await api('PUT', start.uploadUrl, {
        token: undefined, body: bytes, contentType: 'application/octet-stream',
      })
      const result = await api('POST', `/api/v1/admin/plugin-releases/${start.releaseId}/publish`, { token })
      if (result.status !== 'PUBLISHED') throw new Error(`unexpected status ${result.status}`)
      const artifact = result.artifacts?.find((a) => a.filename === path.basename(archive))
      if (!artifact || artifact.sha256 !== expectedSha) {
        throw new Error(`published sha ${artifact?.sha256} != sidecar ${expectedSha}`)
      }
      if (channel === 'stable') {
        // Only the stable channel enters the host's compat feed — verify the
        // exact entry end users will be offered.
        const after = (await catalogById()).get(id)
        if (!after || after.version !== manifest.version) {
          throw new Error('compat catalog did not pick up the stable release')
        }
        if (after.sha256 !== expectedSha) {
          throw new Error(`catalog sha ${after.sha256} != sidecar ${expectedSha}`)
        }
        log(`✓ ${id} ${manifest.version} published + live in the host catalog (sha ${expectedSha.slice(0, 12)}…)`)
      } else {
        log(`✓ ${id} ${manifest.version} published on the ${channel} channel (pre-release: not in the stable host feed by design)`)
      }
      published++
    } catch (error) {
      log(`✗ ${id}: ${error.message}`)
      failed++
    }
  }

  log(`\n${published} published, ${skipped} skipped, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((error) => fail(error.message))
