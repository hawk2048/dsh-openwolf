/**
 * The workspace scanner: walks a directory tree (ignore-aware, budget-capped)
 * and produces a compact {@link CodeMap}. It also exposes per-file digests for
 * the `wolf_file` tool.
 *
 * @module dsh-openwolf/scanner
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { sep } from 'node:path'
import { isIgnored, loadRootGitignore, compilePatterns, type IgnoreContext } from './ignore.ts'
import { detectLang, extractSymbolHits, firstMeaningfulLine, isBinary } from './symbols.ts'
import type { CodeMap, DirEntry, FileDigest, FileEntry, ScanOptions, SymbolLine } from './types.ts'

/** POSIX-ify a relative path. */
export function toPosix(relPath: string): string {
  return relPath.split(sep).join('/')
}

const MAX_SYMBOLS_PER_FILE = 16
const SUMMARY_MAX_LEN = 140
const PREVIEW_DEFAULT_BYTES = 4096

/** Build the ignore context for one scan. */
export async function buildIgnoreContext(root: string, opts: ScanOptions): Promise<IgnoreContext> {
  const gitignore = opts.useGitignore ? await loadRootGitignore(root, async (p) => readFile(p, 'utf8')) : []
  return {
    extraRules: compilePatterns(opts.extraIgnore),
    gitignore,
    hidden: opts.hidden,
  }
}

/** Analyze one file's content into a {@link FileEntry}. */
function analyzeText(filePath: string, text: string, mtimeMs: number, opts: ScanOptions): FileEntry {
  const lang = detectLang(filePath)
  const lines = text.split(/\r?\n/).length - 1
  const summary = firstMeaningfulLine(text, SUMMARY_MAX_LEN)
  const hits = opts.symbols ? extractSymbolHits(text, lang, MAX_SYMBOLS_PER_FILE) : []
  const symbols = hits.map((h) => h.name)
  const symbolLines: SymbolLine[] = hits.map((h) => ({ name: h.name, line: h.line }))
  return {
    path: filePath,
    size: text.length,
    lines,
    symbols,
    symbolLines,
    summary,
    lang,
    tokens: Math.max(1, Math.ceil(text.length / 4)),
    mtimeMs,
    skipped: false,
  }
}

/** Analyze one file into a {@link FileEntry}, honoring size caps and binaries. */
export async function analyzeFile(filePath: string, size: number, mtimeMs: number, opts: ScanOptions): Promise<FileEntry> {
  const lang = detectLang(filePath)
  const tokens = Math.max(1, Math.ceil(size / 4))
  if (size > opts.maxFileBytes) {
    return { path: filePath, size, lines: 0, symbols: [], summary: '[file too large]', lang, tokens, mtimeMs, skipped: true }
  }
  let buf: Buffer
  try {
    buf = await readFile(filePath)
  } catch {
    return { path: filePath, size, lines: 0, symbols: [], summary: '[unreadable]', lang, tokens, mtimeMs, skipped: true }
  }
  if (isBinary(buf)) {
    return { path: filePath, size: buf.length, lines: 0, symbols: [], summary: '[binary]', lang: 'binary', tokens, mtimeMs, skipped: true }
  }
  return analyzeText(filePath, buf.toString('utf8'), mtimeMs, opts)
}

/**
 * Scan a workspace root into a compact {@link CodeMap}. Ignores `.git` and
 * any path matched by the configured rules; stops early at `maxFiles`.
 */
