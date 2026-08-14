/**
 * Language-aware one-line file description generation — an independent
 * implementation of the reference project's description-extractor concept
 * (exports summaries, HTTP route detection, schema detection, JSON metadata),
 * compact and dependency-free.
 *
 * The scanner uses this to build richer `summary` values for map entries and
 * read hints; it falls back to the first meaningful line when nothing more
 * informative is detected.
 *
 * @module dsh-openwolf/description
 */

import { detectLang } from './symbols.ts'
import { firstMeaningfulLine } from './symbols.ts'

const CAP_DEFAULT = 140

/** Cap a string at a length with an ellipsis. */
function cap(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen - 1)}…`
}

/** Summary of exported top-level declarations for TS/JS-family files. */
function tsExportsSummary(text: string): string | null {
  const exports = text.match(/(?:export\s+(?:async\s+)?(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+))/g)
  if (exports === null || exports.length === 0) return null
  const list = exports.map((e) => e.match(/(\w+)\s*$/)?.[1] ?? e).slice(0, 5)
  const more = exports.length > 5 ? ` +${exports.length - 5} more` : ''
  const defaultExport = text.match(/export\s+default\s+([A-Za-z_$][\w$]*)/)
  const defaultPart = defaultExport !== null ? `, default ${defaultExport[1]}` : ''
  return `Exports ${list.join(', ')}${more}${defaultPart}`
}

/** HTTP route summary for Express/Fastify/plain-server style files. */
function httpRoutesSummary(text: string): string | null {
  const routes = text.match(/(?:router|app|server|this)\.(?:get|post|put|patch|delete|all|head|options)\(\s*['"`]([^'"`]+)['"`]/gi)
  if (routes === null || routes.length === 0) return null
  const verbs = new Map<string, string>()
  for (const r of routes.slice(0, 8)) {
    const m = r.match(/\.(\w+)\(\s*['"`]([^'"`]+)['"`]/i)
    if (m !== null) verbs.set(`${m[1]?.toUpperCase() ?? ''} ${m[2] ?? ''}`, `${m[1]?.toUpperCase() ?? ''} ${m[2] ?? ''}`)
  }
  const list = [...verbs.values()].slice(0, 4)
  const more = verbs.size > 4 ? ` +${verbs.size - 4} more` : ''
  return `Defines ${list.join(', ')}${more}`
}

/** Rich one-line description for a file, or null when nothing beyond the first line. */
export function describeText(text: string, filePath: string, maxLen = CAP_DEFAULT): string | null {
  const lang = detectLang(filePath)
  const base = filePath.split(/[\\/]+/).pop() ?? filePath

  switch (lang) {
    case 'ts': case 'tsx': case 'js': case 'jsx': {
      const routes = httpRoutesSummary(text)
      if (routes !== null) return cap(routes, maxLen)
      if (/z\.object\(/.test(text)) return cap(`Defines a zod schema in ${base}`, maxLen)
      const exports = tsExportsSummary(text)
      if (exports !== null) return cap(exports, maxLen)
      if (/class\s+(\w+)/.test(text)) {
        const cls = text.match(/class\s+(\w+)/)?.[1]
        return cap(`Class ${cls ?? base}`, maxLen)
      }
      return null
    }
    case 'py': {
      const docstring = text.match(/^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/m)
      if (docstring !== null && docstring[1] !== undefined && docstring[1].trim() !== '') {
        return cap(docstring[1].trim().split('\n')[0] ?? '', maxLen)
      }
      const classes = text.match(/^\s*class\s+(\w+)/gm)
      const funcs = text.match(/^\s*(?:async\s+)?def\s+(\w+)/gm)
      const parts: string[] = []
      if (classes !== null) parts.push(`${classes.length} class${classes.length > 1 ? 'es' : ''}`)
      if (funcs !== null) parts.push(`${funcs.length} functions`)
      if (parts.length > 0) return cap(parts.join(', '), maxLen)
      return null
    }
    case 'go': {
      const pkg = text.match(/^package\s+(\w+)/m)?.[1]
      const funcs = text.match(/^\s*func\s+/gm)?.length ?? 0
      const handlers = text.match(/http\.(?:Handler|ResponseWriter)/g)?.length ?? 0
      const parts: string[] = []
      if (pkg !== undefined) parts.push(`package ${pkg}`)
      if (handlers > 0) parts.push(`${handlers} HTTP handler${handlers > 1 ? 's' : ''}`)
      if (funcs > 0) parts.push(`${funcs} funcs`)
      return parts.length > 0 ? cap(parts.join(' · '), maxLen) : null
    }
    case 'rs': {
      const pubs = text.match(/^\s*pub(?:\s*\([^)]*\))?\s+(?:fn|struct|enum|trait)\s+(\w+)/gm)?.length ?? 0
      const mods = text.match(/^\s*(?:pub\s+)?mod\s+(\w+)/gm)?.length ?? 0
      const parts: string[] = []
      if (pubs > 0) parts.push(`${pubs} public items`)
      if (mods > 0) parts.push(`${mods} modules`)
      return parts.length > 0 ? cap(parts.join(', '), maxLen) : null
    }
    case 'json': {
      try {
        const parsed = JSON.parse(text) as { name?: unknown; description?: unknown }
        if (typeof parsed.description === 'string') return cap(parsed.description, maxLen)
        if (typeof parsed.name === 'string') return cap(parsed.name, maxLen)
      } catch {
        // fall through
      }
      return null
    }
    default:
      return null
  }
}

/** Best-effort description: rich when detected, else the first meaningful line. */
export function describeFile(text: string, filePath: string, maxLen = CAP_DEFAULT): string {
  return describeText(text, filePath, maxLen) ?? firstMeaningfulLine(text, maxLen)
}
