// AI features end to end against a local fake OpenAI-compatible server:
// custom endpoint setup, AI commit message, Analyze + planned commits, split & commit,
// model picker and AI workspaces.
import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startFakeAi } from '../support/fake-ai.ts'
import { git, launch, sandbox, subjects, toolbar, view, writeFile } from './harness.mjs'

let box, ui, page, repo, other, fake
let reply = () => 'feat: message from fake AI'
const settingsFile = () => JSON.parse(readFileSync(join(box.data, 'spoon.json'), 'utf8'))
const prefs = () => page.locator('.dialog.prefs')
const commitBox = () => page.getByPlaceholder('Commit message · Ctrl+Enter to commit')

async function openPrefs(tab) {
  if (!(await prefs().count())) await toolbar(page, 'settings')
  await prefs().locator('nav.rail').getByRole('button', { name: tab, exact: true }).click()
}

async function closePrefs() {
  await prefs().getByRole('button', { name: 'Done', exact: true }).click()
  await prefs().waitFor({ state: 'detached' })
}

function plan(files) {
  return JSON.stringify({
    summary: 'Two separate changes.',
    commits: [
      { subject: 'feat: add api', body: 'API work', files: files.filter((f) => f.startsWith('api')), rationale: 'api' },
      { subject: 'docs: update readme', body: '', files: files.filter((f) => !f.startsWith('api')), rationale: 'docs' }
    ]
  })
}

before(async () => {
  fake = await startFakeAi((req) => reply(req))
  box = sandbox()
  repo = box.repo('ai-repo', { 'README.md': '# ai\n', 'api/server.ts': 'export const port = 1\n' })
  other = box.repo('ai-other')
  ui = await launch(box, { open: [repo], repos: [other], settings: { aiProvider: 'grok' } })
  page = ui.page
  await view(page, 'Changes')
})
afterEach((t) => ui?.recover(t))
after(async () => {
  await ui?.close()
  await fake?.close()
  box?.cleanup()
})

test('without a connected AI, the AI button opens Settings → AI', async () => {
  writeFile(repo, 'README.md', '# ai v2\n')
  await toolbar(page, 'refresh')
  await page.locator('.commit-box button.primary.ai').click()
  await prefs().waitFor()
  await prefs().locator('#prefs-panel-ai').waitFor()
  await closePrefs()
})

test('a custom endpoint with an invalid URL is rejected', async () => {
  await openPrefs('AI')
  await prefs().getByRole('button', { name: 'Custom endpoint' }).click()
  await prefs().getByPlaceholder('https://openrouter.ai/api/v1').fill('ftp://nope')
  await prefs().getByRole('button', { name: 'Add custom API', exact: true }).click()
  await ui.expectError(/Base URL must start with http/)
})

test('add a custom OpenAI-compatible endpoint from Settings', async () => {
  await openPrefs('AI')
  await prefs().getByRole('button', { name: 'Custom endpoint' }).click()
  await prefs().getByPlaceholder('OpenRouter work').fill('Fake AI')
  await prefs().getByPlaceholder('https://openrouter.ai/api/v1').fill(fake.baseUrl)
  await prefs().getByPlaceholder('gpt-4o-mini').fill('fake-small')
  await prefs().getByRole('button', { name: 'Add custom API', exact: true }).click()
  await ui.until(() => settingsFile().settings.aiEndpoints?.some((e) => e.label === 'Fake AI'), 'endpoint saved')
  const id = settingsFile().settings.aiEndpoints.find((e) => e.label === 'Fake AI').id
  assert.equal(settingsFile().settings.aiProvider, id)
  await prefs().locator('.rail-item[title="Fake AI"]').waitFor()
})

