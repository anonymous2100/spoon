import { EventEmitter } from 'node:events'

// Tests drive the update flow by replacing `autoUpdater.checkForUpdates` and emitting events.
const autoUpdater = Object.assign(new EventEmitter(), {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowDowngrade: false,
  allowPrerelease: false,
  logger: null,
  installs: 0,
  setFeedURL() {},
  async checkForUpdates() {
    return null
  },
  quitAndInstall() {
    autoUpdater.installs++
  }
})

export { autoUpdater }
export default { autoUpdater }
