/**
 * Global project registry for the `wolf` CLI: a machine-local JSON file that
 * lists registered workspaces, so `wolf update` can refresh every project
 * (with timestamped `.wolf` backups) and `wolf restore` can roll back.
 * Independent implementation of the reference registry/update/restore trio.
 *
 * @module dsh-openwolf/registry
 */

import { mkdir, readFile, writeFile, readdir, cp, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

/** Registry file location (env-overridable for tests). */
export function registryPath(override?: string): string {
  if (override !== undefined) return override
  const env = process.env.DSH_WOLF_REGISTRY
  if (env !== undefined && env !== '') return env
  return join(homedir(), '.dsh-wolf-registry.json')
}

/** One registered project. */
export interface RegisteredProject {
  dir: string
  name: string
  registered_at: string
}

interface RegistryDoc {
  version: number
  projects: RegisteredProject[]
}

const DEFAULT_DOC: RegistryDoc = { version: 1, projects: [] }

async function readRegistry(path: string): Promise<RegistryDoc> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RegistryDoc
  } catch {
    return DEFAULT_DOC
  }
}

async function writeRegistry(path: string, doc: RegistryDoc): Promise<void> {
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}

/** List registered projects (resolved to absolute paths). */
export async function listProjects(path?: string): Promise<RegisteredProject[]> {
  return (await readRegistry(registryPath(path))).projects
}

/** Register a workspace (idempotent; re-registration updates the timestamp). */
export async function registerProject(dir: string, path?: string): Promise<RegisteredProject> {
  const abs = resolve(dir)
  const file = registryPath(path)
  const doc = await readRegistry(file)
  const existing = doc.projects.find((p) => p.dir === abs)
  if (existing !== undefined) {
    existing.registered_at = new Date().toISOString()
    await writeRegistry(file, doc)
    return existing
  }
  const project: RegisteredProject = {
    dir: abs,
    name: abs.split(/[\\/]/).pop() ?? abs,
    registered_at: new Date().toISOString(),
  }
  doc.projects.push(project)
  await writeRegistry(file, doc)
  return project
}

/** Unregister a workspace; returns true when it was registered. */
export async function unregisterProject(dir: string, path?: string): Promise<boolean> {
  const abs = resolve(dir)
  const file = registryPath(path)
  const doc = await readRegistry(file)
  const next = doc.projects.filter((p) => p.dir !== abs)
  if (next.length === doc.projects.length) return false
  doc.projects = next
  await writeRegistry(file, doc)
  return true
}

/** Back up a `.wolf` brain to `<dir>/.wolf-backups/<timestamp>/`. */
export async function backupBrain(dir: string, brainDir = '.wolf'): Promise<string> {
  const src = join(dir, brainDir)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(dir, `.wolf-backups/${stamp}`)
  await mkdir(dest, { recursive: true })
  await cp(src, dest, { recursive: true })
  return dest
}

/** List timestamped backups (newest first). */
export async function listBackups(dir: string): Promise<string[]> {
  const root = join(dir, '.wolf-backups')
  try {
    const entries = await readdir(root)
    const dirs = []
    for (const e of entries) {
      try {
        if ((await stat(join(root, e))).isDirectory()) dirs.push(e)
      } catch {
        // skip
      }
    }
    return dirs.sort().reverse()
  } catch {
    return []
  }
}

/** Restore a brain from a backup tag (or the newest when omitted). */
export async function restoreBrain(dir: string, tag?: string, brainDir = '.wolf'): Promise<string> {
  const backups = await listBackups(dir)
  if (backups.length === 0) throw new Error('no backups found')
  const chosen = tag ?? backups[0]!
  if (!backups.includes(chosen)) throw new Error(`backup not found: ${chosen}`)
  const src = join(dir, '.wolf-backups', chosen)
  const dest = join(dir, brainDir)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  await cp(src, dest, { recursive: true })
  return `${dest} (restored from ${chosen})`
}
