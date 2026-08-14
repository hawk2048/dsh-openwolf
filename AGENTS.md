

<!-- dsh-openwolf:start -->
# Code Map
Generated 2026-08-14T17:41:03.206Z · 19 files · 2213 lines · 0.03s

## ./
- `LICENSE` — 21 lines · MIT License
- `README.md` — 134 lines · A compact code-map **"second brain"** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It pre-indexes your workspace…
- `cordis.patch.yml` — 39 lines · - insert:
- `package.json` — 83 lines · {
- `pnpm-lock.yaml` — 332 lines · lockfileVersion: 5.4
- `tsconfig.json` — 21 lines · {

## scripts
- `scripts/collect-peers.mjs` — 46 lines · profileNodeModules, pkgPath, pkg, needed, queue, name · const profileNodeModules = 'C:/Users/wkliu/.dsh/profiles/node_modules/@deepseek-ai'

## src
- `src/ignore.ts` — 163 lines · compileMatcher, parseLine, parseGitignore, loadRootGitignore, compilePatterns, ancestorDirs · interface CompiledRule {
- `src/index.ts` — 366 lines · scanOptionsOf, resolveWorkspace, entryOf, apply, matchLite, name · export const name = 'dsh-openwolf'
- `src/render.ts` — 122 lines · renderMap, renderBlock, findBlock, injectBlock, WOLF_BLOCK_START, WOLF_BLOCK_END · export const WOLF_BLOCK_START = '<!-- dsh-openwolf:start -->'
- `src/scanner.ts` — 213 lines · toPosix, buildIgnoreContext, analyzeText, analyzeFile, scanCodebase, summarizeFile · export function toPosix(relPath: string): string {
- `src/symbols.ts` — 142 lines · detectLang, extractSymbols, isNoiseLine, firstMeaningfulLine, isBinary, lower · const LANG_BY_EXT: Record<string, string> = {
- `src/types.ts` — 103 lines · FileEntry, DirEntry, CodeMap, FileDigest, ScanOptions · export interface FileEntry {

## test
- `test/harness-integration.mjs` — 78 lines · fixture, app, tools, agent, signal, call · const fixture = await mkdtemp(join(tmpdir(), 'openwolf-it-'))
- `test/ignore.test.ts` — 58 lines · base, ctx, rules · const base = { extraRules: compilePatterns([]), gitignore: [], hidden: false }
- `test/render.test.ts` — 86 lines · root, map, agents, first, text1, second · const opts: ScanOptions = {
- `test/scanner.test.ts` — 104 lines · root, map, paths, index, readme, srcDir · const opts: ScanOptions = {
- `test/smoke.mjs` — 17 lines · pkg, c, require, yaml, doc · const pkg = await import('../lib/index.js')
- `test/symbols.test.ts` — 85 lines · greet, DemoServer, Handler, main, src, name · test('detectLang by extension', () => {
<!-- dsh-openwolf:end -->
