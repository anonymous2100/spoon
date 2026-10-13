// Throwaway Git repositories for tests. Everything lives under the per-process sandbox
// created by register.mjs, so the user's own repos and Git config are never touched.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function sandboxDir(prefix = 'case-'): string {
  return mkdtempSync(join(process.env.SPOON_TEST_SANDBOX!, prefix))
}

export function sh(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

export function write(repo: string, file: string, content: string | Buffer): void {
  const full = join(repo, file)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export function commitAll(repo: string, message: string): string {
  sh(repo, ['add', '-A'])
  sh(repo, ['commit', '-q', '-m', message])
  return sh(repo, ['rev-parse', 'HEAD']).trim()
}

/** A repo on `main` with one commit containing README.md. */
export function makeRepo(name = 'repo', files: Record<string, string> = { 'README.md': '# demo\n' }): string {
  const repo = join(sandboxDir(), name)
  mkdirSync(repo, { recursive: true })
  sh(repo, ['init', '-q', '-b', 'main'])
  for (const [file, content] of Object.entries(files)) write(repo, file, content)
  commitAll(repo, 'Initial commit')
  return repo
}

/** A bare "remote" plus a clone of it that tracks origin/main. */
export function makeRemotePair(): { bare: string; clone: string; other: string } {
  const root = sandboxDir('remote-')
  const seed = makeRepo('seed')
  const bare = join(root, 'origin.git')
  sh(root, ['clone', '-q', '--bare', seed, bare])
  const clone = join(root, 'clone')
  const other = join(root, 'other')
  sh(root, ['clone', '-q', bare, clone])
  sh(root, ['clone', '-q', bare, other])
  return { bare, clone, other }
}

export function head(repo: string, ref = 'HEAD'): string {
  return sh(repo, ['rev-parse', ref]).trim()
}

export function log(repo: string, range = 'HEAD'): string[] {
  return sh(repo, ['log', '--format=%s', range]).trim().split('\n').filter(Boolean)
}
