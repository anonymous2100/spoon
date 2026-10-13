// Repository management: init, clone, scan, overview, health checks and one-click fixes,
// submodules, media previews and path safety.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as git from '../../src/main/git.ts'
import { commitAll, head, makeRemotePair, makeRepo, sandboxDir, sh, write } from '../support/repo.ts'

test('findGit locates a working git executable', async () => {
  const exe = await git.findGit()
  assert.ok(exe)
})

test('initRepo creates an empty repo or one with an initial README commit', async () => {
  const root = sandboxDir()
  const bare = await git.initRepo(join(root, 'plain'))
  assert.equal(await git.isRepo(bare), true)
  assert.deepEqual(await git.getCommits(bare), [])
  const seeded = await git.initRepo(join(root, 'seeded'), true)
  assert.equal(readFileSync(join(seeded, 'README.md'), 'utf8'), '# seeded\n')
  assert.deepEqual((await git.getCommits(seeded)).map((c) => c.subject), ['Initial commit'])
  assert.equal((await git.getStatus(seeded)).branch, 'main')
})

test('cloneRepo clones into <dir>/<repo name> or a custom name and reports progress', async () => {
  const { bare } = makeRemotePair()
  const dir = sandboxDir('clone-')
  const progress: string[] = []
  const target = await git.cloneRepo({ url: bare, directory: dir }, (line) => progress.push(line))
  assert.equal(target, join(dir, 'origin'))
  assert.equal(await git.isRepo(target), true)
  assert.ok(progress.length > 0)
  const named = await git.cloneRepo({ url: bare, directory: dir, name: 'custom' })
  assert.equal(named, join(dir, 'custom'))
  await assert.rejects(git.cloneRepo({ url: join(dir, 'does-not-exist.git'), directory: dir, name: 'x' }))
})

test('scanRepos finds nested repos, skips ignored folders and accepts a repo as root', async () => {
  const root = sandboxDir('scan-')
  for (const name of ['alpha', 'group/beta', 'node_modules/ignored', '.hidden/ignored2', 'group/beta/nested-inside']) {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    sh(dir, ['init', '-q'])
  }
  mkdirSync(join(root, 'plain-folder'), { recursive: true })
  const progress: number[] = []
  const found = await git.scanRepos([root, join(root, 'missing')], (p) => progress.push(p.found))
  assert.deepEqual(found.map((r) => r.name), ['alpha', 'beta'])
  assert.ok(progress.length > 0)
  const direct = await git.scanRepos([join(root, 'alpha')])
  assert.deepEqual(direct.map((r) => r.name), ['alpha'])
  const deduped = await git.scanRepos([root, root])
  assert.equal(deduped.length, 2)
})

test('limiter never runs more than N tasks at once', async () => {
  const run = git.limiter(2)
  let active = 0
  let peak = 0
  await Promise.all(
    Array.from({ length: 8 }, () =>
      run(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
      })
    )
  )
  assert.equal(peak, 2)
})

test('overview summarises branch, counts, last commit, remote and operations', async () => {
  const { clone } = makeRemotePair()
  write(clone, 'README.md', 'changed\n')
  write(clone, 'staged.txt', 's')
  sh(clone, ['add', 'staged.txt'])
  write(clone, 'untracked.txt', 'u')
  const o = await git.overview(clone)
  assert.equal(o.exists, true)
  assert.equal(o.branch, 'main')
  assert.equal(o.upstream, 'origin/main')
  assert.equal(o.staged, 1)
  assert.equal(o.unstaged, 1)
  assert.equal(o.untracked, 1)
  assert.equal(o.lastCommit?.subject, 'Initial commit')
  assert.match(o.remoteUrl ?? '', /origin\.git$/)
  assert.equal(o.operation, undefined)
  const missing = await git.overview(join(clone, 'nope'))
  assert.equal(missing.exists, false)
  assert.equal(missing.error, 'Folder not found')
  const plain = sandboxDir('plain-')
  assert.equal(!!(await git.overview(plain)).error, true)
})

