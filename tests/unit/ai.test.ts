// AI accounts, custom endpoints, model catalog, commit messages and change analysis,
// all against a local fake OpenAI-compatible server.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startFakeAi, type FakeAiRequest, type FakeReply } from '../support/fake-ai.ts'
import { commitAll, makeRepo, write } from '../support/repo.ts'
import { calls } from '../support/electron-stub.mjs'
import * as oauth from '../../src/main/oauth.ts'
import * as store from '../../src/main/store.ts'
import { analyzeRepository, analyzeWorkspaces, generateCommitMessage } from '../../src/main/ai.ts'
import { listProviderModels } from '../../src/main/model-catalog.ts'

let fake: Awaited<ReturnType<typeof startFakeAi>>
let next: (req: FakeAiRequest) => FakeReply = () => 'feat: fake commit message'

before(async () => {
  fake = await startFakeAi((req) => next(req))
})
after(() => fake.close())

const endpoint = () => ({
  id: 'custom-fake',
  label: 'Fake AI',
  baseUrl: fake.baseUrl + '/',
  defaultModel: 'fake-small',
  needsKey: false
})

test('built-in providers start disconnected when there are no local sessions', () => {
  const list = oauth.accounts()
  assert.deepEqual(list.map((a) => a.provider), ['grok', 'chatgpt', 'claude'])
  assert.ok(list.every((a) => !a.connected))
  assert.deepEqual(oauth.detectLocalSessions().claude, { available: false, label: undefined })
  assert.throws(() => oauth.importLocal('claude'), /No local claude session/)
})

test('local sessions are detected from the (sandboxed) home folder and imported', () => {
  const home = process.env.USERPROFILE!
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok', subscriptionType: 'pro' } }))
  assert.equal(oauth.detectLocalSessions().claude.available, true)
  const creds = oauth.importLocal('claude')
  assert.equal(creds.label, 'Claude pro')
  assert.equal(oauth.accounts().find((a) => a.provider === 'claude')?.connected, true)
  oauth.disconnect('claude')
  assert.equal(store.loadCreds('claude'), null)
})

test('saveApiKey labels keys per provider', () => {
  assert.equal(oauth.saveApiKey('claude', '  sk-ant  ').label, 'Anthropic API key')
  assert.equal(store.loadCreds('claude')?.apiKey, 'sk-ant')
  assert.equal(oauth.saveApiKey('grok', 'xai').label, 'xAI API key')
  assert.equal(oauth.saveApiKey('chatgpt', 'sk').label, 'OpenAI API key')
  for (const p of ['claude', 'grok', 'chatgpt']) oauth.disconnect(p)
})

test('a keyless custom endpoint is connected and becomes the active provider', () => {
  const { accounts, settings } = oauth.addEndpoint(endpoint())
  assert.equal(settings.aiProvider, 'custom-fake')
  assert.equal(settings.aiModels['custom-fake'], 'fake-small')
  const row = accounts.find((a) => a.provider === 'custom-fake')
  assert.equal(row?.connected, true)
  assert.equal(oauth.providerLabel('custom-fake'), 'Fake AI')
})

test('generateCommitMessage sends the diff and cleans fences and quotes', async () => {
  next = () => '```\n"feat: add login"\n```'
  const msg = await generateCommitMessage('custom-fake', 'diff --git a/x b/x\n+hello', 'ticket 42', 'fake-large')
  assert.equal(msg, 'feat: add login')
  const req = fake.requests.at(-1)!
  assert.equal(req.body.model, 'fake-large')
  assert.equal(req.auth, undefined)
  assert.equal(req.body.messages?.[0].role, 'system')
  assert.match(req.body.messages?.[1].content ?? '', /ticket 42[\s\S]*\+hello/)
})

test('generateCommitMessage keeps quotes that belong to the message', async () => {
  next = () => "fix: rename 'master' to 'main'"
  assert.equal(await generateCommitMessage('custom-fake', '+x'), "fix: rename 'master' to 'main'")
})