test('AI button mode "Write message" fills the commit box from the staged diff', async () => {
  await openPrefs('AI')
  await prefs().getByRole('button', { name: 'Write message', exact: true }).click()
  await ui.until(() => settingsFile().settings.aiCommitMode === 'fill', 'mode saved')
  await closePrefs()
  git(repo, ['add', 'README.md'])
  await toolbar(page, 'refresh')
  reply = () => '"feat: message from fake AI"'
  await page.locator('.commit-box button.primary.ai', { hasText: 'AI message' }).click()
  await ui.until(async () => (await commitBox().inputValue()) === 'feat: message from fake AI', 'commit box filled')
  const req = fake.requests.at(-1)
  assert.match(req.body.messages[1].content, /\+# ai v2/)
  assert.equal(req.body.model, 'fake-small')
  await commitBox().fill('')
  git(repo, ['reset', '-q'])
})

test('model picker lists live models and saves the choice', async () => {
  await page.locator('.commit-box button.model-select').click()
  const list = page.getByRole('listbox', { name: 'AI models' })
  await list.getByRole('option', { name: /fake-large/ }).click()
  const id = settingsFile().settings.aiProvider
  await ui.until(() => settingsFile().settings.aiModels[id] === 'fake-large', 'model saved')
})

test('Analyze proposes commits and creates them after confirmation', async () => {
  writeFile(repo, 'api/server.ts', 'export const port = 2\n')
  await toolbar(page, 'refresh')
  reply = (req) => plan(['api/server.ts', 'README.md'].filter((f) => req.body.messages[1].content.includes(f)))
  await page.getByRole('button', { name: 'Analyze', exact: true }).click()
  const panel = page.locator('.analysis')
  await panel.locator('.plan-card').nth(1).waitFor()
  assert.match(await panel.locator('.analysis-summary').textContent(), /Two separate changes/)
  await ui.confirmNext(true)
  await panel.getByRole('button', { name: 'Create 2 commits' }).click()
  await ui.until(() => subjects(repo).slice(0, 2).join('|') === 'docs: update readme|feat: add api', 'two commits created', 30_000)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
  assert.equal(git(repo, ['show', '--name-only', '--format=', 'HEAD~1']).trim(), 'api/server.ts')
})

test('AI button mode "Split & commit" commits each planned group directly', async () => {
  await openPrefs('AI')
  await prefs().getByRole('button', { name: 'Split & commit', exact: true }).click()
  await closePrefs()
  writeFile(repo, 'api/server.ts', 'export const port = 3\n')
  writeFile(repo, 'README.md', '# ai v3\n')
  await toolbar(page, 'refresh')
  reply = (req) => plan(['api/server.ts', 'README.md'].filter((f) => req.body.messages[1].content.includes(f)))
  const before = subjects(repo).length
  await page.locator('.commit-box button.primary.ai', { hasText: 'AI commits' }).click()
  await ui.until(() => subjects(repo).length === before + 2, 'split commits created', 30_000)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
})

test('AI errors are reported to the user', async () => {
  await openPrefs('AI')
  await prefs().getByRole('button', { name: 'Write message', exact: true }).click()
  await closePrefs()
  writeFile(repo, 'README.md', '# ai v4\n')
  git(repo, ['add', 'README.md'])
  await toolbar(page, 'refresh')
  reply = () => ({ status: 429, error: 'rate limited by fake AI' })
  await page.locator('.commit-box button.primary.ai', { hasText: 'AI message' }).click()
  await ui.expectError(/rate limited by fake AI/)
})

test('Workspaces: Analyze with AI suggests workspaces and saves them', async () => {
  reply = () =>
    JSON.stringify({ summary: 'Both belong together.', workspaces: [{ name: 'AI Group', repos: ['ai-repo', 'ai-other'], rationale: 'same project' }] })
  await toolbar(page, 'workspaces')
  const dialog = page.locator('.dialog').filter({ has: page.locator('h2', { hasText: 'Workspaces' }) })
  await dialog.getByRole('button', { name: 'Analyze with AI' }).click()
  await dialog.getByText('AI Group').first().waitFor()
  await dialog.getByRole('button', { name: /Save to memory/ }).click()
  await ui.until(() => settingsFile().workspaces?.some((w) => w.name === 'AI Group' && w.repos.length === 2), 'AI workspace saved')
})

test('remove the custom endpoint', async () => {
  await openPrefs('AI')
  await prefs().locator('.rail-item[title="Fake AI"]').click()
  await prefs().getByRole('button', { name: 'Remove', exact: true }).click()
  await ui.until(() => !settingsFile().settings.aiEndpoints?.some((e) => e.label === 'Fake AI'), 'endpoint removed')
  await closePrefs()
})

test('no uncaught renderer errors', () => {
  assert.deepEqual(ui.unexpectedPageErrors(), [])
})
