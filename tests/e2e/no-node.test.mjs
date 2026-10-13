// Spoon is installed on machines without Node.js. Features must not depend on `node` being on PATH.
import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, dialogBox, launch, sandbox, subjects, view, writeFile } from './harness.mjs'

let box, ui, page, repo

before(async () => {
  box = sandbox()
  repo = box.repo('no-node')
  for (let i = 1; i <= 22; i++) {
    writeFile(repo, `f${i}.txt`, `${i}\n`)
    commitAll(repo, `commit ${i}`)
  }
  const PATH = (process.env.PATH ?? '')
    .split(';')
    .filter((dir) => dir && !existsSync(join(dir, 'node.exe')))
    .join(';')
  ui = await launch(box, { open: [repo], env: { PATH, Path: PATH } })
  page = ui.page
  await view(page, 'History')
})
afterEach((t) => ui?.recover(t))
after(async () => {
  await ui?.close()
  box?.cleanup()
})

test('interactive rebase works without Node.js on PATH', async () => {
  await page.getByRole('button', { name: 'Interactive Rebase', exact: true }).click()
  const dialog = dialogBox(page, 'Interactive rebase')
  await dialog.locator('.rebase-item').first().waitFor()
  await dialog.locator('.rebase-item').filter({ hasText: 'commit 22' }).locator('select').selectOption('drop')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  await ui.until(
    async () => !subjects(repo).includes('commit 22') || (await ui.errors()).length > 0 || ui.pageErrors.length > 0,
    'rebase finished',
    30_000
  )
  assert.deepEqual([...(await ui.errors()), ...ui.pageErrors], [])
  assert.equal(subjects(repo)[0], 'commit 21')
})
