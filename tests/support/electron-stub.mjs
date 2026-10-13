// Minimal stand-in for the `electron` module so main-process code runs under plain Node.
// Every side effect is recorded in `calls` so tests can assert on it.
import { homedir, tmpdir } from 'node:os'

export const calls = { openExternal: [], showItemInFolder: [], openPath: [], clipboard: [], dialogs: [] }

export const app = {
  isPackaged: false,
  getPath(name) {
    if (name === 'userData') return globalThis.__spoonUserData ?? process.env.SPOON_TEST_USERDATA
    if (name === 'temp') return tmpdir()
    if (name === 'home') return homedir()
    return tmpdir()
  },
  getVersion: () => '0.0.0-test',
  getName: () => 'Spoon',
  on() {},
  whenReady: () => Promise.resolve()
}

export const nativeTheme = { shouldUseDarkColors: false, themeSource: 'system', on() {} }

// Encryption off: creds are stored as plain base64, which keeps tests deterministic.
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (text) => Buffer.from(text, 'utf8'),
  decryptString: (buf) => buf.toString('utf8')
}

export const shell = {
  async openExternal(url) {
    calls.openExternal.push(url)
  },
  showItemInFolder(path) {
    calls.showItemInFolder.push(path)
  },
  async openPath(path) {
    calls.openPath.push(path)
    return ''
  }
}

export const clipboard = { writeText: (text) => calls.clipboard.push(text) }

export const dialog = {
  async showOpenDialog(_win, opts) {
    calls.dialogs.push({ type: 'open', opts })
    return { canceled: true, filePaths: [] }
  },
  async showSaveDialog(_win, opts) {
    calls.dialogs.push({ type: 'save', opts })
    return { canceled: true }
  },
  async showMessageBox(_win, opts) {
    calls.dialogs.push({ type: 'message', opts })
    return { response: 0 }
  },
  showErrorBox(title, content) {
    calls.dialogs.push({ type: 'error', title, content })
  }
}

export class BrowserWindow {
  static getAllWindows() {
    return []
  }
}

export const ipcMain = { handle() {}, on() {}, removeHandler() {} }
export const Menu = { buildFromTemplate: () => ({ popup() {} }), setApplicationMenu() {} }

export default { app, nativeTheme, safeStorage, shell, clipboard, dialog, BrowserWindow, ipcMain, Menu }
