// Main-process services: "Open with" launchers, the PowerShell command runner,
// the repo overview cache and the auto-updater state machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { sandboxDir } from '../support/repo.ts'
import { app, calls } from '../support/electron-stub.mjs'
import { autoUpdater } from '../support/electron-updater-stub.mjs'
import * as store from '../../src/main/store.ts'
import * as launchers from '../../src/main/launchers.ts'
import * as records from '../../src/main/repo-cache.ts'
import * as updater from '../../src/main/updater.ts'
import { encodedCommand, runCommand } from '../../src/main/command.ts'
import { launcherById } from '../../src/shared/launchers.ts'

/**
 * A folder on PATH with a fake `code.cmd` laid out like the real VS Code shim
 * ("%~dp0<exe>" "%~dp0<cli.js>" %*). The "exe" is node itself; cli.js records its arguments.
 */
function fakeEditor() {
  const bin = sandboxDir('bin-')
  const out = join(bin, 'args.txt')
  const exe = join(bin, 'FakeEditor.exe')
  try {
    linkSync(process.execPath, exe)
  } catch {
    copyFileSync(process.execPath, exe)
  }
  mkdirSync(join(bin, 'resources'))
  writeFileSync(join(bin, 'resources', 'cli.js'), `require('fs').appendFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)) + '\\n')`)
  writeFileSync(join(bin, 'code.cmd'), '@echo off\r\n"%~dp0FakeEditor.exe" "%~dp0resources\\cli.js" %*\r\n')
  return { bin, out }
}

const lastArgs = async (out: string): Promise<string[]> => JSON.parse((await waitForFile(out)).trim().split('\n').at(-1)!)

function withPath<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.PATH
  process.env.PATH = `${dir};${original}`
  launchers.clearLauncherCache()
  return fn().finally(() => {
    process.env.PATH = original
    launchers.clearLauncherCache()
  })
}

