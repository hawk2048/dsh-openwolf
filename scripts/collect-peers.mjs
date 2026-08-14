import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const profileNodeModules = 'C:/Users/wkliu/.dsh/profiles/node_modules/@deepseek-ai'
const pkgPath = 'D:/AI/DeepSeek Harness/test1/dsh-openwolf/package.json'
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

const needed = new Set(['@deepseek-ai/cordis'])
for (const name of Object.keys(pkg.devDependencies)) {
  if (name.startsWith('@deepseek-ai/')) needed.add(name)
}

const queue = [...needed]
while (queue.length > 0) {
  const name = queue.shift()
  const short = name.replace('@deepseek-ai/', '')
  let peers = {}
  try {
    peers = JSON.parse(readFileSync(join(profileNodeModules, short, 'package.json'), 'utf8')).peerDependencies ?? {}
  } catch {
    continue
  }
  for (const peer of Object.keys(peers)) {
    if (peer.startsWith('@deepseek-ai/') && !needed.has(peer)) {
      needed.add(peer)
      queue.push(peer)
    }
  }
}

for (const name of [...needed]) {
  if (!(name in pkg.devDependencies)) {
    const short = name.replace('@deepseek-ai/', '')
    try {
      const v = JSON.parse(readFileSync(join(profileNodeModules, short, 'package.json'), 'utf8')).version
      pkg.devDependencies[name] = '^' + v
    } catch {
      console.log('missing in profile:', name)
    }
  }
}

// Keep devDeps sorted for tidiness.
pkg.devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).sort((a, b) => a[0].localeCompare(b[0])))
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log('total @deepseek-ai devDeps:', Object.keys(pkg.devDependencies).filter((n) => n.startsWith('@deepseek-ai/')).length)
