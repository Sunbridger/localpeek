import { app, BrowserWindow } from 'electron'
import { APP_NAME } from '../shared/appInfo'
import { envValue } from './env'
import { registerIpc } from './ipc'
import { DbManager } from './manager'
import { isSupportedPlatform } from './platform'
import { createWindow } from './window'

// 统一 userData 目录名（开发与打包一致）
app.setName(APP_NAME)

if (!isSupportedPlatform()) {
  console.warn('[LocalPeek] 当前平台尚未正式支持，进程发现与启动功能可能不可用')
}

const manager = new DbManager()

if (envValue('SMOKE') === '1') {
  app.whenReady().then(async () => {
    try {
      const { runSmoke } = await import('./smoke')
      await runSmoke(manager)
    } catch (error) {
      console.error('[localpeek:smoke] failed', error)
      process.exitCode = 1
    } finally {
      app.quit()
    }
  })
} else if (envValue('CAPTURE')) {
  app.whenReady().then(async () => {
    try {
      const { runCapture } = await import('./capture')
      await runCapture(manager)
    } catch (error) {
      console.error('[localpeek:capture] failed', error)
      process.exitCode = 1
      app.quit()
    }
  })
} else {
  app.whenReady().then(() => {
    registerIpc(manager)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
