/**
 * Zero-dependency cron: a 5-field cron-expression parser, a time matcher,
 * and a small scheduler. Independent implementation of the reference
 * project's cron engine (standard `minute hour dom month dow` fields).
 *
 * @module dsh-openwolf/cron
 */

/** One parsed 5-field cron expression. */
export interface CronExpr {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
}

/** Field bounds for the five cron fields. */
const FIELDS: Array<{ name: string; min: number; max: number }> = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 7 }, // 0 and 7 both mean Sunday
]

/** Parse one comma-separated field into a set of allowed values. */
function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(\*|\d+-\d+|\d+)(?:\/(\d+))?$/)
    if (stepMatch === null) throw new Error(`invalid cron field: ${field}`)
    const step = stepMatch[2] !== undefined ? Number(stepMatch[2]) : 1
    if (step < 1) throw new Error(`invalid cron step: ${field}`)
    const base = stepMatch[1]!
    if (base === '*') {
      for (let v = min; v <= max; v += step) out.add(v)
    } else if (base.includes('-')) {
      const [lo, hi] = base.split('-').map(Number)
      if (lo === undefined || hi === undefined || lo < min || hi > max || lo > hi) {
        throw new Error(`invalid cron range: ${field}`)
      }
      for (let v = lo; v <= hi; v += step) out.add(v)
    } else {
      const v = Number(base)
      if (v < min || v > max) throw new Error(`cron value out of range: ${field}`)
      out.add(v)
    }
  }
  return out
}

/** Parse a 5-field cron expression (minute hour day-of-month month day-of-week). */
export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron needs 5 fields, got ${parts.length}: ${expr}`)
  const [minute, hour, dom, month, dow] = parts
  if (minute === undefined || hour === undefined || dom === undefined || month === undefined || dow === undefined) {
    throw new Error(`invalid cron: ${expr}`)
  }
  return {
    minute: parseField(minute, FIELDS[0]!.min, FIELDS[0]!.max),
    hour: parseField(hour, FIELDS[1]!.min, FIELDS[1]!.max),
    dom: parseField(dom, FIELDS[2]!.min, FIELDS[2]!.max),
    month: parseField(month, FIELDS[3]!.min, FIELDS[3]!.max),
    dow: parseField(dow, FIELDS[4]!.min, FIELDS[4]!.max),
  }
}

/** Whether a Date matches an expression (dom/dow use OR semantics, like cron). */
export function cronMatches(expr: CronExpr, date: Date): boolean {
  if (!expr.minute.has(date.getMinutes())) return false
  if (!expr.hour.has(date.getHours())) return false
  if (!expr.month.has(date.getMonth() + 1)) return false
  const dom = date.getDate()
  const dow = date.getDay()
  const domOk = expr.dom.has(dom)
  const dowOk = expr.dow.has(dow) || expr.dow.has(7) // 7 = Sunday alias
  // Standard cron: when both dom and dow are restricted, either matching is enough.
  const domRestricted = expr.dom.size < 32
  const dowRestricted = expr.dow.size < 8
  if (domRestricted && dowRestricted) return domOk || dowOk
  if (domRestricted) return domOk
  if (dowRestricted) return dowOk
  return true
}

/** A durable scheduled task. */
export interface CronTask {
  id: string
  name: string
  /** 5-field cron expression. */
  expr: string
  /** Action the task runs: `scan` or `check`. */
  action: 'scan' | 'check'
  enabled: boolean
  last_run?: string
  last_status?: 'ok' | 'error'
  last_detail?: string
  created_at: string
}

/** Find tasks due at a given minute (with last_run guard). */
export function dueTasks(tasks: CronTask[], now: Date): CronTask[] {
  const minuteStart = new Date(now)
  minuteStart.setSeconds(0, 0)
  return tasks.filter((t) => {
    if (!t.enabled) return false
    let expr: CronExpr
    try {
      expr = parseCron(t.expr)
    } catch {
      return false
    }
    if (!cronMatches(expr, now)) return false
    if (t.last_run === undefined) return true
    const last = new Date(t.last_run)
    // Not run within this same minute yet.
    return last.getTime() < minuteStart.getTime()
  })
}
