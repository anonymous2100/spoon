// Loaded with `node --import` for unit tests. It lets Node run the TypeScript sources
// directly and keeps every test away from the real user profile:
// - extensionless relative imports resolve to their `.ts` file
// - `electron` and `electron-updater` resolve to in-process stubs
// - HOME/USERPROFILE and the global Git config point at a throwaway sandbox per process
import { registerHooks } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stubs = {
  electron: new URL('./electron-stub.mjs', import.meta.url).href,
  'electron-updater': new URL('./electron-updater-stub.mjs', import.meta.url).href
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubs[specifier]) return { url: stubs[specifier], shortCircuit: true }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.split('?')[0].endsWith('.ts')) {
      if (!/\.[cm]?[jt]sx?$/.test(specifier.split('?')[0])) {
        const candidate = new URL(specifier + '.ts', context.parentURL)
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  }
})

const sandbox = mkdtempSync(join(tmpdir(), 'spoon-unit-'))
const home = join(sandbox, 'home')
const userData = join(sandbox, 'userData')
const gitconfig = join(sandbox, 'gitconfig')
mkdirSync(home)
mkdirSync(userData)
writeFileSync(
  gitconfig,
  [
    '[user]',
    '\tname = Spoon Test',
    '\temail = spoon-test@example.com',
    '[init]',
    '\tdefaultBranch = main',
    '[commit]',
    '\tgpgsign = false',
    '[tag]',
    '\tgpgsign = false',
    '[core]',
    '\tautocrlf = false',
    '[advice]',
    '\tdetachedHead = false',
    '[protocol "file"]',
    '\tallow = always',
    ''
  ].join('\n')
)
process.env.SPOON_TEST_SANDBOX = sandbox
process.env.SPOON_TEST_USERDATA = userData
process.env.SPOON_TEST_GITCONFIG = gitconfig
process.env.HOME = home
process.env.USERPROFILE = home
process.env.GIT_CONFIG_GLOBAL = gitconfig
process.env.GIT_CONFIG_NOSYSTEM = '1'
delete process.env.GIT_DIR
delete process.env.GIT_WORK_TREE

process.on('exit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    /* Windows can hold a handle briefly; the OS temp cleaner gets it later. */
  }
})
