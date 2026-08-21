/**
 * `dshwolf import-openwolf` — merge a pre-existing OpenWolf brain (`.wolf/`)
 * into this workspace's dsh-openwolf brain (`.dshwolf/`).
 *
 * The two tools deliberately keep separate brains so they can manage the same
 * workspace without overwriting each other. This command is the *one-way*
 * bridge for projects migrating from OpenWolf (Claude Code / Codex / …) to
 * dsh-openwolf: it copies the durable, portable state — learned preferences
 * (`cerebrum.md`), the action log (`memory.md`), bug memory
 * (`buglog.json`), and optionally the phase handoff (`STATUS.md`) — into
 * `.dshwolf/`.
 *
 * The merge is **additive and idempotent**: existing dsh-openwolf data is
 * never overwritten, duplicate entries/rows/records are skipped by content,
 * and re-running the command is a no-op. `.dshwolf/` is backed up (timestamped)
 * before the first change, so `dshwolf restore` can roll back.
 *
 * What is intentionally NOT imported: `anatomy.md` / `anatomy-index.json`
 * (run `dshwolf scan` to build the dsh code map from scratch), `config.json`
 * (dsh config schema differs), `hooks/` and `token-ledger.json` (OpenWolf
 * has no equivalent).
 *
 * @module dsh-openwolf/import-openwolf
 */

import { readFile, writeFile, rename, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { WolfBrain } from './brain.ts'
import { backupBrain } from './registry.ts'
import type { Buglog, BugRecord } from './brain.ts'

/** STATUS.md import policy. */
export type StatusPolicy = 'auto' | 'keep' | 'overwrite' | 'skip'

export interface ImportOpenWolfOptions {
  /** Source OpenWolf brain directory; defaults to `<root>/.wolf`. */
  from?: string
  /** Preview the merge without writing anything. */
  dryRun?: boolean
  /** Take a timestamped `.dshwolf` backup before the first change (default true). */
  backup?: boolean
  /** STATUS.md policy: auto (default) | keep | overwrite | skip. */
  status?: StatusPolicy
}

export interface ImportReport {
  source: string
  found: boolean
  dryRun: boolean
  backup: string | null
  /** Distinct source sections processed and total new entries added. */
  cerebrum: { sections: number; entries: number }
  memory: { rows: number }
  bugs: { added: number; skipped: number }
  status: { action: 'imported' | 'kept' | 'overwritten' | 'skipped' | 'missing'; note?: string }
  /** Brain-relative files that changed (or would change in dry-run). */
  changed: string[]
}

interface Section {
  heading: string
  lines: string[]
}

/** A markdown file split into its preamble and `## Heading` sections. */
interface SectionedMarkdown {
  /** Everything before the first `## ` heading (title, intro, …). */
  preamble: string
  sections: Section[]
}

/** Split a markdown file into its preamble and `## Heading` sections (order preserved). */
function splitSections(text: string): SectionedMarkdown {
  const preamble: string[] = []
  const sections: Section[] = []
  let current: Section | undefined
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^##\s+(.+?)\s*$/)
    if (m !== null) {
      current = { heading: m[1] ?? '', lines: [] }
      sections.push(current)
    } else if (current !== undefined) {
      current.lines.push(raw)
    } else {
      preamble.push(raw)
    }
  }
  return { preamble: preamble.join('\n'), sections }
}

/** Normalize one entry line for dedupe: trim, strip bullets and `[date]` tags. */
function normalizeEntry(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** True for markdown table rows (skipping the `| --- |` separator lines). */
function isTableRow(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith('|')) return false
  return !/^\|[\s\-:|]+\|$/.test(t)
}

/** Read a JSON file tolerantly (missing/corrupt → fallback). */
async function readJSONFile<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Read a text file tolerantly. */
async function readTextFile(p: string): Promise<string> {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return ''
  }
}

/** Atomic write (tmp + rename), mirroring WolfBrain.writeText. */
async function atomicWrite(p: string, text: string): Promise<void> {
  const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, p)
}

/** The template marker that identifies a pristine, never-touched STATUS.md. */
const PRISTINE_STATUS_MARKER = '_Describe the next phase here; the session digest picks up this section._'

function isPristineStatus(text: string): boolean {
  const t = text.trim()
  return t === '' || t.includes(PRISTINE_STATUS_MARKER)
}

