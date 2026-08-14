/**
 * Lightweight, dependency-free source analysis: language detection, top-level
 * symbol extraction, one-line summaries, and binary sniffing. The heuristics
 * are deliberately conservative — a missed symbol is fine, a wrong summary is
 * not.
 *
 * @module dsh-openwolf/symbols
 */

/** Map of file extensions to a short language tag. */
const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx', '.mts': 'ts', '.cts': 'ts',
  '.js': 'js', '.jsx': 'jsx', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py', '.pyw': 'py',
  '.go': 'go',
  '.rs': 'rs',
  '.java': 'java', '.kt': 'kt', '.kts': 'kt',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.cs': 'cs',
  '.rb': 'rb', '.php': 'php', '.swift': 'swift', '.zig': 'zig',
  '.sh': 'sh', '.bash': 'sh', '.zsh': 'sh', '.ps1': 'ps1', '.bat': 'bat', '.cmd': 'bat',
  '.sql': 'sql', '.md': 'md', '.markdown': 'md', '.txt': 'text', '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml', '.html': 'html', '.css': 'css',
}

/** Detect the short language tag for a file path. */
export function detectLang(filePath: string): string {
  const lower = filePath.toLowerCase()
  for (const ext of Object.keys(LANG_BY_EXT)) {
    if (lower.endsWith(ext)) return LANG_BY_EXT[ext] ?? 'text'
  }
  return 'text'
}

/** Lines that never qualify as a summary or symbol source. */
const COMMENT_PREFIXES = ['#', '//', '/*', '*', '--', '<!--', ';', '%', '"""', "'''", '//', '///', '//!', '//c']

const IMPORT_PREFIXES = ['import ', 'from ', 'require(', 'package ', 'using ', '#include', '#define', '#pragma', 'module ', 'use ']

/** Extract top-level symbols for a language. Bounded, regex-based. */
export function extractSymbols(text: string, lang: string, max: number): string[] {
  const symbols: string[] = []
  const push = (name: string | undefined) => {
    if (name === undefined || name === '') return
    if (symbols.length >= max) return
    if (!symbols.includes(name)) symbols.push(name)
  }

  const lineRe = (re: RegExp) => {
    for (const line of text.split(/\r?\n/)) {
      if (symbols.length >= max) break
      const m = line.match(re)
      if (m !== null) push(m[1] ?? m[2])
    }
  }

  switch (lang) {
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'mjs': case 'cjs': case 'mts': case 'cts': {
      lineRe(/^\s*(?:export\s+)?(?:async\s+)?(?:default\s+)?(?:function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))/)
      lineRe(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/)
      lineRe(/^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/)
      break
    }
    case 'py': {
      lineRe(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/)
      lineRe(/^\s*class\s+([A-Za-z_]\w*)/)
      break
    }
    case 'go': {
      lineRe(/^\s*func\s+([A-Za-z_]\w*)/)
      lineRe(/^\s*func\s+\([^)]*\)\s+([A-Z]\w*)/)
      lineRe(/^\s*type\s+([A-Z]\w*)\s+(?:struct|interface)\b/)
      break
    }
    case 'rs': {
      lineRe(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-z_]\w*)/)
      lineRe(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|mod)\s+([A-Za-z_]\w*)/)
      break
    }
    case 'java': case 'kt': {
      lineRe(/^\s*(?:public|private|protected)?\s*(?:abstract\s+|final\s+|static\s+|open\s+)*class\s+([A-Z]\w*)/)
      lineRe(/^\s*(?:public|private|protected)?\s*interface\s+([A-Z]\w*)/)
      lineRe(/^\s*(?:public|private|protected)?\s*(?:static\s+)?[\w<>[\],\s]+\s+(?!if|for|while|switch|return|catch|do|case|else|new|try)\b([a-z]\w*)\s*\(/)
      break
    }
    case 'c': case 'cpp': case 'cs': {
      lineRe(/^\s*(?:public|private|protected)?\s*(?:static\s+|virtual\s+|override\s+|inline\s+)*(?:class|struct|enum)\s+([A-Za-z_]\w*)/)
      lineRe(/^\s*(?:[A-Za-z_][\w:*<>,\s&]*\s+)?(?!if|for|while|switch|return|catch|do|case|else|new|try)\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const)?\s*\{/)
      break
    }
    case 'rb': {
      lineRe(/^\s*(?:def|class|module)\s+([A-Za-z_]\w*(?:::\w+)*)/)
      break
    }
    case 'php': {
      lineRe(/^\s*(?:public|private|protected)?\s*(?:static\s+|function\s+)+([A-Za-z_]\w*)\s*\(/)
      lineRe(/^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/)
      break
    }
    case 'swift': {
      lineRe(/^\s*(?:public|private|internal|fileprivate|open)?\s*(?:static\s+|class\s+|struct\s+|enum\s+|func\s+)+([A-Za-z_]\w*)/)
      break
    }
    default:
      break
  }

  return symbols.slice(0, max)
}

/** True when a line is an import/package/using directive or a comment. */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return true
  const lower = trimmed.toLowerCase()
  for (const prefix of COMMENT_PREFIXES) {
    if (lower.startsWith(prefix)) return true
  }
  for (const prefix of IMPORT_PREFIXES) {
    if (lower.startsWith(prefix)) return true
  }
  return false
}

/** First meaningful line of a file, truncated, or empty when there is none. */
export function firstMeaningfulLine(text: string, maxLen: number): string {
  for (const line of text.split(/\r?\n/)) {
    if (isNoiseLine(line)) continue
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed
  }
  return ''
}

/** Binary sniff: NUL byte in the first 8 KiB. */
export function isBinary(chunk: Uint8Array): boolean {
  const limit = Math.min(chunk.length, 8192)
  for (let i = 0; i < limit; i++) {
    if (chunk[i] === 0) return true
  }
  return false
}
