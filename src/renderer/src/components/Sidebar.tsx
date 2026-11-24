import { useEffect, useMemo, useRef, useState } from 'react'
import { Tooltip, Tree } from 'antd'
import type { TreeDataNode } from 'antd'
import {
  DatabaseOutlined,
  GlobalOutlined,
  TableOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import type { DbKind, InstanceMeta, WebAppInfo, WebAppRole } from '../../../shared/types'
import { api } from '../api'
import {
  cleanError,
  databaseKey,
  instanceKey,
  parseSelection,
  tableKey,
  webKey
} from '../utils'

interface SidebarProps {
  instances: InstanceMeta[]
  webApps: WebAppInfo[]
  selectedKey: string | null
  expandedKeys: string[]
  onSelect: (key: string) => void
  onExpand: (keys: string[]) => void
  onToggleGroup: (key: string) => void
  onError: (message: string) => void
}

const ROLE_LABEL: Record<WebAppRole, string> = {
  frontend: '前端',
  backend: '后端',
  web: 'Web'
}

function statusText(status: InstanceMeta['status']): string {
  switch (status) {
    case 'ready':
      return '已连接'
    case 'needCredentials':
      return '需要凭据'
    case 'checking':
      return '连接中'
    default:
      return '连接失败'
  }
}

function InstanceTitle({ instance }: { instance: InstanceMeta }) {
  const viaText =
    instance.via === 'ssh' ? 'SSH 转发' : instance.via === 'local' ? '本机进程' : instance.via === 'docker' ? 'Docker' : ''
  const detail = [
    statusText(instance.status),
    viaText,
    instance.container?.image,
    instance.container?.ports,
    instance.version
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span className="tree-node">
      <Tooltip title={detail} placement="right">
        <span className={`status-dot status-${instance.status}`} />
      </Tooltip>
      <span className="tree-label">{instance.label}</span>
      <span className="tree-port">:{instance.port}</span>
    </span>
  )
}

export default function Sidebar({
  instances,
  webApps,
  selectedKey,
  expandedKeys,
  onSelect,
  onExpand,
  onToggleGroup,
  onError
}: SidebarProps) {
  const [childrenMap, setChildrenMap] = useState<Record<string, TreeDataNode[]>>({})
  const loadingRef = useRef(new Set<string>())

  const instanceById = useMemo(() => {
    const map = new Map<string, InstanceMeta>()
    for (const instance of instances) map.set(instance.id, instance)
    return map
  }, [instances])

  const buildInstanceNode = (instance: InstanceMeta): TreeDataNode => {
    const key = instanceKey(instance.id)
    const expandable = instance.kind === 'mysql' && instance.status === 'ready'
    const node: TreeDataNode = {
      key,
      title: <InstanceTitle instance={instance} />,
      isLeaf: !expandable
    }
    if (childrenMap[key]) node.children = childrenMap[key]
    return node
  }

  const treeData: TreeDataNode[] = useMemo(() => {
    const groups: Array<{ kind: DbKind; label: string }> = [
      { kind: 'mysql', label: 'MySQL' },
      { kind: 'redis', label: 'Redis' }
    ]

    const groupTitle = (
      groupKey: string,
      label: string,
      count: number,
      icon: React.ReactNode
    ) => {
      const expanded = expandedKeys.includes(groupKey)
      const kindClass =
        groupKey === 'group|mysql'
          ? 'tree-group-mysql'
          : groupKey === 'group|redis'
            ? 'tree-group-redis'
            : 'tree-group-web'
      return (
        <span
          className={`tree-group ${kindClass}${expanded ? ' tree-group-expanded' : ''}`}
          role="button"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation()
            onToggleGroup(groupKey)
          }}
        >
          <span className="tree-group-icon">{icon}</span>
          <span className="tree-group-label">{label}</span>
          <span className="tree-count">{count}</span>
        </span>
      )
    }

    const databaseGroups: TreeDataNode[] = groups.map(({ kind, label }) => {
      const groupInstances = instances.filter((instance) => instance.kind === kind)
      const children: TreeDataNode[] =
        groupInstances.length > 0
          ? groupInstances.map(buildInstanceNode)
          : [
              {
                key: `placeholder|${kind}`,
                title: <span className="muted">未发现</span>,
                disabled: true,
                selectable: false,
                isLeaf: true
              }
            ]
      return {
        key: `group|${kind}`,
        selectable: false,
        title: groupTitle(
          `group|${kind}`,
          label,
          groupInstances.length,
          kind === 'mysql' ? <DatabaseOutlined /> : <ThunderboltOutlined />
        ),
        children
      }
    })

    const webChildren: TreeDataNode[] =
      webApps.length > 0
        ? webApps.map((app) => ({
            key: webKey(app.port),
            isLeaf: true,
            title: (
              <Tooltip
                title={[
                  app.online ? '在线' : '已离线',
                  ROLE_LABEL[app.role],
                  app.title,
                  app.commandLine || app.command
                ]
                  .filter(Boolean)
                  .join(' · ')}
                placement="right"
              >
                <span className="tree-node">
                  <span
                    className={`status-dot ${app.online ? 'status-ready' : 'status-offline'}`}
                  />
                  <span className="tree-label web-project-label">
                    <span className="web-project-name">{app.project || '未识别项目'}</span>
                    <span className="mono">:{app.port}</span>
                  </span>
                  <span className={`web-role-text web-role-${app.role}`}>
                    {ROLE_LABEL[app.role]}
                  </span>
                </span>
              </Tooltip>
            )
          }))
        : [
            {
              key: 'placeholder|web',
              title: <span className="muted">暂无 Web 应用</span>,
              disabled: true,
              selectable: false,
              isLeaf: true
            }
          ]

    const webGroup: TreeDataNode = {
      key: 'group|web',
      selectable: false,
      title: groupTitle('group|web', 'Web 应用', webApps.length, <GlobalOutlined />),
      children: webChildren
    }

    return [...databaseGroups, webGroup]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, childrenMap, webApps, onToggleGroup, expandedKeys])

  const databaseNode = (
    instanceId: string,
    database: string,
    children?: TreeDataNode[]
  ): TreeDataNode => {
    const node: TreeDataNode = {
      key: databaseKey(instanceId, database),
      title: (
        <span className="tree-node">
          <DatabaseOutlined style={{ fontSize: 13, opacity: 0.75 }} />
          <span className="tree-label">{database}</span>
        </span>
      ),
      isLeaf: false
    }
    if (children) node.children = children
    return node
  }

  const ensureDatabases = async (instanceId: string): Promise<void> => {
    const key = instanceKey(instanceId)
    if (childrenMap[key] || loadingRef.current.has(key)) return
    const instance = instanceById.get(instanceId)
    if (!instance || instance.kind !== 'mysql' || instance.status !== 'ready') return

    loadingRef.current.add(key)
    try {
      const databases = await api.mysql.databases(instanceId)
      setChildrenMap((prev) => ({
        ...prev,
        [key]:
          databases.length > 0
            ? databases.map((database) =>
                databaseNode(instanceId, database, prev[databaseKey(instanceId, database)])
              )
            : [
                {
                  key: `${key}|empty`,
                  title: <span className="muted">暂无数据库</span>,
                  disabled: true,
                  selectable: false,
                  isLeaf: true
                }
              ]
      }))
    } catch (error) {
      onError(cleanError(error))
    } finally {
      loadingRef.current.delete(key)
    }
  }

  const ensureTables = async (instanceId: string, database: string): Promise<void> => {
    const key = databaseKey(instanceId, database)
    if (childrenMap[key] || loadingRef.current.has(key)) return

    loadingRef.current.add(key)
    try {
      const tables = await api.mysql.tables(instanceId, database)
      const tableNodes: TreeDataNode[] =
        tables.length > 0
          ? tables.map((table) => ({
              key: tableKey(instanceId, database, table.name),
              title: (
                <span className="tree-node">
                  <TableOutlined style={{ fontSize: 12, opacity: 0.7 }} />
                  <span className="tree-label">{table.name}</span>
                </span>
              ),
              isLeaf: true
            }))
          : [
              {
                key: `${key}|empty`,
                title: <span className="muted">暂无数据表</span>,
                disabled: true,
                selectable: false,
                isLeaf: true
              }
            ]

      setChildrenMap((prev) => {
        const parentKey = instanceKey(instanceId)
        const parent = prev[parentKey] ?? []
        const next: Record<string, TreeDataNode[]> = { ...prev, [key]: tableNodes }
        if (parent.some((node) => node.key === key)) {
          next[parentKey] = parent.map((node) =>
            node.key === key ? databaseNode(instanceId, database, tableNodes) : node
          )
        }
        return next
      })
    } catch (error) {
      onError(cleanError(error))
    } finally {
      loadingRef.current.delete(key)
    }
  }

  useEffect(() => {
    const selection = parseSelection(selectedKey)
    if (!selection) return
    if (selection.type === 'instance') {
      void ensureDatabases(selection.instanceId)
      return
    }
    if (selection.type === 'database' || selection.type === 'table') {
      void ensureDatabases(selection.instanceId)
      void ensureTables(selection.instanceId, selection.database)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const loadData = async (node: TreeDataNode): Promise<void> => {
    const selection = parseSelection(String(node.key))
    if (!selection) return
    if (selection.type === 'instance') {
      await ensureDatabases(selection.instanceId)
    } else if (selection.type === 'database') {
      await ensureTables(selection.instanceId, selection.database)
    }
  }

  return (
    <div className="sidebar-scroll">
      <Tree
        blockNode
        expandAction="click"
        treeData={treeData}
        selectedKeys={selectedKey ? [selectedKey] : []}
        expandedKeys={expandedKeys}
        onExpand={(keys) => onExpand(keys.map(String))}
        onSelect={(keys) => {
          const key = keys[0]
          if (typeof key === 'string' && parseSelection(key)) onSelect(key)
        }}
        loadData={loadData}
      />
    </div>
  )
}
