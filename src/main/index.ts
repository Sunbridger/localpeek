import { app, BrowserWindow } from 'electron'
import { APP_NAME } from '../shared/appInfo'
import { envValue } from './env'
import { registerIpc } from './ipc'
import { DbManager } from './manager'
import { isSupportedPlatform } from './platform'
import { createTray, type TrayController } from './tray'
import { createWindow } from './window'

// 统一 userData 目录名（开发与打包一致）
app.setName(APP_NAME)

if (!isSupportedPlatform()) {
  console.warn('[LocalPeek] 当前平台尚未正式支持，进程发现与启动功能可能不可用')
}

const manager = new DbManager()
let mainWindow: BrowserWindow | null = null
let trayController: TrayController | null = null
let isQuitting = false

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    attachMainWindow(mainWindow)
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function hideMainWindow(): void {
  mainWindow?.hide()
}

function attachMainWindow(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
}

function sendToRenderer(channel: string, payload?: unknown): void {
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  const send = (): void => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

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
    mainWindow = createWindow()
    attachMainWindow(mainWindow)
    trayController = createTray({
      manager,
      showWindow: showMainWindow,
      hideWindow: hideMainWindow,
      isWindowVisible: () => Boolean(mainWindow?.isVisible()),
      sendNavigate: (port) => {
        showMainWindow()
        sendToRenderer('localpeek:navigate', port)
      },
      sendOpenSettings: () => {
        showMainWindow()
        sendToRenderer('localpeek:openSettings')
      },
      quit: () => {
        isQuitting = true
        app.quit()
      },
      rescan: async () => {
        try {
          const result = await manager.scan()
          sendToRenderer('localpeek:scanResult', result)
          trayController?.refresh()
          return result
        } catch (error) {
          console.error('[localpeek:tray] 重新扫描失败', error)
          return null
        }
      }
    })
    app.on('activate', showMainWindow)
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