test('generateCommitMessage rejects an empty diff and surfaces API errors', async () => {
  await assert.rejects(generateCommitMessage('custom-fake', '   '), /Nothing to commit/)
  next = () => ({ status: 401, error: 'bad key' })
  await assert.rejects(generateCommitMessage('custom-fake', '+x'), /bad key/)
  next = () => ''
  await assert.rejects(generateCommitMessage('custom-fake', '+x'), /empty response/)
  await assert.rejects(generateCommitMessage('grok', '+x'), /Connect Grok/)
})

test('a custom endpoint with a key sends it as a bearer token', async () => {
  oauth.addEndpoint({ ...endpoint(), id: 'custom-keyed', label: 'Keyed', needsKey: true }, 'secret-key')
  next = () => 'chore: keyed'
  assert.equal(await generateCommitMessage('custom-keyed', '+x'), 'chore: keyed')
  assert.equal(fake.requests.at(-1)!.auth, 'Bearer secret-key')
  oauth.removeEndpoint('custom-keyed')
  assert.equal(store.getSettings().aiProvider, 'custom-fake')
  assert.ok(!store.getSettings().aiEndpoints.some((e: { id: string }) => e.id === 'custom-keyed'))
})

test('listProviderModels reads /models, caches, and falls back on errors', async () => {
  const live = await listProviderModels('custom-fake', true)
  assert.deepEqual(live.models.map((m) => m.id), ['fake-large', 'fake-small'])
  assert.equal(live.live, true)
  const builtin = await listProviderModels('claude', true)
  assert.equal(builtin.live, false)
  assert.ok(builtin.models.length > 0)
  assert.ok(builtin.error)
})

test('analyzeRepository groups changes using the AI plan', async () => {
  const repo = makeRepo('analyze', { 'src/app.ts': 'export const a = 1\n', 'README.md': '# r\n' })
  write(repo, 'src/app.ts', 'export const a = 2\n')
  write(repo, 'src/util.ts', 'export const u = 1\n')
  write(repo, 'README.md', '# readme\n')
  next = (req) => {
    const system = req.body.messages?.[0].content ?? ''
    if (/review a proposed sequence/i.test(system)) {
      return JSON.stringify({ summary: 'Reviewed.', commits: [
        { subject: 'feat: app and util', body: '', files: ['src/app.ts', 'src/util.ts'], rationale: 'code' },
        { subject: 'docs: readme', body: '', files: ['README.md'], rationale: 'docs' }
      ] })
    }
    return JSON.stringify({ summary: 'Two things.', commits: [
      { subject: 'feat: app', files: ['src/app.ts', 'src/util.ts'], rationale: 'code' },
      { subject: 'docs: readme', files: ['README.md'], rationale: 'docs' }
    ] })
  }
  const plan = await analyzeRepository('custom-fake', repo)
  assert.equal(plan.commits.length, 2)
  assert.deepEqual(plan.commits.flatMap((c) => c.files).sort(), ['README.md', 'src/app.ts', 'src/util.ts'])
})

test('analyzeRepository falls back to folder grouping when the AI fails, and scopes to staged', async () => {
  const repo = makeRepo('analyze-fallback', { 'a/x.txt': 'x\n', 'b/y.txt': 'y\n' })
  write(repo, 'a/x.txt', 'x2\n')
  write(repo, 'b/y.txt', 'y2\n')
  next = () => ({ status: 500, error: 'boom' })
  const plan = await analyzeRepository('custom-fake', repo)
  assert.match(plan.summary, /AI grouping was not used \(boom\)/)
  assert.equal(plan.commits.length, 2)
  await assert.rejects(analyzeRepository('custom-fake', repo, undefined, 'staged'), /No staged changes/)
  commitAll(repo, 'clean')
  await assert.rejects(analyzeRepository('custom-fake', repo), /No local changes/)
})

