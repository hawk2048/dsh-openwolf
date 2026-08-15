/**
 * Session digest construction: the budget-capped, priority-ordered context
 * injected when a session starts (and re-injected after compaction). This is
 * the DSH-native equivalent of the reference implementation's SessionStart
 * digest — same behavior contract, independent implementation.
 *
 * Priority order (each section admitted only while the token budget lasts):
 *   1. STATUS.md `## 🚀` next-phase section
 *   2. Do-Not-Repeat list from cerebrum.md (most recent 10 entries)
 *   3. Recent known bugs from buglog.json (last 5)
 *   4. Anatomy pointer (one line)
 *
 * A staleness warning is prepended (outside the budget) when the anatomy scan
 * is stale: the pinned git HEAD moved, or the last scan is older than
 * `rescanIntervalHours`.
 *
 * @module dsh-openwolf/digest
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { estimateTokens, type WolfBrain } from './brain.ts'

const execFileAsync = promisify(execFile)

/** Extract one `## heading` section: heading line through the next `##` or `---`. */
export function extractSection(markdown: string, headingPattern: RegExp): string {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => headingPattern.test(l))
  if (start === -1) return ''
  const out = [lines[start] ?? '']
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^## /.test(line) || /^---\s*$/.test(line)) break
    out.push(line)
  }
  return out.join('\n').trim()
}

/** TTL cache for git HEAD lookups (each spawn costs ~50-100ms; keep them rare). */
const HEAD_TTL_MS = 30_000
const headCache = new Map<string, { head: string | null; at: number }>()

/** Latest git HEAD for a workspace (cached 30s), or null when not a git repo. */
export async function currentGitHead(root: string): Promise<string | null> {
  const cached = headCache.get(root)
  if (cached !== undefined && Date.now() - cached.at < HEAD_TTL_MS) {
    return cached.head
  }
  let head: string | null = null
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      timeout: 2000,
      windowsHide: true,
    })
    head = stdout.trim()
  } catch {
    head = null
  }
  headCache.set(root, { head, at: Date.now() })
  return head
}

/** Why the anatomy scan state is stale, or null when fresh. */
export async function anatomyStaleReason(brain: WolfBrain, rescanIntervalHours: number): Promise<string | null> {
  const state = await brain.readScanState()
  if (state.last_scanned === undefined) return null
  const head = await currentGitHead(brain.root)
  if (state.git_head !== undefined && head !== null && state.git_head !== head) {
    return 'git HEAD moved since last scan'
  }
  const ageHours = (Date.now() - new Date(state.last_scanned).getTime()) / 3_600_000
  if (ageHours > rescanIntervalHours) {
    return `last scanned ${Math.floor(ageHours)}h ago`
  }
  return null
}

/** A text→tokens estimator (char-ratio default; tokenMeter for better accuracy). */
export type TokenEstimator = (text: string) => number

const charRatioEstimator: TokenEstimator = (text) => estimateTokens(text, 'prose')

/** Build the budget-capped session digest. Returns '' when nothing qualifies. */
export async function buildSessionDigest(brain: WolfBrain, budget: number, estimate: TokenEstimator = charRatioEstimator): Promise<string> {
  const parts: string[] = []
  let used = 0
  const tryAdd = (text: string): void => {
    if (text === '') return
    const cost = estimate(text)
    if (used + cost > budget) return
    parts.push(text)
    used += cost
  }

  // 1. STATUS.md "next phase" — the highest-value resume context.
  tryAdd(extractSection(await brain.readStatus(), /^## 🚀/))

  // 2. Do-Not-Repeat list (most recent 10 entries).
  const dnr = extractSection(await brain.readCerebrum(), /^## Do-Not-Repeat/)
  if (dnr !== '') {
    const entries = dnr.split('\n').filter((l) => l.startsWith('- '))
    if (entries.length > 0) {
      tryAdd(`## Do-Not-Repeat (from .wolf/cerebrum.md)\n${entries.slice(-10).join('\n')}`)
    }
  }

  // 3. Recent known bugs — prevents re-deriving fixes.
  const buglog = await brain.readBuglog()
  if (buglog.bugs.length > 0) {
    const recent = buglog.bugs
      .slice(-5)
      .map((b) => {
        const line = `${b.error_message} → ${b.fix}`
        return line.length > 140 ? `${line.slice(0, 137)}...` : line
      })
    tryAdd(`## Known bugs already fixed (check .wolf/buglog.json before re-debugging)\n${recent.join('\n')}`)
  }

  // 4. Anatomy pointer — the index itself stays on disk.
  const scanState = await brain.readScanState()
  if ((scanState.total_files ?? 0) > 0) {
    tryAdd(`.wolf anatomy tracks ${scanState.total_files} files with descriptions + token sizes — consult it before reading whole files.`)
  }

  return parts.join('\n\n')
}

/** The full session-start digest, including the staleness warning. */
export async function buildSessionDigestWithWarning(
  brain: WolfBrain,
  budget: number,
  rescanIntervalHours: number,
  estimate: TokenEstimator = charRatioEstimator,
): Promise<string> {
  let digest = await buildSessionDigest(brain, budget, estimate)
  const stale = await anatomyStaleReason(brain, rescanIntervalHours)
  if (stale !== null) {
    digest = `⚠ anatomy may be stale (${stale}). Run wolf_refresh before relying on it.\n\n${digest}`
  }
  return digest
}