test('overview counts conflicts and reports the operation in progress', async () => {
  const repo = makeRepo('op', { 'f.txt': 'base\n' })
  sh(repo, ['checkout', '-q', '-b', 'b'])
  write(repo, 'f.txt', 'b\n')
  commitAll(repo, 'b')
  sh(repo, ['checkout', '-q', 'main'])
  write(repo, 'f.txt', 'm\n')
  commitAll(repo, 'm')
  await git.mergeBranch(repo, 'b')
  const o = await git.overview(repo)
  assert.equal(o.operation, 'merge')
  assert.equal(o.conflicts, 1)
})

const ids = (h: { issues: { id: string }[] }) => h.issues.map((i) => i.id).sort()

test('health: missing folder and non-repository folders', async () => {
  const missing = await git.health(join(sandboxDir(), 'gone'))
  assert.deepEqual(ids(missing), ['missing'])
  assert.equal(missing.issues[0].fix?.id, 'remove-missing')
  const plain = await git.health(sandboxDir())
  assert.deepEqual(ids(plain), ['not-repo'])
})

test('health: a local-only clean repo only reports "no remote"', async () => {
  const repo = makeRepo()
  assert.deepEqual(ids(await git.health(repo)), ['no-remote'])
})

test('health + fix: stale index.lock', async () => {
  const repo = makeRepo()
  writeFileSync(join(repo, '.git', 'index.lock'), '')
  const h = await git.health(repo)
  assert.equal(h.issues[0].id, 'lock')
  assert.equal(h.issues[0].severity, 'error')
  assert.equal(await git.applyFix(repo, 'remove-lock'), 'Lock removed')
  assert.equal(existsSync(join(repo, '.git', 'index.lock')), false)
})

test('health + fix: merge in progress can be aborted', async () => {
  const repo = makeRepo('abort', { 'f.txt': 'base\n' })
  sh(repo, ['checkout', '-q', '-b', 'b'])
  write(repo, 'f.txt', 'b\n')
  commitAll(repo, 'b')
  sh(repo, ['checkout', '-q', 'main'])
  write(repo, 'f.txt', 'm\n')
  commitAll(repo, 'm')
  await git.mergeBranch(repo, 'b')
  const h = await git.health(repo)
  const op = h.issues.find((i) => i.id === 'operation')
  assert.equal(op?.title, 'Merge in progress')
  assert.match(op?.detail ?? '', /1 file\(s\) still have conflicts/)
  assert.equal(await git.applyFix(repo, 'abort-operation'), 'merge aborted')
  assert.equal(await git.applyFix(repo, 'abort-operation'), 'Nothing to abort')
})

test('health + fix: detached HEAD offers checkout of the default branch', async () => {
  const repo = makeRepo()
  write(repo, 'a', 'a')
  commitAll(repo, 'two')
  sh(repo, ['checkout', '-q', 'HEAD~1'])
  const h = await git.health(repo)
  const issue = h.issues.find((i) => i.id === 'detached')
  assert.equal(issue?.fix?.label, 'Checkout main')
  assert.equal(await git.applyFix(repo, 'checkout-default'), 'On main')
  assert.equal((await git.getStatus(repo)).branch, 'main')
})

test('health + fix: unpublished branch and branch not tracking its remote', async () => {
  const { clone } = makeRemotePair()
  await git.createBranch(clone, 'local-only', true)
  let h = await git.health(clone)
  assert.equal(h.issues.find((i) => i.id === 'unpublished')?.fix?.label, 'Publish to origin')
  assert.equal(await git.applyFix(clone, 'publish-branch'), 'Published to origin')
  assert.equal((await git.getStatus(clone)).upstream, 'origin/local-only')
  sh(clone, ['branch', '--unset-upstream'])
  h = await git.health(clone)
  assert.equal(h.issues.find((i) => i.id === 'no-upstream')?.fix?.label, 'Track origin/local-only')
  assert.equal(await git.applyFix(clone, 'track-upstream'), 'Tracking origin/local-only')
  assert.equal((await git.getStatus(clone)).upstream, 'origin/local-only')
})

