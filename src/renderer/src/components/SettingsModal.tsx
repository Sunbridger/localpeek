import { useEffect, useState, type ReactNode } from 'react'
import { App, Button, Modal, Popconfirm, Progress, Segmented } from 'antd'
import {
  BgColorsOutlined,
  CopyOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  SyncOutlined
} from '@ant-design/icons'
import type { AppSettings } from '../../../shared/settings'
import type { AppPaths, ThemeMode, WebAppInfo } from '../../../shared/types'
import type {
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateProgress
} from '../../../shared/update'
import { api } from '../api'
import { cleanError, copyText } from '../utils'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function plainReleaseNotes(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .trim()
}

type SettingsSection = 'appearance' | 'update' | 'history' | 'data'

interface SettingsModalProps {
  open: boolean
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  onClose: () => void
  onWebAppsUpdated: (apps: WebAppInfo[]) => void
}

export default function SettingsModal({
  open,
  themeMode,
  onThemeModeChange,
  onClose,
  onWebAppsUpdated
}: SettingsModalProps) {
  const { message, modal } = App.useApp()
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [checkedUpdate, setCheckedUpdate] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState<UpdateDownloadResult | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [installing, setInstalling] = useState(false)
  const [section, setSection] = useState<SettingsSection>('appearance')

  const checkUpdate = async (manual: boolean): Promise<void> => {
    setCheckingUpdate(true)
    if (manual) setUpdateError(null)
    try {
      const result = await api.updates.check()
      setUpdate(result)
      setCheckedUpdate(true)
      setDownloaded((previous) =>
        previous && previous.version === result.latestVersion ? previous : null
      )
      if (manual && !result.hasUpdate) message.success('当前已是最新版本')
    } catch (error) {
      if (manual) setUpdateError(cleanError(error))
    } finally {
      setCheckingUpdate(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setCheckedUpdate(false)
    setUpdateError(null)
    Promise.all([api.paths(), api.settings()])
      .then(([nextPaths, nextSettings]) => {
        setPaths(nextPaths)
        setSettings(nextSettings)
      })
      .catch(() => {})
    void checkUpdate(false)
    return api.updates.onProgress((next) => setProgress(next))
  }, [open])

  const install = async (): Promise<void> => {
    setInstalling(true)
    try {
      await api.updates.install()
    } catch (error) {
      setInstalling(false)
      message.error(cleanError(error))
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    setDownloading(true)
    setProgress({ phase: 'downloading', received: 0, total: update?.asset?.size ?? null })
    try {
      const result = await api.updates.download()
      setDownloaded(result)
      if (result.canAutoInstall) {
        modal.confirm({
          title: `v${result.version} 已下载`,
          content: '应用会退出，替换为新版本后自动重启。现在安装吗？',
          okText: '立即安装',
          cancelText: '稍后',
          onOk: () => install()
        })
      } else {
        message.success('安装包已打开，请将 LocalPeek 拖入 Applications 完成更新')
      }
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }

  const clearHistory = async (): Promise<void> => {
    try {
      const apps = await api.web.clearHistory()
      onWebAppsUpdated(apps)
      message.success('已清除 Web 端口历史')
    } catch (error) {
      message.error(cleanError(error))
    }
  }

  const copyPath = async (text: string): Promise<void> => {
    if (!text) return
    try {
      await copyText(text)
      message.success('已复制路径')
    } catch (error) {
      message.error(cleanError(error))
    }
  }

  const navItem = (
    key: SettingsSection,
    label: string,
    icon: ReactNode
  ): ReactNode => (
    <button
      type="button"
      className={`settings-nav-item${section === key ? ' active' : ''}`}
      onClick={() => setSection(key)}
      aria-current={section === key ? 'page' : undefined}
    >
      {icon}
      <span>{label}</span>
      {key === 'update' && update?.hasUpdate ? <span className="settings-nav-dot" /> : null}
    </button>
  )

  return (
    <Modal
      open={open}
      title="设置"
      footer={null}
      width={760}
      centered
      className="settings-modal"
      styles={{ body: { padding: 0, overflow: 'hidden' } }}
      onCancel={onClose}
    >
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="设置分类">
          {navItem('appearance', '外观', <BgColorsOutlined />)}
          {navItem('update', '版本与更新', <SyncOutlined />)}
          {navItem('history', 'Web 端口历史', <HistoryOutlined />)}
          {navItem('data', '本地数据', <DatabaseOutlined />)}
          <div className="settings-nav-footer">
            <span>LocalPeek</span>
            <span className="mono">v{paths?.version ?? '…'}</span>
          </div>
        </nav>

        <section className="settings-content">
          {section === 'appearance' ? (
            <div className="settings-pane">
              <h2 className="settings-pane-title">外观</h2>
              <p className="settings-pane-sub">选择界面配色。设置保存在本机，重启后保持。</p>
              <div className="settings-section">
                <div className="settings-label">主题</div>
                <Segmented
                  block
                  value={themeMode}
                  onChange={(value) => onThemeModeChange(String(value) as ThemeMode)}
                  options={[
                    { label: '跟随系统', value: 'system' },
                    { label: '浅色', value: 'light' },
                    { label: '深色', value: 'dark' }
                  ]}
                />
                <div className="settings-hint">
                  选择「跟随系统」时会随系统深浅色自动切换；设置保存在本机。
                </div>
              </div>
            </div>
          ) : null}

          {section === 'update' ? (
            <div className="settings-pane">
              <h2 className="settings-pane-title">版本与更新</h2>
              <p className="settings-pane-sub">
                检查 GitHub Releases 上的新版本。更新不会影响本机配置与凭据。
              </p>
              <div className="settings-update-row">
                <span>
                  当前版本 <span className="mono">v{paths?.version ?? '…'}</span>
                </span>
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={checkingUpdate}
                  onClick={() => void checkUpdate(true)}
                >
                  检查更新
                </Button>
              </div>

              {checkedUpdate && update && !update.hasUpdate && !checkingUpdate ? (
                <div className="settings-hint">当前已是最新版本。</div>
              ) : null}

              {update?.hasUpdate ? (
                <div className="settings-update-card">
                  <div className="settings-update-title">
                    发现新版本 <span className="mono">v{update.latestVersion}</span>
                    {update.publishedAt ? (
                      <span className="settings-update-date">
                        {new Date(update.publishedAt).toLocaleDateString('zh-CN')}
                      </span>
                    ) : null}
                  </div>
                  {update.releaseNotes ? (
                    <div className="settings-update-notes">{plainReleaseNotes(update.releaseNotes)}</div>
                  ) : null}
                  {progress ? (
                    <div className="settings-update-progress">
                      <Progress
                        percent={
                          progress.total
                            ? Math.min(
                                100,
                                Math.round((progress.received / progress.total) * 100)
                              )
                            : 0
                        }
                        size="small"
                        showInfo={false}
                        status="active"
                      />
                      <span>
                        {progress.phase === 'preparing'
                          ? '正在准备安装包…'
                          : `正在下载 ${formatBytes(progress.received)}${
                              progress.total ? ` / ${formatBytes(progress.total)}` : ''
                            }`}
                      </span>
                    </div>
                  ) : null}
                  <div className="settings-update-actions">
                    {downloaded?.canAutoInstall ? (
                      <Button
                        type="primary"
                        size="small"
                        loading={installing}
                        onClick={() => void install()}
                      >
                        重启并安装
                      </Button>
                    ) : (
                      <Button
                        type="primary"
                        size="small"
                        loading={downloading}
                        disabled={!update.asset}
                        onClick={() => void downloadUpdate()}
                      >
                        {downloading ? '下载中…' : '下载并安装'}
                      </Button>
                    )}
                    {downloaded?.canAutoInstall ? (
                      <Button
                        size="small"
                        onClick={() => {
                          void api.updates.openDownloaded().catch((error) => {
                            message.error(cleanError(error))
                          })
                        }}
                      >
                        打开安装包
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => void api.openExternal(update.releaseUrl)}>
                      发布说明
                    </Button>
                  </div>
                  <div className="settings-hint">
                    更新包来自 GitHub Releases。安装时会退出并替换当前应用，配置与凭据不受影响。
                  </div>
                </div>
              ) : null}

              {updateError ? <div className="settings-hint">{updateError}</div> : null}
              {update?.hasUpdate && !update.asset ? (
                <div className="settings-hint">该版本没有可用的 macOS arm64 安装包。</div>
              ) : null}
            </div>
          ) : null}

          {section === 'history' ? (
            <div className="settings-pane">
              <h2 className="settings-pane-title">Web 端口历史</h2>
              <p className="settings-pane-sub">
                离线端口保留最近记录，用于一键重启；在线端口会在下次扫描时重新记录。
              </p>
              <div className="settings-history-card">
                <div>
                  <div className="settings-label">
                    保留最近 {settings?.webHistoryLimit ?? 50} 条离线记录
                  </div>
                  <div className="settings-hint">
                    清除历史不会影响正在运行的服务，只删除离线的重启记录。
                  </div>
                </div>
                <Popconfirm
                  title="清除所有 Web 端口历史？"
                  description="仅清除离线历史记录，不影响正在运行的服务。"
                  okText="清除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={clearHistory}
                >
                  <Button danger size="small">
                    清除历史
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ) : null}

          {section === 'data' ? (
            <div className="settings-pane">
              <h2 className="settings-pane-title">本地数据</h2>
              <p className="settings-pane-sub">
                配置、凭据与启动日志都保存在本机。路径可直接复制。
              </p>
              <div className="settings-section">
                <div className="settings-label">文件位置</div>
                <div className="settings-path-row">
                  <span className="settings-path-label">配置文件</span>
                  <span className="settings-path mono">{paths?.configFile ?? '读取中…'}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label="复制配置文件路径"
                    disabled={!paths?.configFile}
                    onClick={() => void copyPath(paths?.configFile ?? '')}
                  />
                </div>
                <div className="settings-path-row">
                  <span className="settings-path-label">启动日志</span>
                  <span className="settings-path mono">
                    {paths ? `${paths.logsDir}/web-<端口>.log` : '读取中…'}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label="复制启动日志路径"
                    disabled={!paths}
                    onClick={() =>
                      void copyPath(paths ? `${paths.logsDir}/web-<端口>.log` : '')
                    }
                  />
                </div>
                <div className="settings-path-row">
                  <span className="settings-path-label">数据目录</span>
                  <span className="settings-path mono">{paths?.userData ?? '读取中…'}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label="复制数据目录路径"
                    disabled={!paths?.userData}
                    onClick={() => void copyPath(paths?.userData ?? '')}
                  />
                </div>
              </div>
              <div className="settings-hint">
                其它扫描端口、Redis db 数等可在配置文件的 settings 中调整，重启后生效。
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Modal>
  )
}
