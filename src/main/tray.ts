import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/appInfo'
import type { ScanResult } from '../shared/types'
import type { DbManager } from './manager'

interface TrayOptions {
  manager: DbManager
  showWindow: () => void
  hideWindow: () => void
  isWindowVisible: () => boolean
  sendNavigate: (port: number) => void
  sendOpenSettings: () => void
  quit: () => void
  rescan: () => Promise<ScanResult | null>
}

export interface TrayController {
  refresh: () => void
  destroy: () => void
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'trayTemplate.png')
    : join(__dirname, '../../build/trayTemplate.png')
}

export function createTray(options: TrayOptions): TrayController {
  const icon = nativeImage.createFromPath(trayIconPath())
  if (!icon.isEmpty()) icon.setTemplateImage(true)
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  if (icon.isEmpty()) tray.setTitle('LP')
  tray.setIgnoreDoubleClickEvents(true)

  const refresh = (): void => {
    const apps = options.manager.currentWebApps()
    const online = apps.filter((item) => item.online).length
    tray.setToolTip(`${APP_NAME} — 在线 ${online} / 历史 ${apps.length}`)
  }

  const buildMenu = (): Menu => {
    const apps = options.manager.currentWebApps()
    const online = apps
      .filter((item) => item.online)
      .sort(
        (a, b) =>
          (a.project ?? '').localeCompare(b.project ?? '') || a.port - b.port
      )
    const offline = apps.length - online.length
    const items: MenuItemConstructorOptions[] = [
      {
        label: `${APP_NAME} · 在线 ${online.length} · 离线 ${offline}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: options.isWindowVisible() ? '隐藏主窗口' : '显示主窗口',
        click: () => (options.isWindowVisible() ? options.hideWindow() : options.showWindow())
      },
      {
        label: '重新扫描',
        click: () => {
          void options.rescan().then(() => refresh())
        }
      },
      { type: 'separator' }
    ]

    if (online.length > 0) {
      items.push({ label: '在线服务', enabled: false })
      for (const app of online.slice(0, 6)) {
        items.push({
          label: `${app.project || '未识别项目'}   :${app.port}`,
          click: () => options.sendNavigate(app.port)
        })
      }
      if (online.length > 6) {
        items.push({ label: `还有 ${online.length - 6} 个…`, enabled: false })
      }
    } else {
      items.push({ label: '暂无在线 Web 服务', enabled: false })
    }

    items.push(
      { type: 'separator' },
      { label: '设置…', click: () => options.sendOpenSettings() },
      { label: `退出 ${APP_NAME}`, click: () => options.quit() }
    )
    return Menu.buildFromTemplate(items)
  }

  const openMenu = (): void => {
    tray.popUpContextMenu(buildMenu())
  }

  tray.on('click', openMenu)
  tray.on('right-click', openMenu)
  refresh()

  const timer = setInterval(refresh, 10_000)
  timer.unref()

  return {
    refresh,
    destroy: () => {
      clearInterval(timer)
      tray.destroy()
    }
  }
}
