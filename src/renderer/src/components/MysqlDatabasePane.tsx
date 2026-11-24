import { Tag } from 'antd'
import { DatabaseOutlined } from '@ant-design/icons'
import type { InstanceMeta } from '../../../shared/types'

interface MysqlDatabasePaneProps {
  instance: InstanceMeta
  database: string
}

export default function MysqlDatabasePane({
  instance,
  database
}: MysqlDatabasePaneProps) {
  return (
    <div className="pane">
      <div className="pane-header">
        <div className="pane-title">
          <span>{database}</span>
          <Tag color="blue">数据库</Tag>
        </div>
        <div className="pane-meta">
          <span>{instance.label}</span>
          <span className="mono">
            {instance.host}:{instance.port}
          </span>
          <span className="muted">数据表已展开在左侧</span>
        </div>
      </div>
      <div className="pane-body">
        <div className="center-fill">
          <DatabaseOutlined style={{ fontSize: 36, opacity: 0.4 }} />
          <span>在左侧展开「{database}」，点击表名查看数据</span>
          <span className="muted">表的字段与索引可在表页面的「结构」标签中查看</span>
        </div>
      </div>
    </div>
  )
}
