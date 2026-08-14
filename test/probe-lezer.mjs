// Probe lezer top-level node shapes for each language fixture.
import { parser as jsParser } from '@lezer/javascript'
import { parser as pyParser } from '@lezer/python'
import { parser as javaParser } from '@lezer/java'
import { parser as goParser } from '@lezer/go'
import { parser as rustParser } from '@lezer/rust'

const tsParser = jsParser.configure({ dialect: 'ts' })

function topLevelNodes(parser, text) {
  const tree = parser.parse(text)
  const out = []
  const cur = tree.cursor()
  // Iterate top-level: depth 1 nodes only (skip Script/Root at depth 0).
  if (cur.firstChild()) {
    do {
      out.push(`${cur.name} @${cur.from}-${cur.to} [${text.slice(cur.from, Math.min(cur.to, cur.from + 60)).replace(/\n/g, ' ')}]`)
    } while (cur.nextSibling())
  }
  return out
}

const fixtures = {
  'ts': [
    `export const version = "1"\nexport function greet(who: string) { return who }\nexport class Server {}\nexport interface Config { port: number }\nexport type Id = string\nexport enum Mode { A }\nexport default Server\n`,
  ],
  'py': [`import os\ndef fetch(url):\n    pass\n\nclass Handler:\n    pass\n`],
  'go': [`package main\nfunc main() {}\nfunc (s *Server) Serve() {}\ntype Config struct { Port int }\n`],
  'rs': [`use std::io;\npub fn main() {}\npub struct Server {}\npub enum Mode {}\npub trait Handler {}\nimpl Server {}\n`],
  'java': [`package app;\npublic class Main {\n    public static void main(String[] args) {}\n}\ninterface Service {}\n`],
}

for (const [lang, texts] of Object.entries(fixtures)) {
  const parser = lang === 'ts' ? tsParser : lang === 'py' ? pyParser : lang === 'go' ? goParser : lang === 'rs' ? rustParser : javaParser
  console.log(`\n==== ${lang} ====`)
  for (const t of texts) {
    console.log(topLevelNodes(parser, t).join('\n'))
  }
}