/**
 * Merge the OpenWolf brain at `source` into the dsh-openwolf brain under
 * `root`. Returns a report; never throws on missing source (reports
 * `found: false`).
 */
export async function importOpenWolf(root: string, options: ImportOpenWolfOptions = {}): Promise<ImportReport> {
  const source = options.from !== undefined ? options.from : join(root, '.wolf')
  const dryRun = options.dryRun === true
  const report: ImportReport = {
    source,
    found: false,
    dryRun,
    backup: null,
    cerebrum: { sections: 0, entries: 0 },
    memory: { rows: 0 },
    bugs: { added: 0, skipped: 0 },
    status: { action: 'missing' },
    changed: [],
  }

  let sourceIsDir = false
  try {
    sourceIsDir = (await stat(source)).isDirectory()
  } catch {
    sourceIsDir = false
  }
  if (!sourceIsDir) return report
  report.found = true

  const brain = new WolfBrain(root, '.dshwolf')
  await brain.ensure()
  const statusPolicy = options.status ?? 'auto'

  // ── cerebrum.md: section-aware, entry-level dedupe ────────────────────
  let cerebrumText: string | null = null
  {
    const srcText = await readTextFile(join(source, 'cerebrum.md'))
    const srcDoc = splitSections(srcText)
    const srcSections = srcDoc.sections
    const targetDoc = splitSections(await brain.readCerebrum())
    const targetSections = targetDoc.sections
    let entries = 0
    let touched = false
    for (const section of srcSections) {
      const heading = section.heading
      const srcLines = section.lines.filter((l) => l.trim() !== '')
      if (srcLines.length === 0) continue
      const target = targetSections.find((s) => s.heading === heading)
      if (target === undefined) {
        // Whole new section: append at the end.
        targetSections.push({ heading, lines: srcLines })
        entries += srcLines.length
        touched = true
        continue
      }
      const known = new Set(target.lines.map((l) => normalizeEntry(l)))
      const fresh = srcLines.filter((l) => !known.has(normalizeEntry(l)))
      if (fresh.length > 0) {
        // Insert right after the heading's first blank line (mirrors
        // WolfBrain.appendCerebrum's placement).
        const idx = targetSections.indexOf(target)
        const block = targetSections[idx] as Section
        const blank = block.lines.findIndex((l) => l.trim() === '')
        const at = blank === -1 ? block.lines.length : blank + 1
        block.lines.splice(at, 0, ...fresh)
        entries += fresh.length
        touched = true
      }
    }
    if (touched) {
      const out = renderSections(targetDoc.preamble, targetSections)
      if (out !== (await brain.readCerebrum())) {
        cerebrumText = out
        report.cerebrum = { sections: srcSections.filter((s) => s.lines.some((l) => l.trim() !== '')).length, entries }
        report.changed.push('cerebrum.md')
      }
    }
  }

  // ── memory.md: append-only table rows, verbatim dedupe ────────────────
  let memoryText: string | null = null
  {
    const srcRows = (await readTextFile(join(source, 'memory.md'))).split(/\r?\n/).filter(isTableRow)
    if (srcRows.length > 0) {
      const targetText = await brain.readText(join(brain.dir, 'memory.md'))
      const known = new Set(targetText.split(/\r?\n/).map((l) => l.trim()))
      const fresh = srcRows.filter((l) => !known.has(l.trim()))
      if (fresh.length > 0) {
        const header = `<!-- memory rows imported from ${basename(source)} on ${new Date().toISOString()} -->`
        const sep = targetText.trimEnd() === '' ? '' : '\n'
        memoryText = `${targetText.trimEnd()}${sep}\n${header}\n${fresh.map((l) => l.trimEnd()).join('\n')}\n`
        report.memory = { rows: fresh.length }
        report.changed.push('memory.md')
      }
    }
  }

  // ── buglog.json: record-level dedupe by error_message + file ──────────
  let buglog: Buglog | null = null
  {
    const srcLog = await readJSONFile<{ version?: number; bugs?: Array<Record<string, unknown>> }>(
      join(source, 'buglog.json'),
      { bugs: [] },
    )
    const srcBugs = Array.isArray(srcLog.bugs) ? srcLog.bugs : []
    if (srcBugs.length > 0) {
      const target = await brain.readBuglog()
      const known = new Set(target.bugs.map((b) => bugKey(b.error_message, b.file)))
      const fresh: BugRecord[] = []
      let skipped = 0
      for (const raw of srcBugs) {
        const errorMessage = String(raw.error_message ?? raw.summary ?? '').trim()
        const fix = String(raw.fix ?? '').trim()
        const file = typeof raw.file === 'string' ? raw.file : undefined
        if (errorMessage === '' && fix === '') {
          skipped++
          continue
        }
        if (known.has(bugKey(errorMessage, file))) {
          skipped++
          continue
        }
        const record: Record<string, unknown> = {
          id: `bug-${target.bugs.length + fresh.length + 1}-${Date.now().toString(36)}`,
          error_message: errorMessage.slice(0, 500),
          fix: fix.slice(0, 2000),
          ...(file !== undefined ? { file } : {}),
          at: String(raw.timestamp ?? raw.last_seen ?? new Date().toISOString()),
        }
        // Carry OpenWolf-only fields along (root_cause, tags, occurrences, …).
        for (const [k, v] of Object.entries(raw)) {
          if (k === 'error_message' || k === 'fix' || k === 'file' || k === 'timestamp' || k === 'last_seen') continue
          record[k] = v
        }
        fresh.push(record as unknown as BugRecord)
        known.add(bugKey(errorMessage, file))
      }
      if (fresh.length > 0) {
        target.bugs.push(...fresh)
        buglog = target
        report.bugs = { added: fresh.length, skipped }
        report.changed.push('buglog.json')
      } else {
        report.bugs = { added: 0, skipped }
      }
    }
  }

  // ── STATUS.md: only replace a pristine target by default ──────────────
  let statusText: string | null = null
  {
    const srcStatus = await readTextFile(join(source, 'STATUS.md'))
    const hasSource = srcStatus.trim() !== ''
    const targetText = await brain.readStatus()
    if (statusPolicy === 'skip') {
      report.status = { action: 'skipped', note: '--status=skip' }
    } else if (statusPolicy === 'overwrite') {
      if (hasSource) {
        statusText = srcStatus
        report.status = { action: 'overwritten' }
        report.changed.push('STATUS.md')
      } else {
        report.status = { action: 'missing', note: 'no STATUS.md in source brain' }
      }
    } else if (statusPolicy === 'keep') {
      report.status = { action: 'kept', note: '--status=keep' }
    } else if (!hasSource) {
      report.status = { action: 'missing', note: 'no STATUS.md in source brain' }
    } else if (isPristineStatus(targetText)) {
      statusText = srcStatus
      report.status = { action: 'imported' }
      report.changed.push('STATUS.md')
    } else {
      report.status = { action: 'kept', note: 'target STATUS.md has content' }
    }
  }

  // ── apply ─────────────────────────────────────────────────────────────
  const willChange = cerebrumText !== null || memoryText !== null || buglog !== null || statusText !== null
  if (!dryRun && willChange) {
    if (options.backup !== false) {
      try {
        report.backup = await backupBrain(root, '.dshwolf')
      } catch {
        report.backup = null
      }
    }
    await brain.withLock(async () => {
      if (cerebrumText !== null) await atomicWrite(join(brain.dir, 'cerebrum.md'), cerebrumText)
      if (memoryText !== null) await atomicWrite(join(brain.dir, 'memory.md'), memoryText)
      if (buglog !== null) await atomicWrite(join(brain.dir, 'buglog.json'), `${JSON.stringify(buglog, null, 2)}\n`)
      if (statusText !== null) await atomicWrite(join(brain.dir, 'STATUS.md'), statusText)
    })
  }

  return report
}

/** Render sections back to markdown, preserving the preamble and blank lines. */
function renderSections(preamble: string, sections: Section[]): string {
  const blocks: string[] = []
  for (const s of sections) {
    // Join lines, then strip leading/trailing blank lines so a section whose
    // first line is empty never renders as a doubled blank separator.
    const body = s.lines
      .map((l) => l.trimEnd())
      .join('\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
    blocks.push(`## ${s.heading}\n${body === '' ? '' : `\n${body}\n`}`)
  }
  const head = preamble.trim()
  return `${head === '' ? '' : `${head}\n\n`}${blocks.join('\n')}\n`
}

/** Content-identity key for one bug record. */
function bugKey(errorMessage: string, file: string | undefined): string {
  return `${errorMessage.trim().toLowerCase()}|${(file ?? '').trim().toLowerCase()}`
}
