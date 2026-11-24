import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntApp, Button, Spin, Splitter, theme } from 'antd'
import {
  ContainerOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { APP_NAME, APP_SUBTITLE } from '../../shared/appInfo'
import type { InstanceMeta, ScanResult, ThemeMode, WebAppInfo } from '../../shared/types'
import appIcon from './assets/app-icon.png'
import { api } from './api'
import InstancePane from './components/InstancePane'
import ManualAddModal from './components/ManualAddModal'
import SettingsModal from './components/SettingsModal'
import MysqlDatabasePane from './components/MysqlDatabasePane'
import MysqlTablePane from './components/MysqlTablePane'
import Sidebar from './components/Sidebar'
import WebAppsPane from './components/WebAppsPane'
import Welcome from './components/Welcome'
import {
  cleanError,
  databaseKey,
  formatTime,
  instanceKey,
  parseSelection,
  webKey
} from './utils'

export default function App({
  dark,
  themeMode,
  onThemeModeChange
}: {
  dark: boolean
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}) {
  const { message } = AntApp.useApp()
  const { token } = theme.useToken()
  const [instances, setInstances] = useState<InstanceMeta[]>([])
  const [webApps, setWebApps] = useState<WebAppInfo[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<Pick<
    ScanResult,
    'scannedAt' | 'dockerAvailable'
  > | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const runScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await api.scan()
      setInstances(result.instances)
      setWebApps(result.webApps)
      setScanned({
        scannedAt: result.scannedAt,
        dockerAvailable: result.dockerAvailable
      })
      setSelectedKey((previous) => {
        const current = parseSelection(previous)
        if (!current || current.type === 'web') return previous
        return result.instances.some((instance) => instance.id === current.instanceId)
          ? previous
          : null
      })
    } catch (error) {
      message.error(`扫描失败：${cleanError(error)}`)
    } finally {
      setScanning(false)
    }
  }, [message])

  useEffect(() => {
    runScan()
  }, [runScan])

  const selection = parseSelection(selectedKey)
  const selectedInstance = useMemo(() => {
    if (!selection || selection.type === 'web') return undefined
    return instances.find((instance) => instance.id === selection.instanceId)
  }, [instances, selection])

  const sortedInstances = useMemo(
    () =>
      [...instances].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.port - b.port || a.label.localeCompare(b.label)
      ),
    [instances]
  )

  const navigate = useCallback(
    (key: string) => {
      setSelectedKey(key)
      const next = parseSelection(key)
      if (!next) return
      if (next.type === 'web') {
        setExpandedKeys((previous) =>
          previous.includes('group|web') ? previous : [...previous, 'group|web']
        )
        return
      }
      const target = instances.find((instance) => instance.id === next.instanceId)
      setExpandedKeys((previous) => {
        const keys = new Set(previous)
        if (target) keys.add(`group|${target.kind}`)
        keys.add(instanceKey(next.instanceId))
        if (next.type === 'database' || next.type === 'table') {
          keys.add(databaseKey(next.instanceId, next.database))
        }
        return [...keys]
      })
    },
    [instances]
  )

  useEffect(() => {
    const offNavigate = api.onNavigate((port) => navigate(webKey(port)))
    const offOpenSettings = api.onOpenSettings(() => setSettingsOpen(true))
    const offScanResult = api.onScanResult((result) => {
      setInstances(result.instances)
      setWebApps(result.webApps)
      setScanned({
        scannedAt: result.scannedAt,
        dockerAvailable: result.dockerAvailable
      })
      setSelectedKey((previous) => {
        const current = parseSelection(previous)
        if (!current || current.type === 'web') return previous
        return result.instances.some((instance) => instance.id === current.instanceId)
          ? previous
          : null
      })
    })
    return () => {
      offNavigate()
      offOpenSettings()
      offScanResult()
    }
  }, [navigate])

  const handleTreeSelect = useCallback((key: string) => {
    setSelectedKey(key)
  }, [])

  const handleUpdated = useCallback((updated: InstanceMeta) => {
    setInstances((previous) =>
      previous.map((instance) => (instance.id === updated.id ? updated : instance))
    )
  }, [])

  const handleRemoveManual = useCallback(
    async (instanceId: string) => {
      try {
        await api.removeManual(instanceId)
        setInstances((previous) => previous.filter((instance) => instance.id !== instanceId))
        setSelectedKey((previous) => {
          const current = parseSelection(previous)
          return current && current.type !== 'web' && current.instanceId === instanceId
            ? null
            : previous
        })
        message.success('已移除手动连接')
      } catch (error) {
        message.error(cleanError(error))
      }
    },
    [message]
  )

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedKeys((previous) =>
      previous.includes(groupKey)
        ? previous.filter((key) => key !== groupKey)
        : [...previous, groupKey]
    )
  }, [])

  const handleWebAppsUpdated = useCallback((apps: WebAppInfo[]) => {
    setWebApps(apps)
  }, [])

  const handleAdded = useCallback(
    (instance: InstanceMeta) => {
      setInstances((previous) => {
        const exists = previous.some((item) => item.id === instance.id)
        return exists
          ? previous.map((item) => (item.id === instance.id ? instance : item))
          : [...previous, instance]
      })
      navigate(instanceKey(instance.id))
    },
    [navigate]
  )

  const content = (() => {
    if (selection?.type === 'web') {
      return (
        <WebAppsPane
          webApps={webApps}
          focusPort={selection.port}
          onWebAppsUpdated={handleWebAppsUpdated}
        />
      )
    }
    if (selection?.type === 'instance' && selectedInstance) {
      return (
        <InstancePane
          key={selectedInstance.id}
          instance={selectedInstance}
          onUpdated={handleUpdated}
          onOpenDatabase={(instanceId, database) => navigate(databaseKey(instanceId, database))}
          onRescan={runScan}
          onRemoveManual={handleRemoveManual}
        />
      )
    }
    if (selection?.type === 'database' && selectedInstance) {
      if (selectedInstance.status !== 'ready') {
        return (
          <InstancePane
            key={selectedInstance.id}
            instance={selectedInstance}
            onUpdated={handleUpdated}
            onOpenDatabase={(instanceId, database) => navigate(databaseKey(instanceId, database))}
            onRescan={runScan}
            onRemoveManual={handleRemoveManual}
          />
        )
      }
      return (
        <MysqlDatabasePane
          key={selectedKey}
          instance={selectedInstance}
          database={selection.database}
        />
      )
    }
    if (selection?.type === 'table' && selectedInstance) {
      if (selectedInstance.status !== 'ready') {
        return (
          <InstancePane
            key={selectedInstance.id}
            instance={selectedInstance}
            onUpdated={handleUpdated}
            onOpenDatabase={(instanceId, database) => navigate(databaseKey(instanceId, database))}
            onRescan={runScan}
            onRemoveManual={handleRemoveManual}
          />
        )
      }
      return (
        <MysqlTablePane
          key={selectedKey}
          instance={selectedInstance}
          database={selection.database}
          table={selection.table}
        />
      )
    }
    return (
      <Welcome
        instances={instances}
        webCount={webApps.filter((app) => app.online).length}
        scannedAt={scanned?.scannedAt ?? 0}
        dockerAvailable={scanned?.dockerAvailable ?? false}
        scanning={scanning}
        onScan={runScan}
        onAdd={() => setAddOpen(true)}
      />
    )
  })()

  return (
    <div className={`app ${dark ? 'theme-dark' : 'theme-light'}`} style={{ background: token.colorBgLayout }}>
      <header
        className="app-header"
        style={{ background: token.colorBgContainer, borderColor: token.colorBorderSecondary }}
      >
        <button
          type="button"
          className="brand brand-home"
          title="回到首页"
          onClick={() => setSelectedKey(null)}
        >
          <img className="brand-logo" src={appIcon} alt={APP_NAME} />
          <div>
            <div className="brand-title">{APP_NAME}</div>
            <div className="brand-sub">{APP_SUBTITLE}</div>
          </div>
        </button>
        <div className="header-actions">
          {scanning ? (
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Spin size="small" />
              正在扫描
            </span>
          ) : scanned ? (
            <span className="muted">
              {instances.length} 个实例 · {formatTime(scanned.scannedAt)} 更新
            </span>
          ) : null}
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            添加连接
          </Button>
          <Button type="primary" icon={<ReloadOutlined />} loading={scanning} onClick={runScan}>
            重新扫描
          </Button>
        </div>
      </header>

      <div className="app-body">
        <Splitter className="main-splitter">
          <Splitter.Panel defaultSize={300} min={230} max={620} style={{ overflow: 'hidden' }}>
            <aside
              className="sidebar"
              style={{ background: token.colorBgContainer }}
            >
              <Sidebar
                instances={sortedInstances}
                webApps={webApps}
                selectedKey={selectedKey}
                expandedKeys={expandedKeys}
                onSelect={handleTreeSelect}
                onExpand={setExpandedKeys}
                onToggleGroup={toggleGroup}
                onError={(text) => message.error(text)}
              />
              <div
                className="sidebar-footer"
                style={{ borderColor: token.colorBorderSecondary }}
              >
                <span>
                  <ContainerOutlined /> Docker {scanned?.dockerAvailable ? '可用' : '不可用'}
                </span>
                <span>更新于 {formatTime(scanned?.scannedAt ?? 0)}</span>
                <div className="sidebar-footer-actions">
                  <Button
                    type="text"
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={() => setSettingsOpen(true)}
                  >
                    设置
                  </Button>
                </div>
              </div>
            </aside>
          </Splitter.Panel>

          <Splitter.Panel style={{ overflow: 'hidden' }}>
            <main className="content" style={{ background: token.colorBgLayout }}>
              {content}
            </main>
          </Splitter.Panel>
        </Splitter>
      </div>

      <ManualAddModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={handleAdded} />
      <SettingsModal
        open={settingsOpen}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        onClose={() => setSettingsOpen(false)}
        onWebAppsUpdated={handleWebAppsUpdated}
        onRescan={runScan}
      />
    </div>
  )
}
