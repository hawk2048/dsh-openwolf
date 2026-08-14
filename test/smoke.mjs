import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const pkg = await import('../lib/index.js')
console.log('name:', pkg.name)
console.log('inject:', JSON.stringify(pkg.inject))
console.log('apply:', typeof pkg.apply)
console.log('Config:', typeof pkg.Config)

const c = pkg.Config({ maxFiles: 99 })
console.log('validated maxFiles:', c.maxFiles)
console.log('defaults:', c.maxMapBytes, c.watch, c.injectAgentsMd, c.sortBy, c.agentsMdFile, JSON.stringify(c.ignore))

const require = createRequire(import.meta.url)
const yaml = require('C:/Users/wkliu/.dsh/profiles/node_modules/yaml')
const doc = yaml.parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
console.log('patch row:', JSON.stringify(doc[0].insert[0]))
