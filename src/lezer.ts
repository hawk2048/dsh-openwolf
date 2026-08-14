/**
 * Optional lezer-backed symbol extraction: parses source with pure-JS
 * CodeMirror grammars and pulls top-level declarations (name + start/end
 * lines + per-symbol token estimate) from the CST. Falls back to the regex
 * backend per language when no grammar is installed.
 *
 * @module dsh-openwolf/lezer
 */

import { detectLang } from './symbols.ts'

/** One extracted symbol with its span and estimated cost. */
export interface LezerSymbolHit {
  name: string
  line: number
  endLine: number
  tokens: number
}

/** Language tag → dynamic grammar loader (module import is cached). */
const LOADERS: Record<string, () => Promise<unknown>> = {
  ts: () => import('@lezer/javascript').then((m: { parser: unknown }) => (m.parser as { configure: (o: object) => unknown }).configure({ dialect: 'ts' })),
  tsx: () => import('@lezer/javascript').then((m: { parser: unknown }) => (m.parser as { configure: (o: object) => unknown }).configure({ dialect: 'tsx' })),
  mts: () => import('@lezer/javascript').then((m: { parser: unknown }) => (m.parser as { configure: (o: object) => unknown }).configure({ dialect: 'ts' })),
  cts: () => import('@lezer/javascript').then((m: { parser: unknown }) => (m.parser as { configure: (o: object) => unknown }).configure({ dialect: 'ts' })),
  js: () => import('@lezer/javascript').then((m: { parser: unknown }) => m.parser),
  jsx: () => import('@lezer/javascript').then((m: { parser: unknown }) => (m.parser as { configure: (o: object) => unknown }).configure({ dialect: 'jsx' })),
  mjs: () => import('@lezer/javascript').then((m: { parser: unknown }) => m.parser),
  cjs: () => import('@lezer/javascript').then((m: { parser: unknown }) => m.parser),
  py: () => import('@lezer/python').then((m: { parser: unknown }) => m.parser),
  go: () => import('@lezer/go').then((m: { parser: unknown }) => m.parser),
  rs: () => import('@lezer/rust').then((m: { parser: unknown }) => m.parser),
  java: () => import('@lezer/java').then((m: { parser: unknown }) => m.parser),
  kt: () => import('@lezer/java').then((m: { parser: unknown }) => m.parser),
}

/** Whether a lezer grammar exists for this file's language tag. */
export function lezerAvailableFor(relPath: string): boolean {
  return detectLang(relPath) in LOADERS
}

/** Symbol kinds per declaration node type. */
const KIND_BY_NODE: Record<string, string> = {
  FunctionDeclaration: 'function', FunctionDefinition: 'function', FunctionDecl: 'function',
  MethodDecl: 'method', FunctionItem: 'function',
  ClassDeclaration: 'class', ClassDefinition: 'class', StructItem: 'struct',
  InterfaceDeclaration: 'type', TypeAliasDeclaration: 'type', TraitItem: 'trait',
  EnumDeclaration: 'enum', EnumItem: 'enum',
  VariableDeclaration: 'const', TypeDecl: 'type', ImplItem: 'impl',
}

/** Name-node names per declaration type (first match wins; java shares names). */
const NAME_CHILD: Record<string, string[]> = {
  FunctionDeclaration: ['VariableDefinition'], ClassDeclaration: ['VariableDefinition', 'Definition'],
  InterfaceDeclaration: ['TypeDefinition', 'Definition'], TypeAliasDeclaration: ['TypeDefinition'], EnumDeclaration: ['TypeDefinition'],
  VariableDeclaration: ['VariableDefinition'],
  FunctionDefinition: ['VariableName'], ClassDefinition: ['VariableName'],
  FunctionDecl: ['DefName'], MethodDecl: ['FieldName'],
  FunctionItem: ['BoundIdentifier'], StructItem: ['TypeIdentifier'], EnumItem: ['TypeIdentifier'], TraitItem: ['TypeIdentifier'],
}

/** Top-level declaration node names we index (keyed by generic or per-language). */
const DECLARATION_NODES = new Set([
  'FunctionDeclaration', 'ClassDeclaration', 'InterfaceDeclaration', 'TypeAliasDeclaration',
  'EnumDeclaration', 'VariableDeclaration', 'FunctionDefinition', 'ClassDefinition',
  'FunctionDecl', 'MethodDecl', 'TypeDecl', 'FunctionItem', 'StructItem', 'EnumItem',
  'TraitItem', 'ImplItem',
])

/** Minimal structural typing for lezer nodes (avoids importing @lezer/common). */
interface LezerNode {
  name: string
  from: number
  to: number
  firstChild: LezerNode | null
  nextSibling: LezerNode | null
}
interface LezerTree { cursor(): unknown }
interface ParserLike { parse(text: string): LezerTree }

/** Offset → 1-based line, via a sorted list of line-start offsets. */
function lineOf(lineStarts: number[], offset: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/** Extract the declaration name from a node, with text-based fallbacks. */
function nameOf(node: LezerNode, text: string): string | null {
  const preferred = NAME_CHILD[node.name]
  if (preferred !== undefined) {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (preferred.includes(child.name)) {
        const name = text.slice(child.from, child.to).trim()
        if (name !== '') return name
      }
    }
  }
  if (node.name === 'TypeDecl') {
    return text.slice(node.from, node.to).match(/^type\s+([A-Za-z_]\w*)/)?.[1] ?? null
  }
  if (node.name === 'ImplItem') {
    return text.slice(node.from, node.to).match(/^impl(?:\s*<[^>]*>)?\s+([A-Za-z_]\w*)/)?.[1] ?? null
  }
  return null
}

/** Collect top-level declarations from a parse tree. */
function collectTopLevel(root: unknown, text: string, lineStarts: number[], max: number): LezerSymbolHit[] {
  const hits: LezerSymbolHit[] = []
  const cur = (root as { cursor(): { firstChild(): boolean; name: string; from: number; to: number; node: LezerNode; nextSibling(): boolean } }).cursor()
  if (!cur.firstChild()) return hits
  do {
    if (hits.length >= max) break
    let node: LezerNode = cur.node
    // Unwrap `export` wrappers for TS/JS: the declaration is a child (the
    // first child is the `export` keyword itself).
    if (node.name === 'ExportDeclaration') {
      let unwrapped: LezerNode | null = null
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (DECLARATION_NODES.has(child.name)) {
          unwrapped = child
          break
        }
      }
      if (unwrapped === null) continue // `export default X` / re-exports: skip
      node = unwrapped
    }
    if (!DECLARATION_NODES.has(node.name)) continue
    const name = nameOf(node, text)
    if (name === null) continue
    hits.push({
      name,
      line: lineOf(lineStarts, node.from),
      endLine: lineOf(lineStarts, node.to),
      tokens: Math.max(1, Math.ceil((node.to - node.from) / 4)),
    })
  } while (cur.nextSibling())
  return hits
}

/**
 * Extract symbols with the lezer backend for a file, or [] when no grammar
 * exists for its language.
 */
export async function extractSymbolsLezer(text: string, relPath: string, max: number): Promise<LezerSymbolHit[]> {
  const lang = detectLang(relPath)
  const loader = LOADERS[lang]
  if (loader === undefined) return []
  const parser = (await loader()) as ParserLike
  const tree = parser.parse(text)
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1)
  }
  return collectTopLevel(tree, text, lineStarts, max)
}
