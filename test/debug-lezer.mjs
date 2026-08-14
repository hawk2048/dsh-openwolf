import { extractSymbolsLezer } from '../lib/lezer.js'
const src = [
  'export const version = "1.0.0"',
  'export function greet(who: string) {',
  '  return who',
  '}',
  'class Server {',
  '  listen() {}',
  '}',
  'export interface Config { port: number }',
  'export type Id = string',
  'export enum Mode { A }',
  '',
].join('\n')
const hits = await extractSymbolsLezer(src, 'src/index.ts', 16)
console.log(JSON.stringify(hits, null, 1))