test('health + fix: behind a clean upstream offers fast-forward; diverged is reported', async () => {
  const { clone, other } = makeRemotePair()
  write(other, 'o', 'o')
  commitAll(other, 'remote')
  sh(other, ['push', '-q'])
  sh(clone, ['fetch', '-q'])
  let h = await git.health(clone)
  assert.equal(h.issues.find((i) => i.id === 'behind')?.title, '1 commit(s) behind')
  assert.equal(await git.applyFix(clone, 'pull-ff'), 'Up to date')
  write(other, 'o2', 'o2')
  commitAll(other, 'remote 2')
  sh(other, ['push', '-q'])
  write(clone, 'c', 'c')
  commitAll(clone, 'local')
  sh(clone, ['fetch', '-q'])
  h = await git.health(clone)
  assert.ok(h.issues.some((i) => i.id === 'diverged'))
  assert.ok(!h.issues.some((i) => i.id === 'behind'))
})

test('health + fix: branches deleted on the remote can be removed locally', async () => {
  const { clone, other } = makeRemotePair()
  sh(clone, ['checkout', '-q', '-b', 'stale'])
  sh(clone, ['push', '-q', '-u', 'origin', 'stale'])
  sh(clone, ['checkout', '-q', 'main'])
  sh(other, ['push', '-q', 'origin', '--delete', 'stale'])
  sh(clone, ['fetch', '-q', '--prune'])
  const h = await git.health(clone)
  const gone = h.issues.find((i) => i.id === 'gone')
  assert.match(gone?.detail ?? '', /stale/)
  assert.equal(await git.applyFix(clone, 'delete-gone-branches'), 'Deleted 1 branch(es)')
  assert.ok(!(await git.getBranches(clone)).some((b) => b.name === 'stale'))
})

test('health + fix: missing identity and set-identity (global config is sandboxed)', async () => {
  const repo = makeRepo()
  const original = process.env.GIT_CONFIG_GLOBAL
  const empty = join(sandboxDir(), 'empty-gitconfig')
  writeFileSync(empty, '')
  process.env.GIT_CONFIG_GLOBAL = empty
  try {
    const h = await git.health(repo)
    assert.ok(h.issues.some((i) => i.id === 'identity'))
    await assert.rejects(git.applyFix(repo, 'set-identity', { name: ' ', email: '' }), /required/)
    assert.equal(await git.applyFix(repo, 'set-identity', { name: 'New Name', email: 'new@example.com' }), 'Identity saved')
    assert.match(readFileSync(empty, 'utf8'), /New Name/)
    assert.ok(!(await git.health(repo)).issues.some((i) => i.id === 'identity'))
  } finally {
    process.env.GIT_CONFIG_GLOBAL = original
  }
})

test('fix: safe-directory writes to the (sandboxed) global config', async () => {
  const repo = makeRepo()
  const original = process.env.GIT_CONFIG_GLOBAL
  const cfg = join(sandboxDir(), 'safe-gitconfig')
  writeFileSync(cfg, '')
  process.env.GIT_CONFIG_GLOBAL = cfg
  try {
    assert.equal(await git.applyFix(repo, 'safe-directory'), 'Folder trusted')
    assert.match(readFileSync(cfg, 'utf8'), new RegExp(repo.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]]/g, '\\$&')))
  } finally {
    process.env.GIT_CONFIG_GLOBAL = original
  }
})

test('fix: gc, prune and remove-missing', async () => {
  const { clone } = makeRemotePair()
  assert.equal(await git.applyFix(clone, 'gc'), 'Repository compacted')
  assert.equal(await git.applyFix(clone, 'prune'), 'Fetched and pruned')
  assert.equal(await git.applyFix(clone, 'remove-missing'), 'Removed')
})

test('health deep mode runs fsck without false positives', async () => {
  const repo = makeRepo()
  assert.ok(!(await git.health(repo, true)).issues.some((i) => i.id === 'fsck'))
})

