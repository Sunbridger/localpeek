import { useEffect, useState } from 'react'
import { App, Button, Divider, Input, Modal, Popconfirm, Segmented } from 'antd'
import {
  parseProjectRootsInput,
  type AppSettings
} from '../../../shared/settings'
import type { AppPaths, ThemeMode, WebAppInfo } from '../../../shared/types'
import { api } from '../api'
import { cleanError } from '../utils'

interface SettingsModalProps {
  open: boolean
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  onClose: () => void
  onWebAppsUpdated: (apps: WebAppInfo[]) => void
  onRescan: () => Promise<void>
}

export default function SettingsModal({
  open,
  themeMode,
  onThemeModeChange,
  onClose,
  onWebAppsUpdated,
  onRescan
}: SettingsModalProps) {
  const { message } = App.useApp()
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [rootsInput, setRootsInput] = useState('')
  const [savingRoots, setSavingRoots] = useState(false)

  useEffect(() => {
    if (!open) return
    Promise.all([api.paths(), api.settings()])
      .then(([nextPaths, nextSettings]) => {
        setPaths(nextPaths)
        setSettings(nextSettings)
        setRootsInput(nextSettings.projectRoots.join(', '))
      })
      .catch(() => {})
  }, [open])

  const saveRoots = async (): Promise<void> => {
    const roots = parseProjectRootsInput(rootsInput)
    if (roots.length === 0) {
      message.error('至少填写一个项目根目录')
      return
    }
    setSavingRoots(true)
    try {
      const next = await api.updateSettings({ projectRoots: roots })
      setSettings(next)
      setRootsInput(next.projectRoots.join(', '))
      message.success('项目根目录已保存')
      await onRescan()
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setSavingRoots(false)
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

  return (
    <Modal
      open={open}
      title="设置"
      footer={null}
      width={560}
      className="settings-modal"
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
      onCancel={onClose}
    >
      <div className="settings-section">
        <div className="settings-label">外观</div>
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

      <Divider />

      <div className="settings-section">
        <div className="settings-label">项目识别</div>
        <div className="settings-inline">
          <Input
            value={rootsInput}
            onChange={(event) => setRootsInput(event.target.value)}
            placeholder="mycode, code"
            onPressEnter={saveRoots}
          />
          <Button size="small" type="primary" loading={savingRoots} onClick={saveRoots}>
            保存
          </Button>
        </div>
        <div className="settings-hint">
          项目名会从 /&lt;根目录&gt;/&lt;项目&gt;/ 中提取，例如 /mycode/demo/ → demo。
          多个用逗号分隔；保存后会重新扫描。
        </div>
      </div>

      <Divider />

      <div className="settings-section">
        <div className="settings-label">Web 端口历史</div>
        <div className="settings-hint">
          离线端口保留最近 {settings?.webHistoryLimit ?? 50} 条记录，用于一键重启；
          在线端口下次扫描时会重新记录。
        </div>
        <div>
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

      <Divider />

      <div className="settings-section">
        <div className="settings-label">本地数据</div>
        <div className="settings-hint mono">
          配置与凭据：{paths?.configFile ?? '读取中…'}
        </div>
        <div className="settings-hint mono">
          启动日志：{paths ? `${paths.logsDir}/web-<端口>.log` : '读取中…'}
        </div>
        <div className="settings-hint">
          其它扫描端口、Redis db 数等可在配置文件 {paths?.configFile ?? ''} 的 settings
          中调整，重启后生效。凭据以本机用户可读的明文保存。
        </div>
      </div>
    </Modal>
  )
}