async function waitForFile(file: string, ms = 8000): Promise<string> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8')
      if (text) return text
    }
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${file}`)
}

test('listLaunchers detects tools on PATH and always offers terminal and explorer', async () => {
  const { bin } = fakeEditor()
  await withPath(bin, async () => {
    const { launchers: list, defaultId } = await launchers.listLaunchers(true)
    const by = Object.fromEntries(list.map((l) => [l.id, l]))
    assert.equal(by.code.available, true)
    assert.equal(by.code.command, 'code')
    assert.equal(by.terminal.available, true)
    assert.equal(by.explorer.available, true)
    assert.ok(list.find((l) => l.available && l.kind === 'ide'))
    assert.ok(defaultId)
  })
})

test('resolveDefaultId honours the saved default only when it is available', () => {
  store.patchSettings({ defaultLauncher: 'zed' })
  const list = [
    { id: 'zed', kind: 'ide', available: false },
    { id: 'code', kind: 'ide', available: true },
    { id: 'explorer', kind: 'system', available: true }
  ] as never
  assert.equal(launchers.resolveDefaultId(list), 'code')
  store.patchSettings({ defaultLauncher: 'code' })
  assert.equal(launchers.resolveDefaultId(list), 'code')
  assert.equal(launchers.resolveDefaultId([{ id: 'explorer', kind: 'system', available: true }] as never), 'explorer')
})

test('openWith: explorer uses the shell, missing folders and unknown launchers fail', async () => {
  const dir = sandboxDir('open-')
  assert.equal(await launchers.openWith(dir, 'explorer'), launcherById('explorer')!.label)
  assert.equal(calls.openPath.at(-1), dir)
  await assert.rejects(launchers.openWith(join(dir, 'missing'), 'explorer'), /no longer exists/)
  await assert.rejects(launchers.openWith(dir, 'does-not-exist'), /Unknown launcher/)
})

test('openWith passes a folder with special characters to the IDE as one argument', async () => {
  const { bin, out } = fakeEditor()
  const folder = join(sandboxDir('special-'), 'R&D')
  mkdirSync(folder)
  await withPath(bin, async () => {
    await launchers.openWith(folder, 'code')
    const args = await lastArgs(out)
    assert.deepEqual(args, [folder])
  })
})

test('openFileAt opens the editor at file:line', async () => {
  const { bin, out } = fakeEditor()
  const repo = sandboxDir('repo-')
  const file = join(repo, 'a b.ts')
  writeFileSync(file, 'x')
  await withPath(bin, async () => {
    store.patchSettings({ defaultLauncher: 'code' })
    assert.equal(await launchers.openFileAt(repo, file, 7.9), 'VS Code')
    const args = await lastArgs(out)
    assert.deepEqual(args, ['--goto', `${file}:7:1`])
  })
  await assert.rejects(launchers.openFileAt(repo, join(repo, 'missing.ts')), /no longer exists/)
})

test('encodedCommand keeps arguments as data, never as PowerShell code', () => {
  const script = Buffer.from(encodedCommand('tool', ['$(evil)', "a'b"], 'in'), 'base64').toString('utf16le')
  assert.ok(!script.includes('$(evil)'))
  assert.match(script, /ConvertFrom-Json/)
})

test('runCommand returns stdout, reports failures and honours abort', async () => {
  const where = await runCommand('where.exe', ['git'], { cwd: process.cwd() })
  assert.match(where, /git/i)
  await assert.rejects(runCommand('where.exe', ['definitely-not-a-command-xyz'], { cwd: process.cwd() }))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runCommand('where.exe', ['git'], { cwd: process.cwd(), signal: controller.signal }), /canceled/)
})

test('repo-cache remembers overviews and activity per stamp and persists on flush', () => {
  const overview = { path: 'C:/R', name: 'R', exists: true } as never
  records.saveOverview('C:/R', 'stamp-1', overview)
  assert.equal(records.recallOverview('c:/r', 'stamp-1'), overview)
  assert.equal(records.recallOverview('C:/R', 'stamp-2'), null)
  records.saveActivity('C:/R', 's', 30, 'me', { '2026-1-1': 2 })
  assert.deepEqual(records.recallActivity('C:/R', 's', 30, 'me'), { '2026-1-1': 2 })
  assert.equal(records.recallActivity('C:/R', 's', 90, 'me'), null)
  assert.equal(records.recallActivity('C:/R', 's', 30, 'you'), null)
  records.saveActivity('C:/R', 's', 10, 'me', {})
  assert.deepEqual(records.recallActivity('C:/R', 's', 30, 'me'), { '2026-1-1': 2 }, 'a shorter span does not replace a longer one')
  records.flush()
  const file = JSON.parse(readFileSync(join(app.getPath('userData'), 'repo-records.json'), 'utf8'))
  assert.ok(Object.keys(file.overview).length >= 1)
  records.forget('C:/R')
  assert.equal(records.recallOverview('C:/R', 'stamp-1'), null)
  records.flush()
})

test('updater: disabled in dev builds', async () => {
  const states: string[] = []
  updater.initUpdater((s) => states.push(s.status), true)
  assert.equal(updater.current().status, 'disabled')
  assert.equal((await updater.check()).status, 'disabled')
})

test('updater: packaged flow goes available → downloading → ready → install', async () => {
  app.isPackaged = true
  try {
    const states: string[] = []
    updater.initUpdater((s) => states.push(s.status), false)
    assert.equal(updater.current().status, 'disabled')
    autoUpdater.checkForUpdates = async () => {
      autoUpdater.emit('checking-for-update')
      autoUpdater.emit('update-available', { version: '9.9.9', releaseNotes: '<p>New <b>stuff</b></p>' })
      autoUpdater.emit('download-progress', { percent: 41.6 })
      return null
    }
    let s = await updater.check()
    assert.equal(s.status, 'downloading')
    assert.equal(s.percent, 42)
    assert.equal(s.version, '9.9.9')
    assert.equal(s.notes, 'New stuff')
    autoUpdater.emit('update-downloaded', { version: '9.9.9' })
    s = updater.current()
    assert.equal(s.status, 'ready')
    updater.install()
    await sleep(10)
    assert.equal(autoUpdater.installs, 1)
  } finally {
    app.isPackaged = false
  }
})

test('updater: a missing latest.yml counts as "no update", other errors are reported', async () => {
  app.isPackaged = true
  try {
    updater.initUpdater(() => undefined, false)
    autoUpdater.emit('update-not-available')
    autoUpdater.checkForUpdates = async () => {
      throw new Error('Cannot find latest.yml in the latest release artifacts')
    }
    assert.equal((await updater.check()).status, 'none')
    autoUpdater.checkForUpdates = async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED\nmore')
    }
    const s = await updater.check()
    assert.equal(s.status, 'error')
    assert.equal(s.error, 'net::ERR_INTERNET_DISCONNECTED')
  } finally {
    app.isPackaged = false
  }
})