test('submodules: list, uninitialised health issue, update', async () => {
  const lib = makeRepo('lib', { 'lib.txt': 'lib' })
  const app = makeRepo('app')
  sh(app, ['submodule', 'add', '-q', lib, 'vendor/lib'])
  commitAll(app, 'add submodule')
  let subs = await git.getSubmodules(app)
  assert.deepEqual(subs.map((s) => [s.path, s.status]), [['vendor/lib', 'ok']])
  const fresh = join(sandboxDir(), 'fresh')
  sh(join(app, '..'), ['clone', '-q', app, fresh])
  subs = await git.getSubmodules(fresh)
  assert.equal(subs[0].status, 'uninitialized')
  const h = await git.health(fresh)
  assert.ok(h.issues.some((i) => i.id === 'submodules'))
  await git.submoduleUpdate(fresh, 'vendor/lib')
  assert.equal((await git.getSubmodules(fresh))[0].status, 'ok')
  assert.equal(existsSync(join(fresh, 'vendor', 'lib', 'lib.txt')), true)
  assert.deepEqual(await git.getSubmodules(lib), [])
})

test('previewMedia returns HEAD vs working copy, commit parent vs commit, and size limits', async () => {
  const png1 = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const png2 = Buffer.concat([png1, Buffer.from([1, 2, 3])])
  const repo = makeRepo('media', { 'img.png': png1.toString('latin1') })
  write(repo, 'img.png', png1)
  commitAll(repo, 'binary png')
  write(repo, 'img.png', png2)
  const work = await git.previewMedia(repo, 'img.png')
  assert.equal(work.before.kind, 'image')
  assert.equal(work.before.mime, 'image/png')
  assert.equal(Buffer.from(work.before.base64!, 'base64').length, png1.length)
  assert.equal(Buffer.from(work.after.base64!, 'base64').length, png2.length)
  const sha = commitAll(repo, 'change png')
  const atCommit = await git.previewMedia(repo, 'img.png', { rev: sha })
  assert.equal(atCommit.after.bytes, png2.length)
  assert.equal(atCommit.before.bytes, png1.length)
  write(repo, 'new.pdf', '%PDF-1.4')
  const added = await git.previewMedia(repo, 'new.pdf')
  assert.equal(added.before.missing, true)
  assert.equal(added.after.kind, 'pdf')
  write(repo, 'huge.mp4', Buffer.alloc(12 * 1024 * 1024 + 1))
  const huge = await git.previewMedia(repo, 'huge.mp4')
  assert.equal(huge.after.tooLarge, true)
  assert.equal(huge.after.base64, undefined)
  const outside = await git.previewMedia(repo, '../outside.png')
  assert.equal(outside.after.missing, true)
})

test('worktreeFile rejects paths that escape the repository', () => {
  const repo = makeRepo()
  assert.equal(git.worktreeFile(repo, 'a/b.txt'), join(repo, 'a', 'b.txt'))
  assert.throws(() => git.worktreeFile(repo, '../escape.txt'), /outside the repository/)
  assert.throws(() => git.worktreeFile(repo, 'C:\\Windows\\win.ini'), /outside the repository/)
})

test('readConflict / writeResolved refuse paths outside the repository', async () => {
  const repo = makeRepo()
  const victim = join(repo, '..', 'victim.txt')
  writeFileSync(victim, 'keep me')
  await assert.rejects(git.writeResolved(repo, '../victim.txt', 'overwritten'))
  assert.equal(readFileSync(victim, 'utf8'), 'keep me')
})

test('lfsFiles returns [] when LFS is not used', async () => {
  assert.deepEqual(await git.lfsFiles(makeRepo()), [])
})

test('isBinaryPath and relativeTo helpers', () => {
  assert.equal(git.isBinaryPath('a/b.PNG'), true)
  assert.equal(git.isBinaryPath('x.dll'), true)
  assert.equal(git.isBinaryPath('x.ts'), false)
  assert.equal(git.relativeTo('C:\\repo', 'C:\\repo\\src\\a.ts'), 'src/a.ts')
})

test('repoStamp notices merges in progress', async () => {
  const repo = makeRepo()
  const before = git.repoStamp(repo)
  writeFileSync(join(repo, '.git', 'MERGE_HEAD'), head(repo))
  assert.notEqual(git.repoStamp(repo), before)
  assert.match(git.repoStamp(repo), /merge/)
})
