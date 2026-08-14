// Probe direct children of declaration nodes to find the NAME node.
import { parser as jsParser } from '@lezer/javascript'
import { parser as pyParser } from '@lezer/python'
import { parser as javaParser } from '@lezer/java'
import { parser as goParser } from '@lezer/go'
import { parser as rustParser } from '@lezer/rust'

const tsParser = jsParser.configure({ dialect: 'ts' })

function childrenOf(parser, text, targetName) {
  const tree = parser.parse(text)
  const out = []
  const cur = tree.cursor()
  cur.firstChild()
  do {
    if (cur.name === targetName) {
      const node = cur.node
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        out.push(`${child.name} [${text.slice(child.from, Math.min(child.to, child.from + 40)).replace(/\n/g, ' ')}]`)
      }
      return out
    }
    // also check one level down (ExportDeclaration wraps declarations)
    if (cur.name === 'ExportDeclaration' || cur.name === 'Script') {
      const node = cur.node
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.name === targetName) {
          for (let g = child.firstChild; g !== null; g = g.nextSibling) {
            out.push(`${g.name} [${text.slice(g.from, Math.min(g.to, g.from + 40)).replace(/\n/g, ' ')}]`)
          }
          return out
        }
      }
    }
  } while (cur.nextSibling())
  return out
}

const cases = [
  ['ts', 'FunctionDeclaration', 'export function greet(who) { return who }\n'],
  ['ts', 'ClassDeclaration', 'export class Server {}\n'],
  ['ts', 'InterfaceDeclaration', 'export interface Config { port: number }\n'],
  ['ts', 'TypeAliasDeclaration', 'export type Id = string\n'],
  ['ts', 'EnumDeclaration', 'export enum Mode { A }\n'],
  ['py', 'FunctionDefinition', 'def fetch(url):\n    pass\n'],
  ['py', 'ClassDefinition', 'class Handler:\n    pass\n'],
  ['go', 'FunctionDecl', 'func main() {}\n'],
  ['go', 'MethodDecl', 'func (s *Server) Serve() {}\n'],
  ['go', 'TypeDecl', 'type Config struct { Port int }\n'],
  ['rs', 'FunctionItem', 'pub fn main() {}\n'],
  ['rs', 'StructItem', 'pub struct Server {}\n'],
  ['rs', 'TraitItem', 'pub trait Handler {}\n'],
  ['java', 'ClassDeclaration', 'public class Main {}\n'],
]
const parsers = { ts: tsParser, py: pyParser, go: goParser, rs: rustParser, java: javaParser }
for (const [lang, nodeName, src] of cases) {
  const kids = childrenOf(parsers[lang], src, nodeName)
  console.log(`\n${lang} ${nodeName}:`)
  console.log(kids.map((k) => '  ' + k).join('\n'))
}
