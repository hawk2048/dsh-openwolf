#!/usr/bin/env node
/**
 * Publish helper for the npm README split:
 *   - GitHub default  : README.md      (Chinese)
 *   - npm page README : README-en.md   (English)
 *
 * npm picks its page README from package.json `readme`, and by default
 * auto-detects `README.*` (which would be the Chinese README.md). This
 * script is wired as `prepublishOnly` (inject) and `postpublish` (restore),
 * so the English README is what npm packs, and the working tree stays clean
 * afterwards.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkgPath = join(root, 'package.json')
const backupPath = join(root, '.package.json.readme.bak')

const mode = process.argv[2] ?? 'inject'

if (mode === 'inject') {
  const en = readFileSync(join(root, 'README-en.md'), 'utf8')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  // Backup the pristine package.json (without the readme field) once.
  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, JSON.stringify(pkg, null, 4) + '\n', 'utf8')
  }
  pkg.readme = en
  pkg.readmeFilename = 'README-en.md'
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n', 'utf8')
  console.log('✓ npm readme injected (English README-en.md)')
} else if (mode === 'restore') {
  if (existsSync(backupPath) && readFileSync(backupPath, 'utf8').trim() !== '') {
    const clean = readFileSync(backupPath, 'utf8')
    writeFileSync(pkgPath, clean)
    rmSync(backupPath, { force: true })
    console.log('✓ package.json restored (readme field removed)')
  } else {
    console.log('no valid backup found — nothing to restore')
  }
} else {
  console.error(`unknown mode: ${mode}`)
  process.exit(1)
}
