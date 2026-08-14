/**
 * Rendering: turns a {@link CodeMap} into a compact Markdown map for model
 * context, and manages the managed block inside `AGENTS.md` (or another
 * instruction file) that the harness preloads per session.
 *
 * @module dsh-openwolf/render
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CodeMap } from './types.ts'

/** Start marker of the managed block. */
export const WOLF_BLOCK_START = '<!-- dsh-openwolf:start -->'
/** End marker of the managed block. */
export const WOLF_BLOCK_END = '<!-- dsh-openwolf:end -->'

const MAX_SYMBOLS_INLINE = 6
const MAX_FILES_PER_DIR = 60
const MAX_DIRS = 40

/** Group files under a directory heading; files in the root go under `./`. */
export function renderMap(map: CodeMap, maxBytes: number): { text: string; truncated: boolean } {
  const lines: string[] = []
  const head = `# Code Map\nGenerated ${new Date(map.scannedAt).toISOString()} · ${map.totalFiles} files · ${map.totalLines} lines · ${(map.elapsedMs / 1000).toFixed(2)}s\n`
  lines.push(head.replace(/\n$/, ''))

  const dirGroups = new Map<string, typeof map.files>()
  for (const file of map.files) {
    const idx = file.path.lastIndexOf('/')
    const dir = idx === -1 ? '' : file.path.slice(0, idx)
    let group = dirGroups.get(dir)
    if (group === undefined) {
      group = []
      dirGroups.set(dir, group)
    }
    group.push(file)
  }

  const dirs = [...dirGroups.keys()].sort()
  for (const dir of dirs.slice(0, MAX_DIRS)) {
    const group = dirGroups.get(dir) ?? []
    lines.push('')
    lines.push(`## ${dir === '' ? './' : dir}`)
    for (const file of group.slice(0, MAX_FILES_PER_DIR)) {
      const sym = file.symbols.slice(0, MAX_SYMBOLS_INLINE).join(', ')
      const detail = [`${file.lines} lines`]
      if (sym !== '') detail.push(sym)
      if (file.summary !== '') detail.push(file.summary)
      lines.push(`- \`${file.path}\` — ${detail.join(' · ')}`)
    }
    if (group.length > MAX_FILES_PER_DIR) {
      lines.push(`- … ${group.length - MAX_FILES_PER_DIR} more file(s)`)
    }
  }
  if (dirs.length > MAX_DIRS) {
    lines.push(`\n… ${dirs.length - MAX_DIRS} more director${dirs.length - MAX_DIRS === 1 ? 'y' : 'ies'} not shown`)
  }
  if (map.truncated) {
    lines.push('\n⚠ scan hit the file budget; some files are not listed')
  }

  let text = lines.join('\n')
  let truncated = false
  if (text.length > maxBytes) {
    text = `${text.slice(0, maxBytes)}…\n(rendered map truncated at ${maxBytes} bytes)`
    truncated = true
  }
  return { text, truncated }
}

/** Render the full managed block for an instruction file. */
export function renderBlock(map: CodeMap, maxBytes: number): string {
  const { text } = renderMap(map, Math.max(512, maxBytes))
  return `${WOLF_BLOCK_START}\n${text}\n${WOLF_BLOCK_END}`
}

/** Locate the managed block in an instruction file's text, if present. */
export function findBlock(fileText: string): { before: string; after: string } | null {
  const start = fileText.indexOf(WOLF_BLOCK_START)
  const end = fileText.indexOf(WOLF_BLOCK_END)
  if (start === -1 || end === -1 || end < start) return null
  return {
    before: fileText.slice(0, start),
    after: fileText.slice(end + WOLF_BLOCK_END.length).replace(/^\n/, ''),
  }
}

/** Result of an {@link injectBlock} call. */
export interface InjectResult {
  /** Absolute path of the instruction file. */
  path: string
  /** True when the file was rewritten. */
  changed: boolean
  /** Bytes of the managed block after injection. */
  blockBytes: number
}

/**
 * Replace (or append) the managed code-map block inside an instruction file
 * such as `AGENTS.md`. The rest of the file is preserved verbatim. Returns
 * `changed: false` when the new block equals the current one.
 */
export async function injectBlock(
  filePath: string,
  map: CodeMap,
  maxBytes: number,
): Promise<InjectResult> {
  const block = renderBlock(map, maxBytes)
  let existing = ''
  try {
    existing = await readFile(filePath, 'utf8')
  } catch {
    // Missing file: create it.
  }
  const found = findBlock(existing)
  const next = found === null ? `${existing.trimEnd()}\n\n${block}\n` : `${found.before}${block}\n${found.after}`
  if (next === existing) return { path: filePath, changed: false, blockBytes: block.length }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, next, 'utf8')
  return { path: filePath, changed: true, blockBytes: block.length }
}
