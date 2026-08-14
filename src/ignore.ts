/**
 * A compact gitignore-lite matcher plus the extra ignore patterns a caller
 * configures. Supports the common gitignore subset: blank lines, `#` comments,
 * `!` negation, trailing `/` (directory-only), `*` / `?` / `**` wildcards, and
 * anchored (contains `/`) vs basename (no `/`) patterns. Last matching rule
 * wins, like git.
 *
 * @module dsh-openwolf/ignore
 */

/** One compiled ignore rule. */
interface CompiledRule {
  /** Negates the match (`!pattern`). */
  negate: boolean
  /** Only matches directories. */
  dirOnly: boolean
  /** Anchored: the pattern contains a `/` and is matched against the full path. */
  anchored: boolean
  /** Compiled matcher against the relevant path string. */
  test: (subject: string) => boolean
}

const ALWAYS_IGNORED = new Set(['.git'])

/** Convert a gitignore pattern into a regex for `*`, `?`, `**`. */
function compileMatcher(pattern: string): (subject: string) => boolean {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`).test.bind(new RegExp(`^${re}$`))
}

/** Parse one raw gitignore line into a rule, or null when it is inert. */
function parseLine(raw: string): CompiledRule | null {
  let line = raw.replace(/[ \t]+$/, '')
  if (line === '' || line.startsWith('#')) return null
  let negate = false
  if (line.startsWith('!')) {
    negate = true
    line = line.slice(1)
  } else if (line.startsWith('\\!')) {
    line = line.slice(1)
  }
  if (line === '') return null
  let dirOnly = false
  if (line.endsWith('/')) {
    dirOnly = true
    line = line.slice(0, -1)
  }
  if (line === '') return null
  // A leading '/' anchors the pattern to the root of the ignore scope.
  let anchored = line.includes('/')
  if (line.startsWith('/')) {
    anchored = true
    line = line.slice(1)
  }
  if (line === '') return null
  const subject = anchored ? line : line.split('/').pop() ?? line
  return { negate, dirOnly, anchored, test: compileMatcher(subject) }
}

/** Parse the text of a `.gitignore` file into rules. */
export function parseGitignore(text: string): CompiledRule[] {
  const rules: CompiledRule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const rule = parseLine(raw)
    if (rule !== null) rules.push(rule)
  }
  return rules
}

/** Read and parse the root-level `.gitignore` of a workspace, if present. */
export async function loadRootGitignore(
  root: string,
  readFile: (path: string) => Promise<string>,
): Promise<CompiledRule[]> {
  try {
    return parseGitignore(await readFile(`${root}/.gitignore`))
  } catch {
    return []
  }
}

/** Options controlling the ignore decision for one path. */
export interface IgnoreContext {
  /** Extra user-configured patterns, already compiled. */
  extraRules: CompiledRule[]
  /** Parsed `.gitignore` rules. */
  gitignore: CompiledRule[]
  /** Whether dot-path segments are included (false = hidden entries are ignored). */
  hidden: boolean
}

/** Compile a list of raw patterns into rules (used for configured `ignore`). */
export function compilePatterns(patterns: string[]): CompiledRule[] {
  const rules: CompiledRule[] = []
  for (const raw of patterns) {
    const rule = parseLine(raw)
    if (rule !== null) rules.push(rule)
  }
  return rules
}

/** All proper ancestor directories of a relative path, innermost first. */
function ancestorDirs(subjectPath: string): string[] {
  const dirs: string[] = []
  let idx = subjectPath.lastIndexOf('/')
  while (idx !== -1) {
    dirs.push(subjectPath.slice(0, idx))
    idx = subjectPath.lastIndexOf('/', idx - 1)
  }
  return dirs
}

function evalRules(rules: CompiledRule[], subjectPath: string, isDir: boolean): boolean {
  let ignored = false
  const ancestors = ancestorDirs(subjectPath)
  for (const rule of rules) {
    if (rule.dirOnly) {
      // A directory-only rule matches a directory, or anything under it.
      const candidates = isDir ? [subjectPath, ...ancestors] : ancestors
      for (const dirPath of candidates) {
        const candidate = rule.anchored ? dirPath : dirPath.split('/').pop() ?? dirPath
        if (rule.test(candidate)) {
          ignored = !rule.negate
          break
        }
      }
    } else {
      const candidate = rule.anchored ? subjectPath : subjectPath.split('/').pop() ?? subjectPath
      if (rule.test(candidate)) ignored = !rule.negate
    }
  }
  return ignored
}

/**
 * Decide whether a workspace-relative path is ignored. `subjectPath` is the
 * POSIX relative path of the entry; `isDir` marks directories (directory-only
 * rules and pruning apply to them).
 */
export function isIgnored(subjectPath: string, isDir: boolean, ctx: IgnoreContext): boolean {
  const segments = subjectPath.split('/')
  if (segments.some((seg) => ALWAYS_IGNORED.has(seg))) return true
  if (!ctx.hidden) {
    if (segments.some((seg) => seg.startsWith('.'))) return true
  }
  if (evalRules(ctx.extraRules, subjectPath, isDir)) return true
  return evalRules(ctx.gitignore, subjectPath, isDir)
}
