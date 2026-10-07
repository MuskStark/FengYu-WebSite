#!/usr/bin/env node
/**
 * Restore the Aceternity component sources into every official plugin's
 * ui-src/src/aceternity/.
 *
 * Toolchain 2.1.x removed the vendored Aceternity components from
 * @infinia/plugin-ui (the Aceternity license forbids redistributing their
 * source files, and this repository is public), so each plugin vendors its own
 * machine-local copies. They are gitignored and must be restored before
 * `fengyu build` / dev-install-official-plugins.sh on a fresh checkout.
 *
 * The FengYu-adapted variants (notably card-spotlight without the three.js
 * CanvasRevealEffect layer — "plugin iframe bundles must stay small") are
 * preserved in the FengYu repository's git history even after the deletion
 * commits, pinned below. Re-pin when the toolchain reworks a component.
 *
 * Usage:
 *   node OfficialPlugins/scripts/restore-aceternity.mjs [--fengyu-root <dir>]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const rootFlag = argv.indexOf('--fengyu-root')
const FENGYU = path.resolve(
  rootFlag >= 0 ? argv[rootFlag + 1] : path.join(__dirname, '..', '..', '..', 'FengYu'),
)
// FengYu commit whose toolchain/ui/src/components/aceternity/ matches the
// component APIs these plugins are written against (pre-deletion HEAD).
const PINNED_COMMIT = 'a407471a'
const PLUGINS = path.resolve(__dirname, '..')
const FETCHED_ON = new Date().toISOString().slice(0, 10)

// component slug -> plugin dirs that import it
const MAP = {
  'card-spotlight': ['plugin-markdown', 'plugin-email'],
  'floating-dock': ['plugin-markdown'],
  'text-generate-effect': ['plugin-markdown'],
  'placeholders-and-vanish-input': ['plugin-markdown', 'plugin-email'],
  'glowing-effect': ['plugin-excel', 'plugin-offlinepython'],
  'meteors': ['plugin-excel', 'plugin-offlinepython'],
  'multi-step-loader': ['plugin-excel'],
  'card-stack': ['plugin-email'],
  'terminal': ['plugin-offlinepython'],
}

let failed = false
for (const [slug, plugins] of Object.entries(MAP)) {
  const blobPath = `toolchain/ui/src/components/aceternity/${slug}.tsx`
  let source
  try {
    source = execFileSync('git', ['-C', FENGYU, 'show', `${PINNED_COMMIT}:${blobPath}`], {
      encoding: 'utf8',
    })
  } catch {
    console.error(`MISSING ${slug} — is ${FENGYU} a FengYu checkout with ${blobPath} at ${PINNED_COMMIT}?`)
    failed = true
    continue
  }

  // Kit-internal imports become the kit's public exports; sibling imports stay.
  const content = source.replace(
    /(["'])\.\.\/(\.\.\/)*(lib\/utils|lib\/cn)\1/g,
    () => "'@infinia/plugin-ui'",
  )
  if (/\.\.\//.test(content)) {
    console.error(`UNHANDLED parent import in ${slug} — adapt manually`)
    failed = true
    continue
  }

  // Plugin tsconfigs are stricter than the kit's own build (noUnusedLocals /
  // noImplicitReturns). Upstream sources trip both; apply the same two fixes
  // every restore so a fresh machine typechecks out of the box.
  const fixups = {
    'meteors': (text) => text
      .replace(/\nimport React from "react";/g, '')
      .replace('meteors.map((el, idx)', 'meteors.map((_, idx)'),
    'terminal': (text) => text.replace(
      '      return () => clearTimeout(t);\n    }\n  }, [phase, outputIdx, currentOutputs, isLastCommand]);',
      '      return () => clearTimeout(t);\n    }\n    return undefined;\n  }, [phase, outputIdx, currentOutputs, isLastCommand]);',
    ),
  }
  const fixed = fixups[slug] ? fixups[slug](content) : content

  const header = [
    `// Vendored into this plugin from the FengYu toolchain ui kit (${blobPath} @ ${PINNED_COMMIT})`,
    '// — originally Aceternity UI (ui.aceternity.com) via the shadcn registry, including the',
    '// documented FengYu deviations. Governed by the Aceternity license: fine inside an end',
    '// product, but never redistribute the source files (do not commit them to a public',
    `// repository). Fetched ${FETCHED_ON}.`,
    "// Imports adapted for the plugin scaffold: kit-internal lib/utils → '@infinia/plugin-ui'.",
  ].join('\n')
  const lines = fixed.split('\n')
  const stamped = /^["']use (client|server)["'];?$/.test((lines[0] ?? '').trim())
    ? (lines.splice(1, 0, '', header), lines.join('\n'))
    : `${header}\n${content}`

  for (const plugin of plugins) {
    const target = path.join(PLUGINS, plugin, 'ui-src/src/aceternity', `${slug}.tsx`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, stamped)
    console.log(`wrote ${plugin}/ui-src/src/aceternity/${slug}.tsx`)
  }
}
process.exit(failed ? 1 : 0)