export async function scanCodebase(root: string, opts: ScanOptions): Promise<CodeMap> {
  const started = Date.now()
  const ignore = await buildIgnoreContext(root, opts)
  const files: FileEntry[] = []
  const dirAgg: Map<string, { files: number; lines: number; bytes: number }> = new Map()
  let totalLines = 0
  let totalBytes = 0
  let skippedFiles = 0
  let truncated = false
  let scanned = 0

  const touchDir = (dirPath: string, entry: { lines: number; bytes: number }) => {
    const agg = dirAgg.get(dirPath) ?? { files: 0, lines: 0, bytes: 0 }
    agg.files += 1
    agg.lines += entry.lines
    agg.bytes += entry.bytes
    dirAgg.set(dirPath, agg)
    const parent = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : ''
    if (parent !== dirPath) touchDir(parent, entry)
  }

  const stack: Array<{ dirAbs: string; dirRel: string }> = [{ dirAbs: root, dirRel: '' }]
  while (stack.length > 0) {
    const { dirAbs, dirRel } = stack.pop()!
    let entries
    try {
      entries = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      continue
    }
    // Deterministic order: directories first, then files, both by name.
    entries.sort((a, b) => {
      const aIsDir = a.isDirectory() ? 0 : 1
      const bIsDir = b.isDirectory() ? 0 : 1
      if (aIsDir !== bIsDir) return aIsDir - bIsDir
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    for (const entry of entries) {
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`
      if (isIgnored(rel, entry.isDirectory(), ignore)) continue
      if (entry.isDirectory()) {
        stack.push({ dirAbs: `${dirAbs}/${entry.name}`, dirRel: rel })
      } else if (entry.isFile()) {
        if (scanned >= opts.maxFiles) {
          truncated = true
          skippedFiles++
          continue
        }
        scanned++
        let size = 0
        let mtimeMs = 0
        try {
          const st = await stat(`${dirAbs}/${entry.name}`)
          size = st.size
          mtimeMs = st.mtimeMs
        } catch {
          skippedFiles++
          continue
        }
        const fileEntry = await analyzeFile(`${dirAbs}/${entry.name}`, size, mtimeMs, opts)
        fileEntry.path = toPosix(rel)
        files.push(fileEntry)
        totalLines += fileEntry.lines
        totalBytes += fileEntry.size
        touchDir(dirRel, { lines: fileEntry.lines, bytes: fileEntry.size })
      }
    }
  }

  if (opts.sortBy === 'size') {
    files.sort((a, b) => b.size - a.size)
  } else {
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  const dirs: DirEntry[] = [...dirAgg.entries()]
    .map(([path, agg]) => ({ path, files: agg.files, lines: agg.lines, bytes: agg.bytes }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {
    root,
    version: started,
    scannedAt: started,
    files,
    dirs,
    totalFiles: files.length,
    totalLines,
    totalBytes,
    skippedFiles,
    truncated,
    elapsedMs: Date.now() - started,
  }
}

/**
 * Produce a {@link FileDigest} for one workspace-relative path. Returns
 * `{ path, exists: false }` when the path is missing or escapes the root.
 */
export async function summarizeFile(root: string, relPath: string, opts: ScanOptions, previewBytes = PREVIEW_DEFAULT_BYTES): Promise<FileDigest> {
  const rel = toPosix(relPath)
  const abs = resolveInside(root, rel)
  if (abs === null) return { path: rel, exists: false }
  let st
  try {
    st = await stat(abs)
  } catch {
    return { path: rel, exists: false }
  }
  if (!st.isFile()) return { path: rel, exists: false }
  const lang = detectLang(rel)
  const digest: FileDigest = { path: rel, exists: true, size: st.size, lines: 0, lang }
  if (st.size > opts.maxFileBytes) {
    digest.preview = '[file too large]'
    digest.previewTruncated = true
    return digest
  }
  let buf: Buffer
  try {
    buf = await readFile(abs)
  } catch {
    digest.preview = '[unreadable]'
    digest.previewTruncated = true
    return digest
  }
  if (isBinary(buf)) {
    digest.lang = 'binary'
    digest.preview = '[binary]'
    digest.previewTruncated = true
    return digest
  }
  const text = buf.toString('utf8')
  digest.lines = text.split(/\r?\n/).length - 1
  if (opts.symbols) digest.symbols = extractSymbolHits(text, lang, MAX_SYMBOLS_PER_FILE).map((h) => h.name)
  const previewLen = Math.max(256, Math.min(previewBytes, opts.maxFileBytes))
  digest.preview = text.slice(0, previewLen)
  digest.previewTruncated = text.length > previewLen
  return digest
}

/**
 * Resolve a workspace-relative path and ensure the result stays inside the
 * root. Returns null for absolute paths, `..` escapes, or symlink-free
 * containment violations (best effort).
 */
export function resolveInside(root: string, relPath: string): string | null {
  if (relPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relPath)) return null
  const parts = relPath.split(/[\\/]+/)
  if (parts.some((p) => p === '..')) return null
  const abs = `${root.replace(/[\\/]+$/, '')}/${parts.join('/')}`
  if (abs !== root && !abs.startsWith(`${root.replace(/[\\/]+$/, '')}/`)) return null
  return abs
}