test('analyzeWorkspaces groups repos with AI and validates input', async () => {
  const repos = [
    { path: 'D:/code/shop/web', name: 'web' },
    { path: 'D:/code/shop/api', name: 'api' },
    { path: 'D:/notes', name: 'notes' }
  ]
  await assert.rejects(analyzeWorkspaces('custom-fake', repos.slice(0, 1)), /at least two/)
  next = () => JSON.stringify({ summary: 'Shop.', workspaces: [{ name: 'Shop', repos: ['web', 'D:/code/shop/api'], rationale: 'same product' }] })
  const result = await analyzeWorkspaces('custom-fake', repos)
  assert.deepEqual(result.workspaces[0].repos, ['D:/code/shop/web', 'D:/code/shop/api'])
})

test('openProviderConsole opens the provider key page', async () => {
  await oauth.openProviderConsole('claude')
  assert.match(calls.openExternal.at(-1) ?? '', /^https:\/\//)
})

test('ensureAiProvider replaces the retired "free" provider', () => {
  store.patchSettings({ aiProvider: 'free' })
  assert.notEqual(oauth.ensureAiProvider().aiProvider, 'free')
})

test('AI commit text follows the app language unless a language is pinned', async () => {
  const systemOf = () => fake.requests.at(-1)!.body.messages?.[0].content ?? ''

  // auto + Chinese UI => Chinese commit messages, with Conventional Commit types kept in English
  store.patchSettings({ locale: 'zh-CN', aiMessageLanguage: 'auto' })
  next = () => 'feat: 支持中文提交信息'
  assert.equal(await generateCommitMessage('custom-fake', '+x'), 'feat: 支持中文提交信息')
  assert.match(systemOf(), /Simplified Chinese/)

  // an explicit pin wins over the UI language, in both directions
  store.patchSettings({ aiMessageLanguage: 'en' })
  next = () => 'feat: english message'
  assert.equal(await generateCommitMessage('custom-fake', '+x'), 'feat: english message')
  assert.match(systemOf(), /in English/)

  store.patchSettings({ locale: 'en', aiMessageLanguage: 'zh-CN' })
  next = () => 'feat: 中文'
  await generateCommitMessage('custom-fake', '+x')
  assert.match(systemOf(), /Simplified Chinese/)

  // auto + English UI => English again
  store.patchSettings({ aiMessageLanguage: 'auto' })
  await generateCommitMessage('custom-fake', '+x')
  assert.match(systemOf(), /in English/)
})

test('commit analysis and review both use the message language', async () => {
  const repo = makeRepo('analyze-language', {
    'src/app.ts': 'export const a = 1\n',
    'src/util.ts': 'export const u = 1\n'
  })
  write(repo, 'src/app.ts', 'export const a = 2\n')
  write(repo, 'src/util.ts', 'export const u = 2\n')
  store.patchSettings({ locale: 'zh-CN', aiMessageLanguage: 'auto' })
  next = (req) => {
    const system = req.body.messages?.[0].content ?? ''
    const commits = [
      { subject: 'feat: 更新 a', body: '', files: ['src/app.ts'], rationale: '代码调整' },
      { subject: 'feat: 更新 util', body: '', files: ['src/util.ts'], rationale: '代码调整' }
    ]
    if (/review a proposed sequence/i.test(system)) return JSON.stringify({ summary: '已复查。', commits })
    return JSON.stringify({ summary: '两处更新。', commits })
  }
  const plan = await analyzeRepository('custom-fake', repo)
  assert.deepEqual(plan.commits.map((commit) => commit.subject), ['feat: 更新 a', 'feat: 更新 util'])
  const systems = fake.requests.slice(-2).map((request) => request.body.messages?.[0].content ?? '')
  assert.match(systems[0], /split uncommitted Git changes[\s\S]*Simplified Chinese/)
  assert.match(systems[1], /review a proposed sequence[\s\S]*Simplified Chinese/)
  store.patchSettings({ locale: 'en', aiMessageLanguage: 'auto' })
})
